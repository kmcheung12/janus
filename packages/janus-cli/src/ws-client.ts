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
  private pendingStopped = false
  private openCallbacks: Array<() => void> = []

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
      const cbs = this.openCallbacks.splice(0)
      cbs.forEach(cb => cb())
      if (this.pendingStopped) {
        this.send({ type: 'recording_stopped', journeyId: this.journeyId })
        this.ws?.close()
        return
      }
      this.sendSync()
    })

    this.ws.on('error', () => {})

    this.ws.on('close', () => {
      if (!this.closed) this.scheduleReconnect()
    })
  }

  waitForOpen(timeoutMs = 2000): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws?.readyState === WebSocket.OPEN) { resolve(); return }
      const cb = () => resolve()
      this.openCallbacks.push(cb)
      setTimeout(() => {
        this.openCallbacks = this.openCallbacks.filter(c => c !== cb)
        resolve() // resolve anyway — command runs even if MCP is unreachable
      }, timeoutMs)
    })
  }

  sendSync(): void {
    this.send({ type: 'sync', journeyId: this.journeyId, meta: this.getMeta(), events: this.getEvents() })
  }

  sendStopped(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: 'recording_stopped', journeyId: this.journeyId })
      this.closed = true
      this.ws.close()
    } else {
      // Not connected — attempt one reconnect just to deliver the stopped message
      this.pendingStopped = true
      this.closed = false
      this.connect()
      this.closed = true  // prevent further reconnects if this attempt also fails
    }
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
