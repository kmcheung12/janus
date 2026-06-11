import type { Journey, JourneyMeta, CapturedEvent, FileAttachment } from './types.js'

const store = new Map<string, Journey>()

export function upsertJourney(id: string, meta: JourneyMeta, events: CapturedEvent[]): void {
  const existing = store.get(id)
  store.set(id, { id, meta, events, files: existing?.files ?? [] })
}

export function addEvent(journeyId: string, event: CapturedEvent): void {
  const j = store.get(journeyId)
  if (!j) return
  j.events.push(event)
}

export function setStatus(journeyId: string, status: 'recording' | 'stopped'): void {
  const j = store.get(journeyId)
  if (!j) return
  j.meta.status = status
}

export function addFile(journeyId: string, file: FileAttachment): void {
  const j = store.get(journeyId)
  if (!j) return
  j.files.push(file)
}

export function getById(id: string): Journey | undefined {
  return store.get(id)
}

export function getByDomain(domain: string): Journey[] {
  const lower = domain.toLowerCase()
  return [...store.values()].filter(j => j.meta.domain.toLowerCase().includes(lower))
}

export function getLatest(): Journey | undefined {
  if (store.size === 0) return undefined
  return [...store.values()].reduce((a, b) => a.meta.startTime > b.meta.startTime ? a : b)
}

export function listAll(): Journey[] {
  return [...store.values()]
}

export function clear(): void {
  store.clear()
}
