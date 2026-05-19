import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerReplayer, replay, _clearRegistry } from '../../src/lib/event-replay/registry'
import type { ClickEvent, NavigationEvent } from '../../src/lib/event-capture/types'

const makeClick = (): ClickEvent => ({
  id: '1', type: 'click', timestamp: 0,
  selector: 'button', label: 'OK', count: 1, x: 100, y: 200,
})

const makeNav = (): NavigationEvent => ({
  id: '2', type: 'navigation', timestamp: 0,
  url: 'https://example.com', title: 'Home',
})

describe('event replay registry', () => {
  beforeEach(() => {
    _clearRegistry()
  })

  it('calls the registered handler with the event', () => {
    const handler = vi.fn()
    registerReplayer('click', handler)
    const event = makeClick()
    replay(event)
    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(event)
  })

  it('does nothing when no handler is registered for the event type', () => {
    expect(() => replay(makeNav())).not.toThrow()
  })

  it('replaces the handler when registered twice for the same type', () => {
    const first = vi.fn()
    const second = vi.fn()
    registerReplayer('click', first)
    registerReplayer('click', second)
    replay(makeClick())
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })
})
