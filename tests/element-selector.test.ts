import { describe, it, expect } from 'vitest'
import { resolveSelector } from '../src/lib/element-selector'

function el(tag: string, attrs: Record<string, string> = {}, text = ''): Element {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  if (text) e.textContent = text
  return e
}

describe('resolveSelector', () => {
  it('prefers data-testid', () => {
    expect(resolveSelector(el('button', { 'data-testid': 'submit-btn' }))).toBe('[data-testid="submit-btn"]')
  })

  it('uses id when no data-testid', () => {
    expect(resolveSelector(el('button', { id: 'my-btn' }))).toBe('#my-btn')
  })

  it('uses aria-label when no id', () => {
    expect(resolveSelector(el('button', { 'aria-label': 'Close dialog' }))).toBe('[aria-label="Close dialog"]')
  })

  it('uses visible text content when no aria-label', () => {
    expect(resolveSelector(el('button', {}, 'Buy Now'))).toBe('button:contains("Buy Now")')
  })

  it('falls back to tag+class, filtering hashed class names', () => {
    const b = el('button')
    b.classList.add('btn', 'sc-ab12cd')  // sc-ab12cd looks like a hash
    expect(resolveSelector(b)).toBe('button.btn')
  })

  it('falls back to tag name alone when no useful class', () => {
    expect(resolveSelector(el('button'))).toBe('button')
  })
})
