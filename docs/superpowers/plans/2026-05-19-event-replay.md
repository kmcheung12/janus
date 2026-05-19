# Event Replay Animations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user clicks an event entry in the EventSidebar, play a short SVG animation on the page visualising what that interaction looked like (contracting circle for clicks, path trace for drags).

**Architecture:** A registry module maps event types to replay functions. A lazy SVG overlay is appended to `document.body` (outside `#janus-root`) and reused across animations. Click and drag replayers register themselves as side effects on import. EventSidebar imports `replay()` and calls it on every entry click.

**Tech Stack:** TypeScript, SVG DOM APIs, Vitest (registry unit tests only — animation code is visual and verified manually)

---

## File Map

| File | Change |
|------|--------|
| `src/lib/event-replay/registry.ts` | New — `Map<EventType, ReplayFn>`, `registerReplayer`, `replay`, `_clearRegistry` |
| `src/lib/event-replay/overlay.ts` | New — lazy-creates shared `<svg>` on `document.body` with keyframe `<style>` |
| `src/lib/event-replay/replayers/click.ts` | New — registers `'click'` replayer: contracting circle |
| `src/lib/event-replay/replayers/drag.ts` | New — registers `'drag'` replayer: stroke-dasharray path trace |
| `src/lib/event-replay/index.ts` | New — imports replayers (side-effect registration), re-exports `replay` |
| `src/components/sidebar/EventSidebar.svelte` | Modify — import `replay`, call on all 4 entry `onclick` handlers |
| `tests/event-replay/registry.test.ts` | New — unit tests for dispatch and no-op behaviour |

---

### Task 1: Registry

**Files:**
- Create: `src/lib/event-replay/registry.ts`
- Create: `tests/event-replay/registry.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/event-replay/registry.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerReplayer, replay, _clearRegistry } from '../../src/lib/event-replay/registry'
import type { ClickEvent, NavigationEvent } from '../../src/lib/event-capture/types'

const makeClick = (): ClickEvent => ({
  id: '1', type: 'click', timestamp: 0,
  selector: 'button', label: 'OK', count: 1, x: 100, y: 200,
})

const makeNav = (): NavigationEvent => ({
  id: '2', type: 'navigation', timestamp: 0,
  url: 'https://example.com', title: 'Home',
})

describe('event replay registry', () => {
  beforeEach(() => {
    _clearRegistry()
  })

  it('calls the registered handler with the event', () => {
    const handler = vi.fn()
    registerReplayer('click', handler)
    const event = makeClick()
    replay(event)
    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(event)
  })

  it('does nothing when no handler is registered for the event type', () => {
    expect(() => replay(makeNav())).not.toThrow()
  })

  it('replaces the handler when registered twice for the same type', () => {
    const first = vi.fn()
    const second = vi.fn()
    registerReplayer('click', first)
    registerReplayer('click', second)
    replay(makeClick())
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```
npm run test:run -- tests/event-replay/registry.test.ts
```

Expected: FAIL — `Cannot find module '../../src/lib/event-replay/registry'`

- [ ] **Step 3: Implement the registry**

Create `src/lib/event-replay/registry.ts`:

```ts
import type { CapturedEvent, EventType } from '../event-capture/types'

type ReplayFn = (event: CapturedEvent) => void

const registry = new Map<EventType, ReplayFn>()

export function registerReplayer(type: EventType, fn: ReplayFn): void {
  registry.set(type, fn)
}

export function replay(event: CapturedEvent): void {
  registry.get(event.type)?.(event)
}

export function _clearRegistry(): void {
  registry.clear()
}
```

- [ ] **Step 4: Run tests — verify they pass**

```
npm run test:run -- tests/event-replay/registry.test.ts
```

Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/event-replay/registry.ts tests/event-replay/registry.test.ts
git commit -m "feat: add event replay registry"
```

---

### Task 2: SVG Overlay

**Files:**
- Create: `src/lib/event-replay/overlay.ts`

No automated tests — this is a thin DOM wrapper. Verified visually in Tasks 3 and 4.

- [ ] **Step 1: Create the overlay module**

Create `src/lib/event-replay/overlay.ts`:

```ts
const KEYFRAMES = `
@keyframes janus-click-ripple {
  from { r: 30; opacity: 1; }
  to   { r: 0;  opacity: 0; }
}
@keyframes janus-drag-trace {
  0%   { stroke-dashoffset: var(--path-len); opacity: 1; }
  75%  { stroke-dashoffset: 0;              opacity: 1; }
  100% { stroke-dashoffset: 0;              opacity: 0; }
}
`

let svg: SVGSVGElement | null = null

export function getOverlay(): SVGSVGElement | null {
  if (!document.body) return null
  if (svg && svg.isConnected) return svg

  svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.id = 'janus-replay-overlay'
  svg.style.cssText = [
    'position:fixed',
    'inset:0',
    'width:100%',
    'height:100%',
    'pointer-events:none',
    'z-index:2147483646',
    'overflow:visible',
  ].join(';')

  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = KEYFRAMES
  svg.appendChild(style)

  document.body.appendChild(svg)
  return svg
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/event-replay/overlay.ts
git commit -m "feat: add SVG replay overlay"
```

---

### Task 3: Click Replayer

**Files:**
- Create: `src/lib/event-replay/replayers/click.ts`

Verified visually — open Janus, record a session, click a click event in the sidebar, confirm purple contracting circle appears at the click coordinates.

- [ ] **Step 1: Create the click replayer**

Create `src/lib/event-replay/replayers/click.ts`:

```ts
import type { CapturedEvent, ClickEvent } from '../../event-capture/types'
import { registerReplayer } from '../registry'
import { getOverlay } from '../overlay'

registerReplayer('click', (event: CapturedEvent) => {
  const e = event as ClickEvent
  const svg = getOverlay()
  if (!svg) return

  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  circle.setAttribute('cx', String(e.x))
  circle.setAttribute('cy', String(e.y))
  circle.setAttribute('r', '30')
  circle.setAttribute('fill', 'none')
  circle.setAttribute('stroke', '#cba6f7')
  circle.setAttribute('stroke-width', '2')
  circle.style.animation = 'janus-click-ripple 400ms ease-out forwards'
  circle.addEventListener('animationend', () => circle.remove(), { once: true })
  svg.appendChild(circle)
})
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/event-replay/replayers/click.ts
git commit -m "feat: add click event replay animation"
```

---

### Task 4: Drag Replayer

**Files:**
- Create: `src/lib/event-replay/replayers/drag.ts`

Verified visually — open Janus, record a drag, click the drag event in the sidebar, confirm blue path trace appears along the recorded drag path.

- [ ] **Step 1: Create the drag replayer**

Create `src/lib/event-replay/replayers/drag.ts`:

```ts
import type { CapturedEvent, DragEvent } from '../../event-capture/types'
import { registerReplayer } from '../registry'
import { getOverlay } from '../overlay'

function pathLength(points: Array<{ x: number; y: number }>): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    total += Math.sqrt(dx * dx + dy * dy)
  }
  return total
}

registerReplayer('drag', (event: CapturedEvent) => {
  const e = event as DragEvent
  if (e.path.length < 2) return
  const svg = getOverlay()
  if (!svg) return

  const len = pathLength(e.path)
  const points = e.path.map(p => `${p.x},${p.y}`).join(' ')

  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
  polyline.setAttribute('points', points)
  polyline.setAttribute('fill', 'none')
  polyline.setAttribute('stroke', '#89b4fa')
  polyline.setAttribute('stroke-width', '2')
  polyline.setAttribute('stroke-linecap', 'round')
  polyline.setAttribute('stroke-linejoin', 'round')
  polyline.style.setProperty('--path-len', String(len))
  polyline.style.strokeDasharray = String(len)
  polyline.style.strokeDashoffset = String(len)
  polyline.style.animation = 'janus-drag-trace 800ms ease-out forwards'
  polyline.addEventListener('animationend', () => polyline.remove(), { once: true })
  svg.appendChild(polyline)
})
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/event-replay/replayers/drag.ts
git commit -m "feat: add drag event replay animation"
```

---

### Task 5: Index Entry Point

**Files:**
- Create: `src/lib/event-replay/index.ts`

- [ ] **Step 1: Create the index**

Create `src/lib/event-replay/index.ts`:

```ts
import './replayers/click'
import './replayers/drag'
export { replay } from './registry'
```

- [ ] **Step 2: Run all tests to confirm nothing is broken**

```
npm run test:run
```

Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/event-replay/index.ts
git commit -m "feat: add event replay entry point"
```

---

### Task 6: Wire EventSidebar

**Files:**
- Modify: `src/components/sidebar/EventSidebar.svelte`

There are 4 entry `onclick` handlers in the component. All 4 need `replay(event)` called before `onSelect(event)`.

- [ ] **Step 1: Add the import**

At the top of the `<script>` block in `EventSidebar.svelte`, after the existing imports, add:

```ts
import { replay } from '../../lib/event-replay'
```

- [ ] **Step 2: Update the four entry onclick handlers**

**Entry 1** — indented API sub-entry (around line 157):
```svelte
<button class="entry entry-indented" class:excluded={event.excluded} onclick={() => { replay(event); onSelect(event) }}>
```

**Entry 2** — single API event in a single-subgroup (around line 192):
```svelte
<button class="entry entry-indented" class:excluded={event.excluded} onclick={() => { replay(event); onSelect(event) }}>
```

**Entry 3** — event inside an expanded multi-subgroup (around line 222):
```svelte
<button class="entry entry-double-indented" class:excluded={event.excluded} onclick={() => { replay(event); onSelect(event) }}>
```

**Entry 4** — top-level non-API entry (around line 240):
```svelte
<button class="entry" class:excluded={item.event.excluded} onclick={() => { replay(item.event); onSelect(item.event) }}>
```

- [ ] **Step 3: Build to confirm no TypeScript errors**

```
npm run build
```

Expected: build succeeds with no errors

- [ ] **Step 4: Verify manually in the browser**

1. `npm run dev` or `npm run dev:firefox`
2. Load the extension, open a page, start recording
3. Perform a click on the page — confirm it appears in the sidebar
4. Click the click entry in the sidebar — confirm a purple contracting circle appears at the click location on the page
5. Perform a drag on the page — confirm it appears in the sidebar
6. Click the drag entry in the sidebar — confirm a blue path trace appears along the drag path
7. Click a keyboard or navigation entry — confirm no animation plays (silent no-op)

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/EventSidebar.svelte
git commit -m "feat: trigger event replay animations from EventSidebar"
```
