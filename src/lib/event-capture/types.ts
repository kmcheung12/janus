export type EventType = 'navigation' | 'click' | 'keyboard' | 'api' | 'scroll' | 'console'

interface BaseEvent {
  id: string
  type: EventType
  timestamp: number
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
}

export interface KeyboardInputEvent extends BaseEvent {
  type: 'keyboard'
  selector: string
  inputType: string
  count: number
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
}

export interface ConsoleEvent extends BaseEvent {
  type: 'console'
  level: 'error' | 'warn'
  message: string
}

export type CapturedEvent = NavigationEvent | ClickEvent | KeyboardInputEvent | ApiEvent | ScrollEvent | ConsoleEvent
