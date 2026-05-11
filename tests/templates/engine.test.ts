import { describe, it, expect } from 'vitest'
import { resolveSlots, renderTemplate } from '../../src/lib/templates/engine'
import type { CapturedEvent } from '../../src/lib/event-capture/types'

const navEvent: CapturedEvent = { id: '1', type: 'navigation', timestamp: 0, url: '/checkout' }
const clickEvent: CapturedEvent = { id: '2', type: 'click', timestamp: 1, selector: '#pay-btn', label: 'Pay Now', count: 1 }
const apiEvent: CapturedEvent = {
  id: '3', type: 'api', timestamp: 2, method: 'POST', url: '/api/payment',
  status: 422, requestBody: '{"card":"4111"}', responseBody: '{"error":"Insufficient funds"}',
  errorDetails: 'Insufficient funds', duration: 340,
}

describe('resolveSlots', () => {
  it('resolves url, element_selector, and interaction_description', () => {
    const slots = resolveSlots({
      url: 'https://example.com/checkout',
      elementSelector: '#pay-btn',
      events: [navEvent, clickEvent],
      selectedEvent: undefined,
      userText: 'Payment fails silently',
    })
    expect(slots.url).toBe('https://example.com/checkout')
    expect(slots.element_selector).toBe('#pay-btn')
    expect(slots.interaction_description).toContain('Navigated to')
    expect(slots.interaction_description).toContain('Pay Now')
    expect(slots.user_text).toBe('Payment fails silently')
  })

  it('resolves api slots from selected api event', () => {
    const slots = resolveSlots({
      url: 'https://example.com',
      elementSelector: undefined,
      events: [],
      selectedEvent: apiEvent,
      userText: '',
    })
    expect(slots.method).toBe('POST')
    expect(slots.status).toBe('422')
    expect(slots.error_details).toBe('Insufficient funds')
  })

  it('leaves api slots undefined when selected event is not api type', () => {
    const slots = resolveSlots({
      url: 'https://example.com',
      elementSelector: undefined,
      events: [],
      selectedEvent: clickEvent,
      userText: '',
    })
    expect(slots.method).toBeUndefined()
    expect(slots.status).toBeUndefined()
    expect(slots.error_details).toBeUndefined()
  })
})

describe('renderTemplate', () => {
  it('substitutes all resolved slots', () => {
    const body = 'Fix bug in {element_selector} on {url}.'
    const result = renderTemplate(body, { url: 'https://ex.com', element_selector: '#btn', interaction_description: '', user_text: '' })
    expect(result).toBe('Fix bug in #btn on https://ex.com.')
  })

  it('drops lines with unresolved slots entirely', () => {
    const body = 'First line\nAPI call: {method} {url}\nLast line'
    const result = renderTemplate(body, { url: 'https://ex.com', interaction_description: '', user_text: '' })
    expect(result).not.toContain('{method}')
    expect(result).toContain('First line')
    expect(result).toContain('Last line')
    expect(result).not.toContain('API call:')
  })

  it('collapses multiple blank lines into one', () => {
    const body = 'Line one\n\n\n\nLine two'
    const result = renderTemplate(body, { url: '', interaction_description: '', user_text: '' })
    expect(result).not.toMatch(/\n{3,}/)
  })

  it('trims leading and trailing whitespace from output', () => {
    const body = '\n\nContent\n\n'
    const result = renderTemplate(body, { url: '', interaction_description: '', user_text: '' })
    expect(result).toBe('Content')
  })

  it('interaction_description includes navigation and click events in order', () => {
    const slots = resolveSlots({
      url: 'https://example.com',
      elementSelector: undefined,
      events: [navEvent, clickEvent],
      selectedEvent: undefined,
      userText: '',
    })
    const lines = slots.interaction_description.split('\n')
    expect(lines[0]).toContain('/checkout')
    expect(lines[1]).toContain('Pay Now')
  })
})
