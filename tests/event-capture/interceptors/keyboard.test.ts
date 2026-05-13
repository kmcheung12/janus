import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { attachKeyboardInterceptor } from '../../../src/lib/event-capture/interceptors/keyboard'
import type { KeyboardInputEvent } from '../../../src/lib/event-capture/types'

describe('attachKeyboardInterceptor', () => {
  let detach: () => void
  let captured: KeyboardInputEvent[] = []

  beforeEach(() => {
    captured = []
    detach = attachKeyboardInterceptor(e => captured.push(e as KeyboardInputEvent))
  })

  afterEach(() => detach())

  it('captures input events on text fields', () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.id = 'search'
    document.body.appendChild(input)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.body.removeChild(input)

    expect(captured).toHaveLength(1)
    expect(captured[0].type).toBe('keyboard')
    expect(captured[0].inputType).toBe('text')
  })

  it('does NOT capture input on password fields', () => {
    const input = document.createElement('input')
    input.type = 'password'
    document.body.appendChild(input)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.body.removeChild(input)

    expect(captured).toHaveLength(0)
  })

  it('does not store keystroke content', () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.value = 'secret'
    document.body.appendChild(input)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.body.removeChild(input)

    expect(JSON.stringify(captured)).not.toContain('secret')
  })

  it('does NOT capture input events on checkbox', () => {
    const el = document.createElement('input')
    el.type = 'checkbox'
    document.body.appendChild(el)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    document.body.removeChild(el)
    expect(captured).toHaveLength(0)
  })

  it('does NOT capture input events on radio', () => {
    const el = document.createElement('input')
    el.type = 'radio'
    document.body.appendChild(el)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    document.body.removeChild(el)
    expect(captured).toHaveLength(0)
  })

  it('does NOT capture input events on range', () => {
    const el = document.createElement('input')
    el.type = 'range'
    document.body.appendChild(el)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    document.body.removeChild(el)
    expect(captured).toHaveLength(0)
  })

  it('does NOT capture input events on hidden', () => {
    const el = document.createElement('input')
    el.type = 'hidden'
    document.body.appendChild(el)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    document.body.removeChild(el)
    expect(captured).toHaveLength(0)
  })

  it('does NOT capture input events on select', () => {
    const el = document.createElement('select')
    document.body.appendChild(el)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    document.body.removeChild(el)
    expect(captured).toHaveLength(0)
  })
})
