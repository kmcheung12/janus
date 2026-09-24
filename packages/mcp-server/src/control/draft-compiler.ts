/**
 * §17 draft compilation and reference integrity.
 *
 * JSON Schema can require that a binding ID *looks* like an ID. It cannot
 * establish that the ID names something in an authorized stored draft. That
 * gap is the whole attack surface of agent-assisted authoring, so these checks
 * run after structural validation and before any definition exists.
 *
 * The client proposes semantics — a name, a description, a schema, which
 * candidate steps to keep. Janus compiles the executable definition by copying
 * locators, matchers and literals out of the draft. No selector, URL or step
 * ever originates from client text.
 */

import { randomUUID } from 'node:crypto'
import type {
  AuthoringBinding, DefinitionProposal, ErrorCode, GeneratedDefinition,
  RecipeStep, ScalarSchema, ToolDraft,
} from '../contracts/types.js'
import { LIMITS, jsonBytes } from '../contracts/limits.js'

export interface CompileFailure {
  code: ErrorCode
  message: string
}

export type CompileResult =
  | { ok: true; definition: GeneratedDefinition }
  | { ok: false; failure: CompileFailure }

function fail(code: ErrorCode, message: string): CompileResult {
  return { ok: false, failure: { code, message } }
}

export interface CompileOptions {
  draft: ToolDraft
  draftRevision: number
  proposal: DefinitionProposal
  principalId: string
  now?: number
}

export function compileDefinition(options: CompileOptions): CompileResult {
  const { draft, proposal, principalId } = options
  const now = options.now ?? Date.now()

  // ── 1. Draft resolution ──────────────────────────────────────────────────
  if (draft.principalId !== principalId) {
    // Reject as stale rather than "forbidden": confirming another principal's
    // draft ID exists is itself a leak.
    return fail('DRAFT_STALE', 'No such draft for this client')
  }
  if (draft.revision !== options.draftRevision) {
    return fail('DRAFT_STALE', `Draft is at revision ${draft.revision}; re-read it and resubmit`)
  }
  if (draft.status === 'expired' || draft.expiresAt <= now) {
    return fail('DRAFT_EXPIRED', 'The draft expired; capture it again')
  }

  // ── 2. Reference integrity ───────────────────────────────────────────────
  const bindingIds = new Set<string>()
  for (const binding of draft.bindings) {
    if (bindingIds.has(binding.id)) return fail('INVALID_DEFINITION', `Duplicate binding ID "${binding.id}"`)
    bindingIds.add(binding.id)
  }

  const slotIds = new Set<string>()
  for (const slot of draft.slots) {
    if (slotIds.has(slot.id)) return fail('INVALID_DEFINITION', `Duplicate slot ID "${slot.id}"`)
    slotIds.add(slot.id)
  }

  const candidates = new Map<string, RecipeStep>()
  for (const step of draft.candidateSteps) {
    if (candidates.has(step.id)) return fail('INVALID_DEFINITION', `Duplicate step ID "${step.id}"`)
    candidates.set(step.id, step)
  }

  const selected = new Set<string>()
  for (const stepId of proposal.stepIds) {
    if (!candidates.has(stepId)) {
      return fail('INVALID_DEFINITION', `Step "${stepId}" is not a candidate in this draft`)
    }
    if (selected.has(stepId)) return fail('INVALID_DEFINITION', `Step "${stepId}" was selected twice`)
    selected.add(stepId)
  }
  for (const required of draft.requiredStepIds) {
    if (!selected.has(required)) {
      return fail('INVALID_DEFINITION', `Step "${required}" is required and cannot be dropped`)
    }
  }
  // In M2 all candidate steps are required; optional subworkflows are not part
  // of form authoring.
  if (selected.size !== candidates.size) {
    return fail('INVALID_DEFINITION', 'Form authoring requires selecting every candidate step')
  }

  // Preserve the authored order, never the order the client happened to send.
  const steps = draft.candidateSteps.filter((s) => selected.has(s.id))

  // ── 3. Parameter mapping ─────────────────────────────────────────────────
  const schemaProperties = Object.keys(proposal.inputSchema.properties ?? {})
  const parameterNames = proposal.parameters.map((p) => p.name)

  if (new Set(parameterNames).size !== parameterNames.length) {
    return fail('INVALID_DEFINITION', 'Duplicate parameter names')
  }
  if (new Set(proposal.parameters.map((p) => p.slotId)).size !== proposal.parameters.length) {
    return fail('INVALID_DEFINITION', 'Two parameters map to the same slot')
  }
  if ([...schemaProperties].sort().join() !== [...parameterNames].sort().join()) {
    return fail('INVALID_DEFINITION', 'Input schema properties and parameter names must correspond exactly')
  }
  if ([...(proposal.inputSchema.required ?? [])].sort().join() !== [...schemaProperties].sort().join()) {
    return fail('INVALID_DEFINITION', 'Every proposed property must be required in v1')
  }
  if (proposal.inputSchema.additionalProperties !== false) {
    return fail('INVALID_DEFINITION', 'Input schema must be closed')
  }
  if (proposal.parameters.length > LIMITS.recipeMaxParameters) {
    return fail('INVALID_DEFINITION', 'Too many parameters')
  }

  const slotsById = new Map(draft.slots.map((s) => [s.id, s]))
  for (const parameter of proposal.parameters) {
    const slot = slotsById.get(parameter.slotId)
    if (!slot) return fail('INVALID_DEFINITION', `Slot "${parameter.slotId}" is not in this draft`)
    if (slot.sensitive) {
      // A password or session field must never become a tool parameter.
      return fail('INVALID_DEFINITION', `Slot "${parameter.slotId}" is sensitive and cannot be exposed`)
    }
    const constraintFailure = narrows(proposal.inputSchema.properties[parameter.name], slot.constraint)
    if (constraintFailure) return fail('INVALID_DEFINITION', `${parameter.name}: ${constraintFailure}`)
  }

  // Every slot the selected steps or matchers actually consume must be mapped,
  // or execution would fail at run time on a missing argument.
  const mapped = new Set(proposal.parameters.map((p) => p.slotId))
  for (const slotId of usedSlots(steps, draft.bindings)) {
    if (!mapped.has(slotId)) return fail('INVALID_DEFINITION', `Slot "${slotId}" is used by a step but unmapped`)
  }

  // ── 4/5. Step and binding reference kinds ────────────────────────────────
  const bindings = new Map(draft.bindings.map((b) => [b.id, b]))
  const structural = validateStepReferences(steps, bindings)
  if (structural) return fail('INVALID_DEFINITION', structural)

  // ── 6. Applicability ─────────────────────────────────────────────────────
  const applicabilityFailure = validateApplicability(draft)
  if (applicabilityFailure) return fail('INVALID_DEFINITION', applicabilityFailure)

  // ── 7. Assign trusted fields ─────────────────────────────────────────────
  // Effects default to the cautious reading: anything that writes, submits or
  // activates a control is consequential and not read-only.
  const mutates = steps.some((s) =>
    s.op === 'set_field' || s.op === 'select_option' || s.op === 'click' || s.op === 'submit_form')

  const definition: GeneratedDefinition = {
    formatVersion: 1,
    definitionId: `def_${randomUUID().replace(/-/g, '')}`,
    definitionRevision: 1,
    principalId,
    sourceDraft: { id: draft.id, revision: draft.revision },
    applicability: draft.applicability,
    name: proposal.name,
    description: proposal.description,
    inputSchema: proposal.inputSchema,
    parameters: proposal.parameters,
    // Copied from the draft, never from client text.
    slots: draft.slots,
    bindings: draft.bindings,
    steps,
    evidenceIds: draft.evidence.map((e) => e.id),
    annotations: { readOnly: !mutates, consequential: mutates },
    createdAt: now,
    updatedAt: now,
  }

  if (jsonBytes(definition) > LIMITS.definitionMaxBytes) {
    return fail('INVALID_DEFINITION', 'Compiled definition exceeds the size limit')
  }

  return { ok: true, definition }
}

/** A proposed schema may narrow the captured constraint, never widen it. */
function narrows(proposed: ScalarSchema | undefined, captured: ScalarSchema): string | undefined {
  if (!proposed) return 'missing schema'

  const widening = proposed.type !== captured.type
    // integer may narrow number, but not the reverse.
    && !(captured.type === 'number' && proposed.type === 'integer')
  if (widening) return `type ${proposed.type} does not match the captured ${captured.type}`

  if (proposed.type === 'string' && captured.type === 'string') {
    if (captured.enum && (!proposed.enum || proposed.enum.some((v) => !captured.enum!.includes(v)))) {
      return 'enum must be a subset of the captured options'
    }
    if (captured.maxLength !== undefined && (proposed.maxLength ?? Infinity) > captured.maxLength) {
      return 'maxLength cannot exceed the captured limit'
    }
    if (captured.minLength !== undefined && (proposed.minLength ?? 0) < captured.minLength) {
      return 'minLength cannot fall below the captured limit'
    }
    if ((proposed.maxLength ?? 0) > LIMITS.stringValueMaxLength) {
      return 'maxLength exceeds the hard string limit'
    }
    if (proposed.minLength !== undefined && proposed.maxLength !== undefined
      && proposed.minLength > proposed.maxLength) {
      return 'minLength exceeds maxLength'
    }
  }

  if ((proposed.type === 'number' || proposed.type === 'integer')
    && (captured.type === 'number' || captured.type === 'integer')) {
    if (captured.minimum !== undefined && (proposed.minimum ?? -Infinity) < captured.minimum) {
      return 'minimum cannot fall below the captured limit'
    }
    if (captured.maximum !== undefined && (proposed.maximum ?? Infinity) > captured.maximum) {
      return 'maximum cannot exceed the captured limit'
    }
    if (proposed.minimum !== undefined && proposed.maximum !== undefined
      && proposed.minimum > proposed.maximum) {
      return 'minimum exceeds maximum'
    }
  }

  return undefined
}

function usedSlots(steps: RecipeStep[], bindings: AuthoringBinding[]): Set<string> {
  const used = new Set<string>()
  for (const step of steps) {
    if ((step.op === 'set_field' || step.op === 'select_option') && step.value.kind === 'slot') {
      used.add(step.value.slotId)
    }
  }
  for (const binding of bindings) {
    if (binding.kind !== 'response') continue
    for (const match of binding.match) {
      if (match.expected.kind === 'slot') used.add(match.expected.slotId)
    }
  }
  return used
}

const CONTROL_FOR_OP: Record<string, string[]> = {
  set_field: ['text', 'number', 'checkbox'],
  select_option: ['select_one'],
  click: ['button'],
  submit_form: ['form'],
}

function validateStepReferences(steps: RecipeStep[], bindings: Map<string, AuthoringBinding>): string | undefined {
  if (steps.length > LIMITS.recipeMaxSteps) return 'Too many steps'
  if (bindings.size > LIMITS.recipeMaxBindings) return 'Too many bindings'

  const seenStepIds = new Set<string>()
  const observerSteps = new Set<string>()
  const waitedObservers = new Set<string>()
  let extractIndex = -1

  for (const [index, step] of steps.entries()) {
    // No forward references: a step may only name something already defined.
    seenStepIds.add(step.id)

    const expected = CONTROL_FOR_OP[step.op]
    if (expected) {
      const targetId = (step as { targetId: string }).targetId
      const binding = bindings.get(targetId)
      if (!binding) return `Step "${step.id}" targets unknown binding "${targetId}"`
      if (binding.kind !== 'control') return `Step "${step.id}" must target a control binding`
      if (!expected.includes(binding.control)) {
        return `${step.op} cannot target a ${binding.control} control`
      }
    }

    if (step.op === 'observe_response') {
      const binding = bindings.get(step.responseBindingId)
      if (binding?.kind !== 'response') return `Step "${step.id}" must reference a response binding`
      observerSteps.add(step.id)
    }

    if (step.op === 'await_condition') {
      if (step.condition.kind === 'response') {
        if (!observerSteps.has(step.condition.observerStepId)) {
          return `Step "${step.id}" waits on an observer that has not started`
        }
        waitedObservers.add(step.condition.observerStepId)
      } else {
        const binding = bindings.get(step.condition.targetId)
        if (binding?.kind !== 'control') return `Step "${step.id}" must wait on a control binding`
      }
      if (step.timeoutMs < LIMITS.stepWaitMinMs || step.timeoutMs > LIMITS.stepWaitMaxMs) {
        return `Step "${step.id}" wait is outside the permitted range`
      }
    }

    if (step.op === 'extract_result') {
      if (extractIndex >= 0) return 'Only one extract_result step is permitted'
      if (index !== steps.length - 1) return 'extract_result must be the final step'
      extractIndex = index

      const names = new Set<string>()
      if (step.fields.length > LIMITS.recipeMaxOutputFields) return 'Too many output fields'
      for (const field of step.fields) {
        if (names.has(field.name)) return `Duplicate output field "${field.name}"`
        names.add(field.name)

        const binding = bindings.get(field.bindingId)
        if (!binding) return `Output "${field.name}" references unknown binding`
        if (binding.kind === 'json_result') {
          if (!observerSteps.has(binding.observerStepId)) {
            return `Output "${field.name}" reads an observer that never started`
          }
          if (!waitedObservers.has(binding.observerStepId)) {
            // Reading before the wait would race the response.
            return `Output "${field.name}" reads a response that was never awaited`
          }
          if (!binding.pointer.startsWith('/') && binding.pointer !== '') {
            return `Output "${field.name}" must use a JSON Pointer`
          }
        } else if (binding.kind === 'dom_result') {
          const target = bindings.get(binding.targetId)
          if (target?.kind !== 'control') return `Output "${field.name}" must read a control`
        } else {
          return `Output "${field.name}" does not reference a result binding`
        }
      }
    }
  }

  if (extractIndex < 0) return 'A definition must end with exactly one extract_result step'
  return undefined
}

function validateApplicability(draft: ToolDraft): string | undefined {
  let origin: URL
  try {
    origin = new URL(draft.applicability.origin)
  } catch {
    return 'Applicability origin is not a URL'
  }
  if (origin.protocol !== 'http:' && origin.protocol !== 'https:') return 'Origin must be http(s)'
  if (origin.username || origin.password) return 'Origin must not carry credentials'
  if (origin.origin !== draft.applicability.origin) return 'Origin must be a bare origin'
  if (!draft.applicability.pathnamePrefix.startsWith('/')) return 'Path prefix must start with /'

  for (const binding of draft.bindings) {
    if (binding.kind !== 'response') continue
    if (!binding.pathname.startsWith('/')) return 'Response matcher path must start with /'
    for (const match of binding.match) {
      if (match.location === 'json_body' && !match.pointer.startsWith('/') && match.pointer !== '') {
        return 'Response body matcher must use a JSON Pointer'
      }
    }
  }
  return undefined
}
