import type { CapturedEvent, ClickEvent, KeyboardInputEvent, ApiEvent, ScrollEvent, DragEvent } from './types'

export function collapse(events: CapturedEvent[]): CapturedEvent[] {
  const result: CapturedEvent[] = []

  for (const event of events) {
    const last = result[result.length - 1]
    if (last && canCollapse(last, event)) {
      result[result.length - 1] = merged(last, event)
    } else {
      result.push({ ...event })
    }
  }

  return result
}

function canCollapse(a: CapturedEvent, b: CapturedEvent): boolean {
  if (a.type !== b.type) return false
  switch (a.type) {
    case 'click':
      return (a as ClickEvent).selector === (b as ClickEvent).selector
    case 'keyboard': {
      const ka = a as KeyboardInputEvent, kb = b as KeyboardInputEvent
      return ka.selector === kb.selector && ka.key === kb.key
    }
    case 'api': {
      const aa = a as ApiEvent, bb = b as ApiEvent
      return aa.method === bb.method && aa.url === bb.url && aa.status === bb.status
    }
    case 'scroll':
      return (a as ScrollEvent).selector === (b as ScrollEvent).selector
    case 'drag':
    case 'console':
    case 'navigation':
      return false
  }
}

function merged(a: CapturedEvent, b: CapturedEvent): CapturedEvent {
  switch (a.type) {
    case 'click':
      return { ...a, count: (a as ClickEvent).count + 1, timestamp: b.timestamp }
    case 'keyboard':
      return { ...a, count: (a as KeyboardInputEvent).count + 1, timestamp: b.timestamp }
    case 'api':
      return { ...a, timestamp: b.timestamp }
    case 'scroll':
      return { ...b, count: (a as ScrollEvent).count + 1 }
    case 'drag':
    case 'console':
    case 'navigation':
      return { ...b }
  }
}
