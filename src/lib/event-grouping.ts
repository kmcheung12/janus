import type { ApiEvent, CapturedEvent } from './event-capture/types'

export type ApiDomainSubgroup = {
  id: string       // id of first event in this domain run
  domain: string
  events: ApiEvent[]
}

export type DisplayItem =
  | { kind: 'event'; event: CapturedEvent }
  | { kind: 'api-group'; id: string; subgroups: ApiDomainSubgroup[] }

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

    if (last?.kind === 'api-group') {
      // Extend the existing top-level group
      const lastSub = last.subgroups[last.subgroups.length - 1]
      if (lastSub.domain === domain) {
        // Same domain as last subgroup — extend it
        lastSub.events.push(apiEvent)
      } else {
        // New domain run — new subgroup within the same top-level group
        last.subgroups.push({ id: apiEvent.id, domain, events: [apiEvent] })
      }
      continue
    }

    // Upgrade a preceding lone api event into a group (any domain pairing)
    if (last?.kind === 'event' && last.event.type === 'api') {
      const prevApi = last.event as ApiEvent
      const prevDomain = extractDomain(prevApi.url)
      items.pop()
      if (prevDomain === domain) {
        // Same domain: one subgroup
        items.push({
          kind: 'api-group',
          id: prevApi.id,
          subgroups: [{ id: prevApi.id, domain, events: [prevApi, apiEvent] }],
        })
      } else {
        // Different domains: two subgroups
        items.push({
          kind: 'api-group',
          id: prevApi.id,
          subgroups: [
            { id: prevApi.id, domain: prevDomain, events: [prevApi] },
            { id: apiEvent.id, domain, events: [apiEvent] },
          ],
        })
      }
      continue
    }

    items.push({ kind: 'event', event })
  }

  return items
}
