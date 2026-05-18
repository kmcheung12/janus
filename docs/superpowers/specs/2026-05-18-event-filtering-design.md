# Event Filtering & API Grouping Design

## Overview

Two related improvements to the Events panel:

1. **Type filter bar** — pill buttons to hide/show entire event types from the panel and prompt
2. **Per-event toggle** — checkbox on each event row to exclude individual events from prompt generation
3. **API grouping** — consecutive API events to the same domain collapse into a single expandable group row

All three affect prompt generation (`formatEvents`). The goal is to reduce visual and prompt noise without changing capture settings.

---

## Data Model

### `excluded` on `BaseEvent`

```typescript
interface BaseEvent {
  id: string
  type: EventType
  timestamp: number
  note?: string
  excluded?: boolean   // undefined and false both mean included (default: included)
}
```

`excluded` is persisted via the existing `updateEvent(id, { excluded })` in `store.ts`. No other store changes needed.

### `formatEvents` change

One new guard at the top of the `map` callback:

```typescript
if (e.excluded) return null
```

`formatEvents` receives a pre-filtered list (type-filtered by Sidebar before being passed in), so it only needs to check the per-event flag.

---

## State Ownership

**`hiddenTypes: Set<EventType>`** lives in `Sidebar.svelte` (not `EventSidebar`).

`Sidebar` computes:

```typescript
let promptEvents = $derived(events.filter(e => !hiddenTypes.has(e.type)))
```

`promptEvents` is passed as the `events` prop to both `EventSidebar` and `AnnotationPanel`. This ensures the type filter affects prompt generation in both views.

`EventSidebar` receives `hiddenTypes` and an `onToggleType` callback to render and control the filter bar.

---

## Type Filter Bar

A row of pill buttons above the event list. One button per event type present in the current session — derived dynamically from `promptEvents`, not hardcoded.

- All types active by default
- Clicking a button toggles that type: inactive = hidden from list + excluded from prompt
- Active buttons use the type's existing badge color; inactive buttons are gray with strikethrough label
- No explicit "All" button — all active is the default state
- Hiding a type via the filter bar does **not** mutate `excluded` on individual events — the two controls are independent. Re-enabling a type restores events to their individual `excluded` state.

```
[ click ] [ api ] [ keyboard ] [ navigation ] [ console ] [ scroll ]
```

---

## Per-Event Toggle

A checkbox on the left of each event row. Defaults to checked (included).

- Unchecking calls `updateEvent(id, { excluded: true })`
- Checking calls `updateEvent(id, { excluded: false })`
- Excluded rows remain visible in the list but render dimmed (reduced opacity)
- This allows the user to re-include events without scrolling past them

```
[✓] [ api ] POST /api/checkout → 200
[✗] [ api ] GET /api/feature-flags → 200     ← dimmed
[✓] [ click ] Click: Pay Now
```

---

## API Grouping

### `groupEvents` — pure function in `src/lib/event-grouping.ts`

```typescript
type DisplayItem =
  | { kind: 'event';     event: CapturedEvent }
  | { kind: 'api-group'; id: string; domain: string; events: ApiEvent[] }

function groupEvents(events: CapturedEvent[]): DisplayItem[]
```

**Grouping rule:** Consecutive API events sharing the same domain (extracted from URL hostname) form a group. A group only forms when 2+ consecutive API events share a domain. Single API events remain as `{ kind: 'event' }` items.

**Domain extraction:** `new URL(url).hostname`, falling back to the raw URL string if parsing fails.

### Group row rendering

Groups start **collapsed**. The header row:

```
[▶] [−] [ api ×7 ] api.stripe.com
```

- `▶` / `▼` — expand/collapse toggle
- Checkbox — tri-state: all-on (✓), all-off (✗), mixed (−)
  - Clicking tri-state cycles: mixed → all-off → all-on
  - Clicking all-on → all-off; all-off → all-on
  - Calls `updateEvent` on every event in the group

When expanded, individual event rows appear below the header with their own per-event toggles. Expanded rows are indented.

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/event-capture/types.ts` | Add `excluded?: boolean` to `BaseEvent` |
| `src/lib/prompts/engine.ts` | `formatEvents` skips `e.excluded === true` |
| `src/lib/event-grouping.ts` | New: `groupEvents()`, `DisplayItem` type, domain extraction |
| `src/components/sidebar/Sidebar.svelte` | Add `hiddenTypes` state, compute `promptEvents`, pass to `EventSidebar` + `AnnotationPanel` |
| `src/components/sidebar/EventSidebar.svelte` | Add type filter bar, per-event toggle, render `DisplayItem[]` with group rows |
| `tests/event-grouping.test.ts` | New: grouping logic unit tests |
| `tests/prompts/engine.test.ts` | Add: `formatEvents` skips excluded events |
