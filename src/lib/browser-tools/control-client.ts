/**
 * Executor control connection (§4, §9).
 *
 * Deliberately separate from `src/lib/mcp/ws-client.ts`: that socket is owned
 * by an active journey and only reconnects while one exists, so discovery
 * would be impossible with recording off. This connection's lifetime is the
 * pairing credential, not the recording.
 */

import type {
  ControlMessage, DaemonToExtension, ExtensionToDaemon, GeneratedDefinition, Id,
  PageDescriptor, PageId, ToolDescriptor, ToolDraft, ToolOutcome,
} from './contract'
import { LIMITS, reconnectDelayMs } from './limits'

export interface ControlClientOptions {
  url: string
  pairingId: string
  token: string
  browserSessionId: Id
  /** Runs a dispatched invocation and resolves with its terminal outcome. */
  execute: (request: ExecuteRequest) => Promise<ExecuteResponse>
  cancel: (requestId: Id) => void
  /** Persist a compiled definition; resolves false if we refuse it. */
  storeDefinition?: (draftId: Id, draftRevision: number, definition: GeneratedDefinition) => Promise<boolean>
  onStatus?: (status: ControlStatus) => void
}

export interface ExecuteRequest {
  requestId: Id
  pageId: PageId
  documentId: Id
  toolId: Id
  toolRevision: number
  arguments: Record<string, unknown>
  timeoutMs: number
}

export interface ExecuteResponse {
  outcome: ToolOutcome
  /** False only with an outcome_unknown error; the daemon enforces this too. */
  executionStopped: boolean
}

export type ControlStatus =
  | { state: 'idle' }
  | { state: 'connecting' }
  | { state: 'connected'; connectionId: Id }
  | { state: 'unreachable' }
  | { state: 'unauthorized' }

let socket: WebSocket | null = null
let options: ControlClientOptions | null = null
let connectionId: Id | null = null
let sequence = 0
let attempt = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let status: ControlStatus = { state: 'idle' }
/**
 * Whether the current credential has ever completed a handshake. Drives
 * whether the pairing payload may still be re-shown for provisioning.
 */
let everConnected = false
/** Last published snapshots, replayed after a reconnect (§17). */
let pages: PageDescriptor[] = []
let toolsByPage = new Map<PageId, { documentId: Id; tools: ToolDescriptor[] }>()

function setStatus(next: ControlStatus): void {
  status = next
  options?.onStatus?.(next)
}

export function getStatus(): ControlStatus {
  return status
}

export function hasEverConnected(): boolean {
  return everConnected
}

export function start(next: ControlClientOptions): void {
  options = next
  attempt = 0
  everConnected = false
  connect()
}

export function stop(): void {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
  options = null
  connectionId = null
  sequence = 0
  pages = []
  toolsByPage = new Map()
  try { socket?.close() } catch { /* already closing */ }
  socket = null
  setStatus({ state: 'idle' })
}

function send(message: ExtensionToDaemon): boolean {
  if (socket?.readyState !== WebSocket.OPEN) return false
  socket.send(JSON.stringify(message))
  return true
}

function connect(): void {
  if (!options) return
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) return

  setStatus({ state: 'connecting' })
  socket = new WebSocket(options.url)

  socket.onopen = () => {
    // Sequences are per connection and restart at 1; the daemon treats a gap
    // as a lost snapshot, so counters must never carry across a reconnect.
    sequence = 0
    connectionId = null
    send({
      protocolVersion: 1,
      type: 'hello',
      role: 'executor',
      pairingId: options!.pairingId,
      token: options!.token,
      browserSessionId: options!.browserSessionId,
    })
  }

  socket.onmessage = (event: MessageEvent<string>) => {
    let message: DaemonToExtension
    try { message = JSON.parse(event.data) as DaemonToExtension } catch { return }
    handle(message)
  }

  socket.onclose = (event: CloseEvent) => {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
    connectionId = null

    // 4401 means the credential is wrong or was replaced. Retrying on a
    // schedule would just lock the record out; the user must re-pair.
    if (event.code === 4401) { setStatus({ state: 'unauthorized' }); return }
    if (!options) return

    setStatus({ state: 'unreachable' })
    const delay = reconnectDelayMs(attempt++)
    reconnectTimer = setTimeout(connect, delay)
  }

  socket.onerror = () => { try { socket?.close() } catch { /* ignore */ } }
}

function handle(message: DaemonToExtension): void {
  if (message.type === 'hello_ack') {
    connectionId = message.connectionId
    attempt = 0
    everConnected = true
    setStatus({ state: 'connected', connectionId })

    heartbeatTimer = setInterval(() => {
      send({
        protocolVersion: 1, connectionId: connectionId!,
        type: 'heartbeat', kind: 'ping', nonce: crypto.randomUUID(),
      })
    }, message.heartbeatIntervalMs)

    // Republish everything: the daemon dropped our pages when the old socket
    // closed, and its view must be rebuilt from scratch rather than patched.
    republish()
    return
  }

  if (!connectionId || message.connectionId !== connectionId) return

  if (message.type === 'heartbeat') {
    if (message.kind === 'ping') {
      send({
        protocolVersion: 1, connectionId,
        type: 'heartbeat', kind: 'pong', nonce: message.nonce,
      })
    }
    return
  }

  if (message.type === 'cancel_tool') {
    options?.cancel(message.requestId)
    return
  }

  if (message.type === 'execute_tool') {
    void runExecution(message)
    return
  }

  if (message.type === 'definition_proposed') {
    void storeProposal(message)
    return
  }
}

async function storeProposal(
  message: Extract<DaemonToExtension, { type: 'definition_proposed' }>,
): Promise<void> {
  if (!connectionId) return
  const saved = await options?.storeDefinition?.(
    message.draftId, message.draftRevision, message.definition,
  ) ?? false

  send({
    protocolVersion: 1,
    connectionId,
    type: 'definition_result',
    requestId: message.requestId,
    outcome: saved
      ? {
          status: 'saved',
          definitionId: message.definition.definitionId,
          definitionRevision: message.definition.definitionRevision,
          state: 'pending',
        }
      : {
          status: 'error',
          error: {
            code: 'INVALID_DEFINITION',
            message: 'The extension refused this definition; it does not match its stored draft',
            execution: 'not_started',
          },
        },
  })
}

/** Offer a captured draft to the daemon so an agent can read it. */
export function publishDraft(draft: ToolDraft): void {
  if (!connectionId) return
  send({
    protocolVersion: 1, connectionId,
    type: 'draft_upsert', sequence: ++sequence, draft,
  })
}

export function removeDraft(draftId: Id, draftRevision: number): void {
  if (!connectionId) return
  send({
    protocolVersion: 1, connectionId,
    type: 'draft_removed', sequence: ++sequence, draftId, draftRevision,
  })
}

async function runExecution(message: Extract<DaemonToExtension, { type: 'execute_tool' }>): Promise<void> {
  if (!options || !connectionId) return

  let response: ExecuteResponse
  try {
    response = await options.execute({
      requestId: message.requestId,
      pageId: message.pageId,
      documentId: message.documentId,
      toolId: message.toolId,
      toolRevision: message.toolRevision,
      arguments: message.arguments,
      timeoutMs: message.timeoutMs,
    })
  } catch (e) {
    // A thrown error means the runtime itself failed, which happens before the
    // page is touched; execution demonstrably did not start.
    response = {
      outcome: {
        status: 'error',
        error: { code: 'INTERNAL_ERROR', message: String((e as Error)?.message ?? e), execution: 'not_started' },
      },
      executionStopped: true,
    }
  }

  send({
    protocolVersion: 1,
    connectionId,
    type: 'tool_result',
    requestId: message.requestId,
    pageId: message.pageId,
    documentId: message.documentId,
    toolId: message.toolId,
    toolRevision: message.toolRevision,
    outcome: response.outcome,
    executionStopped: response.executionStopped,
  })
}

function republish(): void {
  publishPages(pages)
  for (const [pageId, entry] of toolsByPage) {
    publishTools(pageId, entry.documentId, entry.tools)
  }
}

/** Publish the complete set of enabled pages. */
export function publishPages(next: PageDescriptor[]): void {
  pages = next
  if (!connectionId) return
  send({
    protocolVersion: 1, connectionId,
    type: 'pages_sync', sequence: ++sequence, pages: next,
  })
}

/** Publish a complete tool snapshot for one document; empty withdraws all. */
export function publishTools(pageId: PageId, documentId: Id, tools: ToolDescriptor[]): void {
  const bounded = tools.slice(0, LIMITS.toolSnapshotMax)
  toolsByPage.set(pageId, { documentId, tools: bounded })
  if (!connectionId) return
  send({
    protocolVersion: 1, connectionId,
    type: 'tools_changed', sequence: ++sequence, pageId, documentId, tools: bounded,
  })
}

export function removePage(pageId: PageId, documentId: Id, reason: 'navigation' | 'closed' | 'disabled'): void {
  pages = pages.filter((p) => p.pageId !== pageId)
  toolsByPage.delete(pageId)
  if (!connectionId) return
  send({
    protocolVersion: 1, connectionId,
    type: 'page_removed', sequence: ++sequence, pageId, documentId, reason,
  })
}

/** Test seam: inject a socket factory and observe frames. */
export const _internal = { get socket() { return socket }, handle, get sequence() { return sequence } }
export type { ControlMessage }
