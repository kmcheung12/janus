# Janus MVP — Design Spec

**Date:** 2026-05-11
**Status:** Implemented — post-testing amendments in §10

---

## 1. Product Vision

Janus is a browser extension that captures user interactions, lets you annotate them with human judgment, and generates LLM-ready prompts via template substitution. The output is a precise directive an AI coding tool (Cursor, Claude, etc.) can act on immediately.

The core insight: in the age of AI-assisted development, the bottleneck is not writing code — it is knowing *what* to change and *why*. Janus captures the human judgment (the annotation) and wraps it in the technical context needed to close that gap fast.

**What Janus is not:** a session replay tool, a team analytics platform, or a bug tracker. Those are Phase 2.

---

## 2. MVP Scope

**In:**
- Browser extension (Chrome + Firefox)
- Event capture model (no rrweb)
- Annotation mode with element picker and event sidebar
- Tag-as-template prompt generation
- Editable templates with a template management page
- Output: copy to clipboard

**Out (Phase 2):**
- Session persistence and sharing
- SaaS backend
- Before/after session comparison
- Flowchart / session map
- Session organization and search
- Mobile / JS library for site owners
- "Close the loop" tracking

---

## 3. Architecture

Single browser extension. No backend. No network calls. All data lives in extension memory during the active tab session.

```
[Target Page]
     |
     | (injected content script)
     v
[Event Capture Layer]  ──→  [Event Store (in-memory, current tab)]
                                        |
                              [Annotation Mode UI]
                                   /         \
                          [Element Picker]  [Event Sidebar]
                                   \         /
                                 [Annotation Panel]
                                        |
                              [Template Engine]
                                        |
                              [Generated Prompt → Clipboard]

[Extension Page: Template Manager]
     |
     └──→ [Template Store (extension storage)]
```

**Tech stack:** WXT + Svelte 5, Chrome Manifest V3 / Firefox compatible.

---

## 4. Event Capture

The content script intercepts and records the following event types:

| Event Type       | What is captured                                              |
|------------------|---------------------------------------------------------------|
| Page navigation  | URL, timestamp                                                |
| Click            | Target element selector, timestamp                            |
| Keyboard input   | Target element selector, input type (text/password/etc.), timestamp — **not** the keystrokes themselves |
| API call         | Method, URL, request body (truncated), response status, response body (truncated), timing, error if any |

**Event store:** A rolling window of the last 50 collapsed events across the entire tab session. Nothing is cleared on navigation — page navigation events are captured as entries in the store like any other event, so the full journey remains visible in the sidebar.

**Collapsing:** Consecutive events of the same type targeting the same selector are collapsed into a single entry with a count. Example: `Button clicked ×4 — [Buy Now]`. API calls collapse by endpoint; different status codes on the same endpoint are NOT collapsed (a 200 then a 422 are distinct). Collapsing is applied before the 50-event cap — 50 is the count of collapsed entries, not raw events.

**`{element_selector}` resolution:** Most meaningful available identifier, in priority order: `data-testid` → `id` → `aria-label` → visible text content → tag + class. The user can override in the annotation text input.

---

## 5. Annotation Mode

### Activation
Keyboard shortcut (configurable) or action button in the extension popup. Injects the annotation UI overlay onto the target page.

### Element Picker
Activates inspect-like hover mode on the target page. Hovering highlights the element under cursor. Clicking selects it and opens the Annotation Panel.

### Event Sidebar
A sidebar panel listing the last 50 collapsed events for the current tab session, in reverse chronological order. Page navigations appear as entries in the list. Clicking an event selects it and opens the Annotation Panel.

**One and only one selection:** the user selects either a DOM element or an event — not both. This forces clarity of intent: is this annotation about the UI or about what happened in the background?

### Annotation Panel
Opens after a selection. Contains:

1. **Tag selector** — pick a tag (Bug, UX, or any user-defined tag). Loads the corresponding template.
2. **User text input** — a single text field for the user's judgment: what is wrong, what should change, what is the intent.
3. **Auto-filled slot preview** — shows which template slots will be resolved automatically from captured context, and which will be left blank if unavailable (e.g., `{method}` when a DOM element is selected).
4. **Generate Prompt button** — resolves all slots, renders the prompt, copies to clipboard, dismisses the overlay.

**Unresolved slots:** if a slot has no data (e.g., `{status}` when the selected item is a DOM element, not an API call), the line is omitted from the output entirely. A raw `{slot}` never appears in the generated prompt.

---

## 6. Template System

### Concept
A tag is a named prompt template with named slots. Slots are either auto-filled from captured context or user-provided.

### Built-in Templates (editable)

**Bug:**
```
Fix the following bug in {element_selector}:

User action: {interaction_description}
API call: {method} {url} → {status}
Error: {error_details}
User note: {user_text}

Current page: {url}
```

**UX:**
```
Improve the UX of {element_selector} on {url}.

User note: {user_text}
```

### Template Schema

Each template has:
- `name` — display name (e.g., "Bug")
- `description` — one-line description shown in the tag selector
- `body` — the prompt string with `{slot}` placeholders
- `context_scope` — `element` | `event` | `both` — what selection type this template applies to (controls which auto-filled slots are available)

### Auto-filled Slots

| Slot                       | Source                                         |
|----------------------------|------------------------------------------------|
| `{url}`                    | Current page URL                               |
| `{element_selector}`       | Resolved selector of picked element            |
| `{interaction_description}`| Last N events formatted as numbered steps      |
| `{method}`                 | API call method (if event selected)            |
| `{status}`                 | API call response status (if event selected)   |
| `{error_details}`          | API error message / response body on error     |

### User-provided Slots

| Slot           | Source                      |
|----------------|-----------------------------|
| `{user_text}`  | Text input in Annotation Panel |
| Any custom slot not in the auto-fill table | Rendered as a text input field in the Annotation Panel |

### Template Manager Page
A dedicated extension page (`/templates`) accessible from the extension popup.

- Lists all templates (built-in + user-defined)
- Each template is editable inline: name, description, body
- Built-in templates can be edited but not deleted (reset to default option)
- User-defined templates can be created and deleted
- Slot reference panel: lists all available auto-fill slot names with descriptions, click to insert into template body
- Validation: warns if a slot in the body is not in the auto-fill table and has no corresponding user input field (i.e., will always be blank)

---

## 7. Error Handling

- If event capture fails silently (e.g., API call not intercepted due to CSP), the sidebar shows what was captured with no error state — partial context is better than nothing.
- If clipboard write fails, fall back to showing the generated prompt in a selectable text area within the annotation panel.
- If no events are captured yet when annotation mode opens, the event sidebar shows an empty state: "No interactions captured yet. Use the element picker to annotate the current page."

---

## 8. Privacy

- Keyboard inputs: event type and target element are captured, **keystrokes are not**.
- API request/response bodies are truncated to 500 characters to avoid capturing large payloads or sensitive data.
- Password fields (`input[type=password]`) are never captured.
- All data lives in extension memory for the current tab session only. Nothing is persisted to disk or sent over the network.

---

## 10. Post-Implementation Findings

Discovered during real testing in Firefox. These are decisions and constraints not visible at design time.

### 10.1 Browser API: always use `browser.*`, never `chrome.*`

WXT provides a `browser` global that is always Promise-based on both Chrome and Firefox. The `chrome.*` namespace is not Promise-based in Firefox MV2 — `await chrome.tabs.query()` returns `undefined` instead of an array, causing a `Symbol.iterator` TypeError. All API calls must use `browser.*`.

### 10.2 Manifest permissions must be declared explicitly

WXT does not auto-detect which browser APIs the extension uses. The following permissions must be declared in `wxt.config.ts`:

```ts
manifest: {
  permissions: ['storage', 'tabs'],
}
```

- `storage` — required for `browser.storage.local` in both content scripts (AnnotationPanel loads templates) and extension pages (Template Manager).
- `tabs` — required for `browser.tabs.query` and `browser.tabs.sendMessage` in the popup.

### 10.3 Keyboard shortcut: use `e.code`, not `e.key`

The Alt modifier changes `e.key` on Firefox/Mac (e.g., Alt+Shift+J produces `e.key = 'Ô'` instead of `'J'`). Use `e.code === 'KeyJ'` which is layout-independent and unaffected by modifiers.

### 10.4 Element picker highlight: `position: fixed`, not `position: absolute`

The highlight div is rendered inside the overlay, which is `position: fixed`. Using `position: absolute` positions the highlight relative to the overlay panel (i.e., inside the sidebar). The correct positioning is `position: fixed`, using `getBoundingClientRect()` values directly without adding scroll offsets.

### 10.5 Templates page requires an explicit `main.ts` mount

The templates page (`/templates.html`) must have a `main.ts` that calls `mount(App, { target: ... })`. Svelte 5 components do not self-mount — loading `App.svelte` directly as a module script renders nothing.

### 10.6 Extension sidebar interactions must not be captured as page events

The click and keyboard interceptors run at the document level and capture all interactions, including clicks on the sidebar toolbar, typing in the note textarea, clicking Generate Prompt, etc. These must be filtered out:

```ts
if (target.closest('#janus-root')) return
```

Applied in both `click.ts` and `keyboard.ts` interceptors.

### 10.7 Element picker can select extension sidebar elements

This is intentional — Janus is used to annotate its own UI during development. When an element inside `#janus-root` is selected, the Annotation Panel displays an `extension` source badge alongside the selector chip (vs. `page` for elements from the host site). The event interceptors still exclude sidebar interactions from the event log (§10.6) regardless of which element is selected.

### 10.8 Overlay event reactivity requires subscription inside the component

Passing events as a prop from `content.ts` via `mount()` is not reactive in Svelte 5 — reassigning a plain JS variable does not trigger re-renders. The `Overlay` component subscribes to the event store directly using `$state` + `onMount`, and the store's `subscribe` unsubscribe function is returned from `onMount` for automatic cleanup.

---

## 9. Success Criteria

- A user can activate annotation mode, select an element or event, tag it, and have a usable LLM prompt on their clipboard in under 30 seconds.
- Generated prompts are specific enough that an AI coding tool can act on them without the user needing to add context manually.
- Template editing is self-explanatory — a user can create a new tag without documentation.
