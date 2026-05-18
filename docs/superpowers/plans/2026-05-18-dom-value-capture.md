# DOM Value Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `ElementPickEvent` as a first-class captured event and make the annotation Note box expand `{field}` tokens against any event's fields, persisting the note back to the event store.

**Architecture:** Element picking creates a persisted `ElementPickEvent` (selector + text + attributes + styles) and immediately opens the annotation panel. Any event can carry a `note` template string; `expandFields` resolves `{field}` tokens at render time. `formatEvents` uses `defaultNoteTemplate` as the fallback for unannotated events, and skips `element_pick` events with no note. The Note box shows field suggestions on `{`.

**Tech Stack:** TypeScript, Svelte 5 (`$state`, `$derived`, `$effect`, `$props`), Vitest + jsdom, WXT browser extension framework.

---

## File Map

| File | Role |
|------|------|
| `src/lib/event-capture/types.ts` | Add `note?: string` to `BaseEvent`; add `ElementPickEvent` |
| `src/lib/event-capture/store.ts` | Add `updateEvent(id, patch)` |
| `src/lib/prompts/engine.ts` | Add `fieldsOf`, `defaultNoteTemplate`, `expandFields`; rewrite `formatEvents`; update `resolveSlots` |
| `src/components/sidebar/ElementPicker.svelte` | Replace `onSelect` with `onPick(event: ElementPickEvent)`, capture attrs + styles |
| `src/components/sidebar/Sidebar.svelte` | Handle `onPick`: write to store, open panel with new event |
| `src/components/sidebar/EventSidebar.svelte` | Add `element_pick` label + badge |
| `src/components/sidebar/AnnotationPanel.svelte` | Remove `selectedSelector`/`selectedSource` props; seed note from event; persist note; add `{` suggestions |
| `tests/event-capture/store.test.ts` | New: `updateEvent` tests |
| `tests/prompts/engine.test.ts` | Update: add tests for `fieldsOf`, `defaultNoteTemplate`, `expandFields`, updated `formatEvents` |

---

### Task 1: Extend types — `note` on BaseEvent + `ElementPickEvent`

**Files:**
- Modify: `src/lib/event-capture/types.ts`

- [ ] **Step 1: Update `types.ts`**

Replace the entire file content:

```typescript
type EventType = 'session' | 'navigation' | 'click' | 'keyboard' | 'api' | 'scroll' | 'console' | 'drag' | 'element_pick'

interface BaseEvent {
  id: string
  type: EventType
  timestamp: number
  note?: string
}

export interface SessionEvent extends BaseEvent {
  type: 'session'
  viewport: { width: number; height: number }
  dpr: number
}

export interface NavigationEvent extends BaseEvent {
  type: 'navigation'
  url: string
  title: string
}

export interface ClickEvent extends BaseEvent {
  type: 'click'
  selector: string
  label: string
  count: number
  x: number
  y: number
}

export interface DragEvent extends BaseEvent {
  type: 'drag'
  sourceSelector: string
  targetSelector: string | null
  path: Array<{ x: number; y: number }>
  deltaX: number
  deltaY: number
}

export interface KeyboardInputEvent extends BaseEvent {
  type: 'keyboard'
  selector: string
  inputType: string
  count: number
  key?: string
  keys?: string[]
}

export interface ApiEvent extends BaseEvent {
  type: 'api'
  method: string
  url: string
  status: number | null
  requestBody: string | null
  responseBody: string | null
  errorDetails: string | null
  duration: number | null
}

export interface ScrollEvent extends BaseEvent {
  type: 'scroll'
  selector: string
  direction: 'up' | 'down' | 'left' | 'right'
  count: number
  deltaX: number
  deltaY: number
}

export interface ConsoleEvent extends BaseEvent {
  type: 'console'
  level: 'error' | 'warn'
  message: string
}

export interface ElementPickEvent extends BaseEvent {
  type: 'element_pick'
  selector: string
  text: string
  attributes: Record<string, string>
  styles: Record<string, string>
}

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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors (all existing code remains compatible since `note` is optional and `element_pick` is additive).

- [ ] **Step 3: Commit**

```bash
git add src/lib/event-capture/types.ts
git commit -m "feat: add ElementPickEvent and note field to BaseEvent"
```

---

### Task 2: Add `updateEvent` to `store.ts`

**Files:**
- Modify: `src/lib/event-capture/store.ts`
- Create: `tests/event-capture/store.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/event-capture/store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock browser.runtime before importing store
;(global as Record<string, unknown>).browser = {
  storage: { local: { get: vi.fn(), set: vi.fn() } },
  runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) },
}

// Store is a module with internal state — re-import fresh each test via isolateModules
import { addEvent, updateEvent, getEvents, clearEvents } from '../../src/lib/event-capture/store'
import type { CapturedEvent } from '../../src/lib/event-capture/types'

function click(id: string): CapturedEvent {
  return { id, type: 'click', timestamp: 0, selector: '#btn', label: 'Btn', count: 1, x: 0, y: 0 }
}

describe('updateEvent', () => {
  beforeEach(() => clearEvents())

  it('updates note on an existing event', () => {
    addEvent(click('abc'))
    updateEvent('abc', { note: 'some note' })
    const events = getEvents()
    expect(events[0].note).toBe('some note')
  })

  it('does nothing when id not found', () => {
    addEvent(click('abc'))
    updateEvent('xyz', { note: 'nope' })
    expect(getEvents()[0].note).toBeUndefined()
  })

  it('notifies listeners after update', () => {
    addEvent(click('abc'))
    const received: CapturedEvent[][] = []
    const unsub = (await import('../../src/lib/event-capture/store')).subscribe(e => received.push(e))
    updateEvent('abc', { note: 'hi' })
    expect(received.length).toBeGreaterThan(0)
    expect(received.at(-1)![0].note).toBe('hi')
    unsub()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:run -- tests/event-capture/store.test.ts
```

Expected: FAIL — `updateEvent is not a function`

- [ ] **Step 3: Implement `updateEvent` in `store.ts`**

Add after `clearEvents`:

```typescript
export function updateEvent(id: string, patch: Partial<CapturedEvent>): void {
  events = events.map(e => e.id === id ? { ...e, ...patch } : e)
  listeners.forEach(fn => fn(events))
  syncToBackground()
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test:run -- tests/event-capture/store.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/event-capture/store.ts tests/event-capture/store.test.ts
git commit -m "feat: add updateEvent to persist note on stored events"
```

---

### Task 3: Add `fieldsOf` to `engine.ts`

**Files:**
- Modify: `src/lib/prompts/engine.ts`
- Modify: `tests/prompts/engine.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/prompts/engine.test.ts`:

```typescript
import { fieldsOf } from '../../src/lib/prompts/engine'
import type { ElementPickEvent, ClickEvent, ApiEvent, NavigationEvent } from '../../src/lib/event-capture/types'

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
```

- [ ] **Step 2: Run to verify failure**

```bash
npm run test:run -- tests/prompts/engine.test.ts
```

Expected: FAIL — `fieldsOf is not exported`

- [ ] **Step 3: Implement `fieldsOf` in `engine.ts`**

Add after the imports in `engine.ts`:

```typescript
export function fieldsOf(event: CapturedEvent): Record<string, string> {
  function str(v: string | number | null | undefined): string | undefined {
    return v == null ? undefined : String(v)
  }

  switch (event.type) {
    case 'click': {
      const e = event as ClickEvent
      return { selector: e.selector, label: e.label, count: String(e.count), x: String(e.x), y: String(e.y) }
    }
    case 'navigation': {
      const e = event as NavigationEvent
      return { url: e.url, title: e.title }
    }
    case 'api': {
      const e = event as ApiEvent
      const out: Record<string, string> = { method: e.method, url: e.url }
      if (e.status != null) out.status = String(e.status)
      if (e.requestBody != null) out.request_body = e.requestBody
      if (e.responseBody != null) out.response_body = e.responseBody
      if (e.errorDetails != null) out.error_details = e.errorDetails
      return out
    }
    case 'keyboard': {
      const e = event as KeyboardInputEvent
      const out: Record<string, string> = { selector: e.selector, input_type: e.inputType, count: String(e.count) }
      if (e.key != null) out.key = e.key
      return out
    }
    case 'scroll': {
      const e = event as ScrollEvent
      return { selector: e.selector, direction: e.direction, delta_x: String(e.deltaX), delta_y: String(e.deltaY), count: String(e.count) }
    }
    case 'console': {
      const e = event as ConsoleEvent
      return { level: e.level, message: e.message }
    }
    case 'drag': {
      const e = event as DragEvent
      const out: Record<string, string> = { source_selector: e.sourceSelector }
      if (e.targetSelector != null) out.target_selector = e.targetSelector
      return out
    }
    case 'element_pick': {
      const e = event as ElementPickEvent
      return { selector: e.selector, text: e.text, ...e.attributes, ...e.styles }
    }
    case 'session':
      return {}
  }
}
```

Also add the missing imports to the top of `engine.ts` (add `ElementPickEvent` to the existing import):

```typescript
import type { CapturedEvent, SessionEvent, ApiEvent, ClickEvent, KeyboardInputEvent, NavigationEvent, ScrollEvent, ConsoleEvent, DragEvent, ElementPickEvent } from '../event-capture/types'
```

- [ ] **Step 4: Run tests**

```bash
npm run test:run -- tests/prompts/engine.test.ts
```

Expected: all `fieldsOf` tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/prompts/engine.ts tests/prompts/engine.test.ts
git commit -m "feat: add fieldsOf to extract flat string fields from any event"
```

---

### Task 4: Add `defaultNoteTemplate` to `engine.ts`

**Files:**
- Modify: `src/lib/prompts/engine.ts`
- Modify: `tests/prompts/engine.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/prompts/engine.test.ts`:

```typescript
import { defaultNoteTemplate } from '../../src/lib/prompts/engine'

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
```

- [ ] **Step 2: Run to verify failure**

```bash
npm run test:run -- tests/prompts/engine.test.ts
```

Expected: FAIL — `defaultNoteTemplate is not exported`

- [ ] **Step 3: Implement `defaultNoteTemplate` in `engine.ts`**

Add after `fieldsOf`:

```typescript
export function defaultNoteTemplate(event: CapturedEvent): string {
  switch (event.type) {
    case 'click':       return 'Clicked {label} at ({x}, {y})'
    case 'navigation':  return 'Navigated to {url}'
    case 'api':         return '{method} {url} → {status}'
    case 'keyboard':    return 'Typed {count} characters in {selector}'
    case 'scroll':      return 'Scrolled {direction} on {selector}'
    case 'drag':        return 'Dragged {source_selector} onto {target_selector}'
    case 'console':     return 'Console {level}: {message}'
    case 'session':     return 'Session started'
    case 'element_pick': return ''
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test:run -- tests/prompts/engine.test.ts
```

Expected: all `defaultNoteTemplate` tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/prompts/engine.ts tests/prompts/engine.test.ts
git commit -m "feat: add defaultNoteTemplate for seeding annotation note box"
```

---

### Task 5: Add `expandFields` to `engine.ts`

`expandFields` is a lightweight template expander for note text. Unlike `renderTemplate`, it passes unresolved tokens through unchanged and unescapes `{{field}}` → `{field}`.

**Files:**
- Modify: `src/lib/prompts/engine.ts`
- Modify: `tests/prompts/engine.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/prompts/engine.test.ts`:

```typescript
import { expandFields } from '../../src/lib/prompts/engine'

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
```

- [ ] **Step 2: Run to verify failure**

```bash
npm run test:run -- tests/prompts/engine.test.ts
```

Expected: FAIL — `expandFields is not exported`

- [ ] **Step 3: Implement `expandFields` in `engine.ts`**

Add after `defaultNoteTemplate`:

```typescript
export function expandFields(text: string, fields: Record<string, string>): string {
  // Temporarily protect double-braces from substitution
  const SENTINEL = '\x00'
  const protected_ = text.replace(/\{\{(\w+)\}\}/g, `${SENTINEL}$1${SENTINEL}`)
  // Substitute single-brace tokens; pass through unresolved
  const substituted = protected_.replace(/\{(\w+)\}/g, (match, key) => fields[key] ?? match)
  // Unescape sentinels back to literal {field}
  return substituted.replace(new RegExp(`${SENTINEL}(\\w+)${SENTINEL}`, 'g'), '{$1}')
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test:run -- tests/prompts/engine.test.ts
```

Expected: all `expandFields` tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/prompts/engine.ts tests/prompts/engine.test.ts
git commit -m "feat: add expandFields for note interpolation with pass-through unresolved tokens"
```

---

### Task 6: Rewrite `formatEvents` and update `resolveSlots`

**Files:**
- Modify: `src/lib/prompts/engine.ts`
- Modify: `tests/prompts/engine.test.ts`

- [ ] **Step 1: Update `formatEvents` tests**

In `tests/prompts/engine.test.ts`, find the existing `formatEvents` tests (they're inside the `resolveSlots` describe block via `interaction_description`). Add a new dedicated describe block and update expectations to match the new behavior:

```typescript
import { formatEvents } from '../../src/lib/prompts/engine'
import type { ElementPickEvent } from '../../src/lib/event-capture/types'

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
```

- [ ] **Step 2: Run to verify some tests fail**

```bash
npm run test:run -- tests/prompts/engine.test.ts
```

Expected: new `formatEvents` tests FAIL; existing tests may still pass

- [ ] **Step 3: Rewrite `formatEvents` in `engine.ts`**

Replace the existing `formatEvents` function:

```typescript
export function formatEvents(events: CapturedEvent[]): string {
  let i = 0
  return events
    .map(e => {
      const template = e.note ?? defaultNoteTemplate(e)
      if (!template) return null
      i++
      return `${i}. ${expandFields(template, fieldsOf(e))}`
    })
    .filter((line): line is string => line !== null)
    .join('\n')
}
```

- [ ] **Step 4: Update `resolveSlots` to merge event fields**

Replace the existing `resolveSlots` function:

```typescript
export function resolveSlots(ctx: PromptContext): SlotValues {
  const api = ctx.selectedEvent?.type === 'api' ? ctx.selectedEvent as ApiEvent : undefined
  const pick = ctx.selectedEvent?.type === 'element_pick' ? ctx.selectedEvent as ElementPickEvent : undefined
  const eventFields = ctx.selectedEvent ? fieldsOf(ctx.selectedEvent) : {}

  return {
    ...eventFields,
    url: ctx.url,
    element_selector: ctx.elementSelector ?? pick?.selector,
    interaction_description: formatEvents(ctx.events),
    method: api?.method,
    status: api?.status?.toString(),
    error_details: api?.errorDetails ?? undefined,
    user_text: ctx.userText,
  }
}
```

- [ ] **Step 5: Run all tests**

```bash
npm run test:run
```

Expected: all tests PASS. If the existing `resolveSlots` test for `interaction_description` asserts specific strings like "Navigated to" and "Pay Now", verify they still match — the new `formatEvents` produces the same output for unannotated events.

- [ ] **Step 6: Commit**

```bash
git add src/lib/prompts/engine.ts tests/prompts/engine.test.ts
git commit -m "feat: rewrite formatEvents with note expansion, skip unannotated element_pick"
```

---

### Task 7: Update `ElementPicker.svelte`

Replace the `onSelect(selector, source)` callback with `onPick(event: ElementPickEvent)` that captures the full element.

**Files:**
- Modify: `src/components/sidebar/ElementPicker.svelte`

- [ ] **Step 1: Rewrite `ElementPicker.svelte`**

```svelte
<script lang="ts">
  import { onMount } from 'svelte'
  import { resolveSelector } from '../../lib/element-selector'
  import type { ElementPickEvent } from '../../lib/event-capture/types'
  import { generateId } from '../../lib/uuid'

  const CAPTURED_STYLES = ['color', 'background', 'visibility', 'display', 'font-size'] as const

  let { onPick }: {
    onPick: (event: ElementPickEvent) => void
  } = $props()

  let hovered = $state<Element | null>(null)
  let ready = false
  onMount(() => { setTimeout(() => { ready = true }, 0) })

  function captureElement(el: Element): ElementPickEvent {
    const attributes: Record<string, string> = {}
    for (const attr of Array.from(el.attributes)) {
      attributes[attr.name] = attr.value
    }

    const computed = window.getComputedStyle(el)
    const styles: Record<string, string> = {}
    for (const prop of CAPTURED_STYLES) {
      const value = computed.getPropertyValue(prop)
      if (value) {
        const key = prop === 'font-size' ? 'font_size' : prop
        styles[key] = value
      }
    }

    return {
      id: generateId(),
      type: 'element_pick',
      timestamp: Date.now(),
      selector: resolveSelector(el),
      text: el.textContent?.trim() ?? '',
      attributes,
      styles,
    }
  }

  function handleMouseOver(e: MouseEvent) {
    e.stopPropagation()
    hovered = e.target as Element
  }

  function handleClick(e: MouseEvent) {
    if (!ready) return
    e.preventDefault()
    e.stopPropagation()
    onPick(captureElement(e.target as Element))
  }

  function handleMouseOut() {
    hovered = null
  }
</script>

<svelte:document
  onmouseover={handleMouseOver}
  onmouseout={handleMouseOut}
  onclick={handleClick}
/>

{#if hovered}
  {@const rect = hovered.getBoundingClientRect()}
  <div
    class="janus-highlight"
    style="top:{rect.top}px;left:{rect.left}px;width:{rect.width}px;height:{rect.height}px"
  ></div>
{/if}

<style>
  .janus-highlight {
    position: fixed;
    pointer-events: none;
    outline: 2px solid #6366f1;
    background: rgba(99, 102, 241, 0.1);
    z-index: 2147483646;
    border-radius: 2px;
    transition: all 0.05s ease;
  }
</style>
```

- [ ] **Step 2: Check `generateId` exists**

```bash
cat src/lib/uuid.ts
```

If it exports `generateId`, use it. If it only exports a default or `uuidv4`, update the import to match what's actually exported.

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/ElementPicker.svelte
git commit -m "feat: ElementPicker captures full element data and emits ElementPickEvent"
```

---

### Task 8: Update `Sidebar.svelte`

Handle `onPick`: write the event to the store and open the annotation panel with it pre-selected.

**Files:**
- Modify: `src/components/sidebar/Sidebar.svelte`

- [ ] **Step 1: Rewrite `Sidebar.svelte`**

```svelte
<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import ElementPicker from './ElementPicker.svelte'
  import EventSidebar from './EventSidebar.svelte'
  import AnnotationPanel from './AnnotationPanel.svelte'
  import type { CapturedEvent, ElementPickEvent } from '../../lib/event-capture/types'
  import { getEvents, subscribe, addEvent } from '../../lib/event-capture/store'

  let { onClose, onPickingRef, onSidebarRef, initialMode }: {
    onClose: () => void
    onPickingRef?: (fn: () => void) => void
    onSidebarRef?: (fn: () => void) => void
    initialMode?: 'picking' | 'sidebar'
  } = $props()

  let events = $state<CapturedEvent[]>(getEvents())

  onMount(() => {
    onPickingRef?.(() => { mode = 'picking' })
    onSidebarRef?.(() => { mode = 'sidebar' })
    return subscribe(updated => { events = updated })
  })

  type Mode = 'picking' | 'sidebar' | 'panel'

  let mode = $state<Mode>(untrack(() => initialMode ?? 'picking'))
  let previousMode = $state<'picking' | 'sidebar'>('picking')
  let selectedEvent = $state<CapturedEvent | undefined>(undefined)

  function onPick(event: ElementPickEvent) {
    addEvent(event)
    selectedEvent = event
    previousMode = 'picking'
    mode = 'panel'
  }

  function onEventSelected(event: CapturedEvent) {
    selectedEvent = event
    previousMode = 'sidebar'
    mode = 'panel'
  }

  function onBack() {
    mode = previousMode
    selectedEvent = undefined
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return
    if (mode === 'picking') mode = 'sidebar'
    else if (mode === 'sidebar') onClose()
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="janus-sidebar">
  <div class="janus-toolbar">
    <span class="janus-logo">Janus</span>
    <button onclick={() => mode = mode === 'sidebar' ? 'picking' : 'sidebar'}>
      {mode === 'sidebar' ? 'Element Picker' : 'Events'}
    </button>
    <button onclick={onClose}>✕</button>
  </div>

  {#if mode === 'picking'}
    <ElementPicker {onPick} />
    <div class="janus-hint">Click any element to annotate it</div>
  {:else if mode === 'sidebar'}
    <EventSidebar {events} onSelect={onEventSelected} />
  {:else if mode === 'panel' && selectedEvent}
    <AnnotationPanel
      {selectedEvent}
      {events}
      pageUrl={window.location.href}
      onBack={onBack}
      onDone={onClose}
    />
  {/if}
</div>

<style>
  .janus-sidebar {
    position: fixed;
    top: 0;
    right: 0;
    width: 320px;
    height: 100vh;
    background: #1e1e2e;
    color: #cdd6f4;
    font-family: system-ui, sans-serif;
    font-size: 13px;
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    box-shadow: -4px 0 24px rgba(0,0,0,0.4);
  }
  .janus-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid #313244;
  }
  .janus-logo {
    font-weight: 700;
    color: #cba6f7;
    flex: 1;
  }
  .janus-toolbar button {
    background: #313244;
    border: none;
    color: #cdd6f4;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }
  .janus-hint {
    padding: 12px;
    color: #6c7086;
    font-size: 12px;
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/sidebar/Sidebar.svelte
git commit -m "feat: Sidebar handles onPick — writes ElementPickEvent to store and opens panel"
```

---

### Task 9: Update `EventSidebar.svelte`

Add `element_pick` to the `label` and `badge` functions.

**Files:**
- Modify: `src/components/sidebar/EventSidebar.svelte`

- [ ] **Step 1: Add `element_pick` case to `label`**

In `EventSidebar.svelte`, find the `label` function and add a case before the closing brace:

```typescript
case 'element_pick': {
  const p = e as import('../../lib/event-capture/types').ElementPickEvent
  return `Pick: ${p.selector}`
}
```

- [ ] **Step 2: Add `element_pick` to `badge`**

In the `badge` function, the final `return e.type` already covers `element_pick` (returns `'element_pick'`). Add a CSS class for it in the style block:

```css
.badge-element_pick { background: #cba6f7; color: #1e1e2e; }
```

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/EventSidebar.svelte
git commit -m "feat: EventSidebar shows element_pick events in the list"
```

---

### Task 10: Update `AnnotationPanel.svelte` — props, note seeding, persistence

**Files:**
- Modify: `src/components/sidebar/AnnotationPanel.svelte`

- [ ] **Step 1: Rewrite `AnnotationPanel.svelte`**

```svelte
<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { loadTemplates } from '../../lib/prompts/storage'
  import { resolveSlots, renderTemplate, expandFields, fieldsOf, defaultNoteTemplate } from '../../lib/prompts/engine'
  import { AUTO_FILL_SLOTS } from '../../lib/prompts/types'
  import { updateEvent } from '../../lib/event-capture/store'
  import PromptBox from './PromptBox.svelte'
  import type { Template } from '../../lib/prompts/types'
  import type { CapturedEvent } from '../../lib/event-capture/types'

  let { selectedEvent, events, pageUrl, onBack, onDone }: {
    selectedEvent: CapturedEvent
    events: CapturedEvent[]
    pageUrl: string
    onBack: () => void
    onDone: () => void
  } = $props()

  let templates = $state<Template[]>([])
  let selected = $state<Template | null>(null)
  let extraInputs = $state<Record<string, string>>({})

  onMount(async () => {
    templates = await loadTemplates()
    selected = templates[0] ?? null
  })

  // Seed note from persisted value or default template
  let noteText = $state(selectedEvent.note ?? defaultNoteTemplate(selectedEvent))

  $effect(() => {
    noteText = selectedEvent.note ?? defaultNoteTemplate(selectedEvent)
  })

  function handleNoteInput(e: Event) {
    noteText = (e.target as HTMLTextAreaElement).value
    updateEvent(selectedEvent.id, { note: noteText })
  }

  const autoFillKeys = new Set(AUTO_FILL_SLOTS.map(s => s.key))

  function userSlots(template: Template): string[] {
    const matches = template.body.match(/\{(\w+)\}/g) ?? []
    return [...new Set(
      matches
        .map(m => m.slice(1, -1))
        .filter(k => !autoFillKeys.has(k) && k !== 'user_text')
    )]
  }

  let prompt = $derived.by(() => {
    if (!selected) return ''
    const expandedNote = expandFields(noteText, fieldsOf(selectedEvent))
    const slots = resolveSlots({
      url: pageUrl,
      events,
      selectedEvent,
      userText: expandedNote,
    })
    return renderTemplate(selected.body, { ...slots, ...extraInputs })
  })

  // Field suggestion state
  let noteRef = $state<HTMLTextAreaElement | null>(null)
  let showSuggestions = $state(false)
  let suggestions = $derived(Object.keys(fieldsOf(selectedEvent)))

  function handleNoteKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { showSuggestions = false }
  }

  async function insertSuggestion(field: string) {
    if (!noteRef) return
    const pos = noteRef.selectionStart ?? noteText.length
    // Replace the '{' that triggered the dropdown with '{fieldname}'
    noteText = noteText.slice(0, pos - 1) + `{${field}}` + noteText.slice(pos)
    updateEvent(selectedEvent.id, { note: noteText })
    showSuggestions = false
    await tick()
    const newPos = pos - 1 + field.length + 2
    noteRef.selectionStart = newPos
    noteRef.selectionEnd = newPos
    noteRef.focus()
  }

  function checkForOpenBrace(e: Event) {
    handleNoteInput(e)
    const ta = e.target as HTMLTextAreaElement
    const pos = ta.selectionStart ?? 0
    showSuggestions = pos > 0 && noteText[pos - 1] === '{'
  }
</script>

<div class="panel">
  <button class="back" onclick={onBack}>← Back</button>

  <div class="section">
    <p class="label">Selection</p>
    <div class="selection-info">
      <span class="chip">{selectedEvent.type}: {(selectedEvent as any).url ?? (selectedEvent as any).selector ?? (selectedEvent as any).text ?? ''}</span>
    </div>
  </div>

  <div class="section">
    <p class="label">Tag</p>
    <div class="tags">
      {#each templates as t (t.id)}
        <button
          class="tag-btn"
          class:active={selected?.id === t.id}
          onclick={() => { selected = t; extraInputs = {} }}
        >{t.name}</button>
      {/each}
    </div>
  </div>

  {#if selected}
    <div class="section note-section">
      <label for="panel-note">Note <span class="hint">(your judgment)</span></label>
      <div class="note-wrapper">
        <textarea
          id="panel-note"
          bind:this={noteRef}
          value={noteText}
          oninput={checkForOpenBrace}
          onkeydown={handleNoteKeydown}
          onblur={() => showSuggestions = false}
          rows={3}
          placeholder="Describe what this event means…"
        ></textarea>
        {#if showSuggestions && suggestions.length > 0}
          <ul class="suggestions">
            {#each suggestions as field}
              <li>
                <button
                  class="suggestion-item"
                  onmousedown={(e) => { e.preventDefault(); insertSuggestion(field) }}
                >{field}</button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>

    {#each userSlots(selected) as key}
      <div class="section">
        <label for="slot-{key}">{key}</label>
        <input id="slot-{key}" type="text" bind:value={extraInputs[key]} placeholder={key} />
      </div>
    {/each}

    <div class="section prompt-section">
      <p class="label">Prompt</p>
      <PromptBox value={prompt} onCopy={onDone} rows={8} />
    </div>
  {/if}
</div>

<style>
  .panel { display: flex; flex-direction: column; gap: 12px; padding: 12px; overflow-y: auto; flex: 1; }
  .back { background: none; border: none; color: #89b4fa; cursor: pointer; font-size: 12px; text-align: left; padding: 0; }
  .section { display: flex; flex-direction: column; gap: 4px; }
  label, .label { font-size: 11px; color: #6c7086; text-transform: uppercase; letter-spacing: 0.05em; margin: 0; }
  .hint { font-size: 10px; color: #45475a; text-transform: none; letter-spacing: 0; }
  .selection-info { font-size: 12px; }
  .chip { background: #313244; border-radius: 3px; padding: 2px 6px; font-family: monospace; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; }
  .tag-btn { background: #313244; border: 1px solid transparent; color: #cdd6f4; border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
  .tag-btn.active { border-color: #cba6f7; color: #cba6f7; }
  textarea, input { background: #181825; border: 1px solid #313244; border-radius: 4px; color: #cdd6f4; padding: 6px 8px; font-size: 12px; font-family: inherit; resize: vertical; width: 100%; box-sizing: border-box; }
  .note-section { position: relative; }
  .note-wrapper { position: relative; }
  .suggestions {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: #1e1e2e;
    border: 1px solid #45475a;
    border-radius: 4px;
    list-style: none;
    margin: 2px 0 0;
    padding: 4px 0;
    max-height: 160px;
    overflow-y: auto;
    z-index: 10;
  }
  .suggestion-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: #cdd6f4;
    padding: 4px 10px;
    font-size: 12px;
    font-family: monospace;
    cursor: pointer;
  }
  .suggestion-item:hover { background: #313244; }
</style>
```

- [ ] **Step 2: Check `PromptContext` type still matches**

`resolveSlots` now takes `PromptContext` which no longer requires `elementSelector`. Verify the interface in `engine.ts`:

```typescript
export interface PromptContext {
  url: string
  elementSelector?: string   // keep optional for backwards compat
  events: CapturedEvent[]
  selectedEvent?: CapturedEvent
  userText: string
}
```

`elementSelector` is optional so passing no `elementSelector` from `AnnotationPanel` is fine.

- [ ] **Step 3: Run all tests**

```bash
npm run test:run
```

Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/sidebar/AnnotationPanel.svelte
git commit -m "feat: AnnotationPanel seeds note from event, persists changes, adds field suggestions"
```

---

### Task 11: Verify end-to-end in the browser

- [ ] **Step 1: Build and load the extension**

```bash
npm run dev
```

Load the unpacked extension from the `.output/chrome-mv3` directory in `chrome://extensions`.

- [ ] **Step 2: Verify element pick flow**

1. Open any webpage and activate Janus
2. Click an element — confirm the annotation panel opens immediately
3. Check the Note box is pre-filled with `""` (empty, since `element_pick` has no default template)
4. Type `{` — confirm the suggestion dropdown shows `selector`, `text`, and any captured attribute/style keys
5. Click a suggestion — confirm it inserts `{fieldname}` at cursor
6. Confirm the PROMPT area shows the expanded value
7. Close and reopen the panel — confirm the note is persisted (the typed text reappears)

- [ ] **Step 3: Verify annotation on existing events**

1. Trigger a click event on the page
2. Open the Events panel and click the click event
3. Confirm the Note box pre-fills with `Clicked {label} at ({x}, {y})`
4. Confirm the PROMPT area shows the resolved version (e.g., `Clicked Pay Now at (854, 101)`)
5. Edit the note — confirm PROMPT updates live
6. Confirm the Interactions text in the Events panel reflects the edited note

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: DOM value capture — ElementPickEvent, note expansion, field suggestions"
```
