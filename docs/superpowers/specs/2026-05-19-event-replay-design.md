# Event Replay Animations — Design Spec

**Date:** 2026-05-19
**Status:** Approved

---

## 1. Overview

When a user clicks an event entry in the EventSidebar, play a short animation on the page visualising what that interaction looked like. This closes the loop between the captured event log and what actually happened on the page.

---

## 2. Scope

**In:**
- Click event: contracting circle at the capture coordinates
- Drag event: path trace along the recorded pointer path
- Trigger: EventSidebar event entry clicks only

**Out:**
- AnnotationPanel PromptBox display-line clicks (line→event mapping is too fragile)
- Replay for all other event types (keyboard, scroll, navigation, api, etc.) — no-op for now

---

## 3. Architecture

```
src/lib/event-replay/
  overlay.ts          ← lazy-creates and returns a shared fixed <svg> on document.body
  registry.ts         ← Map<EventType, ReplayFn>; replay() dispatches or silently no-ops
  replayers/
    click.ts          ← registers 'click' replayer
    drag.ts           ← registers 'drag' replayer
  index.ts            ← imports replayers (side-effect registration), re-exports replay()
```

---

## 4. SVG Overlay

A single `<svg>` element appended to `document.body`, **outside** `#janus-root`:

```
position: fixed
inset: 0
width: 100%
height: 100%
pointer-events: none
z-index: 2147483646   (one below Janus sidebar at 2147483647)
overflow: visible
```

`overlay.ts` exports `getOverlay(): SVGSVGElement`. On first call it creates and appends the element. Subsequent calls return the cached reference if still connected; otherwise recreates it (handles SPA navigation that clears `document.body`).

A `<style>` block with keyframe definitions is injected into the SVG once on creation (see §5, §6).

Each animation appends child elements to the SVG and removes them on `animationend`. No explicit clearing needed.

---

## 5. Click Replayer

**File:** `src/lib/event-replay/replayers/click.ts`

**Input:** `ClickEvent` — uses `event.x`, `event.y` (clientX/clientY at capture time, viewport-relative → directly usable with `position: fixed`)

**Animation:** SVG `<circle>` element

- `cx={event.x}`, `cy={event.y}`
- Radius: 30px → 0px
- Opacity: 1 → 0
- Duration: 400ms, ease-out
- Color: `#cba6f7` (Janus purple) with no fill, stroke-width 2

Keyframes (injected once into the SVG `<style>`):

```css
@keyframes janus-click-ripple {
  from { r: 30; opacity: 1; }
  to   { r: 0;  opacity: 0; }
}
```

On `animationend`, the `<circle>` removes itself from the SVG.

---

## 6. Drag Replayer

**File:** `src/lib/event-replay/replayers/drag.ts`

**Input:** `DragEvent` — uses `event.path: Array<{x, y}>` (RDP-simplified, clientX/clientY)

**Animation:** SVG `<polyline>` tracing the path

Technique: `stroke-dasharray` = total path length, `stroke-dashoffset` animates from full length → 0 (draws the line progressively), then opacity fades to 0.

- Color: `#89b4fa` (Janus blue), stroke-width 2, no fill, rounded joins
- Duration: 600ms trace + 200ms fade = 800ms total
- `stroke-linecap: round`, `stroke-linejoin: round`

Keyframes:

```css
@keyframes janus-drag-trace {
  0%   { stroke-dashoffset: var(--path-len); opacity: 1; }
  75%  { stroke-dashoffset: 0;              opacity: 1; }
  100% { stroke-dashoffset: 0;              opacity: 0; }
}
```

`--path-len` is set as a CSS custom property on the `<polyline>` element after computing `getTotalLength()`.

On `animationend`, the `<polyline>` removes itself.

---

## 7. Registry

**File:** `src/lib/event-replay/registry.ts`

```ts
type ReplayFn = (event: CapturedEvent) => void
const registry = new Map<EventType, ReplayFn>()

export function registerReplayer(type: EventType, fn: ReplayFn): void
export function replay(event: CapturedEvent): void  // no-op if type not in registry
```

**File:** `src/lib/event-replay/index.ts`

Imports `./replayers/click` and `./replayers/drag` for side-effect registration, then re-exports `replay`.

Adding replay for a new event type in future = one new file in `replayers/` that calls `registerReplayer`.

---

## 8. Wiring: EventSidebar

`EventSidebar.svelte` imports `replay` from `../../lib/event-replay` and calls it alongside the existing `onSelect` in every entry `onclick`:

```ts
onclick={() => { replay(item.event); onSelect(item.event) }}
```

Applied to all entry buttons in the sidebar list (top-level entries and indented API sub-entries). No prop changes to EventSidebar or its parents.

---

## 9. Concurrency

Multiple animations can run simultaneously — each is an independent SVG child element with its own animation. No cancellation or queuing needed at this scope.

---

## 10. Error Handling

- If `document.body` is unavailable (edge case during SPA navigation), `getOverlay()` returns null and `replay()` silently skips.
- If `event.path` is empty or has fewer than 2 points, the drag replayer skips silently.
- If `event.x` / `event.y` are 0, the click ripple still plays (0,0 is a valid viewport coordinate).

---

## 11. Files Changed

| File | Change |
|------|--------|
| `src/lib/event-replay/overlay.ts` | New |
| `src/lib/event-replay/registry.ts` | New |
| `src/lib/event-replay/replayers/click.ts` | New |
| `src/lib/event-replay/replayers/drag.ts` | New |
| `src/lib/event-replay/index.ts` | New |
| `src/components/sidebar/EventSidebar.svelte` | Import `replay`, call in entry onclicks |
