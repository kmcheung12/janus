import type { CapturedEvent } from '../event-capture/types'

const WS_URL = 'ws://localhost:3457'
const RECONNECT_DELAY_MS = 2000

export interface JourneyMeta {
  startTime: number
  startUrl: string
  tabTitle: string
  domain: string
  status: 'recording' | 'stopped'
}

interface ActiveJourney {
  journeyId: string
  meta: JourneyMeta
  events: CapturedEvent[]
}

let ws: WebSocket | null = null
let active: ActiveJourney | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

export function startJourney(journeyId: string, meta: JourneyMeta): void {
  active = { journeyId, meta, events: [] }
  connect()
}

export function syncEvents(journeyId: string, events: CapturedEvent[]): void {
  if (!active || active.journeyId !== journeyId) return
  active.events = events
  send({ type: 'sync', journeyId, meta: active.meta, events })
}

export function stopJourney(journeyId: string): void {
  if (!active || active.journeyId !== journeyId) return
  active.meta.status = 'stopped'
  send({ type: 'recording_stopped', journeyId })
  active = null
}

export function sendFile(journeyId: string, filename: string, mimeType: string, bytes: ArrayBuffer): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  const headerJson = JSON.stringify({ type: 'file', journeyId, filename, mimeType })
  const headerBytes = new TextEncoder().encode(headerJson)
  const frame = new ArrayBuffer(4 + headerBytes.length + bytes.byteLength)
  const view = new DataView(frame)
  view.setUint32(0, headerBytes.length, false)
  new Uint8Array(frame, 4, headerBytes.length).set(headerBytes)
  new Uint8Array(frame, 4 + headerBytes.length).set(new Uint8Array(bytes))
  ws.send(frame)
}

function connect(): void {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return
  ws = new WebSocket(WS_URL)

  ws.onopen = () => {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    if (active) {
      send({ type: 'sync', journeyId: active.journeyId, meta: active.meta, events: active.events })
    }
  }

  ws.onclose = () => {
    if (active) {
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS)
    }
  }

  ws.onerror = () => ws?.close()
}

function send(msg: object): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}
