import type { CapturedEvent } from './types'
import { collapse } from './collapse'

const MAX_EVENTS = 50

let events: CapturedEvent[] = []
const listeners = new Set<(events: CapturedEvent[]) => void>()

export function addEvent(event: CapturedEvent): void {
  events = collapse([...events, event]).slice(-MAX_EVENTS)
  listeners.forEach(fn => fn(events))
}

export function getEvents(): CapturedEvent[] {
  return events
}

export function clearEvents(): void {
  events = []
  listeners.clear()
}

export function subscribe(fn: (events: CapturedEvent[]) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
