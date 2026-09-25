/**
 * Authoring draft store and the three agent-facing authoring tools (§8).
 *
 * The extension captures a draft and holds it; the daemon mirrors it so an
 * agent can read it. Submission compiles a definition but never enables it —
 * activation stays in the extension UI, so a model cannot grant itself a new
 * execution target.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import type { DefinitionProposal, GeneratedDefinition, Id, ToolDraft } from '../contracts/types.js'
import { LIMITS } from '../contracts/limits.js'
import { validateAs } from '../contracts/validate.js'
import { compileDefinition } from './draft-compiler.js'
import type { ClientRecord } from '../credentials.js'

interface StoredDraft {
  draft: ToolDraft
  pairingId: string
}

const drafts = new Map<Id, StoredDraft>()

/** Idempotency for an administrative store retry (§17), keyed by request. */
const submissions = new Map<string, { definition: GeneratedDefinition; at: number; fingerprint: string }>()

export function upsertDraft(pairingId: string, draft: ToolDraft): boolean {
  if (drafts.size >= LIMITS.pendingDefinitionsAndDraftsMax && !drafts.has(draft.id)) return false
  drafts.set(draft.id, { pairingId, draft })
  return true
}

export function removeDraft(draftId: Id): void {
  drafts.delete(draftId)
}

/** Clear a disconnected executor's drafts; never serve stale ones as current. */
export function clearDraftsForPairing(pairingId: string): void {
  for (const [id, stored] of drafts) {
    if (stored.pairingId === pairingId) drafts.delete(id)
  }
}

function visible(principal: ClientRecord): StoredDraft[] {
  if (!principal.authoring) return []
  return [...drafts.values()].filter(
    (d) => principal.pairingIds.includes(d.pairingId) && d.draft.principalId === principal.clientId,
  )
}

export const authoringTools: Tool[] = [
  {
    name: 'list_tool_drafts',
    description:
      'List pending tool drafts captured in the Janus extension and awaiting a proposed definition from you.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_tool_draft',
    description:
      'Read one draft: its selected controls, parameter slots, candidate steps and redacted evidence. ' +
      'Use it to propose a tool name, description and input schema.',
    inputSchema: {
      type: 'object',
      properties: { draftId: { type: 'string' } },
      required: ['draftId'],
    },
  },
  {
    name: 'submit_tool_definition',
    description:
      'Propose semantics for a draft. You supply a name, description, input schema, parameter-to-slot ' +
      'mappings and which candidate step IDs to keep. You cannot supply selectors, URLs or new steps — ' +
      'Janus copies those from the draft. The result stays inactive until a human enables it.',
    inputSchema: {
      type: 'object',
      properties: {
        draftId: { type: 'string' },
        draftRevision: { type: 'integer' },
        definition: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            inputSchema: { type: 'object' },
            parameters: {
              type: 'array',
              items: {
                type: 'object',
                properties: { slotId: { type: 'string' }, name: { type: 'string' } },
                required: ['slotId', 'name'],
                additionalProperties: false,
              },
            },
            stepIds: { type: 'array', items: { type: 'string' } },
          },
          required: ['name', 'description', 'inputSchema', 'parameters', 'stepIds'],
          additionalProperties: false,
        },
      },
      required: ['draftId', 'draftRevision', 'definition'],
    },
  },
]

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

function errorText(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

export function listDrafts(principal: ClientRecord) {
  const pending = visible(principal).map(({ draft }) => ({
    draftId: draft.id,
    draftRevision: draft.revision,
    status: draft.status,
    origin: draft.applicability.origin,
    path: draft.applicability.pathnamePrefix,
    slots: draft.slots.length,
    steps: draft.candidateSteps.length,
    expiresAt: new Date(draft.expiresAt).toISOString(),
  }))
  return text(pending.length ? pending : {
    drafts: [],
    hint: 'Capture a form in the Janus extension to create a draft.',
  })
}

export function getDraft(principal: ClientRecord, draftId: string) {
  const stored = visible(principal).find((d) => d.draft.id === draftId)
  if (!stored) return errorText(`No draft "${draftId}" available to this client`)

  const { draft } = stored
  return text({
    draftId: draft.id,
    draftRevision: draft.revision,
    applicability: draft.applicability,
    // Selected controls are shown as evidence for naming. They are not inputs:
    // a submission cannot contain a selector.
    controls: draft.bindings.filter((b) => b.kind === 'control'),
    slots: draft.slots.map((s) => ({
      slotId: s.id,
      constraint: s.constraint,
      sensitive: s.sensitive,
      note: s.sensitive ? 'Sensitive; cannot become a parameter' : undefined,
    })),
    candidateSteps: draft.candidateSteps,
    requiredStepIds: draft.requiredStepIds,
    evidence: draft.evidence,
    instructions:
      'Propose name, description, a closed input schema whose properties match your parameter names ' +
      'exactly (all required), parameter-to-slot mappings for every non-sensitive slot used by a step, ' +
      'and every candidate step ID in stepIds.',
  })
}

export interface SubmitDeps {
  /** Ask the owning extension to store the compiled definition (§17). */
  store: (pairingId: string, draft: ToolDraft, definition: GeneratedDefinition) => Promise<boolean>
}

export async function submitDefinition(
  principal: ClientRecord,
  args: { draftId: string; draftRevision: number; definition: DefinitionProposal; requestId?: string },
  deps: SubmitDeps,
) {
  if (!principal.authoring) return errorText('UNAUTHORIZED: this client has no authoring scope')

  const structural = validateAs<DefinitionProposal>('DefinitionProposal', args.definition)
  if (!structural.valid) {
    return errorText(`INVALID_DEFINITION: ${structural.errors.join('; ')}`)
  }

  const stored = visible(principal).find((d) => d.draft.id === args.draftId)
  if (!stored) return errorText(`DRAFT_STALE: no draft "${args.draftId}" available to this client`)

  const fingerprint = JSON.stringify([args.draftId, args.draftRevision, args.definition])
  const key = args.requestId ?? fingerprint
  const previous = submissions.get(key)
  if (previous && Date.now() - previous.at < LIMITS.definitionStoreIdempotencyMs) {
    // Retrying the same submission returns the same identity; different
    // contents under the same key are a conflict, not a silent overwrite.
    if (previous.fingerprint !== fingerprint) {
      return errorText('INVALID_DEFINITION: a different submission already used this request ID')
    }
    return text({
      definitionId: previous.definition.definitionId,
      definitionRevision: previous.definition.definitionRevision,
      state: 'pending',
    })
  }

  const compiled = compileDefinition({
    draft: stored.draft,
    draftRevision: args.draftRevision,
    proposal: args.definition,
    principalId: principal.clientId,
  })
  if (!compiled.ok) return errorText(`${compiled.failure.code}: ${compiled.failure.message}`)

  // Only report saved once the extension acknowledges persistence.
  const persisted = await deps.store(stored.pairingId, stored.draft, compiled.definition)
  if (!persisted) {
    return errorText('STORAGE_LIMIT: the extension did not confirm storage; retry with the same request ID')
  }

  submissions.set(key, { definition: compiled.definition, at: Date.now(), fingerprint })

  return text({
    definitionId: compiled.definition.definitionId,
    definitionRevision: compiled.definition.definitionRevision,
    state: 'pending',
    note: 'Review and enable this definition in the Janus extension before it can be called.',
  })
}

export function clear(): void {
  drafts.clear()
  submissions.clear()
}
