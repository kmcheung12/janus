/**
 * Per-page execution queue (§10, §18).
 *
 * One daemon-level queue shared by every MCP session, so two clients cannot
 * interleave mutations on one document. The deadline covers queue time as well
 * as execution: a call that waited 25 seconds gets 5 seconds to run, not a
 * fresh 30.
 *
 * The important rule is the unknown-execution lock. If a call times out or the
 * executor disconnects after dispatch, the page may still be performing the
 * action. Releasing the page on a timer would let a second call overlap work
 * that never stopped, so the lock persists until the extension confirms
 * termination or the document is destroyed.
 */

import { randomUUID } from 'node:crypto'
import type { Id, PageId, Revision, ToolError, ToolOutcome } from '../contracts/types.js'
import { LIMITS } from '../contracts/limits.js'
import * as registry from './registry.js'

export interface DispatchRequest {
  pageId: PageId
  documentId: Id
  toolId: Id
  toolRevision: Revision
  arguments: Record<string, unknown>
  /** MCP client principal, for scope revalidation immediately before dispatch. */
  clientId: string
}

/** Sends one execute_tool frame; returns false if the executor is gone. */
export type Dispatcher = (requestId: Id, request: DispatchRequest, timeoutMs: number) => boolean
export type Canceller = (requestId: Id, pageId: PageId, documentId: Id, reason: 'caller_cancelled' | 'deadline' | 'revoked') => void

interface Pending {
  requestId: Id
  request: DispatchRequest
  settle: (outcome: ToolOutcome) => void
  /** Wall deadline (monotonic ms) covering queue + execution. */
  deadlineAt: number
  timer?: NodeJS.Timeout
  dispatched: boolean
}

interface PageQueue {
  active?: Pending
  waiting: Pending[]
  /** Set when a dispatched call ended without confirmed termination. */
  lockedByRequestId?: Id
}

const queues = new Map<PageId, PageQueue>()
let dispatcher: Dispatcher = () => false
let canceller: Canceller = () => {}
let now = () => Date.now()

export function configureQueue(options: { dispatch: Dispatcher; cancel: Canceller; clock?: () => number }): void {
  dispatcher = options.dispatch
  canceller = options.cancel
  if (options.clock) now = options.clock
}

function queueFor(pageId: PageId): PageQueue {
  let q = queues.get(pageId)
  if (!q) { q = { waiting: [] }; queues.set(pageId, q) }
  return q
}

function totalWaiting(): number {
  let total = 0
  for (const q of queues.values()) total += q.waiting.length
  return total
}

function fail(code: ToolError['code'], message: string, execution: ToolError['execution'] = 'not_started'): ToolOutcome {
  return { status: 'error', error: { code, message, execution } }
}

/**
 * Revalidate immediately before dispatch (§10). Anything may have changed
 * while the call sat in the queue: the document, the revision, the page's very
 * existence.
 */
function revalidate(request: DispatchRequest): ToolOutcome | undefined {
  const page = registry.getPage(request.pageId)
  if (!page) return fail('STALE_DOCUMENT', 'The page is no longer enabled')
  if (page.descriptor.documentId !== request.documentId) {
    return fail('STALE_DOCUMENT', 'The document changed; re-discover tools before retrying')
  }
  if (registry.isTombstoned(request.pageId, request.toolId)) {
    return fail('TOOL_UNAVAILABLE', 'The tool was withdrawn')
  }
  const tool = registry.getTool(request.pageId, request.toolId)
  if (!tool) return fail('TOOL_UNAVAILABLE', 'The tool is no longer published')
  if (tool.toolRevision !== request.toolRevision) {
    return fail('STALE_REVISION', `Tool revision is now ${tool.toolRevision}; re-read the tool list and retry`)
  }
  return undefined
}

function settle(pending: Pending, outcome: ToolOutcome): void {
  if (pending.timer) clearTimeout(pending.timer)
  pending.settle(outcome)
}

function pump(pageId: PageId): void {
  const q = queueFor(pageId)
  if (q.active || q.lockedByRequestId) return

  const next = q.waiting.shift()
  if (!next) {
    registry.setExecutionState(pageId, { state: 'idle' })
    return
  }

  const stale = revalidate(next.request)
  if (stale) { settle(next, stale); pump(pageId); return }

  const remaining = next.deadlineAt - now()
  if (remaining <= 0) {
    settle(next, fail('DEADLINE_EXCEEDED', 'Deadline expired while queued'))
    pump(pageId)
    return
  }

  const sent = dispatcher(next.requestId, next.request, remaining)
  if (!sent) {
    settle(next, fail('DISCONNECTED', 'The browser connection was lost before dispatch'))
    pump(pageId)
    return
  }

  next.dispatched = true
  q.active = next
  registry.setExecutionState(pageId, { state: 'running', requestId: next.requestId })
}

/** Enqueue one invocation. Resolves with a terminal outcome exactly once. */
export function enqueue(request: DispatchRequest): Promise<ToolOutcome> {
  return new Promise<ToolOutcome>((resolve) => {
    const q = queueFor(request.pageId)

    if (q.lockedByRequestId) {
      resolve(fail('PAGE_BUSY', 'A previous invocation may still be running on this page; its outcome is unknown'))
      return
    }
    if (q.waiting.length >= LIMITS.waitingCallsPerPage || totalWaiting() >= LIMITS.waitingCallsGlobal) {
      resolve(fail('QUEUE_FULL', 'Too many calls are already waiting'))
      return
    }

    const immediate = revalidate(request)
    if (immediate) { resolve(immediate); return }

    const pending: Pending = {
      requestId: randomUUID(),
      request,
      settle: resolve,
      deadlineAt: now() + LIMITS.invocationDeadlineMs,
      dispatched: false,
    }

    pending.timer = setTimeout(() => onDeadline(request.pageId, pending), LIMITS.invocationDeadlineMs)
    q.waiting.push(pending)
    pump(request.pageId)
  })
}

function onDeadline(pageId: PageId, pending: Pending): void {
  const q = queueFor(pageId)

  if (q.active?.requestId === pending.requestId) {
    // Dispatched and unfinished: the page may already have performed the
    // action, so the outcome is genuinely unknown and the page stays locked.
    q.active = undefined
    q.lockedByRequestId = pending.requestId
    registry.setExecutionState(pageId, { state: 'unknown', requestId: pending.requestId })
    canceller(pending.requestId, pending.request.pageId, pending.request.documentId, 'deadline')
    settle(pending, fail(
      'DEADLINE_EXCEEDED',
      'The invocation did not complete in time. It may have taken effect; do not retry automatically.',
      'outcome_unknown',
    ))
    return
  }

  const index = q.waiting.findIndex((p) => p.requestId === pending.requestId)
  if (index >= 0) {
    q.waiting.splice(index, 1)
    settle(pending, fail('DEADLINE_EXCEEDED', 'Deadline expired while queued'))
  }
}

export interface ResultClaim {
  requestId: Id
  pageId: PageId
  documentId: Id
  toolId: Id
  toolRevision: Revision
  outcome: ToolOutcome
  executionStopped: boolean
}

/** Accept a tool_result frame. Returns false if it matches no pending call. */
export function resolveResult(claim: ResultClaim): boolean {
  const q = queues.get(claim.pageId)
  if (!q) return false

  // A late result whose request already expired can still release the lock,
  // without resolving the long-gone MCP call a second time.
  if (q.lockedByRequestId === claim.requestId) {
    if (claim.executionStopped) {
      q.lockedByRequestId = undefined
      pump(claim.pageId)
    }
    return true
  }

  const active = q.active
  if (!active || active.requestId !== claim.requestId) return false
  if (
    active.request.documentId !== claim.documentId ||
    active.request.toolId !== claim.toolId ||
    active.request.toolRevision !== claim.toolRevision
  ) {
    return false
  }

  // §17: only an outcome_unknown error may leave execution unstopped.
  const unresolved = !claim.executionStopped
  const isUnknown = claim.outcome.status === 'error' && claim.outcome.error.execution === 'outcome_unknown'
  if (unresolved && !isUnknown) return false

  q.active = undefined
  settle(active, claim.outcome)

  if (unresolved) {
    q.lockedByRequestId = claim.requestId
    registry.setExecutionState(claim.pageId, { state: 'unknown', requestId: claim.requestId })
    return true
  }

  pump(claim.pageId)
  return true
}

/** The executor vanished: fail everything, and lock anything already dispatched. */
export function onExecutorLost(pageId: PageId): void {
  const q = queues.get(pageId)
  if (!q) return

  for (const waiting of q.waiting.splice(0)) {
    settle(waiting, fail('DISCONNECTED', 'The browser disconnected before this call was dispatched'))
  }

  const active = q.active
  if (active) {
    q.active = undefined
    q.lockedByRequestId = active.requestId
    registry.setExecutionState(pageId, { state: 'unknown', requestId: active.requestId })
    settle(active, fail(
      'DISCONNECTED',
      'The browser disconnected after dispatch. The action may have taken effect; do not retry automatically.',
      'outcome_unknown',
    ))
  }
}

/** Document destroyed: only this clears an unknown-execution lock (§10). */
export function onDocumentDestroyed(pageId: PageId): void {
  onExecutorLost(pageId)
  queues.delete(pageId)
}

export function revokeForClient(clientId: string): void {
  for (const [pageId, q] of queues) {
    const kept: typeof q.waiting = []
    for (const pending of q.waiting) {
      if (pending.request.clientId === clientId) {
        settle(pending, fail('UNAUTHORIZED', 'Credentials were revoked'))
      } else {
        kept.push(pending)
      }
    }
    q.waiting = kept
    if (q.active?.request.clientId === clientId) {
      canceller(q.active.requestId, pageId, q.active.request.documentId, 'revoked')
    }
  }
}

export function inspect(pageId: PageId): { active?: Id; waiting: number; locked?: Id } {
  const q = queues.get(pageId)
  return { active: q?.active?.requestId, waiting: q?.waiting.length ?? 0, locked: q?.lockedByRequestId }
}

export function clear(): void {
  for (const q of queues.values()) {
    for (const p of [...q.waiting, ...(q.active ? [q.active] : [])]) {
      if (p.timer) clearTimeout(p.timer)
    }
  }
  queues.clear()
}
