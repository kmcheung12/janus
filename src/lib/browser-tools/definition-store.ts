/**
 * Durable authoring storage (§11, §18).
 *
 * Drafts and definitions outlive the service worker, so they live in IndexedDB
 * rather than the journey buffer — that buffer collapses events and keeps only
 * the last 50, which would silently destroy an authoring capture.
 *
 * A stored definition is inactive. Enabling one is a separate, human-only act
 * recorded as an approval, and any change to the definition invalidates it.
 */

import type { DefinitionApproval, GeneratedDefinition, ToolDraft } from './contract'
import { LIMITS, jsonBytes } from './limits'

const DB_NAME = 'janus-authoring'
const DB_VERSION = 1
const DRAFTS = 'drafts'
const DEFINITIONS = 'definitions'
const APPROVALS = 'approvals'

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(DEFINITIONS)) db.createObjectStore(DEFINITIONS, { keyPath: 'definitionId' })
      if (!db.objectStoreNames.contains(APPROVALS)) db.createObjectStore(APPROVALS, { keyPath: 'definitionId' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode)
    const request = fn(tx.objectStore(store))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }))
}

export function putDraft(draft: ToolDraft): Promise<unknown> {
  return run(DRAFTS, 'readwrite', (s) => s.put(draft))
}

export function getDraft(id: string): Promise<ToolDraft | undefined> {
  return run<ToolDraft | undefined>(DRAFTS, 'readonly', (s) => s.get(id))
}

export function allDrafts(): Promise<ToolDraft[]> {
  return run<ToolDraft[]>(DRAFTS, 'readonly', (s) => s.getAll())
}

export function deleteDraft(id: string): Promise<unknown> {
  return run(DRAFTS, 'readwrite', (s) => s.delete(id))
}

export async function allDefinitions(): Promise<GeneratedDefinition[]> {
  return run<GeneratedDefinition[]>(DEFINITIONS, 'readonly', (s) => s.getAll())
}

export function getApproval(definitionId: string): Promise<DefinitionApproval | undefined> {
  return run<DefinitionApproval | undefined>(APPROVALS, 'readonly', (s) => s.get(definitionId))
}

export async function allApprovals(): Promise<DefinitionApproval[]> {
  return run<DefinitionApproval[]>(APPROVALS, 'readonly', (s) => s.getAll())
}

export interface StoreResult {
  ok: boolean
  reason?: 'storage_limit' | 'too_many' | 'unknown_draft' | 'draft_stale'
}

/**
 * Persist a definition the daemon compiled, after re-checking it against our
 * own copy of the draft. The extension does not trust the daemon's compilation
 * blindly: the draft is the authority for what was actually captured.
 */
export async function storeDefinition(
  draftId: string,
  draftRevision: number,
  definition: GeneratedDefinition,
): Promise<StoreResult> {
  const local = await getDraft(draftId)
  if (!local) return { ok: false, reason: 'unknown_draft' }
  if (local.revision !== draftRevision) return { ok: false, reason: 'draft_stale' }

  // Re-verify that every locator came from our draft, not from the wire.
  const localBindings = new Set(local.bindings.map((b) => JSON.stringify(b)))
  for (const binding of definition.bindings) {
    if (!localBindings.has(JSON.stringify(binding))) return { ok: false, reason: 'draft_stale' }
  }
  const localSteps = new Set(local.candidateSteps.map((s) => JSON.stringify(s)))
  for (const step of definition.steps) {
    if (!localSteps.has(JSON.stringify(step))) return { ok: false, reason: 'draft_stale' }
  }

  const existing = await allDefinitions()
  if (existing.length >= LIMITS.savedDefinitionsMax) return { ok: false, reason: 'too_many' }
  if (jsonBytes(definition) > LIMITS.definitionMaxBytes) return { ok: false, reason: 'storage_limit' }

  await run(DEFINITIONS, 'readwrite', (s) => s.put(definition))
  // Stored, not enabled. A model cannot grant itself an execution target.
  await run(APPROVALS, 'readwrite', (s) => s.put({
    definitionId: definition.definitionId,
    definitionRevision: definition.definitionRevision,
    state: 'pending',
  } satisfies DefinitionApproval))

  return { ok: true }
}

/** Enabling is a human act, recorded against one exact revision. */
export async function setApproval(
  definitionId: string,
  state: DefinitionApproval['state'],
): Promise<DefinitionApproval | undefined> {
  const definition = await run<GeneratedDefinition | undefined>(
    DEFINITIONS, 'readonly', (s) => s.get(definitionId),
  )
  if (!definition) return undefined

  const approval: DefinitionApproval = {
    definitionId,
    definitionRevision: definition.definitionRevision,
    state,
    reviewedAt: Date.now(),
  }
  await run(APPROVALS, 'readwrite', (s) => s.put(approval))
  return approval
}

/** Only definitions approved at their current revision may execute. */
export async function enabledDefinitions(): Promise<GeneratedDefinition[]> {
  const [definitions, approvals] = await Promise.all([allDefinitions(), allApprovals()])
  const byId = new Map(approvals.map((a) => [a.definitionId, a]))
  return definitions.filter((d) => {
    const approval = byId.get(d.definitionId)
    return approval?.state === 'enabled'
      // A revised definition must be reviewed again.
      && approval.definitionRevision === d.definitionRevision
  })
}

export async function deleteDefinition(definitionId: string): Promise<void> {
  await run(DEFINITIONS, 'readwrite', (s) => s.delete(definitionId))
  await run(APPROVALS, 'readwrite', (s) => s.delete(definitionId))
}

/** Purge expired drafts before reporting a storage limit (§18). */
export async function cleanup(now = Date.now()): Promise<{ removed: number }> {
  const drafts = await allDrafts()
  let removed = 0
  for (const draft of drafts) {
    if (draft.expiresAt <= now) { await deleteDraft(draft.id); removed++ }
  }
  return { removed }
}

/**
 * Export a definition for sharing. Carries no credentials, no example values
 * and no raw evidence (§19).
 */
export function exportDefinition(definition: GeneratedDefinition): string {
  const { evidenceIds, principalId, sourceDraft, ...portable } = definition
  return JSON.stringify({
    format: 'janus.webtool.v1',
    definition: portable,
    note: 'Requires the Janus recipe runtime. Portability to another browser is a tested claim, not implied.',
  }, null, 2)
}

export function _resetForTests(): void {
  dbPromise = null
}
