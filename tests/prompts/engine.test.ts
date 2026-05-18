import { describe, it, expect } from 'vitest'
import { resolveSlots, renderTemplate, fieldsOf } from '../../src/lib/prompts/engine'
import type { CapturedEvent, ElementPickEvent, ClickEvent, ApiEvent, NavigationEvent } from '../../src/lib/event-capture/types'

const navEvent: CapturedEvent = { id: '1', type: 'navigation', timestamp: 0, url: '/checkout', title: '' }
const clickEvent: CapturedEvent = { id: '2', type: 'click', timestamp: 1, selector: '#pay-btn', label: 'Pay Now', count: 1, x: 0, y: 0 }
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

describe('fieldsOf', () => {
  it('returns flat string map for click event', () => {
    const e: ClickEvent = { id: '1', type: 'click', timestamp: 0, selector: '#btn', label: 'Save', count: 2, x: 10, y: 20 }
    const fields = fieldsOf(e)
    expect(fields).toEqual({ selector: '#btn', label: 'Save', count: '2', x: '10', y: '20' })
  })

  it('returns flat map for api event with snake_case keys', () => {
    const e: ApiEvent = {
      id: '2', type: 'api', timestamp: 0, method: 'POST', url: '/api/pay',
      status: 422, requestBody: '{}', responseBody: '{"err":"x"}',
      errorDetails: 'bad', duration: 100,
    }
    const fields = fieldsOf(e)
    expect(fields.method).toBe('POST')
    expect(fields.url).toBe('/api/pay')
    expect(fields.status).toBe('422')
    expect(fields.request_body).toBe('{}')
    expect(fields.response_body).toBe('{"err":"x"}')
    expect(fields.error_details).toBe('bad')
  })

  it('omits null/undefined api fields', () => {
    const e: ApiEvent = {
      id: '3', type: 'api', timestamp: 0, method: 'GET', url: '/x',
      status: null, requestBody: null, responseBody: null, errorDetails: null, duration: null,
    }
    const fields = fieldsOf(e)
    expect('status' in fields).toBe(false)
    expect('request_body' in fields).toBe(false)
  })

  it('flattens attributes and styles for element_pick', () => {
    const e: ElementPickEvent = {
      id: '4', type: 'element_pick', timestamp: 0,
      selector: 'button.save', text: 'Save',
      attributes: { href: '/go', 'data-testid': 'save-btn' },
      styles: { color: 'red', font_size: '14px' },
    }
    const fields = fieldsOf(e)
    expect(fields.selector).toBe('button.save')
    expect(fields.text).toBe('Save')
    expect(fields.href).toBe('/go')
    expect(fields['data-testid']).toBe('save-btn')
    expect(fields.color).toBe('red')
    expect(fields.font_size).toBe('14px')
  })

  it('returns empty object for session event', () => {
    const e = { id: '5', type: 'session' as const, timestamp: 0, viewport: { width: 1280, height: 800 }, dpr: 2 }
    expect(fieldsOf(e)).toEqual({})
  })
})

import { defaultNoteTemplate, expandFields, formatEvents } from '../../src/lib/prompts/engine'

describe('defaultNoteTemplate', () => {
  it('click', () => {
    expect(defaultNoteTemplate({ id: '', type: 'click', timestamp: 0, selector: '', label: '', count: 1, x: 0, y: 0 }))
      .toBe('Clicked {label} at ({x}, {y})')
  })

  it('navigation', () => {
    expect(defaultNoteTemplate({ id: '', type: 'navigation', timestamp: 0, url: '', title: '' }))
      .toBe('Navigated to {url}')
  })

  it('api', () => {
    expect(defaultNoteTemplate({ id: '', type: 'api', timestamp: 0, method: 'GET', url: '', status: null, requestBody: null, responseBody: null, errorDetails: null, duration: null }))
      .toBe('{method} {url} → {status}')
  })

  it('keyboard', () => {
    expect(defaultNoteTemplate({ id: '', type: 'keyboard', timestamp: 0, selector: '', inputType: '', count: 1 }))
      .toBe('Typed {count} characters in {selector}')
  })

  it('scroll', () => {
    expect(defaultNoteTemplate({ id: '', type: 'scroll', timestamp: 0, selector: '', direction: 'down', count: 1, deltaX: 0, deltaY: 0 }))
      .toBe('Scrolled {direction} on {selector}')
  })

  it('drag', () => {
    expect(defaultNoteTemplate({ id: '', type: 'drag', timestamp: 0, sourceSelector: '', targetSelector: null, path: [], deltaX: 0, deltaY: 0 }))
      .toBe('Dragged {source_selector} onto {target_selector}')
  })

  it('console', () => {
    expect(defaultNoteTemplate({ id: '', type: 'console', timestamp: 0, level: 'error', message: '' }))
      .toBe('Console {level}: {message}')
  })

  it('session', () => {
    expect(defaultNoteTemplate({ id: '', type: 'session', timestamp: 0, viewport: { width: 0, height: 0 }, dpr: 1 }))
      .toBe('Session started')
  })

  it('element_pick returns empty string', () => {
    expect(defaultNoteTemplate({ id: '', type: 'element_pick', timestamp: 0, selector: '', text: '', attributes: {}, styles: {} }))
      .toBe('')
  })
})

describe('formatEvents', () => {
  it('formats click using default template', () => {
    const e: CapturedEvent = { id: '1', type: 'click', timestamp: 0, selector: '#btn', label: 'Pay Now', count: 1, x: 854, y: 101 }
    expect(formatEvents([e])).toBe('1. Clicked Pay Now at (854, 101)')
  })

  it('uses note instead of default template when present', () => {
    const e: CapturedEvent = { id: '1', type: 'click', timestamp: 0, selector: '#btn', label: 'Pay Now', count: 1, x: 0, y: 0, note: '{selector} should navigate to /checkout' }
    expect(formatEvents([e])).toBe('1. #btn should navigate to /checkout')
  })

  it('skips element_pick with no note', () => {
    const pick: ElementPickEvent = { id: '1', type: 'element_pick', timestamp: 0, selector: 'h1', text: 'Hello', attributes: {}, styles: {} }
    const click: CapturedEvent = { id: '2', type: 'click', timestamp: 1, selector: '#btn', label: 'Go', count: 1, x: 0, y: 0 }
    const result = formatEvents([pick, click])
    expect(result).not.toContain('element_pick')
    expect(result).toBe('1. Clicked Go at (0, 0)')
  })

  it('includes element_pick when it has a note', () => {
    const pick: ElementPickEvent = { id: '1', type: 'element_pick', timestamp: 0, selector: 'h1.title', text: 'Welcome', attributes: {}, styles: {}, note: '{text} should equal "Dashboard"' }
    expect(formatEvents([pick])).toBe('1. Welcome should equal "Dashboard"')
  })

  it('numbers lines contiguously skipping invisible events', () => {
    const pick: ElementPickEvent = { id: '1', type: 'element_pick', timestamp: 0, selector: 'h1', text: '', attributes: {}, styles: {} }
    const nav: CapturedEvent = { id: '2', type: 'navigation', timestamp: 1, url: '/home', title: 'Home' }
    const result = formatEvents([pick, nav])
    expect(result).toBe('1. Navigated to /home')
  })
})

describe('expandFields', () => {
  it('substitutes known fields', () => {
    expect(expandFields('{selector} should be visible', { selector: 'button.save' }))
      .toBe('button.save should be visible')
  })

  it('passes unknown fields through unchanged', () => {
    expect(expandFields('value is {unknown_field}', {}))
      .toBe('value is {unknown_field}')
  })

  it('unescapes {{field}} to literal {field}', () => {
    expect(expandFields('use {{selector}} to target', { selector: 'btn' }))
      .toBe('use {selector} to target')
  })

  it('substitutes before unescaping — {{field}} never gets substituted', () => {
    expect(expandFields('{{selector}} and {selector}', { selector: 'btn' }))
      .toBe('{selector} and btn')
  })

  it('handles multiline text', () => {
    const result = expandFields('{label} clicked\n{selector} is the target', { label: 'Save', selector: '#save' })
    expect(result).toBe('Save clicked\n#save is the target')
  })
})
