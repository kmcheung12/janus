# Sidebar Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the user to drag the left edge of the Janus sidebar to resize its width.

**Architecture:** A thin drag handle `<div>` sits on the left edge of `.janus-sidebar`. On `pointerdown` the handle captures the pointer and tracks `pointermove` on the window to recompute width as `window.innerWidth - e.clientX`, clamped to [200, 600]px. Width is ephemeral `$state` — resets to 320px default on unmount.

**Tech Stack:** Svelte 5 runes, CSS custom property for width, Pointer Events API.

---

### Task 1: Add drag-to-resize to the sidebar

**Files:**
- Modify: `src/components/sidebar/Sidebar.svelte`

This is pure UI interaction — no unit-testable logic. Verify manually after implementing.

- [ ] **Step 1: Add `width` state and pointer handlers to the script block**

In `src/components/sidebar/Sidebar.svelte`, add after the existing `$state` declarations (after line `let selectedEvent = $state...`):

```typescript
let width = $state(320)
let dragging = $state(false)

function onResizePointerDown(e: PointerEvent) {
  (e.target as HTMLElement).setPointerCapture(e.pointerId)
  dragging = true
}

function onResizePointerMove(e: PointerEvent) {
  if (!dragging) return
  width = Math.min(600, Math.max(200, window.innerWidth - e.clientX))
}

function onResizePointerUp(e: PointerEvent) {
  dragging = false
}
```

- [ ] **Step 2: Add the resize handle to the template**

Inside the `<div class="janus-sidebar">` opening tag, add `style="width: {width}px"`. Then add the handle as the first child of `.janus-sidebar`, before `.janus-toolbar`:

```svelte
<div class="janus-sidebar" style="width: {width}px">
  <div
    class="janus-resize-handle"
    class:dragging
    role="separator"
    aria-orientation="vertical"
    onpointerdown={onResizePointerDown}
    onpointermove={onResizePointerMove}
    onpointerup={onResizePointerUp}
  ></div>
  <div class="janus-toolbar">
```

- [ ] **Step 3: Add CSS for the resize handle**

Remove the hardcoded `width: 320px` from `.janus-sidebar` (the inline style binding now controls it). Add to the `<style>` block:

```css
.janus-resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  width: 5px;
  height: 100%;
  cursor: ew-resize;
  z-index: 1;
}
.janus-resize-handle:hover,
.janus-resize-handle.dragging {
  background: var(--janus-mauve);
  opacity: 0.5;
}
```

- [ ] **Step 4: Manual verification**

Build and load the extension, open the sidebar on any page. Drag the left edge:
- Width changes fluidly while dragging
- Stops at 200px (min) and 600px (max)
- Handle highlights on hover and while dragging
- Releasing the mouse stops the drag even if pointer leaves the sidebar
- Width resets to 320px when sidebar is closed and reopened

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/Sidebar.svelte
git commit -m "feat: drag-to-resize sidebar width"
```
