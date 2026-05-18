import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock browser.runtime before importing store
;(global as Record<string, unknown>).browser = {
  storage: { local: { get: vi.fn(), set: vi.fn() } },
  runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) },
}

// Store is a module with internal state — re-import fresh each test via isolateModules
import { addEvent, updateEvent, getEvents, clearEvents } from '../../src/lib/event-capture/store'
import type { CapturedEvent } from '../../src/lib/event-capture/types'

function click(id: string): CapturedEvent {
  return { id, type: 'click', timestamp: 0, selector: '#btn', label: 'Btn', count: 1, x: 0, y: 0 }
}

describe('updateEvent', () => {
  beforeEach(() => clearEvents())

  it('updates note on an existing event', () => {
    addEvent(click('abc'))
    updateEvent('abc', { note: 'some note' })
    const events = getEvents()
    expect(events[0].note).toBe('some note')
  })

  it('does nothing when id not found', () => {
    addEvent(click('abc'))
    updateEvent('xyz', { note: 'nope' })
    expect(getEvents()[0].note).toBeUndefined()
  })

  it('notifies listeners after update', async () => {
    addEvent(click('abc'))
    const received: CapturedEvent[][] = []
    const unsub = (await import('../../src/lib/event-capture/store')).subscribe(e => received.push(e))
    updateEvent('abc', { note: 'hi' })
    expect(received.length).toBeGreaterThan(0)
    expect(received.at(-1)![0].note).toBe('hi')
    unsub()
  })
})
