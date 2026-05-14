type EventType = 'session' | 'navigation' | 'click' | 'keyboard' | 'api' | 'scroll' | 'console' | 'drag'

interface BaseEvent {
  id: string
  type: EventType
  timestamp: number
}

export interface SessionEvent extends BaseEvent {
  type: 'session'
  viewport: { width: number; height: number }
  dpr: number
}

export interface NavigationEvent extends BaseEvent {
  type: 'navigation'
  url: string
  title: string
}

export interface ClickEvent extends BaseEvent {
  type: 'click'
  selector: string
  label: string
  count: number
  x: number
  y: number
}

export interface DragEvent extends BaseEvent {
  type: 'drag'
  sourceSelector: string
  targetSelector: string | null
  path: Array<{ x: number; y: number }>
  deltaX: number
  deltaY: number
}

export interface KeyboardInputEvent extends BaseEvent {
  type: 'keyboard'
  selector: string
  inputType: string
  count: number
  key?: string
  keys?: string[]
}

export interface ApiEvent extends BaseEvent {
  type: 'api'
  method: string
  url: string
  status: number | null
  requestBody: string | null
  responseBody: string | null
  errorDetails: string | null
  duration: number | null
}

export interface ScrollEvent extends BaseEvent {
  type: 'scroll'
  selector: string
  direction: 'up' | 'down' | 'left' | 'right'
  count: number
  deltaX: number
  deltaY: number
}

export interface ConsoleEvent extends BaseEvent {
  type: 'console'
  level: 'error' | 'warn'
  message: string
}

export type CapturedEvent = SessionEvent | NavigationEvent | ClickEvent | KeyboardInputEvent | ApiEvent | ScrollEvent | ConsoleEvent | DragEvent
