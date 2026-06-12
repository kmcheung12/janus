# Unique Element Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `resolveSelector` always return a valid CSS selector that uniquely identifies the target element in the live DOM.

**Architecture:** Extract a `segmentFor` helper that produces the best single-element CSS segment (testid → id → aria-label → classes → tag), then walk up the DOM in `resolveSelector`, checking uniqueness with `querySelectorAll` at each level. Fall back to `:nth-child` only if no ancestor chain produces a unique match. Remove the non-standard `:contains()` fallback.

**Tech Stack:** TypeScript, vitest, jsdom

---

## File Map

| File | Change |
|------|--------|
| `src/lib/element-selector.ts` | Refactor: extract `segmentFor`, rewrite `resolveSelector`, remove `:contains()` |
| `tests/element-selector.test.ts` | Update: remove `:contains()` test, add DOM-attached tests for ancestor walking and nth-child |

---

### Task 1: Update tests to cover the new behaviour

**Files:**
- Modify: `tests/element-selector.test.ts`

- [ ] **Step 1: Replace the test file with updated coverage**

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail as expected**

```
npm run test:run -- tests/element-selector.test.ts
```

Expected: the 3 new tests (`returns basic segment…`, `walks up to parent…`, `uses nth-child…`) fail. The `:contains()` test is gone. Priority tests still pass (they hit the `!el.isConnected` early-return path which we'll add next).

---

### Task 2: Implement `segmentFor` + rewrite `resolveSelector`

**Files:**
- Modify: `src/lib/element-selector.ts`

- [ ] **Step 1: Replace the file with the new implementation**

```typescript
const HASHED_CLASS = /^[a-zA-Z]{2,4}-[a-z0-9]{4,}$|^css-[a-z0-9]+$/

function segmentFor(el: Element): string {
  const testId = el.getAttribute('data-testid')
  if (testId) return `[data-testid="${testId}"]`

  if (el.id) return `#${el.id}`

  const ariaLabel = el.getAttribute('aria-label')
  if (ariaLabel) return `[aria-label="${ariaLabel}"]`

  const classes = Array.from(el.classList)
    .filter(c => !HASHED_CLASS.test(c))
    .slice(0, 2)
    .join('.')

  return classes
    ? `${el.tagName.toLowerCase()}.${classes}`
    : el.tagName.toLowerCase()
}

function isUnique(selector: string, el: Element): boolean {
  try {
    const matches = document.querySelectorAll(selector)
    return matches.length === 1 && matches[0] === el
  } catch {
    return false
  }
}

export function resolveSelector(el: Element): string {
  if (!el.isConnected) return segmentFor(el)

  const segments: string[] = [segmentFor(el)]
  let ancestor: Element | null = el.parentElement

  while (ancestor && ancestor !== document.documentElement) {
    if (isUnique(segments.join(' > '), el)) return segments.join(' > ')
    segments.unshift(segmentFor(ancestor))
    ancestor = ancestor.parentElement
  }

  if (isUnique(segments.join(' > '), el)) return segments.join(' > ')

  // Last resort: nth-child index within immediate parent
  const parent = el.parentElement
  if (parent) {
    const index = Array.from(parent.children).indexOf(el) + 1
    segments[segments.length - 1] = `${el.tagName.toLowerCase()}:nth-child(${index})`
  }
  return segments.join(' > ')
}
```

- [ ] **Step 2: Run all tests**

```
npm run test:run
```

Expected: all tests pass, including the 3 new ones.

- [ ] **Step 3: Commit**

```bash
git add src/lib/element-selector.ts tests/element-selector.test.ts
git commit -m "feat: make resolveSelector uniquely identify elements via DOM path walking"
```
