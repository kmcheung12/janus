import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as registry from '../src/control/registry.js'
import * as queue from '../src/control/queue.js'
import { LIMITS } from '../src/contracts/limits.js'
import type { PageDescriptor, ToolDescriptor } from '../src/contracts/types.js'

const PAGE_ID = '00112233445566778899aabbccddeeff'
const CONNECTION = 'connection_1'
const PAIRING = 'pair_1'

function page(overrides: Partial<PageDescriptor> = {}): PageDescriptor {
  return {
    pageId: PAGE_ID,
    browserSessionId: 'browser_1',
    tabId: 7,
    frameId: 0,
    documentId: 'doc_1',
    label: 'Shop',
    title: 'Shop',
    url: 'https://shop.example/',
    origin: 'https://shop.example',
    nativeCapability: 'available',
    execution: { state: 'idle' },
    ...overrides,
  }
}

function tool(overrides: Partial<ToolDescriptor> = {}): ToolDescriptor {
  return {
    toolId: 'tool_1',
    toolRevision: 1,
    source: { kind: 'native', nativeName: 'search' },
    name: 'Search products',
    description: 'Search the catalogue',
    inputSchema: { type: 'object', properties: {} },
    readOnlyHint: true,
    consequentialHint: false,
    ...overrides,
  }
}

/** Dispatches are captured rather than sent, so tests control completion. */
let dispatched: Array<{ requestId: string; timeoutMs: number }>
let cancelled: Array<{ requestId: string; reason: string }>
let deliverable: boolean

function setup(clock?: () => number) {
  dispatched = []
  cancelled = []
  deliverable = true
  queue.configureQueue({
    dispatch: (requestId, _request, timeoutMs) => {
      if (!deliverable) return false
      dispatched.push({ requestId, timeoutMs })
      return true
    },
    cancel: (requestId, _p, _d, reason) => { cancelled.push({ requestId, reason }) },
    clock,
  })
  registry.syncPages(CONNECTION, PAIRING, [page()])
  registry.syncTools(CONNECTION, PAGE_ID, 'doc_1', [tool()])
}

function invoke(overrides: Partial<Parameters<typeof queue.enqueue>[0]> = {}) {
  return queue.enqueue({
    pageId: PAGE_ID, documentId: 'doc_1', toolId: 'tool_1', toolRevision: 1,
    arguments: {}, clientId: 'client_1', ...overrides,
  })
}

function complete(requestId: string, result: unknown = { ok: true }) {
  return queue.resolveResult({
    requestId, pageId: PAGE_ID, documentId: 'doc_1', toolId: 'tool_1', toolRevision: 1,
    outcome: { status: 'completed', result: result as never }, executionStopped: true,
  })
}

beforeEach(() => { registry.clear(); queue.clear(); setup() })
afterEach(() => { vi.useRealTimers(); registry.clear(); queue.clear() })

describe('revalidation before dispatch', () => {
  it('rejects a stale revision', async () => {
    const outcome = await invoke({ toolRevision: 99 })
    expect(outcome).toMatchObject({ status: 'error', error: { code: 'STALE_REVISION' } })
    expect(dispatched).toHaveLength(0)
  })

  it('rejects a stale document', async () => {
    const outcome = await invoke({ documentId: 'doc_old' })
    expect(outcome).toMatchObject({ status: 'error', error: { code: 'STALE_DOCUMENT' } })
  })

  it('rejects a withdrawn tool', async () => {
    registry.syncTools(CONNECTION, PAGE_ID, 'doc_1', [])
    const outcome = await invoke()
    expect(outcome).toMatchObject({ status: 'error', error: { code: 'TOOL_UNAVAILABLE' } })
  })

  it('never falls back to a different document', async () => {
    // Navigation replaces the document; the queued call must fail, not retarget.
    registry.syncPages(CONNECTION, PAIRING, [page({ documentId: 'doc_2' })])
    const outcome = await invoke({ documentId: 'doc_1' })
    expect(outcome).toMatchObject({ status: 'error', error: { code: 'STALE_DOCUMENT' } })
    expect(dispatched).toHaveLength(0)
  })

  it('fails a queued call whose revision changes while it waits', async () => {
    const first = invoke()
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))

    const second = invoke()
    registry.syncTools(CONNECTION, PAGE_ID, 'doc_1', [tool({ toolRevision: 2 })])
    complete(dispatched[0].requestId)

    await expect(first).resolves.toMatchObject({ status: 'completed' })
    await expect(second).resolves.toMatchObject({ status: 'error', error: { code: 'STALE_REVISION' } })
  })
})

describe('per-page serialization', () => {
  it('holds a second call until the first completes', async () => {
    const first = invoke()
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))

    const second = invoke()
    // The second call must not reach the page while the first is running.
    await new Promise((r) => setTimeout(r, 10))
    expect(dispatched).toHaveLength(1)
    expect(queue.inspect(PAGE_ID).waiting).toBe(1)

    complete(dispatched[0].requestId, { first: true })
    await expect(first).resolves.toMatchObject({ status: 'completed' })

    await vi.waitFor(() => expect(dispatched).toHaveLength(2))
    complete(dispatched[1].requestId, { second: true })
    await expect(second).resolves.toMatchObject({ status: 'completed' })
  })

  it('serializes across different clients', async () => {
    const a = invoke({ clientId: 'client_a' })
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))
    const b = invoke({ clientId: 'client_b' })
    await new Promise((r) => setTimeout(r, 10))
    expect(dispatched).toHaveLength(1)

    complete(dispatched[0].requestId)
    await a
    await vi.waitFor(() => expect(dispatched).toHaveLength(2))
    complete(dispatched[1].requestId)
    await expect(b).resolves.toMatchObject({ status: 'completed' })
  })

  it('rejects calls beyond the per-page waiting limit', async () => {
    const running = invoke()
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))

    const waiting = Array.from({ length: LIMITS.waitingCallsPerPage }, () => invoke())
    const overflow = await invoke()
    expect(overflow).toMatchObject({ status: 'error', error: { code: 'QUEUE_FULL' } })

    complete(dispatched[0].requestId)
    await running
    for (let i = 0; i < waiting.length; i++) {
      await vi.waitFor(() => expect(dispatched.length).toBeGreaterThan(i + 1))
      complete(dispatched[i + 1].requestId)
    }
    await Promise.all(waiting)
  })
})

describe('result matching', () => {
  it('ignores a result for an unknown request', async () => {
    invoke()
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))
    expect(complete('not-a-request')).toBe(false)
  })

  it('ignores a result claiming the wrong document', async () => {
    invoke()
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))
    const accepted = queue.resolveResult({
      requestId: dispatched[0].requestId, pageId: PAGE_ID, documentId: 'doc_other',
      toolId: 'tool_1', toolRevision: 1,
      outcome: { status: 'completed', result: null }, executionStopped: true,
    })
    expect(accepted).toBe(false)
  })

  it('refuses executionStopped: false unless the outcome is unknown', async () => {
    invoke()
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))
    const accepted = queue.resolveResult({
      requestId: dispatched[0].requestId, pageId: PAGE_ID, documentId: 'doc_1',
      toolId: 'tool_1', toolRevision: 1,
      outcome: { status: 'completed', result: null }, executionStopped: false,
    })
    expect(accepted).toBe(false)
  })
})

describe('unknown execution lock', () => {
  it('keeps the page unavailable after an unknown outcome', async () => {
    const first = invoke()
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))

    queue.resolveResult({
      requestId: dispatched[0].requestId, pageId: PAGE_ID, documentId: 'doc_1',
      toolId: 'tool_1', toolRevision: 1,
      outcome: { status: 'error', error: { code: 'CANCELLED', message: 'cancel requested', execution: 'outcome_unknown' } },
      executionStopped: false,
    })
    await expect(first).resolves.toMatchObject({ status: 'error' })

    // Acknowledging a cancellation is not evidence that work stopped.
    const blocked = await invoke()
    expect(blocked).toMatchObject({ status: 'error', error: { code: 'PAGE_BUSY' } })
    expect(queue.inspect(PAGE_ID).locked).toBeTruthy()
  })

  it('releases only on a confirmed stop', async () => {
    const first = invoke()
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))
    const requestId = dispatched[0].requestId

    queue.resolveResult({
      requestId, pageId: PAGE_ID, documentId: 'doc_1', toolId: 'tool_1', toolRevision: 1,
      outcome: { status: 'error', error: { code: 'DEADLINE_EXCEEDED', message: 'x', execution: 'outcome_unknown' } },
      executionStopped: false,
    })
    await first
    expect((await invoke())).toMatchObject({ error: { code: 'PAGE_BUSY' } })

    // A later frame confirming termination unlocks the page without resolving
    // the long-gone MCP call again.
    queue.resolveResult({
      requestId, pageId: PAGE_ID, documentId: 'doc_1', toolId: 'tool_1', toolRevision: 1,
      outcome: { status: 'error', error: { code: 'CANCELLED', message: 'stopped', execution: 'failed' } },
      executionStopped: true,
    })
    expect(queue.inspect(PAGE_ID).locked).toBeUndefined()

    const after = invoke()
    await vi.waitFor(() => expect(dispatched).toHaveLength(2))
    complete(dispatched[1].requestId)
    await expect(after).resolves.toMatchObject({ status: 'completed' })
  })

  it('is cleared by document destruction', async () => {
    const first = invoke()
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))
    queue.onExecutorLost(PAGE_ID)
    await expect(first).resolves.toMatchObject({
      status: 'error', error: { code: 'DISCONNECTED', execution: 'outcome_unknown' },
    })
    expect(queue.inspect(PAGE_ID).locked).toBeTruthy()

    queue.onDocumentDestroyed(PAGE_ID)
    expect(queue.inspect(PAGE_ID).locked).toBeUndefined()
  })
})

describe('disconnection', () => {
  it('reports not-started for calls that never dispatched', async () => {
    deliverable = false
    const outcome = await invoke()
    expect(outcome).toMatchObject({
      status: 'error', error: { code: 'DISCONNECTED', execution: 'not_started' },
    })
  })

  it('reports outcome_unknown for a call lost after dispatch', async () => {
    const running = invoke()
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))
    queue.onExecutorLost(PAGE_ID)
    await expect(running).resolves.toMatchObject({
      status: 'error', error: { execution: 'outcome_unknown' },
    })
  })
})

describe('deadlines', () => {
  it('passes the remaining budget, not a fresh one, to a queued call', async () => {
    let t = 1_000_000
    registry.clear(); queue.clear()
    setup(() => t)

    const first = invoke()
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))
    expect(dispatched[0].timeoutMs).toBe(LIMITS.invocationDeadlineMs)

    const second = invoke()
    t += 10_000 // second call spends 10s queued
    complete(dispatched[0].requestId)
    await first

    await vi.waitFor(() => expect(dispatched).toHaveLength(2))
    expect(dispatched[1].timeoutMs).toBeLessThanOrEqual(LIMITS.invocationDeadlineMs - 10_000)

    complete(dispatched[1].requestId)
    await second
  })
})
