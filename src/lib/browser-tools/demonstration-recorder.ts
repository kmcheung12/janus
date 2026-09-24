/**
 * Demonstration authoring capture (§11, Milestone 3).
 *
 * Deliberately not the journey recorder. That one exists to show a human what
 * happened: it collapses adjacent events and keeps the last 50, which is right
 * for a display buffer and fatal for authoring — a 60-step demonstration would
 * silently lose its beginning, and collapsed keystrokes cannot be turned back
 * into parameter bindings.
 *
 * So this has its own semantics: explicit start/stop, ordered steps, no
 * collapsing, a visible capacity limit instead of silent truncation, and
 * durable storage.
 *
 * It also records values, which the journey recorder deliberately does not.
 * That makes sensitive-field exclusion a requirement here rather than a nicety.
 */

import type {
  AuthoringBinding, Evidence, ParameterSlot, RecipeStep, ScalarSchema, ToolDraft,
} from './contract'
import { LIMITS } from './limits'
import { resolveSelector } from '../element-selector'
import { activeInvocationId } from './provenance'

export type StopReason = 'user' | 'time_limit' | 'event_limit' | 'size_limit' | 'navigation'

export interface RecordedStep {
  index: number
  kind: 'set_field' | 'select_option' | 'click' | 'submit_form'
  selector: string
  control: 'text' | 'number' | 'checkbox' | 'select_one' | 'button' | 'form'
  label: string
  /** Captured only for non-sensitive fields; the user confirms before use. */
  value?: string
  allowedValues?: string[]
  constraint?: ScalarSchema
  /** Excluded from authoring by default — we cannot prove we caused it. */
  actor: 'human' | 'unknown'
  invocationId?: string
  at: number
}

export interface RecordingState {
  id: string
  startedAt: number
  steps: RecordedStep[]
  stopped?: StopReason
  /** Steps dropped because a limit was hit, surfaced rather than hidden. */
  overflowed: boolean
  bytes: number
}

const SENSITIVE_TYPES = new Set(['password', 'file', 'hidden'])
const IGNORED_TYPES = new Set(['submit', 'reset', 'image', 'button'])

let state: RecordingState | null = null
let detach: Array<() => void> = []
let onChange: ((state: RecordingState) => void) | null = null

export function current(): RecordingState | null {
  return state
}

export function isRecording(): boolean {
  return state !== null && !state.stopped
}

function emit(): void {
  if (state) onChange?.({ ...state, steps: [...state.steps] })
}

function labelFor(element: Element): string {
  const ancestor = element.closest('label')
  return (
    ancestor?.textContent?.trim()
    || element.getAttribute('aria-label')
    || element.getAttribute('placeholder')
    || (element as HTMLInputElement).name
    || element.tagName.toLowerCase()
  ).slice(0, 120)
}

function isSensitive(element: Element): boolean {
  const type = (element as HTMLInputElement).type
  if (SENSITIVE_TYPES.has(type)) return true
  // Autocomplete hints are the site telling us this is a credential.
  const autocomplete = element.getAttribute('autocomplete') ?? ''
  return /password|cc-number|cc-csc|one-time-code/.test(autocomplete)
}

function push(step: Omit<RecordedStep, 'index' | 'at' | 'actor' | 'invocationId'>): void {
  if (!state || state.stopped) return

  const invocationId = activeInvocationId()
  const entry: RecordedStep = {
    ...step,
    index: state.steps.length,
    at: Date.now(),
    // We cannot prove an agent caused this, only that it coincided. Authoring
    // excludes uncertain steps by default rather than learning from them.
    actor: invocationId ? 'unknown' : 'human',
    invocationId: invocationId ?? undefined,
  }

  const size = JSON.stringify(entry).length
  if (state.steps.length >= LIMITS.demonstrationMaxEvents) { stop('event_limit'); return }
  if (state.bytes + size > LIMITS.demonstrationMaxBytes) { stop('size_limit'); return }
  if (Date.now() - state.startedAt > LIMITS.demonstrationMaxMs) { stop('time_limit'); return }

  state.bytes += size
  // No collapsing: two identical clicks are two steps, because a recipe that
  // dropped one would do the wrong thing.
  state.steps.push(entry)
  emit()
}

export function start(listener?: (state: RecordingState) => void): RecordingState {
  stop('user')
  onChange = listener ?? null
  state = {
    id: `rec_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    startedAt: Date.now(),
    steps: [],
    overflowed: false,
    bytes: 0,
  }

  const onInput = (event: Event) => {
    const target = event.target as HTMLElement
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return
    if (isSensitive(target)) return // never recorded, not even redacted later
    const type = (target as HTMLInputElement).type
    if (IGNORED_TYPES.has(type)) return

    const isSelect = target instanceof HTMLSelectElement
    const selector = resolveSelector(target)

    // Replace rather than append while the user keeps typing into one field:
    // the final value is the parameter, and intermediate keystrokes are noise.
    const last = state?.steps.at(-1)
    if (last && last.selector === selector && (last.kind === 'set_field' || last.kind === 'select_option')) {
      last.value = target.value
      emit()
      return
    }

    push({
      kind: isSelect ? 'select_option' : 'set_field',
      selector,
      control: isSelect ? 'select_one'
        : type === 'checkbox' ? 'checkbox'
        : type === 'number' ? 'number' : 'text',
      label: labelFor(target),
      value: type === 'checkbox' ? String((target as HTMLInputElement).checked) : target.value,
      allowedValues: isSelect ? [...target.options].map((o) => o.value) : undefined,
      constraint: isSelect
        ? { type: 'string', enum: [...target.options].map((o) => o.value) }
        : type === 'checkbox' ? { type: 'boolean' }
        : type === 'number' ? { type: 'number' }
        : { type: 'string', maxLength: LIMITS.stringValueMaxLength },
    })
  }

  const onClick = (event: MouseEvent) => {
    const target = (event.target as HTMLElement)?.closest('button, [role="button"], a') as HTMLElement | null
    if (!target) return
    push({
      kind: 'click',
      selector: resolveSelector(target),
      control: 'button',
      label: labelFor(target),
    })
  }

  const onSubmit = (event: SubmitEvent) => {
    const form = event.target as HTMLFormElement
    push({
      kind: 'submit_form',
      selector: resolveSelector(form),
      control: 'form',
      label: labelFor(form),
    })
  }

  document.addEventListener('change', onInput, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('submit', onSubmit, true)

  detach = [
    () => document.removeEventListener('change', onInput, true),
    () => document.removeEventListener('click', onClick, true),
    () => document.removeEventListener('submit', onSubmit, true),
  ]

  emit()
  return state
}

export function stop(reason: StopReason = 'user'): RecordingState | null {
  if (!state) return null
  for (const fn of detach) fn()
  detach = []
  if (!state.stopped) {
    state.stopped = reason
    // A capacity stop is a visible failure, not a silent truncation.
    state.overflowed = reason === 'event_limit' || reason === 'size_limit'
  }
  emit()
  const finished = state
  state = null
  return finished
}

export interface BuildOptions {
  recording: RecordingState
  principalId: string
  browserSessionId: string
  pageId: string
  documentId: string
  /** Step indices the user confirmed should become parameters. */
  parameterIndices: number[]
  /** Step index whose element supplies the result. */
  resultIndex?: number
  now?: number
}

/**
 * Turn a confirmed recording into a draft.
 *
 * Steps whose attribution is uncertain are excluded: they require explicit
 * resolution rather than silently becoming training examples (§10).
 */
export function buildDraft(options: BuildOptions): { draft: ToolDraft; excluded: RecordedStep[] } {
  const now = options.now ?? Date.now()
  const excluded = options.recording.steps.filter((s) => s.actor !== 'human')
  const usable = options.recording.steps.filter((s) => s.actor === 'human')

  const bindings: AuthoringBinding[] = []
  const slots: ParameterSlot[] = []
  const steps: RecipeStep[] = []
  const evidence: Evidence[] = []

  let index = 0
  for (const recorded of usable) {
    const bindingId = `b_${index}`
    bindings.push(
      recorded.control === 'select_one'
        ? { kind: 'control', id: bindingId, selector: recorded.selector, control: 'select_one', allowedValues: recorded.allowedValues }
        : { kind: 'control', id: bindingId, selector: recorded.selector, control: recorded.control },
    )

    const stepId = `s_${index}`
    if (recorded.kind === 'set_field' || recorded.kind === 'select_option') {
      const parameterised = options.parameterIndices.includes(recorded.index)
      if (parameterised) {
        const slotId = `p_${index}`
        slots.push({
          id: slotId,
          constraint: recorded.constraint ?? { type: 'string' },
          sensitive: false,
        })
        steps.push({ op: recorded.kind, id: stepId, targetId: bindingId, value: { kind: 'slot', slotId } })
      } else {
        // Not a parameter: the demonstrated value is baked in as a literal.
        steps.push({
          op: recorded.kind, id: stepId, targetId: bindingId,
          value: { kind: 'literal', value: recorded.value ?? '' },
        })
      }
    } else if (recorded.kind === 'click') {
      steps.push({ op: 'click', id: stepId, targetId: bindingId })
    } else {
      steps.push({ op: 'submit_form', id: stepId, targetId: bindingId })
    }

    evidence.push({
      id: `ev_${index}`,
      kind: 'journey',
      summary: `${recorded.kind} on "${recorded.label}"`,
      completeness: 'complete',
      attribution: 'confirmed',
    })
    index++
  }

  // A recipe must end in an extraction. Use the confirmed result element, or
  // fall back to the last touched element.
  const resultBindingId = `b_result`
  const sourceBinding = options.resultIndex !== undefined
    ? bindings[options.resultIndex]
    : bindings.at(-1)
  bindings.push({
    kind: 'dom_result', id: resultBindingId,
    targetId: sourceBinding?.id ?? 'b_0', read: 'text',
  })
  steps.push({
    op: 'extract_result', id: `s_${index}`,
    fields: [{ name: 'result', bindingId: resultBindingId }],
  })

  const draft: ToolDraft = {
    id: `draft_${options.recording.id.slice(4)}`,
    revision: 1,
    principalId: options.principalId,
    browserSessionId: options.browserSessionId,
    pageId: options.pageId,
    documentId: options.documentId,
    applicability: { origin: window.location.origin, pathnamePrefix: window.location.pathname },
    status: 'pending',
    createdAt: now,
    expiresAt: now + LIMITS.draftRetentionMs,
    bindings,
    slots,
    candidateSteps: steps,
    requiredStepIds: steps.map((s) => s.id),
    evidence: evidence.slice(0, LIMITS.evidenceMaxItems),
  }

  return { draft, excluded }
}
