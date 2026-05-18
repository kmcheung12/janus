# DOM Value Capture & Annotation Expansion

## Overview

Two closely related changes:

1. **Element pick as a first-class event** — picking an element creates an `ElementPickEvent` in the event store (capturing selector, text, attributes, computed styles) and immediately opens the annotation panel.
2. **Annotation expansion** — the Note box in the annotation panel supports `{field}` interpolation against any selected event's fields, with field suggestions on `{` and `{{...}}` escape syntax for literal braces.

---

## Data Model

### Annotation storage

`BaseEvent` gains an optional `note` field:

```typescript
interface BaseEvent {
  id: string
  type: EventType
  timestamp: number
  note?: string   // raw template text, e.g. "{selector} should equal 'Save'"
}
```

`note` stores the user's raw Note box input (with `{field}` tokens unresolved). It is written back to the store when the user leaves the annotation panel. The expanded result is derived at render time via `fieldsOf` + `renderTemplate`.

All event types can carry a `note`. `formatEvents` uses the expanded note as the output line when present, falling back to the default format for events without one — except `element_pick`, which is skipped entirely when `note` is absent.

### New event type: `ElementPickEvent`

```typescript
export interface ElementPickEvent extends BaseEvent {
  type: 'element_pick'
  selector: string
  text: string
  attributes: Record<string, string>   // all HTML attributes on the element
  styles: Record<string, string>        // color, background, visibility, display, font-size
}
```

`CapturedEvent` union gains `| ElementPickEvent`.

`EventType` gains `'element_pick'`.

### Available `{fields}` per event type

All fields are flat strings — no dot notation.

| Event type     | Available fields |
|----------------|-----------------|
| `element_pick` | `selector`, `text`, + all attribute keys (e.g. `href`, `data-testid`), + style keys (`color`, `background`, `visibility`, `display`, `font_size`) |
| `click`        | `selector`, `label`, `x`, `y`, `count` |
| `api`          | `method`, `url`, `status`, `request_body`, `response_body`, `error_details` |
| `keyboard`     | `selector`, `input_type`, `count`, `key` |
| `navigation`   | `url`, `title` |
| `scroll`       | `selector`, `direction`, `delta_x`, `delta_y`, `count` |
| `console`      | `level`, `message` |
| `drag`         | `source_selector`, `target_selector` |

---

## Capture Flow

When the user picks an element in `ElementPicker`:

1. Capture `resolveSelector(el)`, `el.textContent.trim()`, all `el.attributes` as a key-value map, and computed styles for the predefined set (`color`, `background`, `visibility`, `display`, `font-size`). The `font-size` CSS property is stored under the key `font_size`.
2. Write the `ElementPickEvent` to the event store (via `addEvent` in `store.ts`).
3. `Sidebar` responds to the new event — switches mode to `'panel'` with the new event pre-selected.

The existing `onSelect(selector, source)` callback on `ElementPicker` is replaced. `ElementPicker` now calls a single `onPick(event: ElementPickEvent)` callback. `Sidebar` handles writing to the store and opening the panel.

---

## Annotation Expansion

### `fieldsOf(event: CapturedEvent): Record<string, string>`

New function in `engine.ts`. Returns a flat string map of all fields for any event type. For `element_pick`, attributes and styles are merged directly into the top-level map (no namespace prefix). For other event types, returns the fields listed in the table above.

### Note box with `{field}` interpolation

The Note box in `AnnotationPanel` becomes a template. On render, `renderTemplate` substitutes `{field}` tokens using the result of `fieldsOf(selectedEvent)` merged with any extra slot inputs.

Escaping: `{{field}}` renders as the literal string `{field}` in the prompt. The render step applies field substitution first, then unescapes `{{...}}` → `{...}`.

Unresolved fields: lines containing unresolved `{field}` tokens are dropped from the output (existing behaviour, unchanged).

### Field suggestions

When the user types `{` in the Note box:

- A small dropdown appears listing available field names from `fieldsOf(selectedEvent)`.
- Clicking a suggestion inserts `{fieldname}` at the cursor position.
- `Escape` or clicking outside dismisses the dropdown; the `{` remains as typed.

The suggestion list is derived from `fieldsOf` — no hardcoded field lists in the UI.

### PROMPT area

No changes needed. `renderTemplate` already produces the expanded output. With the Note text now containing `{field}` references, the prompt reflects live expansion as the user types.

---

## Event List Rendering

`formatEvents` in `engine.ts` gains a case for `element_pick`. Unlike other event types, `element_pick` events are only included in the formatted output if they have a non-empty annotation (Note). If unannotated, the event is skipped entirely — it produces no line in `interaction_description`.

When annotated, the expanded note text is used as the line. The raw event fields (`selector`, `text`, etc.) do not appear in the output independently; they only appear via `{field}` interpolation in the note.

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/event-capture/types.ts` | Add `ElementPickEvent`, expand `EventType` and `CapturedEvent` union |
| `src/lib/event-capture/store.ts` | Add `updateEvent(id, patch)` to persist `note` back to a stored event |
| `src/lib/prompts/engine.ts` | Add `fieldsOf`, extend `renderTemplate` with `{{}}` unescaping, add `element_pick` case to `formatEvents`, update `resolveSlots` to merge event fields |
| `src/components/sidebar/ElementPicker.svelte` | Replace `onSelect(selector, source)` with `onPick(event: ElementPickEvent)`, capture attributes + styles |
| `src/components/sidebar/Sidebar.svelte` | Handle `onPick`: write event to store, open panel with event pre-selected |
| `src/components/sidebar/AnnotationPanel.svelte` | Add `{` suggestion dropdown to Note box; call `updateEvent` to persist note on change |
