export type EventType = 'navigation' | 'click' | 'keyboard' | 'api'

interface BaseEvent {
  id: string
  type: EventType
  timestamp: number
}

export interface NavigationEvent extends BaseEvent {
  type: 'navigation'
  url: string
}

export interface ClickEvent extends BaseEvent {
  type: 'click'
  selector: string
  label: string
  count: number
}

export interface KeyboardEvent extends BaseEvent {
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

export type CapturedEvent = NavigationEvent | ClickEvent | KeyboardEvent | ApiEvent
