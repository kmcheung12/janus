import { describe, it, expect } from 'vitest'
import { collapse } from '../../src/lib/event-capture/collapse'
import type { CapturedEvent } from '../../src/lib/event-capture/types'

function clickEvent(selector: string, count = 1): CapturedEvent {
  return { id: crypto.randomUUID(), type: 'click', timestamp: Date.now(), selector, label: selector, count, x: 0, y: 0 }
}

function navEvent(url: string): CapturedEvent {
  return { id: crypto.randomUUID(), type: 'navigation', timestamp: Date.now(), url, title: '' }
}

function apiEvent(method: string, url: string, status: number | null): CapturedEvent {
  return { id: crypto.randomUUID(), type: 'api', timestamp: Date.now(), method, url, status, requestBody: null, responseBody: null, errorDetails: null, duration: null }
}

function keyboardEvent(selector: string, count = 1): CapturedEvent {
  return { id: crypto.randomUUID(), type: 'keyboard', timestamp: Date.now(), selector, inputType: 'text', count }
}

describe('collapse', () => {
  it('collapses consecutive clicks on the same selector', () => {
    const events = [clickEvent('#btn'), clickEvent('#btn'), clickEvent('#btn')]
    const result = collapse(events)
    expect(result).toHaveLength(1)
    expect((result[0] as any).count).toBe(3)
  })

  it('does not collapse clicks on different selectors', () => {
    const events = [clickEvent('#a'), clickEvent('#b')]
    const result = collapse(events)
    expect(result).toHaveLength(2)
  })

  it('does not collapse consecutive navigations', () => {
    const events = [navEvent('/a'), navEvent('/a')]
    const result = collapse(events)
    expect(result).toHaveLength(2)
  })

  it('does not collapse api calls with different status codes', () => {
    const events = [apiEvent('POST', '/api/cart', 200), apiEvent('POST', '/api/cart', 422)]
    const result = collapse(events)
    expect(result).toHaveLength(2)
  })

  it('collapses api calls with same method, url, and status', () => {
    const events = [apiEvent('GET', '/api/items', 200), apiEvent('GET', '/api/items', 200)]
    const result = collapse(events)
    expect(result).toHaveLength(1)
  })

  it('collapses consecutive keyboard events on the same selector', () => {
    const events = [keyboardEvent('#search'), keyboardEvent('#search'), keyboardEvent('#search')]
    const result = collapse(events)
    expect(result).toHaveLength(1)
    expect((result[0] as any).count).toBe(3)
  })

  it('does not collapse keyboard events on different selectors', () => {
    const events = [keyboardEvent('#search'), keyboardEvent('#email')]
    const result = collapse(events)
    expect(result).toHaveLength(2)
  })

  it('resets collapse when a different event type occurs between same-type events', () => {
    const events = [clickEvent('#btn'), navEvent('/a'), clickEvent('#btn')]
    const result = collapse(events)
    expect(result).toHaveLength(3)
  })
})
