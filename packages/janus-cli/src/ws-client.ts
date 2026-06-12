import WebSocket from 'ws'

interface JourneyMeta {
  startTime: number
  startUrl: string
  tabTitle: string
  domain: string
  status: 'recording' | 'stopped'
}

interface CliLineEvent {
  id: string
  type: 'cli_line'
  timestamp: number
  line: string
  stream: 'stdout' | 'stderr'
}

type WsMessage =
  | { type: 'sync'; journeyId: string; meta: JourneyMeta; events: CliLineEvent[] }
  | { type: 'recording_stopped'; journeyId: string }

export class JanusWsClient {
  private ws: WebSocket | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectDelay = 1000
  private closed = false

  constructor(
    private readonly url: string,
    private readonly journeyId: string,
    private readonly getMeta: () => JourneyMeta,
    private readonly getEvents: () => CliLineEvent[],
  ) {}

  connect(): void {
    if (this.closed) return
    try {
      this.ws = new WebSocket(this.url)
    } catch {
      this.scheduleReconnect()
      return
    }

    this.ws.on('open', () => {
      this.reconnectDelay = 1000
      this.sendSync()
    })

    this.ws.on('error', () => {})

    this.ws.on('close', () => {
      if (!this.closed) this.scheduleReconnect()
    })
  }

  sendSync(): void {
    this.send({ type: 'sync', journeyId: this.journeyId, meta: this.getMeta(), events: this.getEvents() })
  }

  sendStopped(): void {
    this.send({ type: 'recording_stopped', journeyId: this.journeyId })
    this.closed = true
    this.ws?.close()
  }

  private send(msg: WsMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000)
      this.connect()
    }, this.reconnectDelay)
  }

  destroy(): void {
    this.closed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
  }
}
