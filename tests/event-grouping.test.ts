import { describe, it, expect } from 'vitest'
import { groupEvents } from '../src/lib/event-grouping'
import type { ApiEvent, CapturedEvent } from '../src/lib/event-capture/types'

function api(id: string, url: string): ApiEvent {
  return { id, type: 'api', timestamp: 0, method: 'GET', url, status: 200,
    requestBody: null, responseBody: null, errorDetails: null, duration: null }
}

function nav(id: string): CapturedEvent {
  return { id, type: 'navigation', timestamp: 0, url: '/x', title: '' }
}

describe('groupEvents', () => {
  it('returns a single api event as a plain event item', () => {
    const items = groupEvents([api('1', 'https://stripe.com/v1/charges')])
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('event')
  })

  it('groups two consecutive same-domain api events into one subgroup', () => {
    const items = groupEvents([
      api('1', 'https://stripe.com/v1/charges'),
      api('2', 'https://stripe.com/v1/customers'),
    ])
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('api-group')
    if (items[0].kind === 'api-group') {
      expect(items[0].id).toBe('1')
      expect(items[0].subgroups).toHaveLength(1)
      expect(items[0].subgroups[0].domain).toBe('stripe.com')
      expect(items[0].subgroups[0].events).toHaveLength(2)
    }
  })

  it('groups two consecutive different-domain api events into two subgroups', () => {
    const items = groupEvents([
      api('1', 'https://stripe.com/v1/charges'),
      api('2', 'https://api.example.com/data'),
    ])
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('api-group')
    if (items[0].kind === 'api-group') {
      expect(items[0].subgroups).toHaveLength(2)
      expect(items[0].subgroups[0].domain).toBe('stripe.com')
      expect(items[0].subgroups[1].domain).toBe('api.example.com')
    }
  })

  it('does not group api events separated by a non-api event', () => {
    const items = groupEvents([
      api('1', 'https://stripe.com/charge'),
      nav('2'),
      api('3', 'https://stripe.com/confirm'),
    ])
    expect(items).toHaveLength(3)
    expect(items[0].kind).toBe('event')
    expect(items[1].kind).toBe('event')
    expect(items[2].kind).toBe('event')
  })

  it('non-api events are never grouped', () => {
    const items = groupEvents([nav('1'), nav('2')])
    expect(items).toHaveLength(2)
    items.forEach(item => expect(item.kind).toBe('event'))
  })

  it('puts all consecutive api events in one group with multiple domain subgroups', () => {
    const items = groupEvents([
      api('1', 'https://stripe.com/a'),
      api('2', 'https://stripe.com/b'),
      api('3', 'https://example.com/a'),
      api('4', 'https://example.com/b'),
    ])
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('api-group')
    if (items[0].kind === 'api-group') {
      expect(items[0].subgroups).toHaveLength(2)
      expect(items[0].subgroups[0].domain).toBe('stripe.com')
      expect(items[0].subgroups[0].events).toHaveLength(2)
      expect(items[0].subgroups[1].domain).toBe('example.com')
      expect(items[0].subgroups[1].events).toHaveLength(2)
    }
  })

  it('creates subgroups matching the user example pattern: a×2, b×3, a×5', () => {
    const items = groupEvents([
      api('1', 'https://a.com/1'),
      api('2', 'https://a.com/2'),
      api('3', 'https://b.com/1'),
      api('4', 'https://b.com/2'),
      api('5', 'https://b.com/3'),
      api('6', 'https://a.com/3'),
      api('7', 'https://a.com/4'),
      api('8', 'https://a.com/5'),
    ])
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('api-group')
    if (items[0].kind === 'api-group') {
      expect(items[0].subgroups).toHaveLength(3)
      expect(items[0].subgroups[0]).toMatchObject({ domain: 'a.com' })
      expect(items[0].subgroups[0].events).toHaveLength(2)
      expect(items[0].subgroups[1]).toMatchObject({ domain: 'b.com' })
      expect(items[0].subgroups[1].events).toHaveLength(3)
      expect(items[0].subgroups[2]).toMatchObject({ domain: 'a.com' })
      expect(items[0].subgroups[2].events).toHaveLength(3)
    }
  })

  it('group id is the id of the first event in the group', () => {
    const items = groupEvents([
      api('first', 'https://stripe.com/a'),
      api('second', 'https://stripe.com/b'),
    ])
    expect(items[0].kind).toBe('api-group')
    if (items[0].kind === 'api-group') {
      expect(items[0].id).toBe('first')
      expect(items[0].subgroups[0].id).toBe('first')
    }
  })

  it('uses raw URL as domain when URL parsing fails', () => {
    const items = groupEvents([
      api('1', 'not-a-valid-url'),
      api('2', 'not-a-valid-url'),
    ])
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('api-group')
    if (items[0].kind === 'api-group') {
      expect(items[0].subgroups).toHaveLength(1)
      expect(items[0].subgroups[0].domain).toBe('not-a-valid-url')
    }
  })

  it('returns empty array for empty input', () => {
    expect(groupEvents([])).toHaveLength(0)
  })
})
