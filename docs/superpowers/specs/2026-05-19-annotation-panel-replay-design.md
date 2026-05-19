# AnnotationPanel Prompt Line Replay — Design Spec

**Date:** 2026-05-19
**Status:** Approved

---

## 1. Overview

When the user clicks a `.display-line` in the PromptBox prompt preview inside `AnnotationPanel`, replay the event that generated that line (if any). Template structure lines (e.g. "Fix the following bug in...") silently do nothing.

---

## 2. Scope

**In:**
- Display-line clicks in the AnnotationPanel prompt preview trigger event replay
- Click and drag events animate (via existing `replay()` infrastructure)
- Template structure lines are silent no-ops

**Out:**
- No changes to EventSidebar
- No new exports from `engine.ts`
- No new files

---

## 3. Line → Event Mapping

The prompt's `{interaction_description}` slot is produced by `formatEvents(events)`, which outputs numbered lines:

```
1. Clicked button
2. Typed in input
3. POST /api/submit → 422
```

These lines appear verbatim in the rendered prompt — either on their own line or after an inline prefix (e.g. `"User action: 1. Clicked button"` when the template puts `{interaction_description}` after other text on the same line).

The map is built inline in `AnnotationPanel` using the same logic as `formatEvents` — iterating `events`, skipping excluded and no-template events, formatting each line, storing `line → event`. All helpers needed (`fieldsOf`, `expandFields`, `defaultNoteTemplate`) are already imported by `AnnotationPanel`.

---

## 4. Lookup Strategy

When a display-line is clicked:

1. **Exact match** — `map.get(line)` covers lines on their own row
2. **Prefix-stripped match** — if exact misses, try `line.match(/^.+?:\s*(\d+\..+)$/)` and look up the captured group. This handles `"User action: 1. Clicked button"` → looks up `"1. Clicked button"`.

The prefix pattern requires the captured portion to start with `\d+\.` (a numbered item), so template lines like `"API call: POST /api → 422"` do not false-positive (POST doesn't start with digits).

---

## 5. Template Exclude Filter

`resolveSlots` applies `selected.exclude` when building `interaction_description`:

```ts
formatEvents(ctx.exclude?.length ? ctx.events.filter(e => !ctx.exclude!.includes(e.type)) : ctx.events)
```

The inline map must apply the same filter so line numbers match. `selected.exclude` is available in `AnnotationPanel` as `selected?.exclude`.

---

## 6. Changes

### `src/components/sidebar/PromptBox.svelte`

Add `onLineClick?: (line: string) => void` to props. In display-line mode, each `.display-line` calls `onLineClick?.(line)` on click. Add `.display-line.clickable { cursor: pointer; }` — applied when `onLineClick` is defined.

### `src/components/sidebar/AnnotationPanel.svelte`

Add `import { replay } from '../../lib/event-replay'`.

Add a `$derived` that builds the map whenever `events` or `selected` changes:

```ts
let lineEventMap = $derived.by(() => {
  if (!selected) return new Map<string, CapturedEvent>()
  const exclude = selected.exclude ?? []
  const filtered = exclude.length ? events.filter(e => !exclude.includes(e.type as EventType)) : events
  const map = new Map<string, CapturedEvent>()
  let i = 0
  for (const e of filtered) {
    if (e.excluded) continue
    const template = e.note ?? defaultNoteTemplate(e)
    if (!template) continue
    i++
    map.set(`${i}. ${expandFields(template, fieldsOf(e))}`, e)
  }
  return map
})
```

Add a handler:

```ts
function handleLineClick(line: string) {
  let event = lineEventMap.get(line)
  if (!event) {
    const m = line.match(/^.+?:\s*(\d+\..+)$/)
    if (m) event = lineEventMap.get(m[1])
  }
  if (event) replay(event)
}
```

Pass to PromptBox:

```svelte
<PromptBox value={prompt} onCopy={onDone} rows={8} {highlightLine} onLineClick={handleLineClick} />
```

`EventType` is not yet imported in `AnnotationPanel` — add it to the existing types import.

---

## 7. Files Changed

| File | Change |
|------|--------|
| `src/components/sidebar/PromptBox.svelte` | Add `onLineClick` prop, wire onclick on `.display-line`, add `.clickable` cursor style |
| `src/components/sidebar/AnnotationPanel.svelte` | Import `replay` + `EventType`, add `lineEventMap` derived, add `handleLineClick`, pass `onLineClick` to PromptBox |
