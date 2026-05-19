# Resize & Orientation Event Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture debounced window resize and immediate orientationchange events as a new toggleable `resize` event type.

**Architecture:** Add `ResizeEvent` to the type system, create a single `attachResizeInterceptor` following the existing interceptor pattern (debounce 500ms on `resize`, immediate on `orientationchange`), wire it into the content script alongside existing interceptors, add `resize: true` to capture config, and update the prompt engine and event sidebar to display it.

**Tech Stack:** TypeScript, Svelte, vitest, jsdom

---

## File Map

| File | Change |
|------|--------|
| `src/lib/event-capture/types.ts` | Add `ResizeEvent`, extend `EventType` and `CapturedEvent` |
| `src/lib/event-capture/interceptors/resize.ts` | New — interceptor |
| `src/lib/capture-config.ts` | Add `resize` field |
| `src/entrypoints/content.ts` | Import and wire up interceptor |
| `src/lib/prompts/engine.ts` | Add `resize` to `fieldsOf` and `defaultNoteTemplate` |
| `src/components/sidebar/EventSidebar.svelte` | Add label, badge, TYPE_LABELS entry |
| `tests/event-capture/interceptors/resize.test.ts` | New — interceptor tests |
| `tests/prompts/engine.test.ts` | Add `fieldsOf` and `defaultNoteTemplate` tests for `resize` |

---

### Task 1: Add `ResizeEvent` to the type system

**Files:**
- Modify: `src/lib/event-capture/types.ts`

- [ ] **Step 1: Add `ResizeEvent` and extend the unions**

In `src/lib/event-capture/types.ts`, make these three changes:

1. Add `'resize'` to `EventType`:
```ts
export type EventType = 'session' | 'navigation' | 'click' | 'keyboard' | 'api' | 'scroll' | 'console' | 'drag' | 'element_pick' | 'resize'
```

2. Add the `ResizeEvent` interface after `ElementPickEvent`:
```ts
export interface ResizeEvent extends BaseEvent {
  type: 'resize'
  width: number
  height: number
  orientation?: string
}
```

3. Add `ResizeEvent` to the `CapturedEvent` union:
```ts
export type CapturedEvent =
  | SessionEvent
  | NavigationEvent
  | ClickEvent
  | KeyboardInputEvent
  | ApiEvent
  | ScrollEvent
  | ConsoleEvent
  | DragEvent
  | ElementPickEvent
  | ResizeEvent
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/event-capture/types.ts
git commit -m "feat: add ResizeEvent type"
```

---

### Task 2: Create the resize interceptor (TDD)

**Files:**
- Create: `tests/event-capture/interceptors/resize.test.ts`
- Create: `src/lib/event-capture/interceptors/resize.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/event-capture/interceptors/resize.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { attachResizeInterceptor } from '../../../src/lib/event-capture/interceptors/resize'
import type { ResizeEvent } from '../../../src/lib/event-capture/types'

describe('attachResizeInterceptor', () => {
  let detach: () => void
  let captured: ResizeEvent[]

  beforeEach(() => {
    vi.useFakeTimers()
    captured = []
    detach = attachResizeInterceptor(e => captured.push(e as ResizeEvent))
  })

  afterEach(() => {
    detach()
    vi.useRealTimers()
  })

  it('emits a resize event after 500ms debounce', () => {
    window.dispatchEvent(new Event('resize'))
    expect(captured).toHaveLength(0)
    vi.advanceTimersByTime(499)
    expect(captured).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(captured).toHaveLength(1)
    expect(captured[0].type).toBe('resize')
    expect(captured[0].width).toBe(window.innerWidth)
    expect(captured[0].height).toBe(window.innerHeight)
  })

  it('debounces multiple resize events into one', () => {
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(200)
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(200)
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(500)
    expect(captured).toHaveLength(1)
  })

  it('emits an orientationchange event immediately', () => {
    window.dispatchEvent(new Event('orientationchange'))
    expect(captured).toHaveLength(1)
    expect(captured[0].type).toBe('resize')
  })

  it('includes orientation when screen.orientation is available', () => {
    Object.defineProperty(window.screen, 'orientation', {
      value: { type: 'landscape-primary' },
      configurable: true,
    })
    window.dispatchEvent(new Event('orientationchange'))
    expect(captured[0].orientation).toBe('landscape-primary')
  })

  it('omits orientation when screen.orientation is unavailable', () => {
    Object.defineProperty(window.screen, 'orientation', {
      value: undefined,
      configurable: true,
    })
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(500)
    expect(captured[0].orientation).toBeUndefined()
  })

  it('detach stops capturing resize events', () => {
    detach()
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(500)
    expect(captured).toHaveLength(0)
  })

  it('detach stops capturing orientationchange events', () => {
    detach()
    window.dispatchEvent(new Event('orientationchange'))
    expect(captured).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test:run tests/event-capture/interceptors/resize.test.ts
```

Expected: all tests fail with module not found or similar.

- [ ] **Step 3: Implement the interceptor**

Create `src/lib/event-capture/interceptors/resize.ts`:

```ts
import type { ResizeEvent, CapturedEvent } from '../types'
import { uuid } from '../../uuid'

export function attachResizeInterceptor(onEvent: (e: CapturedEvent) => void): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  function emit() {
    const event: ResizeEvent = {
      id: uuid(),
      type: 'resize',
      timestamp: Date.now(),
      width: window.innerWidth,
      height: window.innerHeight,
      orientation: window.screen?.orientation?.type,
    }
    onEvent(event)
  }

  function onResize() {
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      emit()
    }, 500)
  }

  function onOrientationChange() {
    emit()
  }

  window.addEventListener('resize', onResize)
  window.addEventListener('orientationchange', onOrientationChange)

  return () => {
    window.removeEventListener('resize', onResize)
    window.removeEventListener('orientationchange', onOrientationChange)
    if (debounceTimer !== null) clearTimeout(debounceTimer)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test:run tests/event-capture/interceptors/resize.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/event-capture/interceptors/resize.ts tests/event-capture/interceptors/resize.test.ts
git commit -m "feat: add resize/orientation interceptor"
```

---

### Task 3: Add `resize` to capture config

**Files:**
- Modify: `src/lib/capture-config.ts`

- [ ] **Step 1: Add `resize` field**

In `src/lib/capture-config.ts`, make these changes:

1. Add `resize: boolean` to `CaptureConfig`:
```ts
export interface CaptureConfig {
  click: boolean
  keyboard: boolean
  keyboard_keystrokes: boolean
  navigation: boolean
  api: boolean
  scroll: boolean
  drag: boolean
  console_error: boolean
  console_warn: boolean
  resize: boolean
}
```

2. Add to `CAPTURE_CONFIG_LABELS`:
```ts
export const CAPTURE_CONFIG_LABELS: Record<keyof CaptureConfig, string> = {
  click: 'Click',
  keyboard: 'Keyboard input',
  keyboard_keystrokes: 'Capture actual keystrokes',
  navigation: 'Navigation',
  api: 'API / Network',
  scroll: 'Scroll',
  drag: 'Drag',
  console_error: 'Console errors',
  console_warn: 'Console warnings',
  resize: 'Resize & orientation',
}
```

3. Add to `DEFAULTS`:
```ts
const DEFAULTS: CaptureConfig = {
  click: true,
  keyboard: true,
  keyboard_keystrokes: false,
  navigation: true,
  api: true,
  scroll: true,
  drag: true,
  console_error: true,
  console_warn: true,
  resize: true,
}
```

- [ ] **Step 2: Run all tests to confirm no regressions**

```bash
pnpm test:run
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/capture-config.ts
git commit -m "feat: add resize to capture config"
```

---

### Task 4: Wire up the interceptor in content.ts

**Files:**
- Modify: `src/entrypoints/content.ts`

- [ ] **Step 1: Import and wire up**

In `src/entrypoints/content.ts`:

1. Add the import after the existing interceptor imports:
```ts
import { attachResizeInterceptor } from '../lib/event-capture/interceptors/resize'
```

2. Add `attachResizeInterceptor(filteredAddEvent)` to the `cleanups` array. The array currently looks like:
```ts
const cleanups = [
  attachPointerInterceptor(filteredAddEvent),
  attachKeyboardInterceptor(filteredAddEvent, () => captureConfig.keyboard_keystrokes),
  attachNavigationInterceptor(filteredAddEvent),
  attachScrollInterceptor(filteredAddEvent),
]
```

Change it to:
```ts
const cleanups = [
  attachPointerInterceptor(filteredAddEvent),
  attachKeyboardInterceptor(filteredAddEvent, () => captureConfig.keyboard_keystrokes),
  attachNavigationInterceptor(filteredAddEvent),
  attachScrollInterceptor(filteredAddEvent),
  attachResizeInterceptor(filteredAddEvent),
]
```

- [ ] **Step 2: Run all tests to confirm no regressions**

```bash
pnpm test:run
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/entrypoints/content.ts
git commit -m "feat: wire resize interceptor into content script"
```

---

### Task 5: Update the prompt engine (TDD)

**Files:**
- Modify: `src/lib/prompts/engine.ts`
- Modify: `tests/prompts/engine.test.ts`

- [ ] **Step 1: Write failing tests**

In `tests/prompts/engine.test.ts`, add these tests (insert after the existing `fieldsOf` / `defaultNoteTemplate` tests, or at the end of the file):

```ts
import type { ResizeEvent } from '../../src/lib/event-capture/types'

describe('fieldsOf resize', () => {
  it('returns width and height as strings', () => {
    const e: ResizeEvent = { id: '1', type: 'resize', timestamp: 0, width: 1280, height: 800 }
    const fields = fieldsOf(e)
    expect(fields.width).toBe('1280')
    expect(fields.height).toBe('800')
    expect(fields.orientation).toBeUndefined()
  })

  it('includes orientation when present', () => {
    const e: ResizeEvent = { id: '1', type: 'resize', timestamp: 0, width: 375, height: 812, orientation: 'portrait-primary' }
    const fields = fieldsOf(e)
    expect(fields.orientation).toBe('portrait-primary')
  })
})

describe('defaultNoteTemplate resize', () => {
  it('returns viewport resized template', () => {
    const e: ResizeEvent = { id: '1', type: 'resize', timestamp: 0, width: 1280, height: 800 }
    expect(defaultNoteTemplate(e)).toBe('Viewport resized to {width}×{height}')
  })
})
```

Also add `defaultNoteTemplate` to the import at the top of the test file if it isn't already there:
```ts
import { resolveSlots, renderTemplate, fieldsOf, defaultNoteTemplate } from '../../src/lib/prompts/engine'
```

And add `ResizeEvent` to the type imports:
```ts
import type { CapturedEvent, ElementPickEvent, ClickEvent, ApiEvent, NavigationEvent, KeyboardInputEvent, ResizeEvent } from '../../src/lib/event-capture/types'
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test:run tests/prompts/engine.test.ts
```

Expected: the 3 new tests fail.

- [ ] **Step 3: Update engine.ts**

In `src/lib/prompts/engine.ts`:

1. Add `ResizeEvent` to the import:
```ts
import type { CapturedEvent, SessionEvent, ApiEvent, ClickEvent, KeyboardInputEvent, NavigationEvent, ScrollEvent, ConsoleEvent, DragEvent, ElementPickEvent, ResizeEvent } from '../event-capture/types'
```

2. Add the `resize` case to `fieldsOf` (before the closing brace, after the `session` case):
```ts
case 'resize': {
  const e = event as ResizeEvent
  const out: Record<string, string> = { width: String(e.width), height: String(e.height) }
  if (e.orientation != null) out.orientation = e.orientation
  return out
}
```

3. Add the `resize` case to `defaultNoteTemplate` (before the closing brace):
```ts
case 'resize':      return 'Viewport resized to {width}×{height}'
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test:run tests/prompts/engine.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Run all tests**

```bash
pnpm test:run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/prompts/engine.ts tests/prompts/engine.test.ts
git commit -m "feat: add resize event to prompt engine"
```

---

### Task 6: Update EventSidebar.svelte

**Files:**
- Modify: `src/components/sidebar/EventSidebar.svelte`

- [ ] **Step 1: Add ResizeEvent import**

At the top of the `<script>` block, the import currently reads:
```ts
import type { CapturedEvent, ApiEvent, ClickEvent, KeyboardInputEvent, NavigationEvent, ConsoleEvent, ScrollEvent, DragEvent, SessionEvent, ElementPickEvent, EventType } from '../../lib/event-capture/types'
```

Add `ResizeEvent`:
```ts
import type { CapturedEvent, ApiEvent, ClickEvent, KeyboardInputEvent, NavigationEvent, ConsoleEvent, ScrollEvent, DragEvent, SessionEvent, ElementPickEvent, ResizeEvent, EventType } from '../../lib/event-capture/types'
```

- [ ] **Step 2: Add label case**

In the `label(e: CapturedEvent)` function, add a case before the closing brace (after the `element_pick` case):

```ts
case 'resize': {
  const r = e as ResizeEvent
  return `Viewport resized to ${r.width}×${r.height}`
}
```

- [ ] **Step 3: Add TYPE_LABELS entry**

In the `TYPE_LABELS` object:
```ts
const TYPE_LABELS: Partial<Record<EventType, string>> = {
  click: 'click', navigation: 'nav', keyboard: 'kbd',
  api: 'api', scroll: 'scroll', console: 'console',
  drag: 'drag', element_pick: 'pick', session: 'session',
  resize: 'resize',
}
```

- [ ] **Step 4: Add badge CSS class**

In the `<style>` block, the neutral badge line currently reads:
```css
.badge-click, .badge-keyboard, .badge-navigation, .badge-scroll, .badge-drag, .badge-session { background: #313244; color: #cdd6f4; }
```

Add `.badge-resize` to the same rule:
```css
.badge-click, .badge-keyboard, .badge-navigation, .badge-scroll, .badge-drag, .badge-session, .badge-resize { background: #313244; color: #cdd6f4; }
```

- [ ] **Step 5: Run all tests**

```bash
pnpm test:run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/sidebar/EventSidebar.svelte
git commit -m "feat: display resize events in event sidebar"
```
