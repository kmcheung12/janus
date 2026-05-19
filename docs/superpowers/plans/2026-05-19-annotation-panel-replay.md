# AnnotationPanel Prompt Line Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a display-line in the AnnotationPanel prompt preview replays the event that generated that line (click/drag animations); template structure lines silently do nothing.

**Architecture:** `PromptBox` gains an `onLineClick` callback prop wired to each `.display-line`. `AnnotationPanel` builds a `Map<formattedLine, CapturedEvent>` inline using the same filtering and formatting logic as `formatEvents`, then passes a handler to `PromptBox` that looks up the clicked line and calls `replay()`. No new files or engine exports.

**Tech Stack:** Svelte 5, TypeScript — no new dependencies.

---

## File Map

| File | Change |
|------|--------|
| `src/components/sidebar/PromptBox.svelte` | Add `onLineClick` prop; wire `onclick` + `.clickable` class on each `.display-line`; add cursor style |
| `src/components/sidebar/AnnotationPanel.svelte` | Import `replay` + `EventType`; add `lineEventMap` derived; add `handleLineClick`; pass `onLineClick` to PromptBox |

---

### Task 1: PromptBox — onLineClick prop

**Files:**
- Modify: `src/components/sidebar/PromptBox.svelte`

No automated tests — component tests don't exist in this project. Verified by build check and manual browser test in Task 2.

- [ ] **Step 1: Add `onLineClick` to the props destructure**

Replace the existing props block (lines 5–10):

```svelte
  let { value, onCopy, rows = 8, highlightLine, onLineClick }: {
    value: string
    onCopy?: () => void
    rows?: number
    highlightLine?: string
    onLineClick?: (line: string) => void
  } = $props()
```

- [ ] **Step 2: Wire `onclick` and `.clickable` class on each `.display-line`**

Replace the existing `.display-line` div (line 40):

```svelte
        <div
          class="display-line"
          class:highlighted={active}
          class:clickable={!!onLineClick}
          onclick={() => onLineClick?.(line)}
          use:scrollIfActive={active}
        >{line}</div>
```

- [ ] **Step 3: Add the `.clickable` cursor style**

In the `<style>` block, after the `.display-line.highlighted` rule, add:

```css
  .display-line.clickable { cursor: pointer; }
  .display-line.clickable:hover { background: #252535; }
```

- [ ] **Step 4: Build to confirm no TypeScript errors**

```
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/PromptBox.svelte
git commit -m "feat: add onLineClick prop to PromptBox display-line mode"
```

---

### Task 2: AnnotationPanel — line-to-event map and replay

**Files:**
- Modify: `src/components/sidebar/AnnotationPanel.svelte`

- [ ] **Step 1: Add `EventType` to the existing types import**

Line 9 currently reads:

```ts
  import type { CapturedEvent } from '../../lib/event-capture/types'
```

Change it to:

```ts
  import type { CapturedEvent, EventType } from '../../lib/event-capture/types'
```

- [ ] **Step 2: Add the `replay` import**

After line 9 (the types import), add:

```ts
  import { replay } from '../../lib/event-replay'
```

- [ ] **Step 3: Add the `lineEventMap` derived and `handleLineClick` function**

After the `prompt` derived block (after line 67), add:

```ts
  let lineEventMap = $derived.by(() => {
    if (!selected) return new Map<string, CapturedEvent>()
    const exclude = selected.exclude ?? []
    const filtered = exclude.length
      ? events.filter(e => !exclude.includes(e.type as EventType))
      : events
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

  function handleLineClick(line: string) {
    let event = lineEventMap.get(line)
    if (!event) {
      const m = line.match(/^.+?:\s*(\d+\..+)$/)
      if (m) event = lineEventMap.get(m[1])
    }
    if (event) replay(event)
  }
```

- [ ] **Step 4: Pass `onLineClick` to PromptBox**

Line 161 currently reads:

```svelte
      <PromptBox value={prompt} onCopy={onDone} rows={8} {highlightLine} />
```

Change it to:

```svelte
      <PromptBox value={prompt} onCopy={onDone} rows={8} {highlightLine} onLineClick={handleLineClick} />
```

- [ ] **Step 5: Build to confirm no TypeScript errors**

```
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 6: Run tests to confirm no regressions**

```
npm run test:run
```

Expected: 128 tests pass.

- [ ] **Step 7: Verify manually in the browser**

1. `npm run dev` (or `npm run dev:firefox`)
2. Load the extension, start recording on any page
3. Click a button on the page — confirm a click event appears in the sidebar
4. Click the click event in the sidebar to open the AnnotationPanel
5. Select a template that includes `{interaction_description}` (e.g. the Bug template)
6. In the prompt preview, click a numbered interaction line (e.g. `"1. Clicked..."`) — confirm a purple contracting circle appears at the click location on the page
7. If the template puts `{interaction_description}` inline (e.g. `"User action: 1. Clicked..."`), clicking that line should also trigger the animation
8. Click a template structure line (e.g. `"Fix the following bug in..."`) — confirm nothing happens
9. Perform a drag, open its AnnotationPanel, click the drag interaction line — confirm blue path trace appears

- [ ] **Step 8: Commit**

```bash
git add src/components/sidebar/AnnotationPanel.svelte
git commit -m "feat: replay events from AnnotationPanel prompt display-line clicks"
```
