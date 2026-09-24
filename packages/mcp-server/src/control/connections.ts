/**
 * Executor connections: handshake, sequencing and frame routing (§9, §17).
 *
 * A socket starts unauthenticated and may send exactly one thing: a `hello`
 * within the handshake deadline and under the handshake byte cap. Until that
 * succeeds it cannot register pages, publish tools or resolve calls. Failed
 * authentication closes the socket without revealing whether the pairing ID
 * exists.
 */

import { randomUUID } from 'node:crypto'
import type { WebSocket } from 'ws'
import type {
  ControlMessage, DaemonToExtension, GeneratedDefinition, Id, PageId,
  ToolDescriptor, ToolDraft,
} from '../contracts/types.js'
import { LIMITS } from '../contracts/limits.js'
import { validateControlMessage } from '../contracts/validate.js'
import type { CredentialStore } from '../credentials.js'
import * as registry from './registry.js'
import * as queue from './queue.js'
import * as drafts from './drafts.js'

export interface ExecutorConnection {
  connectionId: Id
  pairingId: string
  browserSessionId: Id
  socket: WebSocket
  /** Last accepted sequence; a gap forces full resynchronization. */
  lastSequence: number
  desynchronized: boolean
}

const connections = new Map<Id, ExecutorConnection>()
const byPairing = new Map<string, Id>()

export function connectionFor(pairingId: string): ExecutorConnection | undefined {
  const id = byPairing.get(pairingId)
  return id ? connections.get(id) : undefined
}

export function send(connectionId: Id, message: DaemonToExtension): boolean {
  const connection = connections.get(connectionId)
  if (!connection || connection.socket.readyState !== 1) return false
  connection.socket.send(JSON.stringify(message))
  return true
}

function closeWith(socket: WebSocket, code: number, reason: string): void {
  try { socket.close(code, reason) } catch { /* already closing */ }
}

function drop(connectionId: Id): void {
  const connection = connections.get(connectionId)
  if (!connection) return
  for (const page of registry.pagesForPairing(connection.pairingId)) {
    if (page.connectionId === connectionId) queue.onExecutorLost(page.descriptor.pageId)
  }
  registry.removeConnection(connectionId)
  // Never serve a disconnected executor's drafts as current; they are rebuilt
  // from live resynchronization on reconnect (§17).
  drafts.clearDraftsForPairing(connection.pairingId)
  connections.delete(connectionId)
  if (byPairing.get(connection.pairingId) === connectionId) byPairing.delete(connection.pairingId)
}

/** Close any executor still holding a replaced credential (§19 rotate). */
export function disconnectPairing(pairingId: string): void {
  const connection = connectionFor(pairingId)
  if (!connection) return
  closeWith(connection.socket, 4401, 'credential replaced')
  drop(connection.connectionId)
}

interface SocketState {
  authenticated?: ExecutorConnection
  handshakeTimer?: NodeJS.Timeout
  bytesBeforeAuth: number
  heartbeatTimer?: NodeJS.Timeout
  lastSeen: number
}

export function attachControlSocket(socket: WebSocket, credentials: CredentialStore): void {
  const state: SocketState = { bytesBeforeAuth: 0, lastSeen: Date.now() }

  state.handshakeTimer = setTimeout(() => {
    if (!state.authenticated) closeWith(socket, 4408, 'handshake timeout')
  }, LIMITS.pairingHandshakeMs)

  const teardown = () => {
    if (state.handshakeTimer) clearTimeout(state.handshakeTimer)
    if (state.heartbeatTimer) clearInterval(state.heartbeatTimer)
    if (state.authenticated) drop(state.authenticated.connectionId)
  }

  socket.on('close', teardown)
  socket.on('error', teardown)

  socket.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
    // Binary frames are journey file uploads and are never part of the
    // control protocol; an unauthenticated socket may not send them either.
    if (isBinary) return

    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)

    if (raw.byteLength > LIMITS.controlFrameMaxBytes) {
      closeWith(socket, 1009, 'frame too large')
      return
    }
    if (!state.authenticated) {
      state.bytesBeforeAuth += raw.byteLength
      if (state.bytesBeforeAuth > LIMITS.pairingHandshakeMaxBytes) {
        closeWith(socket, 1009, 'handshake too large')
        return
      }
    }

    let parsed: unknown
    try { parsed = JSON.parse(raw.toString('utf8')) } catch { closeWith(socket, 1007, 'malformed frame'); return }

    const result = validateControlMessage(parsed)
    if (!result.valid) { closeWith(socket, 1008, 'protocol error'); return }

    state.lastSeen = Date.now()
    handle(socket, state, result.value, credentials)
  })
}

function handle(
  socket: WebSocket,
  state: SocketState,
  message: ControlMessage,
  credentials: CredentialStore,
): void {
  if (!state.authenticated) {
    if (message.type !== 'hello') { closeWith(socket, 1008, 'protocol error'); return }

    const record = credentials.verifyExecutor(message.pairingId, message.token)
    // Identical response either way: a caller must not be able to probe which
    // pairing IDs exist.
    if (!record) { closeWith(socket, 4401, 'unauthorized'); return }

    // One live executor per pairing; a reconnect supersedes the old socket.
    disconnectPairing(message.pairingId)

    const connection: ExecutorConnection = {
      connectionId: randomUUID(),
      pairingId: message.pairingId,
      browserSessionId: message.browserSessionId,
      socket,
      lastSequence: 0,
      desynchronized: false,
    }
    connections.set(connection.connectionId, connection)
    byPairing.set(connection.pairingId, connection.connectionId)
    state.authenticated = connection
    if (state.handshakeTimer) clearTimeout(state.handshakeTimer)

    send(connection.connectionId, {
      protocolVersion: 1,
      connectionId: connection.connectionId,
      type: 'hello_ack',
      role: 'executor',
      heartbeatIntervalMs: LIMITS.heartbeatIntervalMs,
      inactivityTimeoutMs: LIMITS.inactivityTimeoutMs,
      authoringPrincipals: credentials
        .listClients()
        .filter((c) => c.pairingId === connection.pairingId && c.authoring)
        .slice(0, LIMITS.authoringPrincipalsMax)
        .map((c) => ({ id: c.clientId, label: c.label })),
    })

    state.heartbeatTimer = setInterval(() => {
      if (Date.now() - state.lastSeen > LIMITS.inactivityTimeoutMs) {
        closeWith(socket, 4408, 'inactive')
        return
      }
      send(connection.connectionId, {
        protocolVersion: 1, connectionId: connection.connectionId,
        type: 'heartbeat', kind: 'ping', nonce: randomUUID(),
      })
    }, LIMITS.heartbeatIntervalMs)
    return
  }

  const connection = state.authenticated

  // Every post-handshake frame must carry the assigned connection ID, and a
  // second hello on an authenticated socket is a protocol error.
  if (message.type === 'hello') { closeWith(socket, 1008, 'protocol error'); return }
  if (message.connectionId !== connection.connectionId) { closeWith(socket, 1008, 'protocol error'); return }

  if (message.type === 'heartbeat') {
    // A pong is never echoed, or two peers would ping-pong forever.
    if (message.kind === 'ping') {
      send(connection.connectionId, {
        protocolVersion: 1, connectionId: connection.connectionId,
        type: 'heartbeat', kind: 'pong', nonce: message.nonce,
      })
    }
    return
  }

  if ('sequence' in message) {
    const expected = connection.lastSequence + 1
    if (message.sequence !== expected) {
      // A gap means we missed a snapshot and our view may be wrong. Refuse
      // further work until the extension resynchronizes from scratch.
      connection.desynchronized = true
      closeWith(socket, 1008, 'sequence gap')
      return
    }
    connection.lastSequence = message.sequence
  }

  switch (message.type) {
    case 'pages_sync':
      registry.syncPages(connection.connectionId, connection.pairingId, message.pages)
      return

    case 'tools_changed': {
      const outcome = registry.syncTools(
        connection.connectionId, message.pageId, message.documentId,
        message.tools as ToolDescriptor[],
      )
      if (!outcome.ok && outcome.reason === 'reused_tool_id') closeWith(socket, 1008, 'protocol error')
      return
    }

    case 'page_removed':
      queue.onDocumentDestroyed(message.pageId as PageId)
      registry.removePage(message.pageId, connection.connectionId)
      return

    case 'tool_result':
      queue.resolveResult({
        requestId: message.requestId,
        pageId: message.pageId,
        documentId: message.documentId,
        toolId: message.toolId,
        toolRevision: message.toolRevision,
        outcome: message.outcome,
        executionStopped: message.executionStopped,
      })
      return

    case 'draft_upsert':
      drafts.upsertDraft(connection.pairingId, message.draft)
      return

    case 'draft_removed':
      drafts.removeDraft(message.draftId)
      return

    case 'definition_result':
      resolveDefinitionStore(message.requestId, message.outcome.status === 'saved')
      return

    default:
      return
  }
}

/**
 * Storing a compiled definition is a request to the extension, which repeats
 * the structural and reference checks against its own copy of the draft before
 * persisting. The daemon only reports success once that lands.
 */
const pendingStores = new Map<Id, (ok: boolean) => void>()

export function storeDefinition(
  pairingId: string,
  draft: ToolDraft,
  definition: GeneratedDefinition,
  timeoutMs: number,
): Promise<boolean> {
  const connection = connectionFor(pairingId)
  if (!connection) return Promise.resolve(false)

  const requestId = randomUUID()
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      pendingStores.delete(requestId)
      // Timing out leaves the outcome uncertain; an idempotent retry resolves
      // it rather than us guessing.
      resolve(false)
    }, timeoutMs)

    pendingStores.set(requestId, (ok) => { clearTimeout(timer); resolve(ok) })

    const sent = send(connection.connectionId, {
      protocolVersion: 1,
      connectionId: connection.connectionId,
      type: 'definition_proposed',
      requestId,
      draftId: draft.id,
      draftRevision: draft.revision,
      definition,
    })
    if (!sent) {
      clearTimeout(timer)
      pendingStores.delete(requestId)
      resolve(false)
    }
  })
}

function resolveDefinitionStore(requestId: Id, ok: boolean): void {
  const resolve = pendingStores.get(requestId)
  if (!resolve) return
  pendingStores.delete(requestId)
  resolve(ok)
}

export function clear(): void {
  for (const resolve of pendingStores.values()) resolve(false)
  pendingStores.clear()
  for (const connection of connections.values()) closeWith(connection.socket, 1001, 'shutdown')
  connections.clear()
  byPairing.clear()
}
