import { WebSocketServer } from 'ws'
import type { RawData, WebSocket } from 'ws'
import { upsertJourney, addEvent, setStatus, addFile } from './journey-store.js'
import { parseFrame, saveFile } from './file-store.js'
import type { WsTextMessage } from './types.js'
import type { CredentialStore } from './credentials.js'
import { attachControlSocket, connectionFor, send } from './control/connections.js'
import * as queue from './control/queue.js'
import * as registry from './control/registry.js'

export interface WsServerOptions {
  port: number
  host: string
  credentials: CredentialStore
}

/**
 * One listener carries two protocols. Journey capture is unchanged and stays
 * on the legacy path; control traffic authenticates separately, so a
 * terminal-capture producer never gains execution rights (§9).
 *
 * Routing is decided by the first frame: a `hello` opens a control session,
 * anything else is legacy capture.
 */
export function startWsServer(options: WsServerOptions): WebSocketServer {
  const wss = new WebSocketServer({ port: options.port, host: options.host })

  wss.on('connection', (ws: WebSocket) => {
    let mode: 'undecided' | 'control' | 'capture' = 'undecided'

    const onMessage = (data: RawData, isBinary: boolean) => {
      if (mode === 'undecided') {
        mode = looksLikeControl(data, isBinary) ? 'control' : 'capture'
        if (mode === 'control') {
          ws.off('message', onMessage)
          attachControlSocket(ws, options.credentials)
          // The control handler has not seen the frame that classified this
          // socket, so hand it over rather than dropping the handshake.
          ws.emit('message', data, isBinary)
          return
        }
      }

      if (isBinary) {
        handleBinary(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer))
      } else {
        handleText(data.toString())
      }
    }

    ws.on('message', onMessage)
  })

  wss.on('error', (err) => {
    console.error('[janus-mcp] WebSocket server error:', err.message)
  })

  return wss
}

/**
 * Control frames all carry `protocolVersion`; legacy journey frames never do.
 * Classifying on that rather than on `type === 'hello'` means an
 * unauthenticated control frame is rejected by the control handler instead of
 * falling through to the permissive capture path and being silently ignored.
 */
function looksLikeControl(data: RawData, isBinary: boolean): boolean {
  if (isBinary) return false
  try {
    const parsed = JSON.parse(data.toString()) as { type?: string; protocolVersion?: unknown }
    return parsed?.type === 'hello' || parsed?.protocolVersion !== undefined
  } catch {
    return false
  }
}

/** Connect the execution queue to the control transport (§10). */
export function wireQueue(): void {
  queue.configureQueue({
    dispatch: (requestId, request, timeoutMs) => {
      const page = registry.getPage(request.pageId)
      if (!page) return false
      return send(page.connectionId, {
        protocolVersion: 1,
        connectionId: page.connectionId,
        type: 'execute_tool',
        requestId,
        pageId: request.pageId,
        documentId: request.documentId,
        toolId: request.toolId,
        toolRevision: request.toolRevision,
        arguments: request.arguments as Record<string, never>,
        timeoutMs,
      })
    },

    cancel: (requestId, pageId, documentId, reason) => {
      const page = registry.getPage(pageId)
      if (!page || !connectionFor(page.pairingId)) return
      send(page.connectionId, {
        protocolVersion: 1,
        connectionId: page.connectionId,
        type: 'cancel_tool',
        requestId,
        pageId,
        documentId,
        reason,
      })
    },
  })
}

function handleText(raw: string): void {
  let msg: WsTextMessage
  try {
    msg = JSON.parse(raw) as WsTextMessage
  } catch {
    return
  }
  switch (msg.type) {
    case 'sync':
      upsertJourney(msg.journeyId, msg.meta, msg.events)
      break
    case 'event':
      addEvent(msg.journeyId, msg.event)
      break
    case 'recording_stopped':
      setStatus(msg.journeyId, 'stopped')
      break
  }
}

function handleBinary(buffer: Buffer): void {
  try {
    const { header, data } = parseFrame(buffer)
    if (header.type !== 'file') return
    const path = saveFile(header.journeyId, header.filename, data)
    addFile(header.journeyId, { filename: header.filename, mimeType: header.mimeType, path })
  } catch (e) {
    console.error('[janus-mcp] Malformed binary frame:', e)
  }
}
