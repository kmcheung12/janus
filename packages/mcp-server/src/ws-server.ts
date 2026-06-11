import { WebSocketServer } from 'ws'
import type { RawData } from 'ws'
import { upsertJourney, addEvent, setStatus, addFile } from './journey-store.js'
import { parseFrame, saveFile } from './file-store.js'
import type { WsTextMessage } from './types.js'

export function startWsServer(port: number): WebSocketServer {
  const wss = new WebSocketServer({ port })

  wss.on('connection', (ws) => {
    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        handleBinary(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer))
      } else {
        handleText(data.toString())
      }
    })
  })

  wss.on('error', (err) => {
    console.error('[janus-mcp] WebSocket server error:', err.message)
  })

  return wss
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
