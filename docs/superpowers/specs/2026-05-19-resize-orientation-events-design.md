# Resize & Orientation Event Capture — Design Spec

## Goal

Capture `window resize` and `orientationchange` events during recording sessions as a new first-class `resize` event type, toggleable via capture config.

## Data Model

New `ResizeEvent` in `src/lib/event-capture/types.ts`:

```ts
export interface ResizeEvent extends BaseEvent {
  type: 'resize'
  width: number
  height: number
  orientation?: string  // e.g. "landscape-primary", "portrait-primary" — omitted on desktop
}
```

- `EventType` union gains `'resize'`
- `CapturedEvent` union gains `ResizeEvent`

## Interceptor

New file: `src/lib/event-capture/interceptors/resize.ts`

- Listens to `window` `resize` event, debounced 500ms via `setTimeout`/`clearTimeout`
- Listens to `window` `orientationchange` event (fires immediately, no debounce)
- Both emit a `ResizeEvent` with `window.innerWidth`, `window.innerHeight`, and `screen.orientation?.type` (optional chaining — `undefined` when not supported)
- Returns a cleanup function that removes both listeners and clears any pending debounce timer

## Capture Config

`src/lib/capture-config.ts`:

- Add `resize: boolean` to `CaptureConfig` interface
- Add label `'Resize & orientation'` to `CAPTURE_CONFIG_LABELS`
- Default: `true`

## Wiring (content.ts)

- Import `attachResizeInterceptor` from the new interceptor
- Call it in the `cleanups` array alongside the existing interceptors

## Prompt Engine (engine.ts)

- `fieldsOf`: add `resize` case returning `{ width: String(e.width), height: String(e.height), ...(e.orientation ? { orientation: e.orientation } : {}) }`
- `defaultNoteTemplate`: add `resize` case returning `'Viewport resized to {width}×{height}'`

## Event Sidebar (EventSidebar.svelte)

- Add `resize` to the badge label map
- Display label: `'Viewport resized to {width}×{height}'`
- Badge styled with the existing neutral class (same as `session`, `navigation`, etc.)

## File Map

| File | Change |
|------|--------|
| `src/lib/event-capture/types.ts` | Add `ResizeEvent`, extend `EventType` and `CapturedEvent` |
| `src/lib/event-capture/interceptors/resize.ts` | New file — interceptor |
| `src/lib/capture-config.ts` | Add `resize` field |
| `src/entrypoints/content.ts` | Wire up interceptor |
| `src/lib/prompts/engine.ts` | Add `resize` to `fieldsOf` and `defaultNoteTemplate` |
| `src/components/sidebar/EventSidebar.svelte` | Add badge and label for `resize` |
