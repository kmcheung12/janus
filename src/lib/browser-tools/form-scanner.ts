/**
 * Form scanning for Milestone 2 authoring (§5, §17).
 *
 * Produces a draft from a real form: bindings for its controls, a slot per
 * user-supplied value, and candidate steps in submission order. Deterministic
 * inspection supplies the structure; the connected agent supplies the
 * semantics.
 *
 * Scanning never submits the form. Collecting network evidence requires an
 * explicit test run, because a scan that silently submitted would have real
 * effects the user never asked for.
 */

import type {
  AuthoringBinding, Evidence, ParameterSlot, RecipeStep, ScalarSchema, ToolDraft,
} from './contract'
import { LIMITS } from './limits'
import { resolveSelector } from '../element-selector'

/** Controls M2 supports. Anything else appears as unsupported, not ignored. */
const SUPPORTED_INPUT_TYPES = new Set([
  'text', 'search', 'email', 'url', 'tel', 'number', 'checkbox',
])

/** Never becomes a slot, an example value or an exported constant. */
const SENSITIVE_TYPES = new Set(['password', 'file', 'hidden'])

export interface ScanResult {
  draft: ToolDraft
  unsupported: Array<{ description: string; reason: string }>
}

interface ScanOptions {
  form: HTMLFormElement
  principalId: string
  browserSessionId: string
  pageId: string
  documentId: string
  now?: number
}

function id(prefix: string, index: number): string {
  return `${prefix}_${index}`
}

/** CSS.escape is absent in some environments; mirror element-selector's guard. */
function escapeId(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape
    ? CSS.escape(value)
    : value.replace(/([^\w-])/g, '\\$1')
}

function labelFor(element: Element): string {
  const withId = element.id ? document.querySelector(`label[for="${escapeId(element.id)}"]`) : null
  const ancestor = element.closest('label')
  return (
    withId?.textContent?.trim()
    || ancestor?.textContent?.trim()
    || element.getAttribute('aria-label')
    || element.getAttribute('placeholder')
    || (element as HTMLInputElement).name
    || element.tagName.toLowerCase()
  ).slice(0, 120)
}

function constraintFor(element: HTMLInputElement | HTMLSelectElement): ScalarSchema {
  if (element instanceof HTMLSelectElement) {
    return {
      type: 'string',
      description: labelFor(element),
      enum: [...element.options].map((o) => o.value).slice(0, LIMITS.enumMaxEntries),
    }
  }
  if (element.type === 'checkbox') {
    return { type: 'boolean', description: labelFor(element) }
  }
  if (element.type === 'number') {
    const schema: ScalarSchema = { type: 'number', description: labelFor(element) }
    if (element.min !== '') schema.minimum = Number(element.min)
    if (element.max !== '') schema.maximum = Number(element.max)
    return schema
  }
  const schema: ScalarSchema = { type: 'string', description: labelFor(element) }
  const maxLength = element.maxLength > 0 ? element.maxLength : LIMITS.stringValueMaxLength
  schema.maxLength = Math.min(maxLength, LIMITS.stringValueMaxLength)
  if (element.required) schema.minLength = 1
  return schema
}

export function scanForm(options: ScanOptions): ScanResult {
  const { form } = options
  const now = options.now ?? Date.now()

  const bindings: AuthoringBinding[] = []
  const slots: ParameterSlot[] = []
  const steps: RecipeStep[] = []
  const evidence: Evidence[] = []
  const unsupported: ScanResult['unsupported'] = []

  let bindingIndex = 0
  let slotIndex = 0
  let stepIndex = 0

  const controls = [...form.elements] as Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>

  for (const element of controls) {
    if (element instanceof HTMLButtonElement || (element instanceof HTMLInputElement && element.type === 'submit')) {
      continue // handled as the submit step below
    }

    const type = (element as HTMLInputElement).type

    if (SENSITIVE_TYPES.has(type)) {
      // Recorded as a slot so the compiler can refuse it by name, with no
      // value ever captured.
      slots.push({ id: id('slot', slotIndex++), constraint: { type: 'string' }, sensitive: true })
      unsupported.push({ description: labelFor(element), reason: `${type} fields are never exposed` })
      continue
    }

    if (element instanceof HTMLTextAreaElement || (element as HTMLElement).isContentEditable) {
      unsupported.push({ description: labelFor(element), reason: 'rich text is not supported in this milestone' })
      continue
    }

    const isSelect = element instanceof HTMLSelectElement
    if (!isSelect && !SUPPORTED_INPUT_TYPES.has(type)) {
      unsupported.push({ description: labelFor(element), reason: `${type} controls are not supported yet` })
      continue
    }

    const selector = resolveSelector(element)
    // A selector that is not unique now will not be unique at execution time.
    if (document.querySelectorAll(selector).length !== 1) {
      unsupported.push({ description: labelFor(element), reason: 'could not derive a unique selector' })
      continue
    }

    const control = isSelect ? 'select_one' : type === 'checkbox' ? 'checkbox' : type === 'number' ? 'number' : 'text'
    const bindingId = id('b', bindingIndex++)
    bindings.push(
      isSelect
        ? {
            kind: 'control', id: bindingId, selector, control: 'select_one',
            allowedValues: [...element.options].map((o) => o.value).slice(0, LIMITS.enumMaxEntries),
          }
        : { kind: 'control', id: bindingId, selector, control },
    )

    const slotId = id('slot', slotIndex++)
    slots.push({ id: slotId, constraint: constraintFor(element), sensitive: false })

    steps.push(
      isSelect
        ? { op: 'select_option', id: id('s', stepIndex++), targetId: bindingId, value: { kind: 'slot', slotId } }
        : { op: 'set_field', id: id('s', stepIndex++), targetId: bindingId, value: { kind: 'slot', slotId } },
    )

    evidence.push({
      id: `ev_${bindingId}`,
      kind: 'form',
      summary: `${control} control labelled "${labelFor(element)}"`,
      completeness: 'complete',
      attribution: 'confirmed',
    })
  }

  // Submit, then read a result region back out of the DOM.
  const formSelector = resolveSelector(form)
  const formBindingId = id('b', bindingIndex++)
  bindings.push({ kind: 'control', id: formBindingId, selector: formSelector, control: 'form' })
  steps.push({ op: 'submit_form', id: id('s', stepIndex++), targetId: formBindingId })

  const resultRegion = findResultRegion(form)
  if (resultRegion) {
    const regionBindingId = id('b', bindingIndex++)
    bindings.push({ kind: 'control', id: regionBindingId, selector: resolveSelector(resultRegion), control: 'text' })
    steps.push({
      op: 'await_condition', id: id('s', stepIndex++),
      timeoutMs: LIMITS.stepWaitDefaultMs,
      condition: { kind: 'dom', targetId: regionBindingId, state: 'visible' },
    })
    const resultBindingId = id('b', bindingIndex++)
    bindings.push({ kind: 'dom_result', id: resultBindingId, targetId: regionBindingId, read: 'text' })
    steps.push({
      op: 'extract_result', id: id('s', stepIndex++),
      fields: [{ name: 'result', bindingId: resultBindingId }],
    })
  } else {
    // A recipe must end with an extraction, so fall back to reading the form
    // itself rather than producing a definition that cannot compile.
    const resultBindingId = id('b', bindingIndex++)
    bindings.push({ kind: 'dom_result', id: resultBindingId, targetId: formBindingId, read: 'text' })
    steps.push({
      op: 'extract_result', id: id('s', stepIndex++),
      fields: [{ name: 'result', bindingId: resultBindingId }],
    })
  }

  const draft: ToolDraft = {
    id: `draft_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    revision: 1,
    principalId: options.principalId,
    browserSessionId: options.browserSessionId,
    pageId: options.pageId,
    documentId: options.documentId,
    applicability: {
      origin: window.location.origin,
      pathnamePrefix: window.location.pathname,
    },
    status: 'pending',
    createdAt: now,
    expiresAt: now + LIMITS.draftRetentionMs,
    bindings,
    slots,
    candidateSteps: steps,
    requiredStepIds: steps.map((s) => s.id),
    evidence: evidence.slice(0, LIMITS.evidenceMaxItems),
  }

  return { draft, unsupported }
}

/**
 * A plausible place results appear. Only a hint for authoring — the user
 * confirms it, and an explicit test run proves it.
 */
function findResultRegion(form: HTMLFormElement): HTMLElement | null {
  const candidates = [
    '[role="status"]', '[aria-live]', '[data-results]', '#results', '.results',
  ]
  for (const selector of candidates) {
    const found = document.querySelector(selector) as HTMLElement | null
    if (found && !form.contains(found)) return found
  }
  return null
}
