import type { ApiEvent, CapturedEvent } from './event-capture/types'

export type DisplayItem =
  | { kind: 'event'; event: CapturedEvent }
  | { kind: 'api-group'; id: string; domain: string; events: ApiEvent[] }

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export function groupEvents(events: CapturedEvent[]): DisplayItem[] {
  const items: DisplayItem[] = []

  for (const event of events) {
    if (event.type !== 'api') {
      items.push({ kind: 'event', event })
      continue
    }

    const apiEvent = event as ApiEvent
    const domain = extractDomain(apiEvent.url)
    const last = items[items.length - 1]

    // Extend an existing group with the same domain
    if (last?.kind === 'api-group' && last.domain === domain) {
      last.events.push(apiEvent)
      continue
    }

    // Upgrade a preceding lone api event into a group when domains match
    if (last?.kind === 'event' && last.event.type === 'api') {
      const prevApi = last.event as ApiEvent
      if (extractDomain(prevApi.url) === domain) {
        items.pop()
        items.push({ kind: 'api-group', id: prevApi.id, domain, events: [prevApi, apiEvent] })
        continue
      }
    }

    items.push({ kind: 'event', event })
  }

  return items
}
