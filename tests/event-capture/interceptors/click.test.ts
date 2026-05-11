import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { attachClickInterceptor } from '../../../src/lib/event-capture/interceptors/click'
import type { ClickEvent } from '../../../src/lib/event-capture/types'

describe('attachClickInterceptor', () => {
  let detach: () => void
  let captured: ClickEvent[] = []

  beforeEach(() => {
    captured = []
    detach = attachClickInterceptor(e => captured.push(e as ClickEvent))
  })

  afterEach(() => detach())

  it('captures a click event with selector and label', () => {
    const btn = document.createElement('button')
    btn.id = 'my-btn'
    btn.textContent = 'Click me'
    document.body.appendChild(btn)
    btn.click()
    document.body.removeChild(btn)

    expect(captured).toHaveLength(1)
    expect(captured[0].type).toBe('click')
    expect(captured[0].selector).toContain('my-btn')
  })

  it('captures clicks on plain divs', () => {
    const div = document.createElement('div')
    div.id = 'wrapper'
    document.body.appendChild(div)
    div.click()
    document.body.removeChild(div)
    expect(captured).toHaveLength(1)
  })

  it('detach stops capturing', () => {
    detach()
    const btn = document.createElement('button')
    document.body.appendChild(btn)
    btn.click()
    document.body.removeChild(btn)
    expect(captured).toHaveLength(0)
  })
})
