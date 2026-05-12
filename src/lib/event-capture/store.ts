import type { CapturedEvent } from './types'
import { collapse } from './collapse'

const MAX_EVENTS = 50

let events: CapturedEvent[] = []
const listeners = new Set<(events: CapturedEvent[]) => void>()

function syncToBackground() {
  browser.runtime
    .sendMessage({ type: 'JANUS_SYNC_EVENTS', events })
    .catch(() => {})
}

export function addEvent(event: CapturedEvent): void {
  events = collapse([...events, event]).slice(-MAX_EVENTS)
  listeners.forEach(fn => fn(events))
  syncToBackground()
}

export function getEvents(): CapturedEvent[] {
  return events
}

export function clearEvents(): void {
  events = []
  listeners.forEach(fn => fn(events))
  browser.runtime.sendMessage({ type: 'JANUS_CLEAR_EVENTS' }).catch(() => {})
}

export function subscribe(fn: (events: CapturedEvent[]) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export async function loadPersistedEvents(): Promise<void> {
  try {
    const stored = await browser.runtime.sendMessage({ type: 'JANUS_GET_EVENTS' }) as CapturedEvent[] | undefined
    if (stored?.length) {
      events = stored
      listeners.forEach(fn => fn(events))
    }
  } catch {
    // background not ready yet — fine, start with empty store
  }
}
