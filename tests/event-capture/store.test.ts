import { describe, it, expect, beforeEach } from 'vitest'
import { addEvent, getEvents, subscribe, clearEvents } from '../../src/lib/event-capture/store'
import type { CapturedEvent } from '../../src/lib/event-capture/types'

function clickEvent(selector: string): CapturedEvent {
  return { id: crypto.randomUUID(), type: 'click', timestamp: Date.now(), selector, label: selector, count: 1 }
}

describe('store', () => {
  beforeEach(() => clearEvents())

  it('stores an added event', () => {
    addEvent(clickEvent('#btn'))
    expect(getEvents()).toHaveLength(1)
  })

  it('caps at 50 collapsed events', () => {
    for (let i = 0; i < 60; i++) addEvent(clickEvent(`#btn-${i}`))
    expect(getEvents()).toHaveLength(50)
  })

  it('notifies subscribers on add', () => {
    let received: CapturedEvent[] = []
    subscribe(events => { received = events })
    addEvent(clickEvent('#x'))
    expect(received).toHaveLength(1)
  })

  it('unsubscribe stops notifications', () => {
    let callCount = 0
    const unsub = subscribe(() => callCount++)
    unsub()
    addEvent(clickEvent('#x'))
    expect(callCount).toBe(0)
  })

  it('collapses consecutive same-target clicks into one entry', () => {
    addEvent(clickEvent('#btn'))
    addEvent(clickEvent('#btn'))
    expect(getEvents()).toHaveLength(1)
    expect((getEvents()[0] as any).count).toBe(2)
  })
})
