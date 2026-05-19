import type { CapturedEvent, EventType } from '../event-capture/types'

type ReplayFn = (event: CapturedEvent) => void

const registry = new Map<EventType, ReplayFn>()

export function registerReplayer(type: EventType, fn: ReplayFn): void {
  registry.set(type, fn)
}

export function replay(event: CapturedEvent): void {
  registry.get(event.type)?.(event)
}

export function _clearRegistry(): void {
  registry.clear()
}
