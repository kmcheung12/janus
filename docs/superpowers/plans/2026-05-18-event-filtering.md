# Event Filtering & API Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a type filter bar, per-event exclude toggles, and API domain grouping to the Events panel so users can control which events appear in the generated prompt.

**Architecture:** `excluded?: boolean` is stored on each event via `updateEvent`. `Sidebar` holds `hiddenTypes: Set<EventType>` and passes `promptEvents` (type-filtered) to `AnnotationPanel` and the full `events` + `hiddenTypes` to `EventSidebar`. `EventSidebar` derives its visible list, renders a type filter bar and per-event checkboxes, and groups consecutive API events by domain via a pure `groupEvents()` function. `formatEvents` skips `excluded` events.

**Tech Stack:** TypeScript, Svelte 5 (`$state`, `$derived`, `$props`), Vitest + jsdom, WXT browser extension framework.

---

## File Map

| File | Change |
|------|--------|
| `src/lib/event-capture/types.ts` | Export `EventType`; add `excluded?: boolean` to `BaseEvent` |
| `src/lib/prompts/engine.ts` | `formatEvents` skips `e.excluded === true` |
| `src/lib/event-grouping.ts` | New: `groupEvents()`, `DisplayItem` type, `extractDomain()` |
| `src/components/sidebar/Sidebar.svelte` | Add `hiddenTypes` state + `promptEvents` derived; pass to children |
| `src/components/sidebar/EventSidebar.svelte` | Type filter bar, per-event toggle, group rows |
| `tests/event-grouping.test.ts` | New: unit tests for `groupEvents` |
| `tests/prompts/engine.test.ts` | Add: `formatEvents` skips excluded events |

---

### Task 1: Export `EventType` and add `excluded` to `BaseEvent`

**Files:**
- Modify: `src/lib/event-capture/types.ts`

- [ ] **Step 1: Update `types.ts`**

Replace the first two lines with:

```typescript
export type EventType = 'session' | 'navigation' | 'click' | 'keyboard' | 'api' | 'scroll' | 'console' | 'drag' | 'element_pick'

interface BaseEvent {
  id: string
  type: EventType
  timestamp: number
  note?: string
  excluded?: boolean
}
```

(`excluded` is optional — `undefined` and `false` both mean included. No existing code needs updating since it's additive.)

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/event-capture/types.ts
git commit -m "feat: export EventType, add excluded flag to BaseEvent"
```

---

### Task 2: `formatEvents` skips excluded events

**Files:**
- Modify: `src/lib/prompts/engine.ts`
- Modify: `tests/prompts/engine.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/prompts/engine.test.ts`:

```typescript
import { formatEvents } from '../../src/lib/prompts/engine'

describe('formatEvents — excluded flag', () => {
  it('skips events where excluded is true', () => {
    const events: CapturedEvent[] = [
      { id: '1', type: 'navigation', timestamp: 0, url: '/home', title: 'Home' },
      { id: '2', type: 'navigation', timestamp: 1, url: '/about', title: 'About', excluded: true },
      { id: '3', type: 'navigation', timestamp: 2, url: '/contact', title: 'Contact' },
    ]
    const result = formatEvents(events)
    expect(result).toContain('Home')
    expect(result).not.toContain('About')
    expect(result).toContain('Contact')
  })

  it('numbers lines contiguously after skipping excluded events', () => {
    const events: CapturedEvent[] = [
      { id: '1', type: 'navigation', timestamp: 0, url: '/a', title: 'A' },
      { id: '2', type: 'navigation', timestamp: 1, url: '/b', title: 'B', excluded: true },
      { id: '3', type: 'navigation', timestamp: 2, url: '/c', title: 'C' },
    ]
    const lines = formatEvents(events).split('\n')
    expect(lines[0]).toStartWith('1.')
    expect(lines[1]).toStartWith('2.')
    expect(lines).toHaveLength(2)
  })

  it('includes events where excluded is false', () => {
    const events: CapturedEvent[] = [
      { id: '1', type: 'navigation', timestamp: 0, url: '/x', title: 'X', excluded: false },
    ]
    expect(formatEvents(events)).toContain('X')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- tests/prompts/engine.test.ts
```

Expected: the 3 new `formatEvents — excluded flag` tests FAIL (excluded events still appear).

- [ ] **Step 3: Add guard to `formatEvents` in `engine.ts`**

Find the `formatEvents` function in `src/lib/prompts/engine.ts`. It contains a `.map(e => {` callback. Add one line at the top of that callback:

```typescript
export function formatEvents(events: CapturedEvent[]): string {
  let i = 0
  return events
    .map(e => {
      if (e.excluded) return null          // ← add this line
      const template = e.note ?? defaultNoteTemplate(e)
      if (!template) return null
      i++
      return `${i}. ${expandFields(template, fieldsOf(e))}`
    })
    .filter((line): line is string => line !== null)
    .join('\n')
}
```

- [ ] **Step 4: Run all tests**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/prompts/engine.ts tests/prompts/engine.test.ts
git commit -m "feat: formatEvents skips excluded events"
```

---

### Task 3: `groupEvents` pure function

**Files:**
- Create: `src/lib/event-grouping.ts`
- Create: `tests/event-grouping.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/event-grouping.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { groupEvents } from '../../src/lib/event-grouping'
import type { ApiEvent, CapturedEvent } from '../../src/lib/event-capture/types'

function api(id: string, url: string): ApiEvent {
  return { id, type: 'api', timestamp: 0, method: 'GET', url, status: 200,
    requestBody: null, responseBody: null, errorDetails: null, duration: null }
}

function nav(id: string): CapturedEvent {
  return { id, type: 'navigation', timestamp: 0, url: '/x', title: '' }
}

describe('groupEvents', () => {
  it('returns a single api event as a plain event item', () => {
    const items = groupEvents([api('1', 'https://stripe.com/v1/charges')])
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('event')
  })

  it('groups two consecutive api events with the same domain', () => {
    const items = groupEvents([
      api('1', 'https://stripe.com/v1/charges'),
      api('2', 'https://stripe.com/v1/customers'),
    ])
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('api-group')
    if (items[0].kind === 'api-group') {
      expect(items[0].domain).toBe('stripe.com')
      expect(items[0].events).toHaveLength(2)
      expect(items[0].id).toBe('1')
    }
  })

  it('does not group two consecutive api events with different domains', () => {
    const items = groupEvents([
      api('1', 'https://stripe.com/v1/charges'),
      api('2', 'https://api.example.com/data'),
    ])
    expect(items).toHaveLength(2)
    expect(items[0].kind).toBe('event')
    expect(items[1].kind).toBe('event')
  })

  it('does not group api events separated by a non-api event', () => {
    const items = groupEvents([
      api('1', 'https://stripe.com/charge'),
      nav('2'),
      api('3', 'https://stripe.com/confirm'),
    ])
    expect(items).toHaveLength(3)
    expect(items[0].kind).toBe('event')
    expect(items[1].kind).toBe('event')
    expect(items[2].kind).toBe('event')
  })

  it('non-api events are never grouped', () => {
    const items = groupEvents([nav('1'), nav('2')])
    expect(items).toHaveLength(2)
    items.forEach(item => expect(item.kind).toBe('event'))
  })

  it('forms two separate groups for different domains in sequence', () => {
    const items = groupEvents([
      api('1', 'https://stripe.com/a'),
      api('2', 'https://stripe.com/b'),
      api('3', 'https://example.com/a'),
      api('4', 'https://example.com/b'),
    ])
    expect(items).toHaveLength(2)
    if (items[0].kind === 'api-group') expect(items[0].domain).toBe('stripe.com')
    if (items[1].kind === 'api-group') expect(items[1].domain).toBe('example.com')
  })

  it('group id is the id of the first event in the group', () => {
    const items = groupEvents([
      api('first', 'https://stripe.com/a'),
      api('second', 'https://stripe.com/b'),
    ])
    expect(items[0].kind).toBe('api-group')
    if (items[0].kind === 'api-group') expect(items[0].id).toBe('first')
  })

  it('uses raw URL as domain when URL parsing fails', () => {
    const items = groupEvents([
      api('1', 'not-a-valid-url'),
      api('2', 'not-a-valid-url'),
    ])
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('api-group')
    if (items[0].kind === 'api-group') expect(items[0].domain).toBe('not-a-valid-url')
  })

  it('returns empty array for empty input', () => {
    expect(groupEvents([])).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- tests/event-grouping.test.ts
```

Expected: FAIL — `Cannot find module '../../src/lib/event-grouping'`.

- [ ] **Step 3: Implement `src/lib/event-grouping.ts`**

Create the file:

```typescript
import type { ApiEvent, CapturedEvent } from './event-capture/types'

export type DisplayItem =
  | { kind: 'event'; event: CapturedEvent }
  | { kind: 'api-group'; id: string; domain: string; events: ApiEvent[] }

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export function groupEvents(events: CapturedEvent[]): DisplayItem[] {
  const items: DisplayItem[] = []

  for (const event of events) {
    if (event.type !== 'api') {
      items.push({ kind: 'event', event })
      continue
    }

    const apiEvent = event as ApiEvent
    const domain = extractDomain(apiEvent.url)
    const last = items[items.length - 1]

    // Extend an existing group with the same domain
    if (last?.kind === 'api-group' && last.domain === domain) {
      last.events.push(apiEvent)
      continue
    }

    // Upgrade a preceding lone api event into a group when domains match
    if (last?.kind === 'event' && last.event.type === 'api') {
      const prevApi = last.event as ApiEvent
      if (extractDomain(prevApi.url) === domain) {
        items.pop()
        items.push({ kind: 'api-group', id: prevApi.id, domain, events: [prevApi, apiEvent] })
        continue
      }
    }

    items.push({ kind: 'event', event })
  }

  return items
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test:run -- tests/event-grouping.test.ts
```

Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/event-grouping.ts tests/event-grouping.test.ts
git commit -m "feat: add groupEvents for collapsing consecutive API calls by domain"
```

---

### Task 4: `Sidebar.svelte` — add `hiddenTypes` and `promptEvents`

**Files:**
- Modify: `src/components/sidebar/Sidebar.svelte`

- [ ] **Step 1: Update the `<script>` block**

Replace the existing `<script>` block with:

```svelte
<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import ElementPicker from './ElementPicker.svelte'
  import EventSidebar from './EventSidebar.svelte'
  import AnnotationPanel from './AnnotationPanel.svelte'
  import type { CapturedEvent, ElementPickEvent, EventType } from '../../lib/event-capture/types'
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

  // Type filter — ephemeral per session, does not persist
  let hiddenTypes = $state(new Set<EventType>())

  function onToggleType(type: EventType) {
    const next = new Set(hiddenTypes)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    hiddenTypes = next
  }

  // Events passed to AnnotationPanel: type-filtered + formatEvents will skip excluded
  let promptEvents = $derived(events.filter(e => !hiddenTypes.has(e.type as EventType)))

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
```

- [ ] **Step 2: Update the template to pass new props**

Replace the `{:else if mode === 'sidebar'}` and `{:else if mode === 'panel'}` blocks:

```svelte
  {:else if mode === 'sidebar'}
    <EventSidebar {events} {hiddenTypes} {onToggleType} onSelect={onEventSelected} />
  {:else if mode === 'panel' && selectedEvent}
    <AnnotationPanel
      {selectedEvent}
      events={promptEvents}
      pageUrl={window.location.href}
      onBack={onBack}
      onDone={onClose}
    />
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: TypeScript error on `EventSidebar` because it doesn't accept `hiddenTypes` / `onToggleType` yet — that's fine, it will be fixed in Task 5.

- [ ] **Step 4: Commit**

```bash
git add src/components/sidebar/Sidebar.svelte
git commit -m "feat: Sidebar passes hiddenTypes and promptEvents to children"
```

---

### Task 5: `EventSidebar.svelte` — type filter bar, per-event toggles, API group rows

**Files:**
- Modify: `src/components/sidebar/EventSidebar.svelte`

- [ ] **Step 1: Replace the entire file**

```svelte
<script lang="ts">
  import type { CapturedEvent, ApiEvent, ClickEvent, KeyboardInputEvent, NavigationEvent, ConsoleEvent, ScrollEvent, DragEvent, SessionEvent, ElementPickEvent, EventType } from '../../lib/event-capture/types'
  import { formatEvents } from '../../lib/prompts/engine'
  import { groupEvents } from '../../lib/event-grouping'
  import type { DisplayItem } from '../../lib/event-grouping'
  import { updateEvent } from '../../lib/event-capture/store'
  import PromptBox from './PromptBox.svelte'

  let { events, hiddenTypes, onToggleType, onSelect }: {
    events: CapturedEvent[]
    hiddenTypes: Set<EventType>
    onToggleType: (type: EventType) => void
    onSelect: (e: CapturedEvent) => void
  } = $props()

  // All distinct types in the full event list (for the filter bar)
  let allTypes = $derived([...new Set(events.map(e => e.type))] as EventType[])

  // Events visible in the list after type filtering
  let visibleEvents = $derived(events.filter(e => !hiddenTypes.has(e.type as EventType)))

  // Grouped display items, newest first
  let displayItems = $derived([...groupEvents(visibleEvents)].reverse())

  // Prompt text shown in the bottom box (respects both type filter and excluded flag)
  let interactionText = $derived(formatEvents(visibleEvents))

  // Which API groups are expanded
  let expandedGroups = $state(new Set<string>())

  function toggleGroupExpanded(id: string) {
    const next = new Set(expandedGroups)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    expandedGroups = next
  }

  function toggleEventExcluded(event: CapturedEvent) {
    updateEvent(event.id, { excluded: !event.excluded })
  }

  function toggleGroupExcluded(groupEvts: ApiEvent[]) {
    const allExcluded = groupEvts.every(e => e.excluded)
    // all excluded → include all; otherwise → exclude all
    groupEvts.forEach(e => updateEvent(e.id, { excluded: !allExcluded }))
  }

  // Svelte action: sets the native indeterminate property on a checkbox
  function indeterminate(node: HTMLInputElement, value: boolean) {
    node.indeterminate = value
    return { update(v: boolean) { node.indeterminate = v } }
  }

  function label(e: CapturedEvent): string {
    switch (e.type) {
      case 'navigation': {
        const n = e as NavigationEvent
        return `→ ${n.title || n.url}`
      }
      case 'click': {
        const c = e as ClickEvent
        return `Click: ${c.label || c.selector}${c.count > 1 ? ` ×${c.count}` : ''}`
      }
      case 'keyboard': {
        const k = e as KeyboardInputEvent
        return `Input: ${k.selector}${k.count > 1 ? ` ×${k.count}` : ''}`
      }
      case 'api': {
        const a = e as ApiEvent
        return `${a.method} ${a.url} → ${a.status ?? '…'}`
      }
      case 'console': {
        const c = e as ConsoleEvent
        return `console.${c.level}: ${c.message}`
      }
      case 'scroll': {
        const s = e as ScrollEvent
        return `Scroll ${s.direction} on ${s.selector === 'window' ? 'page' : s.selector}${s.count > 1 ? ` ×${s.count}` : ''}`
      }
      case 'drag': {
        const d = e as DragEvent
        return `Drag ${d.sourceSelector}${d.targetSelector ? ` → ${d.targetSelector}` : ''}`
      }
      case 'session': {
        const s = e as SessionEvent
        return `Session started ${s.viewport.width}×${s.viewport.height}`
      }
      case 'element_pick': {
        const p = e as ElementPickEvent
        return `Pick: ${p.selector}`
      }
    }
  }

  function badge(e: CapturedEvent): string {
    if (e.type === 'api') {
      const a = e as ApiEvent
      if (a.status === null || a.status >= 500) return 'error'
      if (a.status >= 400) return 'warn'
      return 'ok'
    }
    if (e.type === 'console') return `console-${(e as ConsoleEvent).level}`
    return e.type
  }

  const TYPE_LABELS: Partial<Record<EventType, string>> = {
    click: 'click', navigation: 'nav', keyboard: 'kbd',
    api: 'api', scroll: 'scroll', console: 'console',
    drag: 'drag', element_pick: 'pick', session: 'session',
  }
</script>

<div class="sidebar-wrapper">
  {#if allTypes.length > 0}
    <div class="filter-bar">
      {#each allTypes as type}
        <button
          class="filter-btn"
          class:inactive={hiddenTypes.has(type)}
          onclick={() => onToggleType(type)}
        >{TYPE_LABELS[type] ?? type}</button>
      {/each}
    </div>
  {/if}

  <div class="events-list">
    {#if events.length === 0}
      <p class="empty">No interactions captured yet.</p>
    {:else if visibleEvents.length === 0}
      <p class="empty">All events hidden by filter.</p>
    {:else}
      {#each displayItems as item (item.kind === 'api-group' ? item.id : item.event.id)}
        {#if item.kind === 'api-group'}
          {@const allExcluded = item.events.every(e => e.excluded)}
          {@const someExcluded = item.events.some(e => e.excluded)}
          {@const isExpanded = expandedGroups.has(item.id)}
          <div class="group-header" class:excluded={allExcluded}>
            <input
              type="checkbox"
              class="event-toggle"
              checked={!allExcluded}
              use:indeterminate={someExcluded && !allExcluded}
              onchange={() => toggleGroupExcluded(item.events)}
            />
            <button class="expand-btn" onclick={() => toggleGroupExpanded(item.id)}>
              {isExpanded ? '▼' : '▶'}
            </button>
            <span class="badge badge-ok">api ×{item.events.length}</span>
            <span class="group-domain">{item.domain}</span>
          </div>
          {#if isExpanded}
            {#each [...item.events].reverse() as event (event.id)}
              <button class="entry entry-indented" class:excluded={event.excluded} onclick={() => onSelect(event)}>
                <input
                  type="checkbox"
                  class="event-toggle"
                  checked={!event.excluded}
                  onclick={(e) => e.stopPropagation()}
                  onchange={() => toggleEventExcluded(event)}
                />
                <span class="badge badge-{badge(event)}">{event.type}</span>
                <span class="entry-label">{label(event)}</span>
              </button>
            {/each}
          {/if}
        {:else}
          <button class="entry" class:excluded={item.event.excluded} onclick={() => onSelect(item.event)}>
            <input
              type="checkbox"
              class="event-toggle"
              checked={!item.event.excluded}
              onclick={(e) => e.stopPropagation()}
              onchange={() => toggleEventExcluded(item.event)}
            />
            <span class="badge badge-{badge(item.event)}">{item.event.type}</span>
            <span class="entry-label">{label(item.event)}</span>
          </button>
        {/if}
      {/each}
    {/if}
  </div>

  {#if events.length > 0}
    <div class="prompt-area">
      <p class="label">Interactions</p>
      <PromptBox value={interactionText} rows={5} />
    </div>
  {/if}
</div>

<style>
  .sidebar-wrapper { display: flex; flex-direction: column; flex: 1; overflow: hidden; }

  .filter-bar {
    display: flex; flex-wrap: wrap; gap: 4px;
    padding: 6px 8px; border-bottom: 1px solid #313244; flex-shrink: 0;
  }
  .filter-btn {
    padding: 2px 7px; border-radius: 3px; font-size: 10px; font-weight: 600;
    text-transform: uppercase; border: none; cursor: pointer;
    background: #313244; color: #cdd6f4; transition: opacity 0.1s;
  }
  .filter-btn.inactive { opacity: 0.35; text-decoration: line-through; }

  .events-list { overflow-y: auto; flex: 1; padding: 4px 0; }
  .prompt-area { padding: 8px 12px; border-top: 1px solid #313244; flex-shrink: 0; }
  .label { font-size: 11px; color: #6c7086; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 4px; }
  .empty { padding: 12px; color: #6c7086; font-size: 12px; }

  .entry {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 6px 12px;
    background: none; border: none; color: #cdd6f4;
    cursor: pointer; text-align: left; font-size: 12px;
  }
  .entry:hover { background: #313244; }
  .entry.excluded { opacity: 0.4; }
  .entry-indented { padding-left: 28px; }

  .group-header {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 12px; font-size: 12px; color: #cdd6f4;
    border-bottom: 1px solid #2a2a3e;
  }
  .group-header.excluded { opacity: 0.4; }
  .group-domain { color: #a6adc8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }

  .expand-btn {
    background: none; border: none; color: #6c7086;
    font-size: 10px; cursor: pointer; padding: 0; flex-shrink: 0;
  }

  .event-toggle {
    flex-shrink: 0; cursor: pointer; accent-color: #cba6f7;
    width: 13px; height: 13px;
  }

  .badge {
    padding: 2px 5px; border-radius: 3px; font-size: 10px;
    font-weight: 600; flex-shrink: 0; text-transform: uppercase;
  }
  .badge-click, .badge-keyboard, .badge-navigation, .badge-scroll, .badge-drag, .badge-session { background: #313244; color: #cdd6f4; }
  .badge-element_pick { background: #cba6f7; color: #1e1e2e; }
  .badge-console-error { background: #f38ba8; color: #1e1e2e; }
  .badge-console-warn { background: #fab387; color: #1e1e2e; }
  .badge-ok { background: #a6e3a1; color: #1e1e2e; }
  .badge-warn { background: #fab387; color: #1e1e2e; }
  .badge-error { background: #f38ba8; color: #1e1e2e; }
  .entry-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
</style>
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run all tests**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/sidebar/EventSidebar.svelte
git commit -m "feat: EventSidebar — type filter bar, per-event toggles, API group rows"
```

---

### Task 6: Manual verification in browser

- [ ] **Step 1: Build the extension**

```bash
npm run dev
```

Load the unpacked extension from `.output/chrome-mv3` in `chrome://extensions`.

- [ ] **Step 2: Verify type filter bar**

1. Open a page with mixed events (navigate, click, make an XHR)
2. Confirm the filter bar shows one button per event type seen
3. Click `api` to hide — confirm api events disappear from the list and from the Interactions text
4. Click `api` again — confirm events return

- [ ] **Step 3: Verify per-event toggle**

1. Uncheck a click event — confirm it dims and disappears from the Interactions text
2. Check it again — confirm it returns to full opacity and reappears in Interactions
3. Navigate to the annotation panel and back — confirm the excluded state persisted

- [ ] **Step 4: Verify API grouping**

1. Trigger 3+ consecutive network calls to the same domain (e.g., load a page that calls an analytics API repeatedly)
2. Confirm they appear as a collapsed group: `▶ [✓] [ api ×N ] domain.com`
3. Click `▶` to expand — confirm individual rows appear indented with their own checkboxes
4. Uncheck the group header — confirm all events in the group dim
5. Re-check — confirm all events restore

- [ ] **Step 5: Verify annotation panel sees the same filter**

1. Hide all `api` events via the filter bar
2. Open the annotation panel
3. Confirm the Interactions section in the prompt does not contain api events

- [ ] **Step 6: Commit if any fixups were needed**

```bash
git add -A
git commit -m "fix: event filtering manual verification fixups"
```
