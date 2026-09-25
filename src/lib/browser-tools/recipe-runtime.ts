/**
 * Generated-tool execution (§11).
 *
 * Interprets a fixed, non-Turing-complete step vocabulary. There is no eval,
 * no user-defined function, no recursion and no unbounded loop — a step is one
 * of seven packaged operations, and the exhaustive switch below is what makes
 * that guarantee real rather than aspirational.
 *
 * Selectors, matchers and extraction paths come from the enabled definition.
 * The caller supplies only declared business values, which are never
 * interpolated into a selector.
 */

import type {
  AuthoringBinding, GeneratedDefinition, Json, RecipeStep, ToolError, ToolOutcome, ValueRef,
} from './contract'
import { LIMITS, jsonBytes } from './limits'
import { isVisible } from './visibility'
import { observeResponses, type ResponseObserver } from './response-observer'

export interface RunOptions {
  definition: GeneratedDefinition
  input: Record<string, Json>
  signal: AbortSignal
  /** Remaining budget from the daemon, already net of queue time. */
  timeoutMs: number
}

export interface RunResult {
  outcome: ToolOutcome
  /** False only when we cannot establish that the page stopped working. */
  executionStopped: boolean
}

class StepFailure extends Error {
  constructor(
    public readonly code: ToolError['code'],
    message: string,
    public readonly execution: ToolError['execution'] = 'failed',
  ) {
    super(message)
  }
}

export async function run(options: RunOptions): Promise<RunResult> {
  const { definition, input, signal } = options
  const deadline = Date.now() + options.timeoutMs
  const bindings = new Map(definition.bindings.map((b) => [b.id, b]))
  const observers = new Map<string, ResponseObserver>()
  const outputs: Record<string, Json> = {}

  // Nothing has touched the page yet, so a failure here is not_started.
  let started = false

  try {
    if (!matchesApplicability(definition)) {
      throw new StepFailure('STALE_DOCUMENT', 'This page no longer matches the tool definition', 'not_started')
    }
    if (definition.steps.length > LIMITS.recipeMaxSteps) {
      throw new StepFailure('INVALID_DEFINITION', 'Recipe exceeds the step limit', 'not_started')
    }

    for (const step of definition.steps) {
      if (signal.aborted) throw new StepFailure('CANCELLED', 'Cancelled', started ? 'outcome_unknown' : 'not_started')
      if (Date.now() > deadline) {
        throw new StepFailure('DEADLINE_EXCEEDED', 'Ran out of time', started ? 'outcome_unknown' : 'not_started')
      }
      started = await runStep(step, { definition, input, bindings, observers, outputs, deadline, signal }) || started
    }

    const result = outputs as Json
    if (jsonBytes(result) > LIMITS.toolResultMaxBytes) {
      throw new StepFailure('RESULT_LIMIT', 'Result exceeds the size limit and was not truncated')
    }
    return { outcome: { status: 'completed', result }, executionStopped: true }
  } catch (e) {
    const failure = e instanceof StepFailure
      ? e
      : new StepFailure('INTERNAL_ERROR', String((e as Error)?.message ?? e))
    return {
      outcome: {
        status: 'error',
        error: { code: failure.code, message: failure.message, execution: failure.execution },
      },
      // Only an unknown outcome may leave execution unresolved.
      executionStopped: failure.execution !== 'outcome_unknown',
    }
  } finally {
    // §11: observers are removed on completion, timeout, cancellation or
    // document invalidation, without exception.
    for (const observer of observers.values()) observer.stop()
  }
}

interface StepContext {
  definition: GeneratedDefinition
  input: Record<string, Json>
  bindings: Map<string, AuthoringBinding>
  observers: Map<string, ResponseObserver>
  outputs: Record<string, Json>
  deadline: number
  signal: AbortSignal
}

/** Returns true if the step may have had an observable effect on the page. */
async function runStep(step: RecipeStep, ctx: StepContext): Promise<boolean> {
  switch (step.op) {
    case 'set_field': {
      const element = resolveControl(step.targetId, ctx)
      setNativeValue(element, String(resolveValue(step.value, ctx)))
      return true
    }

    case 'select_option': {
      const element = resolveControl(step.targetId, ctx) as HTMLSelectElement
      const wanted = String(resolveValue(step.value, ctx))
      const binding = ctx.bindings.get(step.targetId)
      // Option selection is a bounded operation on an already-selected
      // control: the value must be one the definition recorded.
      if (binding?.kind === 'control' && binding.allowedValues && !binding.allowedValues.includes(wanted)) {
        throw new StepFailure('INVALID_INPUT', `"${wanted}" is not an allowed option`, 'not_started')
      }
      const option = [...element.options].find((o) => o.value === wanted || o.label === wanted)
      if (!option) throw new StepFailure('TARGET_MISSING', `No option "${wanted}"`)
      element.value = option.value
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }

    case 'click': {
      resolveControl(step.targetId, ctx).click()
      return true
    }

    case 'submit_form': {
      const form = resolveControl(step.targetId, ctx) as HTMLFormElement
      if (typeof form.requestSubmit === 'function') form.requestSubmit()
      else form.submit()
      return true
    }

    case 'observe_response': {
      const binding = ctx.bindings.get(step.responseBindingId)
      if (binding?.kind !== 'response') {
        throw new StepFailure('INVALID_DEFINITION', 'observe_response needs a response binding', 'not_started')
      }
      if (ctx.observers.size >= LIMITS.responseObserversPerInvocation) {
        throw new StepFailure('INVALID_DEFINITION', 'Too many response observers', 'not_started')
      }
      // Armed before the triggering action, so a fast response cannot be
      // missed between the click and the observer being installed.
      ctx.observers.set(step.id, observeResponses(binding, ctx.input, ctx.definition))
      return false
    }

    case 'await_condition': {
      const budget = Math.min(
        Math.max(step.timeoutMs, LIMITS.stepWaitMinMs),
        LIMITS.stepWaitMaxMs,
        ctx.deadline - Date.now(),
      )
      if (step.condition.kind === 'dom') {
        await awaitDom(step.condition.targetId, step.condition.state, budget, ctx)
      } else {
        const observer = ctx.observers.get(step.condition.observerStepId)
        if (!observer) throw new StepFailure('INVALID_DEFINITION', 'Wait references an unknown observer', 'not_started')
        await observer.settled(budget)
      }
      return false
    }

    case 'extract_result': {
      if (step.fields.length > LIMITS.recipeMaxOutputFields) {
        throw new StepFailure('INVALID_DEFINITION', 'Too many output fields', 'not_started')
      }
      for (const field of step.fields) {
        ctx.outputs[field.name] = extract(field.bindingId, ctx)
      }
      return false
    }

    default: {
      // The vocabulary is closed. A new operation must fail loudly here rather
      // than being silently ignored, and TypeScript makes reaching this line a
      // compile error if a variant is ever added without handling.
      const unreachable: never = step
      throw new StepFailure('INVALID_DEFINITION', `Unsupported operation: ${JSON.stringify(unreachable)}`, 'not_started')
    }
  }
}

function matchesApplicability(definition: GeneratedDefinition): boolean {
  const { origin, pathnamePrefix } = definition.applicability
  if (window.location.origin !== origin) return false
  const path = window.location.pathname
  // Segment-boundary matching, so /admin does not match /administrator.
  return path === pathnamePrefix
    || path.startsWith(pathnamePrefix.endsWith('/') ? pathnamePrefix : `${pathnamePrefix}/`)
}

function resolveValue(ref: ValueRef, ctx: StepContext): Json {
  if (ref.kind === 'literal') return ref.value
  const parameter = ctx.definition.parameters.find((p) => p.slotId === ref.slotId)
  if (!parameter) throw new StepFailure('INVALID_DEFINITION', 'Step references an unmapped slot', 'not_started')
  const value = ctx.input[parameter.name]
  if (value === undefined) throw new StepFailure('INVALID_INPUT', `Missing argument "${parameter.name}"`, 'not_started')
  if (typeof value === 'string' && value.length > LIMITS.stringValueMaxLength) {
    throw new StepFailure('INVALID_INPUT', `"${parameter.name}" exceeds the string limit`, 'not_started')
  }
  return value
}

/** Resolve an authored selector, requiring exactly one match (§18). */
function resolveControl(bindingId: string, ctx: StepContext): HTMLElement {
  const binding = ctx.bindings.get(bindingId)
  if (binding?.kind !== 'control') {
    throw new StepFailure('INVALID_DEFINITION', 'Step references a non-control binding', 'not_started')
  }
  let matches: NodeListOf<Element>
  try {
    matches = document.querySelectorAll(binding.selector)
  } catch {
    throw new StepFailure('INVALID_DEFINITION', 'Stored selector is not valid', 'not_started')
  }
  if (matches.length === 0) {
    throw new StepFailure('TARGET_MISSING', `The page no longer has ${describe(binding)}. The tool needs re-authoring.`)
  }
  if (matches.length > 1) {
    // Picking the first would silently act on an unrelated element.
    throw new StepFailure('TARGET_AMBIGUOUS', `${matches.length} elements match ${describe(binding)}. The tool needs re-authoring.`)
  }
  return matches[0] as HTMLElement
}

function describe(binding: Extract<AuthoringBinding, { kind: 'control' }>): string {
  return `the ${binding.control} "${binding.selector}"`
}

/**
 * React and other frameworks track the value through a property setter, so
 * assigning `.value` directly leaves their state stale and the input reverts.
 */
function setNativeValue(element: HTMLElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set

  if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
    const next = value === 'true' || value === '1'
    if (element.checked !== next) element.click()
    return
  }

  if (setter) setter.call(element, value)
  else (element as HTMLInputElement).value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

async function awaitDom(
  bindingId: string,
  state: 'visible' | 'hidden' | 'enabled',
  budget: number,
  ctx: StepContext,
): Promise<void> {
  const deadline = Date.now() + budget
  // A packaged bounded wait, not a programmable loop: the caller cannot change
  // the predicate, the interval or the bound.
  while (Date.now() < deadline) {
    if (ctx.signal.aborted) throw new StepFailure('CANCELLED', 'Cancelled', 'outcome_unknown')
    if (conditionHolds(bindingId, state, ctx)) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new StepFailure('TARGET_MISSING', `Timed out waiting for the target to become ${state}`)
}

function conditionHolds(bindingId: string, state: 'visible' | 'hidden' | 'enabled', ctx: StepContext): boolean {
  const binding = ctx.bindings.get(bindingId)
  if (binding?.kind !== 'control') return false
  const element = document.querySelector(binding.selector) as HTMLElement | null
  if (state === 'hidden') return !element || !isVisible(element)
  if (!element) return false
  if (state === 'visible') return isVisible(element)
  return !(element as HTMLInputElement).disabled
}

function extract(bindingId: string, ctx: StepContext): Json {
  const binding = ctx.bindings.get(bindingId)
  if (!binding) throw new StepFailure('INVALID_DEFINITION', 'Unknown result binding', 'not_started')

  if (binding.kind === 'dom_result') {
    const element = resolveControl(binding.targetId, ctx)
    if (binding.read === 'text') return element.textContent?.trim() ?? null
    if (binding.read === 'checked') return (element as HTMLInputElement).checked
    return (element as HTMLInputElement).value ?? null
  }

  if (binding.kind === 'json_result') {
    const observer = ctx.observers.get(binding.observerStepId)
    if (!observer) throw new StepFailure('INVALID_DEFINITION', 'Result references an unknown observer', 'not_started')
    return observer.read(binding.pointer)
  }

  throw new StepFailure('INVALID_DEFINITION', 'Binding is not a result source', 'not_started')
}
