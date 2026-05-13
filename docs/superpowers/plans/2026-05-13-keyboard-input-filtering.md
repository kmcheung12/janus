# Keyboard Input Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent duplicate events by filtering out input types that are already captured by the click interceptor, and suppressing Enter keydown/keyup on types where Enter fires an input event.

**Architecture:** Two constants (`INPUT_SKIP_TYPES`, `ENTER_SKIP_TYPES`) and a `shouldSkipEnter` helper are added to `keyboard.ts`. `inputHandler` skips types in `INPUT_SKIP_TYPES`. `keydownHandler` and `keyupHandler` skip types covered by `shouldSkipEnter` (which checks `ENTER_SKIP_TYPES` and `isContentEditable`). A matrix comment documents the full rationale for every input type.

**Tech Stack:** TypeScript, vitest, jsdom

---

## Background: The Input Type Matrix

```
Type             | Capture input event? | Capture Enter keydown/keyup?
-----------------|----------------------|------------------------------
text             | yes                  | yes
email            | yes                  | yes
url              | yes                  | yes
tel              | yes                  | yes
search           | yes                  | yes
number           | yes                  | yes
file             | yes                  | yes
textarea         | yes                  | NO — Enter inserts newline, input captures it
contenteditable  | yes                  | NO — Enter inserts line break, input captures it
date             | yes                  | NO — Enter confirms picker, input captures it
time             | yes                  | NO — Enter confirms picker, input captures it
color            | yes                  | NO — Enter confirms picker, input captures it
range            | NO — click captures  | n/a
checkbox         | NO — click captures  | n/a
radio            | NO — click captures  | n/a
select-one       | NO — click captures  | n/a
select-multiple  | NO — click captures  | n/a
hidden           | NO — no user gesture | n/a
password         | NO — security        | NO — security
```

---

## File Map

| File | Change |
|------|--------|
| `src/lib/event-capture/interceptors/keyboard.ts` | Add `INPUT_SKIP_TYPES`, `ENTER_SKIP_TYPES`, `shouldSkipEnter`; add matrix comment; filter in `inputHandler`, `keydownHandler`, `keyupHandler` |
| `tests/event-capture/interceptors/keyboard.test.ts` | Add tests for all skipped input types and Enter suppression |

---

### Task 1: Filter `input` events for non-keyboard input types

**Files:**
- Modify: `tests/event-capture/interceptors/keyboard.test.ts`
- Modify: `src/lib/event-capture/interceptors/keyboard.ts`

- [ ] **Step 1: Add failing tests for input event filtering**

Add these `it` blocks inside the existing `describe('attachKeyboardInterceptor', ...)` in `tests/event-capture/interceptors/keyboard.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

```
npm run test:run -- tests/event-capture/interceptors/keyboard.test.ts
```

Expected: 5 new tests fail, 3 existing tests still pass.

- [ ] **Step 3: Implement `INPUT_SKIP_TYPES` in `keyboard.ts`**

Replace the top of `src/lib/event-capture/interceptors/keyboard.ts` (before the `attachKeyboardInterceptor` function) with:

```typescript
import type { KeyboardInputEvent, CapturedEvent } from '../types'
import { resolveSelector } from '../../element-selector'
import { uuid } from '../../uuid'

// Input types where an input event is a side-effect of a click (already captured
// by the click interceptor), or where there is no meaningful user text input.
const INPUT_SKIP_TYPES = new Set([
  'checkbox', 'radio', 'select-one', 'select-multiple', 'range', 'hidden',
])
```

Then in `inputHandler`, add the skip check after the password check:

```typescript
  function inputHandler(e: Event) {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement
    if (!target) return
    if (target.closest('#janus-root')) return
    if ((target as HTMLInputElement).type === 'password') return

    const inputType = (target as HTMLInputElement).type ?? 'text'
    if (INPUT_SKIP_TYPES.has(inputType)) return

    const event: KeyboardInputEvent = {
      id: uuid(),
      type: 'keyboard',
      timestamp: Date.now(),
      selector: resolveSelector(target),
      inputType,
      count: 1,
    }
    onEvent(event)
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```
npm run test:run -- tests/event-capture/interceptors/keyboard.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/event-capture/interceptors/keyboard.ts tests/event-capture/interceptors/keyboard.test.ts
git commit -m "feat: skip input events for types captured by click interceptor"
```

---

### Task 2: Filter Enter keydown/keyup for types where Enter fires an input event

**Files:**
- Modify: `tests/event-capture/interceptors/keyboard.test.ts`
- Modify: `src/lib/event-capture/interceptors/keyboard.ts`

- [ ] **Step 1: Add failing tests for Enter suppression**

Add these `it` blocks inside the existing `describe('attachKeyboardInterceptor', ...)`:

```typescript
  it('does NOT emit Enter event for textarea (input event captures the newline)', () => {
    const el = document.createElement('textarea')
    document.body.appendChild(el)
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    document.body.removeChild(el)
    expect(captured).toHaveLength(0)
  })

  it('does NOT emit Enter event for date input (input event captures the value)', () => {
    const el = document.createElement('input')
    el.type = 'date'
    document.body.appendChild(el)
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    document.body.removeChild(el)
    expect(captured).toHaveLength(0)
  })

  it('does NOT emit Enter event for time input', () => {
    const el = document.createElement('input')
    el.type = 'time'
    document.body.appendChild(el)
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    document.body.removeChild(el)
    expect(captured).toHaveLength(0)
  })

  it('does NOT emit Enter event for color input', () => {
    const el = document.createElement('input')
    el.type = 'color'
    document.body.appendChild(el)
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    document.body.removeChild(el)
    expect(captured).toHaveLength(0)
  })

  it('does NOT emit Enter event for contenteditable (input event captures the line break)', () => {
    const el = document.createElement('div')
    el.contentEditable = 'true'
    document.body.appendChild(el)
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    document.body.removeChild(el)
    expect(captured).toHaveLength(0)
  })

  it('DOES emit Enter event for text input (Enter does not fire an input event)', () => {
    const el = document.createElement('input')
    el.type = 'text'
    el.id = 'search-field'
    document.body.appendChild(el)
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    document.body.removeChild(el)
    expect(captured).toHaveLength(1)
    expect(captured[0].key).toBe('Enter')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```
npm run test:run -- tests/event-capture/interceptors/keyboard.test.ts
```

Expected: 6 new tests fail (5 suppression tests + 1 positive Enter test), 8 existing tests pass.

- [ ] **Step 3: Implement `ENTER_SKIP_TYPES`, `shouldSkipEnter`, and the matrix comment in `keyboard.ts`**

Replace the full contents of `src/lib/event-capture/interceptors/keyboard.ts` with:

```typescript
import type { KeyboardInputEvent, CapturedEvent } from '../types'
import { resolveSelector } from '../../element-selector'
import { uuid } from '../../uuid'

// Input type capture matrix:
//
// Type             | Capture input event? | Capture Enter keydown/keyup?
// -----------------|----------------------|------------------------------
// text             | yes                  | yes
// email            | yes                  | yes
// url              | yes                  | yes
// tel              | yes                  | yes
// search           | yes                  | yes
// number           | yes                  | yes
// file             | yes                  | yes
// textarea         | yes                  | no — Enter inserts newline, input captures it
// contenteditable  | yes                  | no — Enter inserts line break, input captures it
// date             | yes                  | no — Enter confirms picker, input captures it
// time             | yes                  | no — Enter confirms picker, input captures it
// color            | yes                  | no — Enter confirms picker, input captures it
// range            | no — click captures  | n/a
// checkbox         | no — click captures  | n/a
// radio            | no — click captures  | n/a
// select-one       | no — click captures  | n/a
// select-multiple  | no — click captures  | n/a
// hidden           | no — no user gesture | n/a
// password         | no — security        | no — security

// Input types where an input event is a side-effect of a click (already captured
// by the click interceptor), or where there is no meaningful user text input.
const INPUT_SKIP_TYPES = new Set([
  'checkbox', 'radio', 'select-one', 'select-multiple', 'range', 'hidden',
])

// Input types where pressing Enter fires an input event that captures the value
// change. Emitting a separate Enter keyboard event would duplicate it.
const ENTER_SKIP_TYPES = new Set(['textarea', 'date', 'time', 'color'])

function shouldSkipEnter(target: Element): boolean {
  const inputType = (target as HTMLInputElement).type
  return ENTER_SKIP_TYPES.has(inputType) || (target as HTMLElement).isContentEditable
}

export function attachKeyboardInterceptor(onEvent: (e: CapturedEvent) => void): () => void {
  function inputHandler(e: Event) {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement
    if (!target) return
    if (target.closest('#janus-root')) return
    if ((target as HTMLInputElement).type === 'password') return

    const inputType = (target as HTMLInputElement).type ?? 'text'
    if (INPUT_SKIP_TYPES.has(inputType)) return

    const event: KeyboardInputEvent = {
      id: uuid(),
      type: 'keyboard',
      timestamp: Date.now(),
      selector: resolveSelector(target),
      inputType,
      count: 1,
    }
    onEvent(event)
  }

  // Chrome's native form-submission handling can swallow keydown for Enter before
  // content-script capture listeners fire. keyup is a reliable fallback.
  // pendingEnter tracks elements where keydown already emitted, so keyup skips them.
  const pendingEnter = new WeakSet<Element>()

  function emitEnter(target: Element) {
    const inputType = (target as HTMLInputElement).type ?? 'text'
    onEvent({
      id: uuid(),
      type: 'keyboard',
      timestamp: Date.now(),
      selector: resolveSelector(target),
      inputType,
      count: 1,
      key: 'Enter',
    })
  }

  function keydownHandler(e: KeyboardEvent) {
    if (e.key !== 'Enter') return
    const target = e.target as Element
    if (!target) return
    if (target.closest('#janus-root')) return
    if ((target as HTMLInputElement).type === 'password') return
    if (shouldSkipEnter(target)) return
    pendingEnter.add(target)
    emitEnter(target)
  }

  function keyupHandler(e: KeyboardEvent) {
    if (e.key !== 'Enter') return
    const target = e.target as Element
    if (!target) return
    if (pendingEnter.has(target)) {
      pendingEnter.delete(target)
      return // keydown already emitted
    }
    if (target.closest('#janus-root')) return
    if ((target as HTMLInputElement).type === 'password') return
    if (shouldSkipEnter(target)) return
    emitEnter(target)
  }

  document.addEventListener('input', inputHandler, { capture: true })
  document.addEventListener('keydown', keydownHandler, { capture: true })
  document.addEventListener('keyup', keyupHandler, { capture: true })
  return () => {
    document.removeEventListener('input', inputHandler, { capture: true })
    document.removeEventListener('keydown', keydownHandler, { capture: true })
    document.removeEventListener('keyup', keyupHandler, { capture: true })
  }
}
```

- [ ] **Step 4: Run all tests**

```
npm run test:run -- tests/event-capture/interceptors/keyboard.test.ts
```

Expected: all 14 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/event-capture/interceptors/keyboard.ts tests/event-capture/interceptors/keyboard.test.ts
git commit -m "feat: suppress Enter events for types where input event already captures value change"
```
