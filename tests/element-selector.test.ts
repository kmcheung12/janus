import { describe, it, expect, afterEach } from 'vitest'
import { resolveSelector } from '../src/lib/element-selector'

// Helper for elements NOT attached to the DOM (tests the disconnected fallback)
function detached(tag: string, attrs: Record<string, string> = {}): Element {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  return e
}

describe('resolveSelector', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  // --- Priority order (via disconnected fallback, tests segmentFor logic) ---

  it('prefers data-testid', () => {
    expect(resolveSelector(detached('button', { 'data-testid': 'submit-btn' }))).toBe('[data-testid="submit-btn"]')
  })

  it('uses id when no data-testid', () => {
    expect(resolveSelector(detached('button', { id: 'my-btn' }))).toBe('#my-btn')
  })

  it('uses aria-label when no id', () => {
    expect(resolveSelector(detached('button', { 'aria-label': 'Close dialog' }))).toBe('[aria-label="Close dialog"]')
  })

  it('filters hashed class names and uses remaining classes', () => {
    const b = detached('button')
    b.classList.add('btn', 'sc-ab12cd')
    expect(resolveSelector(b)).toBe('button.btn')
  })

  it('falls back to bare tag when no stable classes', () => {
    expect(resolveSelector(detached('button'))).toBe('button')
  })

  // --- DOM-attached: uniqueness checking ---

  it('returns basic segment when it already uniquely identifies the element', () => {
    const el = document.createElement('button')
    el.setAttribute('aria-label', 'Save')
    document.body.appendChild(el)
    expect(resolveSelector(el)).toBe('[aria-label="Save"]')
  })

  it('walks up to parent when basic segment matches multiple elements', () => {
    document.body.innerHTML = `
      <nav class="sidebar"><button class="item">A</button></nav>
      <main><button class="item">B</button></main>
    `
    const target = document.querySelector('nav.sidebar > button.item')!
    expect(resolveSelector(target)).toBe('nav.sidebar > button.item')
  })

  it('uses nth-child as last resort when no stable attributes distinguish element', () => {
    document.body.innerHTML = `<ul><li>A</li><li>B</li><li>C</li></ul>`
    const target = document.querySelectorAll('li')[1]
    expect(resolveSelector(target)).toBe('body > ul > li:nth-child(2)')
  })
})
