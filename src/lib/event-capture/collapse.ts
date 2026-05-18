import type { CapturedEvent, ClickEvent, KeyboardInputEvent, ApiEvent, ScrollEvent } from './types'

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
    case 'click': {
      const ca = a as ClickEvent, cb = b as ClickEvent
      return ca.selector === cb.selector && ca.x === cb.x && ca.y === cb.y
    }
    case 'keyboard': {
      const ka = a as KeyboardInputEvent, kb = b as KeyboardInputEvent
      if (ka.selector !== kb.selector) return false
      if (ka.keys !== undefined && kb.keys !== undefined) return true  // keystroke mode: collapse all into sequence
      return ka.key === kb.key  // count mode: only collapse same key (Enter with Enter)
    }
    case 'api': {
      const aa = a as ApiEvent, bb = b as ApiEvent
      return aa.method === bb.method && aa.url === bb.url && aa.status === bb.status
    }
    case 'scroll':
      return (a as ScrollEvent).selector === (b as ScrollEvent).selector
    case 'session':
    case 'drag':
    case 'console':
    case 'navigation':
    case 'element_pick':
      return false
  }
}

function merged(a: CapturedEvent, b: CapturedEvent): CapturedEvent {
  switch (a.type) {
    case 'click':
      return { ...a, count: (a as ClickEvent).count + 1, timestamp: b.timestamp }
    case 'keyboard': {
      const ka = a as KeyboardInputEvent, kb = b as KeyboardInputEvent
      if (ka.keys !== undefined && kb.keys !== undefined) {
        return { ...a, keys: [...ka.keys, ...kb.keys], count: ka.count + kb.count, timestamp: b.timestamp }
      }
      return { ...a, count: ka.count + 1, timestamp: b.timestamp }
    }
    case 'api':
      return { ...a, timestamp: b.timestamp }
    case 'scroll':
      return { ...b, count: (a as ScrollEvent).count + 1 }
    case 'session':
    case 'drag':
    case 'console':
    case 'navigation':
    case 'element_pick':
      return { ...b }
  }
}
