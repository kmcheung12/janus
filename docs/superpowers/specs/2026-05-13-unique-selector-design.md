# Unique Element Selector Design

**Date:** 2026-05-13
**Status:** Approved

## Problem

`resolveSelector` in `src/lib/element-selector.ts` returns the first plausible-looking selector without checking whether it uniquely identifies the target element. Selectors are used by an LLM to identify elements and propose code changes, so uniqueness is essential.

Additionally, the current `:contains("text")` fallback is jQuery syntax — not valid CSS — so the LLM cannot use those selectors in real code.

## Goal

`resolveSelector(el)` always returns a valid CSS selector that:
1. Matches exactly one element in the current document
2. Is the element that was passed in
3. Uses only standard CSS syntax

## Design

### `segmentFor(el: Element): string`

A new internal helper that produces the best single-segment selector for one element, using the same priority as the current logic but without `:contains()`:

| Priority | Output example |
|----------|---------------|
| `data-testid` | `[data-testid="save"]` |
| `id` | `#main-nav` |
| `aria-label` | `[aria-label="Close"]` |
| stable classes (up to 2) | `button.submit` |
| tag only | `li` |

"Stable classes" are filtered with the existing `HASHED_CLASS` regex (excludes CSS-module and hashed utility class names).

### `resolveSelector(el: Element): string`

Builds a unique selector by walking up the DOM:

1. Start with `path = [segmentFor(el)]`
2. Join path with ` > ` and test with `document.querySelectorAll`
3. If exactly one result and it is `el` → return the selector
4. Prepend `segmentFor(el.parentElement)` and repeat from step 2
5. Stop walking at `<html>`
6. If still not unique after reaching root (no stable attributes anywhere in ancestor chain): find `el`'s 1-based index among its parent's children and replace `el`'s segment with `tag:nth-child(n)` — the accumulated parent path provides the anchor — then return

### What changes

- `resolveSelector` is refactored into `segmentFor` + `resolveSelector`
- `:contains()` fallback is removed
- No changes to callers (`click.ts`, `keyboard.ts`, `scroll.ts`)
- No changes to event types or collapse logic

### Examples

| Scenario | Result |
|----------|--------|
| Element has `data-testid` | `[data-testid="submit"]` |
| Element has a unique `id` | `#user-menu` |
| Element needs ancestor context | `nav.sidebar > ul > li.active > a` |
| No stable attributes anywhere | `ul.menu > li:nth-child(3)` |

## Constraints

- Runs in browser context (page content script) — `document.querySelectorAll` is available
- Must remain synchronous
- No new dependencies
