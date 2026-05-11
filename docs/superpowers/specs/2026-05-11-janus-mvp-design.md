# Janus MVP — Design Spec

**Date:** 2026-05-11
**Status:** Approved for implementation planning

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

## 9. Success Criteria

- A user can activate annotation mode, select an element or event, tag it, and have a usable LLM prompt on their clipboard in under 30 seconds.
- Generated prompts are specific enough that an AI coding tool can act on them without the user needing to add context manually.
- Template editing is self-explanatory — a user can create a new tag without documentation.
