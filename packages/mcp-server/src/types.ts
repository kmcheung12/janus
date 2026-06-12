// --- Copied from src/lib/event-capture/types.ts ---
export type EventType = 'session' | 'navigation' | 'click' | 'keyboard' | 'api' | 'scroll' | 'console' | 'drag' | 'element_pick' | 'resize' | 'cli_line'

interface BaseEvent {
  id: string
  type: EventType
  timestamp: number
  note?: string
  excluded?: boolean
}

export interface SessionEvent extends BaseEvent { type: 'session'; viewport: { width: number; height: number }; dpr: number; browser: string }
export interface NavigationEvent extends BaseEvent { type: 'navigation'; url: string; title: string }
export interface ClickEvent extends BaseEvent { type: 'click'; selector: string; label: string; count: number; x: number; y: number }
export interface DragEvent extends BaseEvent { type: 'drag'; sourceSelector: string; targetSelector: string | null; path: Array<{ x: number; y: number }>; deltaX: number; deltaY: number }
export interface KeyboardInputEvent extends BaseEvent { type: 'keyboard'; selector: string; inputType: string; count: number; key?: string; keys?: string[] }
export interface ApiEvent extends BaseEvent { type: 'api'; method: string; url: string; status: number | null; requestBody: string | null; responseBody: string | null; errorDetails: string | null; duration: number | null }
export interface ScrollEvent extends BaseEvent { type: 'scroll'; selector: string; direction: 'up' | 'down' | 'left' | 'right'; count: number; deltaX: number; deltaY: number }
export interface ConsoleEvent extends BaseEvent { type: 'console'; level: 'error' | 'warn' | 'log'; message: string; source?: string | null }
export interface ElementPickEvent extends BaseEvent { type: 'element_pick'; selector: string; text: string; attributes: Record<string, string>; styles: Record<string, string> }
export interface ResizeEvent extends BaseEvent { type: 'resize'; width: number; height: number; orientation?: string }
export interface CliLineEvent extends BaseEvent { type: 'cli_line'; line: string; stream: 'stdout' | 'stderr' }

export type CapturedEvent =
  | SessionEvent | NavigationEvent | ClickEvent | KeyboardInputEvent
  | ApiEvent | ScrollEvent | ConsoleEvent | DragEvent | ElementPickEvent | ResizeEvent | CliLineEvent

// --- MCP server types ---
export interface JourneyMeta {
  startTime: number
  startUrl: string
  tabTitle: string
  domain: string
  status: 'recording' | 'stopped'
}

export interface FileAttachment {
  filename: string
  mimeType: string
  path: string
}

export interface Journey {
  id: string
  meta: JourneyMeta
  events: CapturedEvent[]
  files: FileAttachment[]
}

export type WsTextMessage =
  | { type: 'sync'; journeyId: string; meta: JourneyMeta; events: CapturedEvent[] }
  | { type: 'event'; journeyId: string; event: CapturedEvent }
  | { type: 'recording_stopped'; journeyId: string }

export interface FileMessageHeader {
  type: 'file'
  journeyId: string
  filename: string
  mimeType: string
}
