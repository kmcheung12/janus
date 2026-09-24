# Janus WebMCP Tools and Browser Command Bridge

Date: 2026-09-24  
Author: Codex, based on the Janus design discussion and review  
Implementation owner: Unassigned  
Status: Draft for discussion  
Revision: 4 — adds closed contracts and schemas, fixed v1 limits, stable tool naming, UI states and the integration harness; retains revision 3's native API and fixture requirements  
Scope: Product requirements and proposed architecture; no implementation completed

## 1. Purpose

Enable a CLI agent connected to Janus MCP to discover and invoke structured actions in a running browser session.

Janus should support websites that already expose WebMCP tools and websites for which Janus generates tool definitions and execution handlers. Both should use the same browser command bridge and return results to the calling CLI session.

The intended benefit is to let the agent choose an action by its name, description and input schema, without repeatedly traversing the whole DOM to work out how to perform it.

## 2. Requirements understood from the discussion

The requested features are:

1. From the extension, generate a WebMCP tool declaration for a website that does not support WebMCP.
2. For a website that supports WebMCP, discover its declarations and proxy its tools through Janus MCP so a CLI session can invoke the appropriate function in the webpage.
3. Combine generation and proxying so a website without WebMCP can expose generated actions to the CLI through Janus MCP.

The discussion also identified the need for a bidirectional command-and-response path between Janus MCP and the browser extension.

The design direction following review is:

- Build an authenticated browser command bridge independent of recording and native WebMCP availability.
- Publish individual page tools with their schemas and MCP tool-list change notifications in Milestone 1.5.
- Use the connected coding agent's model to complete tool drafts; Janus does not require a separate model provider or API key.
- Deliver form-based generation and proxying in Milestone 2. Demonstration authoring has its own capture milestone.
- Support bounded DOM and network-response extraction, with explicit limits on attribution and capture completeness.
- Preserve invocation provenance in journeys and enforce a bounded generated-tool execution vocabulary.

These are the design decisions for this draft. Sections 17–20 and the linked contract artifacts specify the v1 implementation baseline; browser support remains subject to the release gates in §13. The artifacts are specification files, not an implemented runtime.

The headline success criterion for the native path is behavioral: a coding-agent CLI connected only to Janus MCP can drive a real third-party WebMCP site through a multi-step task without a DOM snapshot. §13 names the reference fixture and its pass conditions.

### Non-goals for the first release

- Discovering or invoking arbitrary private JavaScript functions inside an application.
- General remote JavaScript execution or caller-supplied automation scripts.
- Automatic coverage of every website, custom control, or workflow.
- AI-assisted generation without an active connected coding-agent session.
- Cross-origin iframe execution, navigation-spanning results, or background/headless browser provisioning.
- Publishing every open tab's tools automatically or replacing the existing journey recorder.
- Guaranteeing rollback or exactly-once effects after an interrupted invocation.

## 3. Important distinctions

### Declaration and implementation

A tool declaration describes a capability: its name, description and input schema. Making that capability callable also requires an implementation.

Native WebMCP tools already have an execution mechanism supplied by the website/browser. For generated tools, Janus must provide an execution handler and a way to recognize completion and extract a result.

Generating JSON metadata alone does not make an arbitrary website executable.

### Native tools and generated tools

A native tool can invoke the application's own exposed logic. A generated handler may use targeted DOM operations, a demonstrated workflow, or a deliberately implemented site adapter.

Generated tools avoid repeated DOM exploration by the CLI agent; they do not guarantee that execution itself never touches the DOM. Coverage and reliability depend on the controls and workflows Janus supports.

A Janus execution recipe is an internal format, not part of the WebMCP standard. An export advertised as WebMCP must include a registration wrapper and its required execution support.

### Browser dependency and access to page functions

The generated-tool runtime and MCP bridge must not require Chrome's native WebMCP implementation or its testing flag. They use extension messaging, permitted script execution and supported page operations. Chrome and Firefox build targets already exist in the repository; they do not establish that the new execution path works on both browsers.

| Execution path | Needs native WebMCP? | Remaining dependency |
| --- | --- | --- |
| Janus-generated recipe | No | A tested extension browser, host permissions and supported page controls |
| Packaged adapter calling an exposed page function | No | Permitted page-context execution and an explicitly accessible function |
| Website-native WebMCP tool | Yes, or a separately supported shim | A compatible API, successful website registration and applicable browser permissions |

An extension can arrange page-context execution where the browser allows it, but that does not expose arbitrary functions hidden inside closures, modules or framework state. Such an action needs a website-exposed handler or a deliberately implemented adapter. A shim must actually receive the website's registrations; installing one after the fact does not recover missing native callbacks.

### Execution world

`ModelContext` is exposed on `Document`, so the isolated content-script world reaches `document.modelContext` directly. Both halves of the API — `registerTool()` for publishing a handler and `getTools()` / `executeTool()` for consuming one — are available from the same world.

Consequences:

- Native discovery and invocation (Feature B) require no page-context script.
- Registering a Janus-generated handler through WebMCP (Feature C) also requires no page-context script. The registered `execute` callback can be the recipe interpreter that already runs in the content script, so no callback crosses an untrusted boundary.
- Page-context execution remains necessary only for the packaged-adapter path that calls a deliberately exposed page function, and for any shim that must intercept a website's own registrations.

Because registration and discovery are members of one interface, they share availability: a browser cannot supply one without the other. They therefore need a single compatibility row rather than separate ones.

Untested: whether a tool registered from the extension's isolated world is attributed to the page origin, to the extension, or is visible at all to `getTools({ fromOrigins })` callers including the page's own agent. This determines whether Feature C's WebMCP export behaves the same as Janus registering on a site's behalf, and is in scope for the §13 native spike.

Browser differences in execution worlds, permissions, lifecycle and page integration require real-browser tests. The architectural goal is independence from Chrome-specific WebMCP, not a claim that every browser or page is already supported. [WebExtensions execution worlds](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/ExecutionWorld)

### CLI agent and the Janus CLI executable

The primary consumer is a coding-agent CLI already connected to Janus as an MCP client. It invokes MCP tools over Janus's existing MCP endpoint.

The existing Janus CLI executable captures terminal output. Adding commands such as browser-tool listing or invocation to that executable would be a separate convenience feature.

### WebSocket transport and command protocol

WebSocket already supports communication in both directions. Janus needs to extend its current application protocol with commands, correlated results and browser routing. A second socket is not inherently required.

## 4. Current repository baseline

The current implementation provides useful capture and transport components, but does not execute webpage actions requested by an MCP client.

| Area | Current behavior | Implication |
| --- | --- | --- |
| Extension WebSocket client | Sends journey data; connection/reconnection is tied to an active journey; tracks one active journey | Add incoming commands and separate control connectivity from recording |
| WebSocket server | Accepts journey and file messages | Add authenticated browser connection registration and request/response routing |
| MCP server | Exposes static journey-query tools | Add page discovery, tool discovery and invocation |
| HTTP session management | Retains transports but no application-level registry of MCP Server instances | Retain server/transport pairs and publish registry changes to authorized sessions |
| Content scripts | Capture interactions; current entrypoints skip iframes | Start with explicit top-level document support; expand frame support deliberately. Skipping iframes for capture does not exclude descendant-frame tools from `getTools()`, which must be filtered actively |
| Event replay | Draws click and drag overlays | Implement actual action execution separately |
| Keyboard capture | Omits input values in its default mode | Existing logs cannot directly reconstruct parameterized input workflows |
| Event storage | Collapses events and retains the latest 50 | Introduce a dedicated authoring capture format |
| Network capture | Captures fetch/XHR bodies truncated to 500 characters; API events can be collapsed | Add bounded extraction and request matching; current history is evidence, not a complete result store |
| Event provenance | No actor or invocation identity on captured events | Attribute known agent effects and preserve unknown attribution |
| Authentication | No explicit control authentication; listeners omit a bind host | Pair executors, authenticate MCP callers, and bind both listeners to loopback |
| Tool generation | No draft/definition authoring protocol | Let the connected agent complete and submit constrained drafts |
| Browser integration testing | Vitest/jsdom extension tests and Node HTTP tests exist, but no extension-plus-daemon runner | Build the Playwright/daemon/MCP-client harness in Milestone 1, before claiming round-trip acceptance |

In `ws-client.ts`, initial connection is triggered by `startJourney()`, and reconnection is conditional on `active`. A fresh session with recording disabled cannot discover tools through today's implementation. The recording-disabled acceptance case deliberately requires changing that lifecycle.

Relevant files:

- `src/lib/mcp/ws-client.ts`
- `src/entrypoints/background.ts`
- `src/entrypoints/content.ts`
- `src/entrypoints/network.content.ts`
- `src/lib/element-selector.ts`
- `src/lib/event-capture/interceptors/keyboard.ts`
- `src/lib/event-capture/store.ts`
- `src/lib/event-replay/replayers/click.ts`
- `packages/mcp-server/src/ws-server.ts`
- `packages/mcp-server/src/mcp-tools.ts`
- `packages/mcp-server/src/http-server.ts`

Source inspection is the basis for these findings. A live WebMCP integration has not been tested.

## 5. User-facing capabilities

### Feature A: Generate tools for a website

The user starts tool creation from the extension. Authoring is delivered in two distinct stages:

- Milestone 2: scan a supported form and derive a draft from its controls, labels, types, constraints and options; the connected agent supplies semantics and a constrained schema.
- Milestone 3: demonstrate a bounded workflow using a dedicated authoring recorder, then choose parameters and result extraction. This is not part of Milestone 2.

The authoring flow should allow the user to:

1. Select the relevant form or demonstrate a bounded workflow.
2. Review the tool name, description and input schema.
3. Review or select parameters, applicability conditions and result extraction.
4. Test the tool with supplied arguments.
5. Save it for local use or export a WebMCP registration package.

A generated tool must retain enough implementation information to execute, wait for completion and report a result. Passwords and session credentials must not become saved example values or exported constants.

Deterministic inspection supplies structural facts. The connected coding agent's existing model produces the proposed name, description and schema, referencing bindings from the draft. Janus validates the submission and presents it for local enabling. No additional model provider or key is part of this design.

The extension places a draft in a pending queue and displays its ID. The user asks an active CLI agent to author that draft; the agent retrieves it through MCP and submits a proposed definition. The initial design does not assume a server notification can wake an idle agent or force it to perform model work. An unprocessed draft stays pending.

Include permitted examples and available network evidence in the draft, marking truncation and uncertain correlation. Supply only selected, redacted evidence. A form scan must not silently submit a form just to collect network data; an explicit test can collect fresh evidence.

### Feature B: Proxy native WebMCP tools

The extension discovers tools exposed by an enabled page. Janus publishes their metadata to the MCP client.

The CLI agent selects a page and tool, provides arguments, and receives the result or a meaningful error. The tool runs in the existing browser session, preserving the page's current login and application state.

Discovery must distinguish an unavailable browser API from a supported page with no registered tools.

### Feature C: Generate and proxy tools

The user enables a saved generated definition on a matching page. Janus creates a live instance in the same registry used for native tools.

The CLI follows the same discovery and invocation flow for either source. Tool metadata identifies whether a tool is native or generated.

Where supported, Janus may also register generated handlers through WebMCP. Where WebMCP is unavailable, Janus's own runtime can still expose those handlers through Janus MCP. This does not imply that other browser agents can discover them as native WebMCP tools.

## 6. Proposed architecture

```text
CLI agent
    ↕ MCP
Janus MCP server
    ↕ existing WebSocket, extended with commands and results
Extension background
    ↕ extension messaging
Selected page/document
    ├── native WebMCP adapter
    └── generated-tool runtime
```

### Janus MCP server

- Maintain available browser connections, enabled pages and live tool metadata.
- Retain `{ server, transport, principal }` per MCP session; subscribe each session to its authorized tool registry and dispose subscriptions on closure.
- Advertise `tools.listChanged`, publish typed page tools, and notify affected sessions when their visible tool set changes.
- Resolve each call to one specific browser document and tool revision.
- Validate arguments and dispatch execution requests.
- Correlate results with the originating MCP request.
- Expire pending calls and handle disconnected targets.

### Extension background

- Own the authenticated daemon connection independently of journey recording.
- Track enabled tabs and their active documents.
- Route requests to the correct document.
- Forward results and capability changes.
- Enforce page enabling and definition activation independently of the model's proposals.
- Track invocation identities and explicit generated-action provenance.
- Restore discovery after connection loss or service-worker restart.

### Page integration

The native adapter discovers and invokes browser-exposed tools from the isolated content-script world through `document.modelContext`. Generated handlers registered through WebMCP use the same world and the same interface. Page-context execution is reserved for packaged adapters calling deliberately exposed page functions and for shims that must intercept a website's own registrations; it is not required for native discovery, native invocation or generated registration.

The generated runtime interprets a bounded execution recipe, resolves targets, supplies input, waits for completion and extracts results.

Use the same transport for either adapter. The generated runtime must remain usable when native discovery reports WebMCP unavailable. Any bridge into page execution exposes only fixed operations and treats page messages/results as untrusted data; daemon credentials stay in the extension background.

Keep executable callbacks and browser object references in the browser. Only serializable metadata, identifiers, arguments and results cross the WebSocket.

## 7. Browser and tool identity

A domain or active tab is not a sufficient execution target: the user may have several tabs or browser instances on the same site.

Proposed identities:

| Identity | Purpose |
| --- | --- |
| Browser session ID | Distinguish extension/browser sessions |
| Connection ID | Distinguish current authenticated socket connections |
| Page ID | Opaque external handle for a specific live document |
| Page label | User-defined display name, such as Work mail or Test checkout; not a routing identifier |
| Tab/frame/document identity | Extension-owned routing information behind the page handle |
| Tool ID | Stable logical tool identity within one enabled document; revision is separate |
| Request ID | Correlate one invocation with one terminal response |

A new document or explicit re-enablement gets a new random 128-bit page handle. Tool removal invalidates the live entry; replacement advances its revision. Preserve logical tool IDs, frozen name slugs and revision high-water marks for the lifetime of that page handle, including removal/reappearance. A page's native name identifies a native logical tool; a saved definition ID identifies a generated logical tool. Origin and routing metadata come from extension-observed state, not arbitrary webpage messages.

For the first milestone, expose only explicitly enabled top-level documents. Reserve frame identity in the model without claiming cross-origin iframe support.

`getTools()` returns tools registered by the document **and its descendants**. Restricting the first milestone to top-level documents is therefore an active filtering requirement, not an abstention: descendant-frame tools arrive by default and must be excluded before publication, using origin/frame attribution such as `getTools({ fromOrigins })` where the resolved API provides it. A tool that cannot be confidently attributed to the enabled top-level document is not published.

SPA route changes must trigger a refresh of applicability and available tools. Native registrations can change without navigation.

The user can name an enabled page in the extension. Names appear in discovery and tool titles/descriptions so similar tabs are distinguishable. Names need not be unique and must never substitute for document identity or carry authority across navigation.

## 8. Proposed MCP interface

### Primary interface: typed page tools, delivered in Milestone 1.5

Publish each enabled action as a separate MCP tool with its own fully specified business input schema. Keep the published name stable across revision changes; carry the expected revision as a required argument. This avoids name churn while rejecting calls constructed against stale schemas.

The exact v1 naming algorithm is:

1. `pageId` is 32 lowercase hexadecimal characters generated from 128 random bits. The namespace is its first 12 characters.
2. At the logical tool's first publication, normalize its name with Unicode NFKD, remove U+0300–U+036F combining marks, lowercase ASCII A–Z, replace every maximal run outside `[a-z0-9]` with `_`, and trim leading/trailing `_`. Take the first 20 characters and trim trailing `_` again. Use `tool` if empty. Freeze this slug for that logical tool/page lifetime; changing a title or page label never changes it.
3. Encode `["janus.webtool.v1", browserSessionId, pageId, sourceKind, toolId]` using `JSON.stringify` with that exact array order, then UTF-8. `sourceKind` is `native` or `generated`. Compute SHA-256 and use its first 20 lowercase hexadecimal characters as the name suffix. Store the full digest and tuple for collision checks. Do not include revision, labels or descriptions.
4. Publish `web__<12-character namespace>__<slug>__<20-character suffix>`. Maximum length: 61 ASCII characters. Tool IDs and page handles are not reused for different logical identities.
5. If an existing name maps to a different identity tuple, reject the new publication with `NAME_COLLISION`; never overwrite or add an order-dependent numeric suffix. Notify the extension.

Each published input schema is a closed object with required `revision` and `input` properties. `revision` is an integer with `enum: [currentToolRevision]`; `input` contains the actual business schema, not an opaque record. The outer object has `additionalProperties: false`. For example, a generated search action accepts `{ "revision": 3, "input": { "query": "headphones" } }`, with `input.query` explicitly typed by its own schema.

For v1 publication, business input must be an object schema. Schemas using references, anchors or embedded schema-resource IDs are reported as unsupported and are not published; do not naively nest root-relative references under `input`. Supporting those schemas later requires a tested schema-resource/rebasing implementation. This limits Janus's proxy; it does not alter the native registration.

Require the supplied revision to equal the live revision at enqueue and again at dispatch. Never fill in a missing revision or silently upgrade one. Send only the validated `input` object to the webpage. Updating a tool changes its schema/revision and emits `list_changed` while retaining its name. Removal makes that name unavailable; reappearance under the same logical identity advances the revision. Navigation or disable/re-enable creates a new page handle and new names. Return `STALE_REVISION` with a rediscovery instruction for stale calls.

Advance a native tool's revision on changed metadata or a registry-change event that may have replaced its handler, even if metadata is unchanged. Use positive safe integers and retain tombstones until the page handle expires. Janus checks its observed registry; it cannot make uncooperative website handler replacement atomic with browser execution.

Golden naming vector: for `["janus.webtool.v1", "browser_1", "00112233445566778899aabbccddeeff", "generated", "tool_1"]`, the SHA-256 digest is `ea0593e094b99fe633be2a1b3a8a3788e2fbbbc1eb60af919fbb64343ac445de`. First publication of `Search products` yields `web__001122334455__search_products__ea0593e094b99fe633be`. Independent slug cases are `Crème brûlée / 商品` → `creme_brulee`, `商品` → `tool`, and forty `a` characters → twenty `a` characters. Subsequent revision/label/title updates retain the stored name instead of rerunning first-publication naming.

The tool title and description include the user-assigned page label and source. Metadata retains the page identity, origin, tool revision and available annotations. Annotations are behavioral hints, not permission grants.

Advertise `tools.listChanged: true`. Refresh the authorized tool list and emit `notifications/tools/list_changed` when tools are added, removed, revised or become unavailable. Invalidate removed entries and obsolete revisions immediately; notifications may coalesce for at most 100 ms. Publish only enabled pages visible to the authenticated client principal; do not publish every open tab.

Retain MCP Server objects alongside transports in `http-server.ts` and attach registry subscriptions to each session. Clean them up when the session closes. Verify notification handling with the intended CLI client before calling this milestone complete.

Client-visible schemas improve tool selection and argument construction. Janus must still validate every invocation against the bound schema before execution. [MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)

### Discovery and bridge diagnostics

Keep `list_pages()` as a management/discovery tool. It returns the enabled page's opaque ID, user label, browser session ID, title, URL, origin and execution capabilities, subject to the caller's access scope.

`list_page_tools(pageId)` and `call_page_tool(pageId, toolId, revision, input)` support the Milestone 1 spike and diagnostics. They are not the primary released action interface. They use the same authorization, explicit revision checks, input validation and execution queue as typed tools; they do not provide broader capabilities.

### Agent-assisted authoring

Provide the following management tools for Milestone 2:

```text
list_tool_drafts()
get_tool_draft(draftId)
submit_tool_definition(draftId, draftRevision, definition)
```

Drafts originate from explicit extension authoring actions and are scoped to the authorized principal and page. Submissions reference existing draft binding IDs and candidate steps, rather than introducing arbitrary selectors or code. Validate schemas, references, evidence limits and the draft revision before saving. A submitted definition remains inactive until enabled through the extension's authoring UI.

Submission does not itself execute or expand page access. A later definition revision must be reviewed and enabled again. The agent's model supplies semantics; deterministic validators decide whether the definition is structurally acceptable.

Exact authoring input schemas are `ListToolDraftsInput`, `GetToolDraftInput` and `SubmitToolDefinitionInput` in the [v1 schema artifact](2026-09-24-webmcp-contracts.schema.json). `get_tool_draft` returns a schema-validated `ToolDraft`; `submit_tool_definition` returns `{ definitionId, definitionRevision, state: "pending" }` after §17's semantic checks. The client submits a closed `DefinitionProposal`, not a `GeneratedDefinition`. Janus compiles the latter by copying authorized bindings and steps from the draft.

### Results

Return normalized MCP results preserving useful structured data where representable. Tool errors use the appropriate MCP error representation and include a stable category and execution state: not started, failed, or outcome unknown. No error response should suggest that cancellation or a timeout reversed side effects.

## 9. Proposed WebSocket command protocol

Keep existing journey and file messages. Add a versioned control protocol with authenticated client roles so a terminal-output producer is not automatically a browser executor.

| Message | Direction | Purpose |
| --- | --- | --- |
| hello | Extension → server | Present the pre-provisioned pairing credential, browser identity and protocol version |
| hello_ack | Server → extension | Confirm accepted executor role and connection identity; never echo credentials |
| pages_sync | Extension → server | Synchronize enabled live documents |
| tools_changed | Extension → server | Publish or invalidate tools for a document |
| execute_tool | Server → extension | Dispatch a specific tool invocation |
| tool_result | Extension → server | Resolve the invocation with a result or error |
| cancel_tool | Server → extension | Request cancellation when supported |
| page_removed | Extension → server | Invalidate a closed, replaced or disabled document |
| heartbeat | Bidirectional as needed | Detect connection liveness and support the chosen worker lifecycle |

Illustrative request:

```json
{
  "type": "execute_tool",
  "protocolVersion": 1,
  "connectionId": "connection_1",
  "requestId": "req_123",
  "pageId": "00112233445566778899aabbccddeeff",
  "documentId": "doc_9",
  "toolId": "tool_12",
  "toolRevision": 3,
  "arguments": {
    "query": "wireless headphones"
  },
  "timeoutMs": 30000
}
```

The M1 bridge has nine discriminated message kinds, including `hello_ack`. M2 adds `draft_upsert`, `draft_removed`, `definition_proposed` and `definition_result` to transfer drafts and store proposed definitions. Complete fields, nested unions and direction-specific unions are in the [TypeScript contract](2026-09-24-webmcp-contracts.ts) and [runtime schemas](2026-09-24-webmcp-contracts.schema.json). The example uses a 30-second budget; actual dispatch uses the remaining budget after queue time, as defined in §18.

Until the pairing credential is verified, accept only a size-limited handshake within a short deadline. Reject any registration, result, file or control messages from an unverified executor connection. The daemon must already know the expected credential through §12's pairing flow; the first client to connect cannot enroll itself. Authenticate legacy capture producers separately and never grant them execution or executor-registration privileges.

The server maintains pending requests associated with the originating MCP session, target connection and deadline. A response is accepted only for the matching pending request and authenticated executor.

Transport reconnection does not authorize replay of a previous command.

## 10. Execution and lifecycle behavior

1. The CLI receives typed tools for its authorized enabled pages through MCP discovery.
2. Janus resolves the selected name to its bound document/revision and validates arguments.
3. The extension checks that the expected document and tool revision are still current.
4. The appropriate adapter executes the action.
5. The runtime determines completion and obtains the result.
6. Janus resolves the originating MCP call.

Required behavior:

- Never fall back silently to the currently active tab or a newer document.
- Invalidate stale handles on navigation, tool replacement, closure or disconnect.
- Resynchronize discovery after reconnection; do not replay pending actions.
- Apply deadlines and bounded result sizes.
- Propagate cancellation where supported; cancellation does not undo completed effects.
- Serialize calls per page in a daemon-level queue shared by all MCP sessions. Bound queue size and total deadlines, and revalidate permission, document and revision immediately before dispatch.
- Preserve existing journey capture and journey-query behavior.

An error before dispatch can report that execution did not start. A timeout or disconnect after dispatch can leave the outcome unknown: the page may already have performed the action. Such a call must not be automatically retried.

Expiration of the caller's deadline must not unlock a page on which execution may still be running. Keep the page unavailable to subsequent dispatch until execution termination is confirmed or the old document is destroyed. Acknowledging receipt of a cancellation request is insufficient. Failure to establish whether execution stopped is an explicit blocked/busy state, not permission to overlap calls.

For the first milestone, cross-document actions and result retrieval after navigation are out of scope. If navigation interrupts an invocation, return an explicit stale-document or unknown-outcome result according to whether execution began.

### Provenance and journey integrity

Add an actor field to captured events with `human`, `janus`, `page` and `unknown` values, plus optional `invocationId` and attribution evidence. Existing persisted events lacking these fields normalize to `unknown`; absence is not evidence of a human action. Update both extension and MCP event types and their serializers.

Record invocation start/end separately so a native handler remains visible even if it emits no UI events. Label explicitly generated events with the invocation identity. Use native signals, including `SubmitEvent.agentInvoked` where available, as additional evidence. That attribute describes WebMCP form submission and is not a general provenance marker for every downstream event. [Chrome declarative API](https://developer.chrome.com/docs/ai/webmcp/declarative-api)

Do not label all activity occurring during an invocation as caused by it. Concurrent human input and background requests remain possible. Preserve uncertain asynchronous attribution as unknown and distinguish temporal association from confirmed cause.

Collapse and grouping logic must preserve actor and invocation boundaries. Journeys retain agent activity for inspection, with source labels and filtering. Demonstration authoring excludes agent effects and unresolved mixed activity by default; uncertain steps require explicit resolution instead of silently becoming training examples.

## 11. Generated definition format and runtime

A saved definition should contain:

- Stable definition ID and version.
- Name, description and input schema.
- Origin and route applicability.
- Parameter bindings.
- Supported execution steps and locators.
- Preconditions and completion condition.
- Result extraction rules.
- Evidence references, capture completeness and attribution confidence.
- Behavioral annotations and authoring/test status.

A live instance additionally binds that definition to the current page/document.

Where a live instance is published through WebMCP, it also owns one `AbortController`. `ModelContext` has no `unregisterTool()`; a tool is withdrawn by aborting the signal supplied in its registration options. Bumping a revision is therefore abort-then-register, and invalidating a page's tools on navigation, disablement or document destruction is aborting that page's controllers. Use this as the invalidation mechanism rather than inventing a parallel one, and ensure every registration path stores its controller so no live instance can outlive its binding.

### Fixed execution vocabulary

Use structured recipes interpreted by packaged extension code. The initial vocabulary is a finite sequence of supported operations: set a selected field, choose an option, click a selected control, submit a selected form, observe a matching response, await a bounded condition, and extract a bounded result.

The recipe language is non-Turing-complete: no evaluation of strings as code, user-defined functions, recursion, arbitrary expressions or unbounded loops. Cap step count, target matches, waits, captured bytes and output size. Bounded waiting inside a packaged primitive does not expose a programmable loop.

Selectors, form targets, request matchers and extraction paths are resolved from validated authoring bindings and fixed in the enabled definition. At invocation time the client supplies only declared business values. It cannot supply raw selectors, executable function paths, new recipe steps or URLs that redirect execution. Do not interpolate business values into selector or code strings. Option selection uses a bounded operation on an already selected control.

Packaged site adapters may call deliberately exposed page functions, but their callable targets and implementation are fixed by extension code. There is no generic `call_function(path, arguments)` endpoint. Native WebMCP callbacks remain website-supplied code and are outside the recipe language; their calls still pass through page authorization and schema validation.

Selectors should be checked for an unambiguous match at execution time. Missing or ambiguous targets must produce a repairable failure, rather than silently choosing an unrelated element.

### DOM and network result extraction

DOM extraction reads selected fields from bounded matching elements. Network extraction observes requests made by the page and extracts selected fields from matching responses. It does not replay recorded HTTP requests or expose a generic authenticated fetch facility.

A network-response primitive must:

1. Install its observer before the triggering action and assign internal request identities at request start.
2. Use an authored matcher for method, destination and selected request characteristics, constrained to the current document and bounded observation interval.
3. Distinguish matching evidence from proven causal attribution. Reject ambiguous matches unless the definition explicitly expects a bounded collection.
4. Parse supported response formats within byte limits and extract using fixed field paths such as JSON Pointers, without executable filter expressions.
5. Remove observers on completion, timeout, cancellation or document invalidation.
6. Report unavailable, truncated, oversized or unparseable data explicitly; never present partial data as a complete result.

For example, `search_products(query)` can arm its response observer, set the selected search field, submit, await the matched response and return selected product fields from its JSON body. A DOM result can be used when it is the tested extraction rule. Do not silently switch extraction rules after a failure.

Existing journeys contain useful interaction and API evidence, but current timestamps and adjacency do not establish causation. Bodies are truncated to 500 characters, some response types are not captured, and repeated API events can collapse. Reuse that corpus to suggest names, semantics and candidate matchers; collect fresh bounded evidence when a test needs complete fields. Do not build the runtime primitive on the existing display-history buffer.

Form authoring in Milestone 2 uses selected controls and optional bounded evidence collected during an explicit test. It does not require the full demonstration recorder. Custom controls and complex workflows may need packaged adapters.

### Demonstration capture, delivered in Milestone 3

Introduce a dedicated authoring recorder that reuses suitable interception code but has independent semantics and persistence:

- Explicit start/stop boundaries, ordered steps, page/document identity and actor attribution.
- Selected field-value snapshots and parameter bindings captured with user intent; raw keystroke logging is not a prerequisite.
- Sensitive-field exclusion and example-value redaction before persistence or transfer to the agent.
- No application of journey `collapse()` or its 50-event limit. Use separate bounded capacity, with visible overflow/failure rather than silent history loss.
- Durable authoring storage, such as an IndexedDB store, with draft revisioning, resume validation, deletion and a defined retention policy.
- Network observation that retains relevant request identity and bounded evidence while marking ambiguous attribution.
- Completion/result selection and a validation run before enabling the definition.

Keep the ordinary journey recorder's existing size/collapse behavior, adding only provenance-aware boundaries and presentation. Dedicated authoring capture must not turn on broad sensitive-value collection during normal recording.

## 12. Access boundaries

Execution extends Janus from observing a session to controlling it.

### Pairing and caller authentication

Use separate credentials for browser executors, MCP callers and legacy capture producers. The proposed first implementation uses bearer secrets on explicitly loopback-bound endpoints, with the following provisioning:

1. The user selects Pair with Janus in extension settings. The extension generates a cryptographically random 256-bit executor token and pairing ID in the background context.
2. The user explicitly provisions that ID/token into the local daemon through a local pairing command or protected configuration. Secret input should use stdin or a protected file, not command-line arguments. The daemon does not offer an unauthenticated enrollment endpoint or trust the first `hello`.
3. The extension presents its pairing ID and token in the first `hello`. The daemon compares against the provisioned record before granting the executor role. The acknowledgment contains no secret. Unpaired connections time out and cannot publish pages or results.
4. The daemon generates a different token per authorized MCP client. Configure that client to send `Authorization: Bearer ...` on every MCP transport request, including legacy SSE/message routes if retained. An MCP session ID alone is not authentication. Browser executor tokens cannot authorize MCP calls.
5. Associate each MCP credential with allowed enabled pages and authoring rights. Check scope both at enqueue and dispatch. Give terminal capture clients only the producer privileges required for journey ingestion.
6. Provide revoke/rotate operations. Revoking a principal removes its tool visibility and queued work and closes its connections; cancellation of already dispatched work remains best effort and its outcome may be unknown.

Keep daemon credentials in user-access-restricted local storage. Keep extension secrets in background-only storage or restrict extension storage access to trusted contexts where supported; never expose them through content-script messages, page globals, exported definitions or logs. Supported-browser validation must include the chosen storage and authentication path.

This local bearer-token proposal assumes a trusted local daemon and OS account. It does not claim resistance to a malicious process able to read that account's credentials, replace the daemon or impersonate its loopback endpoint. Remote transport or stronger same-account isolation would require a different channel-authentication design.

### Execution and authoring authorization

The implementation must:

- Bind local MCP and WebSocket listeners explicitly to loopback.
- Authenticate control connections and validate relevant request origins.
- Restrict execution to enabled pages and the selected tool.
- Separate proposed definitions from enabled definitions. The model may submit drafts within its scope, but cannot self-enable a new target or enlarge its authority.
- Apply the fixed-vocabulary and authored-target restrictions in §11 to generated tools and any retained generic dispatcher.
- Keep extension/daemon credentials outside page-accessible state.
- Validate page-originated metadata and message shapes.
- Avoid a general arbitrary-JavaScript execution endpoint.
- Keep generated definitions and exports free of embedded session credentials.
- Record enough invocation metadata to diagnose routing, timing and failures without indiscriminately logging sensitive arguments.

The extension exposes page naming/enabling and definition activation through the concrete UI states in §19. The baseline authentication and scope checks above are required. Tool annotations alone do not grant execution authority. Existing journey workflows must continue after the corresponding producer credentials are configured.

## 13. Delivery sequence and browser release gates

### Milestone 1: Authenticated browser command bridge

Support one explicitly enabled, user-named top-level page; authenticated caller/executor roles; correlated results; per-page serialization across MCP sessions; and navigation/disconnection handling. Retain server/transport session records and implement invocation provenance.

M1 includes the three settings/popup components in §19, the daemon's local pairing/client-provisioning commands, configurable loopback ports, the shared contract validators, and the new integration harness in §20. The milestone cannot pass on Vitest/jsdom tests alone. Build the harness early enough to drive M1's connection, UI, authorization and round-trip implementation.

The extension must connect and reconnect with recording off. Use a packaged generated-tool fixture with a harmless read action and a visible state change to validate the round trip with native WebMCP disabled. This validates the common bridge without depending on browser adoption of WebMCP.

Run a separate native compatibility spike against a named Chrome version and test page. Chrome currently documents an origin trial starting with Chrome 149 and a testing flag for local development; neither proves Janus's extension integration works on an ordinary unflagged page. Test discovery and invocation from the actual extension execution context. [Chrome WebMCP availability](https://developer.chrome.com/docs/ai/webmcp)

Native support remains experimental until its claimed browser/API path passes. A flagged development result is not an unflagged release result. The spike does not block the generated-tool milestones.

#### Native end-to-end validation target

The spike's success condition is behavioral, not structural: **a coding-agent CLI connected only to Janus MCP can drive a real third-party WebMCP site to complete a multi-step task, without a DOM snapshot and without browser-automation tools.**

Reference fixture: the Basketful grocery demo at <https://shopping-webmcp-demo.netlify.app/>, a client-rendered shopping app that registers its tools at runtime. Record the observed tool names, schemas and revision behavior at test time; do not hard-code them into the adapter, and do not treat this site's shape as the general case.

The run must satisfy:

1. The agent enumerates the site's tools through Janus MCP alone, with accurate names, descriptions and input schemas.
2. The agent selects tools and constructs arguments from those schemas without being told the DOM structure and without a page snapshot in its context.
3. A multi-step task — for example search, inspect a result, add to a basket, read back basket state — completes through sequential invocations, with each result informing the next call.
4. Page state visibly changes in the browser, and the final state matches what the agent reports.
5. Tools registered by any cross-origin descendant frame are excluded from what the agent sees.
6. Interleaved human interaction during the run is not attributed to the agent in the journey.

A read-only subset passing is not a pass. Because this is a live third-party site, pin the tested date and Chrome version in the result, and mirror the fixture locally once its behavior is understood so the lane does not depend on someone else's deployment.

### Milestone 1.5: Typed MCP tool publication

Publish enabled actions using §8's stable naming algorithm and fully typed `{ revision, input }` schema. Add authorized per-session registry subscriptions, `listChanged` capability and notifications, explicit revision checks, and cleanup on session closure.

Verify that the intended CLI refreshes tools and can invoke a page action directly with schema-shaped arguments. Exercise addition, removal and replacement with two MCP sessions, including different access scopes. The packaged generated fixture supplies a native-WebMCP-independent test lane.

### Milestone 2: Agent-assisted form generation and proxying

Deliver form scanning only. Add the pending-draft queue, agent retrieval/submission tools, constrained binding references, schema validation, parameter review, local enabling, persistence and export. Use the connected agent's model; no separate provider setup is required.

Implement the bounded recipe runtime with authored controls, DOM extraction and matching network-response extraction for supported forms. Fresh network evidence comes from explicit bounded test runs. Demonstration capture is not a prerequisite and is not included in this milestone.

Publish generated tools through the same typed MCP interface. Validate invocation, reload/route matching, stale revisions and changed controls with native WebMCP disabled. This is the first generated-tool product release. A blocked native compatibility spike must not block it.

### Milestone 3: Demonstration authoring and durable capture

Deliver §11's dedicated recorder: ordered steps, selected value capture, parameterization, sensitive-field handling, provenance, durable authoring storage, explicit capacity limits, request evidence and completion/result selection. Preserve ordinary journey defaults.

Have the connected agent synthesize definitions from these drafts, then validate and enable them through the same authoring flow. Test interrupted capture, resume after document change, overflow, mixed human/agent activity and extraction ambiguity.

### Browser support matrix required before release

| Path | Validation lane | Release claim |
| --- | --- | --- |
| Generated runtime | Stable extension browser with native WebMCP disabled | Required for the generated-tool release; record tested browser/version |
| Generated runtime on Firefox | Existing Firefox build target plus actual execution, messaging and lifecycle tests | Advertise Firefox support only after this lane passes |
| Native WebMCP with testing flag | Explicit Chrome version/channel and flag state | Experimental native compatibility only |
| Native WebMCP without testing flag | Actual extension discovery/invocation on an eligible origin-trial or otherwise supported page | Required before claiming unflagged native support; retain site/API conditions |
| Shim-backed tools | Explicit shim registration and invocation contract | Separate compatibility claim, not inferred from injection capability |

The matrix records API availability, execution-world requirements, permissions and worker/reconnection behavior. Supporting the generated path on another browser requires testing its adapter; it does not require that browser to implement native WebMCP.

### Later extensions

- Multiple enabled pages and browser sessions exposed through the UI.
- Iframe and cross-document result support.
- Additional tested browsers and shim adapters.
- Direct shell commands in the Janus CLI.

Identity design must prevent collisions from the start, and queue correctness must hold across multiple MCP clients even when the initial UI enables only one page.

## 14. Acceptance criteria

| Scenario | Expected result |
| --- | --- |
| Native tool discovery | On the tested supported API path, CLI receives accurate tool metadata and schema without a DOM snapshot |
| Native invocation | Correct page handler runs and its result returns to the initiating MCP call |
| Native end-to-end drive | On the §13 reference fixture, an agent connected only to Janus MCP completes a multi-step task through sequential tool calls, with no DOM snapshot and no browser-automation tools; final page state matches the reported result |
| Descendant-frame tools | Tools registered by a cross-origin iframe are not published to the CLI in the first milestone |
| Revision withdrawal | Aborting a Janus-owned registration removes that handler; calls while absent or with the old revision fail, and a replacement cannot silently receive them |
| Native WebMCP disabled | Packaged/generated tools still publish and execute; native capability reports unavailable |
| Recording disabled from startup | Extension connects, discovers tools, executes calls and reconnects without ever starting a journey |
| Typed tool publication | Page action has its own fully typed input schema and requires the advertised revision |
| Tool-list changes | Authorized CLI sessions refresh on addition/removal/revision; unauthorized sessions do not receive those tools |
| Session cleanup | Closing an MCP session removes its server/transport record and registry subscriptions |
| User-named page | Label appears in discovery/tool metadata while opaque identity governs routing |
| Same-origin tabs | An invocation cannot switch to another tab |
| Invalid input | Schema validation rejects the call before execution |
| Tool revision changes | Name stays stable; the old revision is rejected, schema change is notified, and a fresh call can explicitly use the new revision |
| Name normalization and collision | Non-ASCII/long names follow the exact transform; truncation never aliases identities and a forced digest collision rejects new publication |
| Navigation or tab closure | Stale target fails explicitly; no fallback execution |
| Timeout/disconnect after dispatch | Outcome is reported as unknown when appropriate; no automatic replay |
| Unknown running state | Expiring a request does not permit a second invocation to overlap potentially running work |
| Two concurrent MCP sessions | Results return to the correct caller; each session sees only its authorized tools |
| Two overlapping calls to one page | Shared queue serializes execution across sessions and revalidates before dispatch |
| Queued permission or document change | A queued call fails before dispatch if its permission, document or revision becomes stale |
| Agent-assisted draft | Agent retrieves selected evidence and submits a valid definition without another model provider |
| Idle or absent authoring agent | Draft remains pending; no claimed automatic model work or silent submission |
| Authoring scope | Client cannot submit arbitrary selectors, reference another principal's draft, or self-enable a definition |
| Generated search form | Parameterized input executes and returns the configured result |
| Authored-target enforcement | Invocation arguments cannot introduce selectors, executable expressions, target URLs or extra steps |
| Changed generated-tool target | Missing or ambiguous control produces an actionable failure |
| Matching network response | Observer starts before the action and returns only the authored fields from the expected response |
| Ambiguous or incomplete network evidence | Polling collisions, missing data and truncation fail explicitly; no fabricated causal attribution |
| Invocation during recording | Known agent effects carry provenance; journeys retain them and demonstration authoring excludes them by default |
| Human input during invocation | Human/unknown activity is not automatically attributed to the agent; collapsing preserves boundaries |
| Native handler without UI events | Invocation start/result remains observable without inventing click events |
| Invalid executor pairing | Connection cannot register pages, claim executor authority or resolve pending calls |
| Unauthenticated MCP caller | Invocation fails even when a legitimate browser executor is connected |
| Revoked credentials | Tool access and queued work are removed; running effects are not falsely reported as undone |
| Existing recording workflow | Configured producer credentials preserve journey capture, file transfer and query behavior |
| Demonstration capture, M3 | Independent ordered durable storage survives supported interruptions and reports capacity limits |
| Closed contract validation | Unknown step/message variants and unknown object keys fail runtime validation before effects |
| Draft reference integrity | Structurally valid submissions with foreign/missing step IDs or weakened slot constraints fail semantic validation |
| M1 UI | Pairing, bad credentials, enable/disable, page labels and settings persistence work through the real extension UI |
| Harness isolation | A fresh daemon/profile and two SDK clients exercise the real extension socket without connecting to the developer's daemon or browser profile |

Unit tests should cover protocol validation, authority checks, queue state, attribution boundaries and recipe limits. Integration tests should exercise extension-to-daemon round trips and tool-list notifications with multiple MCP sessions. Browser compatibility, page behavior and native availability require real-browser checks. Documentation or a successful extension build is not a substitute for those checks.

## 15. Open decisions

- Which exact browser versions pass the §13 matrix and will be supported at first release?
- How is a tool registered from the extension's isolated world attributed for origin filtering, and is it visible to the page's own agent? This decides whether Feature C's export and Janus-side registration are equivalent.
- What is the export format, including any runtime dependency?
- Should later releases expand beyond §18's fixed limits and §19's conservative confirmation behavior?
- How should a user resolve mixed or uncertain attribution while authoring a demonstration?
- When should additional browsers, iframe execution and navigation-producing tools enter scope?

Form-first generation, use of the connected agent's model, typed tool publication in Milestone 1.5, separate caller/executor credentials and a shared per-page execution queue are design decisions, not unresolved alternatives.

## 16. Technical references

The current WebMCP draft defines a single `ModelContext` interface exposed on `Document`:

```webidl
partial interface Document { readonly attribute ModelContext modelContext; }
```

It carries `registerTool()` for publishing a handler, and `getTools()` / `executeTool()` for discovering and invoking one, plus registry-change events. `getTools()` resolves to tools from the document and its descendants.

Two details differ from earlier public write-ups of this API and from intermediate revisions, and an adapter written against those will break:

- There is no `navigator.modelContext`. Registration and discovery are members of the same `Document`-scoped interface.
- There is no `unregisterTool()`. A tool is withdrawn through an `AbortSignal` supplied in `ModelContextRegisterToolOptions`. Methods named `provideContext()` / `clearContext()` are not part of this draft.

The browser API is evolving, so the implementation should use an adapter, pin the observed shape in a compatibility test, and verify its supported browser build rather than trusting secondary documentation. [WebMCP draft](https://webmachinelearning.github.io/webmcp/)

The Model Context Tool Inspector provides an extension reference for discovery and invocation, including compatibility handling. Its setup documents a testing flag, while Chrome's broader documentation also describes an origin trial. Validate Janus itself against §13's matrix rather than extrapolating release support from the inspector. [Inspector implementation](https://github.com/beaufortfrancois/model-context-tool-inspector/blob/main/content.js), [setup](https://github.com/beaufortfrancois/model-context-tool-inspector#prerequisites), [Chrome WebMCP](https://developer.chrome.com/docs/ai/webmcp)

MCP specifies tool schemas, invocation, server-side input validation and notifications for changing tool lists. [MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)

Chrome documents `SubmitEvent.agentInvoked` for its declarative WebMCP forms. WebExtensions documentation distinguishes isolated and page execution worlds. These APIs support parts of the design, but neither promises complete effect attribution or access to private application functions. [Declarative API](https://developer.chrome.com/docs/ai/webmcp/declarative-api), [execution worlds](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/ExecutionWorld)

## 17. Normative v1 contracts and validation

The companion [TypeScript types](2026-09-24-webmcp-contracts.ts) define `RecipeStep`, `ToolDraft`, `DefinitionProposal`, `GeneratedDefinition`, `DefinitionApproval`, `LiveInstance`, all thirteen bridge/authoring messages, and their direction-specific unions. The [JSON Schema document](2026-09-24-webmcp-contracts.schema.json) supplies matching runtime contracts, including the authoring-tool inputs. Both are versioned design artifacts; implementation must not substitute casts for validation.

The schema uses Draft-07 and local references only. Its root validates `ControlMessage`. To validate a different contract, register this document with a validator and select `urn:janus:webmcp-contracts:v1#/definitions/<Name>`. To publish an authoring input schema, copy the selected definition as the root and include the document's `definitions`; retain its local reference targets without remote resolution. Disable type coercion, default insertion and removal of additional properties. Reject extra properties instead of silently stripping them. Type declarations do not replace these runtime checks.

Every non-map object is closed. `RecipeStep` has exactly seven `op` variants; there is no `custom`, script or extension payload. The executor uses an exhaustive switch with an unreachable-default assertion. Adding an operation requires a contract/schema revision and validation/execution tests. Data-only JSON results and native business schemas may contain ordinary object maps, but do not create operation variants.

### Draft compilation and reference integrity

JSON Schema can require the shape of a binding ID, but cannot establish membership in an authorized stored draft. After structural validation, execute these checks before creating a definition:

1. Resolve the draft under the authenticated principal. Its revision must equal `draftRevision`, it must be unexpired, and its page/document must still be available for authoring. Return `DRAFT_STALE` or `DRAFT_EXPIRED` without changing stored state on failure.
2. Require unique binding IDs, slot IDs and candidate step IDs within the draft. Every submitted `stepId` must name a candidate in this exact draft. Require all `requiredStepIds`, preserve candidate order, and reject duplicate or foreign references. In M2 all candidate steps are required; optional subworkflows are not part of form authoring.
3. Require a one-to-one mapping between `parameters[].name`, `parameters[].slotId`, and the input schema's properties. In v1 every proposed property is required. All referenced slots must exist and be non-sensitive, and every value slot used by selected steps or matchers must be mapped. Unused/unknown parameters are rejected.
4. Constrain proposed scalar schemas to the captured slot constraints: types must match (integer may narrow number), enums must be subsets, minimum/minLength cannot decrease and maximum/maxLength cannot increase. Reject inconsistent bounds. Apply the hard string/collection limits in §18 even when a schema omits an optional bound.
5. Validate reference kinds: `set_field` targets text/number/checkbox, `select_option` targets select_one, `click` targets button, and `submit_form` targets form. DOM results target an existing control. Response observers target a response binding; response waits/results reference an earlier observer step. A response result must follow its wait. Require one `extract_result`, as the final step, with unique output names. No reference cycles or forward execution references are allowed.
6. Copy locators, request matchers, literals and extraction rules from the draft, never from new client text. Validate origin with URL parsing; require an HTTP(S) origin without credentials, a path starting with `/`, and segment-boundary path-prefix matching. Do not interpolate parameter values into paths/selectors. JSON Pointer is the only response field-path syntax in v1. Matchers support exact GET/POST origin/path plus declared query or JSON-body scalar comparisons; no regex/eval filters.
7. Assign definition ID, monotonic definition revision, ownership, timestamps and annotations in trusted code. A client cannot declare its own approval. Unknown effects default to consequential; any write/submit/control activation defaults to non-read-only. Send a compiled definition to the owning extension, which repeats structural/reference checks against its local draft and stores it pending review.

M2 supports single-document forms using text-like inputs, number inputs, checkboxes, select-one controls and submit buttons. Password/file inputs, contenteditable, rich/custom widgets and navigation-producing submissions are unsupported. Network extraction supports bounded JSON fetch/XHR responses; DOM extraction reads text, value or checked state. Unsupported controls/results appear in the draft UI and prevent enabling an incomplete recipe.

`get_tool_draft` returns the selected bindings and steps as evidence, but `submit_tool_definition` cannot contain a selector, matcher, extraction path or arbitrary step. Its schema accepts only a name, description, restricted input schema, parameter-to-slot mappings and existing step IDs. Return `{ definitionId, definitionRevision, state: "pending" }` only after the extension acknowledges persistence; the proposal is still not executable.

### Protocol state and ownership

- M1 accepts the nine bridge message variants; M2 enables the four authoring variants. Wrong-direction, unknown, oversized or structurally invalid messages close the connection with a policy/protocol error. Failed authentication closes it without revealing whether a pairing ID exists.
- `hello_ack` assigns a fresh connection ID and lists at most eight authoring principals from trusted daemon configuration (empty before M2). Subsequent messages must use that connection ID. `sequence` on page/tool/draft updates is one monotonically increasing positive counter per executor connection, beginning at 1. Ignore duplicates; a gap requires reconnect/full resynchronization before accepting more calls.
- `pages_sync` is a complete snapshot (zero or one enabled page in v1). `tools_changed` is a complete tool snapshot for that page/document, with at most 32 entries. Missing entries invalidate immediately. Authenticate ownership and check the declared browser/page against the executor connection. An empty tool snapshot withdraws all page tools. Reject reuse of a tool ID for a different logical source. Validate native business schemas against the supported JSON Schema meta-schema, apply §8's embedding restrictions, and never resolve remote schema references.
- `execute_tool` snapshots tool revision and carries business arguments only. `tool_result` must match the originating connection, request, document, tool and revision. `executionStopped: false` is legal only for an error with `execution: "outcome_unknown"`. A later matching result with `executionStopped: true` may release the busy page without resolving the already expired MCP request again. The success or stopped-error result is otherwise terminal; duplicate terminal responses have no effect.
- `cancel_tool` requests cancellation; it does not acknowledge termination. `heartbeat` ping receives a pong with the same nonce; a pong is not echoed. Use §18's fixed heartbeat/inactivity intervals.
- On reconnect, expire old wire request IDs and republish page/tool snapshots. Reuse a page handle only if the extension can recover its identity, logical-tool/revision records and execution state. Lost state requires a new handle, but does not clear an unknown execution lock on the same browser document; only confirmed termination or document destruction does that.
- M2 `draft_upsert` sends one complete bounded draft; `draft_removed` invalidates it. Draft ownership must match an authorized authoring principal from the pairing configuration. Clear cached executor drafts on disconnect and rebuild them from live resynchronization; never serve stale offline drafts as current.
- `definition_proposed` and `definition_result` correlate one compile/store request. The extension verifies the exact local draft and stores a pending definition, with idempotency by request ID and draft revision for 10 minutes. Retrying that same submission must return the same definition identity; different contents under the same request ID fail. This administrative retry policy never applies to webpage execution.

## 18. Fixed v1 defaults and limits

These values are implementation decisions for v1. Limits are enforced at both receiving boundaries where applicable. A future change requires updated contracts/tests; no tool caller can raise them. Byte counts are UTF-8 encoded JSON bytes unless stated otherwise. Use monotonic clocks for deadlines and wall-clock timestamps for persistence/expiry.

| Setting | v1 value and behavior |
| --- | --- |
| Enabled pages | 1 per executor/browser session; enabling another requires explicit replacement |
| Active execution | 1 per browser document across every MCP session |
| Waiting calls | 4 per page, 32 globally; excess fails immediately with QUEUE_FULL |
| Invocation deadline | 30,000 ms from server receipt, including queue and UI confirmation time; dispatch gets remaining time |
| Step wait | 5,000 ms default, 100–10,000 ms permitted in a saved recipe, always capped by remaining invocation budget |
| Pairing handshake | 5,000 ms; at most 4 KiB before authentication |
| Heartbeat | Ping every 15,000 ms; connection unavailable after 45,000 ms without valid peer traffic |
| Reconnect | 1, 2, 4, 8, 16, then 30 seconds, each with up to 20% positive jitter; reset after valid hello_ack |
| Tool-list notification | Coalesce for at most 100 ms; local invalidation is immediate |
| WebSocket control frame | 1 MiB maximum; check raw length before parsing |
| Tool input | 32 KiB maximum, at most 16 nesting levels; native business schema at most 16 KiB |
| Tool result | 64 KiB maximum, at most 16 nesting levels; larger results fail RESULT_LIMIT with no implicit truncation |
| Native tool catalog | 32 tools per page; overflow marks catalog unsupported rather than silently publishing a subset |
| Generated recipe | 32 steps, 64 bindings, 16 parameters, 16 named output fields |
| Selected controls | Exactly one target per control binding; zero/multiple matches fail |
| Scalar values | Strings at most 4,096 characters; select/string enums at most 100 entries; numeric values finite |
| Native input/result collections | At most 1,024 members per array/object, additionally bounded by bytes/depth |
| Response observers | At most 4 per invocation; one unambiguous response per observer |
| Response capture | 256 KiB decoded body per matched response, 1 MiB total per invocation; stop bounded reading and fail CAPTURE_LIMIT on excess |
| Draft or compiled definition | 256 KiB each; transfer one draft per message |
| Draft evidence | 16 items, 8 KiB sample per item, 64 KiB total samples; redact before storing or sending |
| Demonstration capture, M3 | 15 minutes, 2,000 events or 5 MiB, whichever comes first; stop visibly on capacity/time limit |
| Draft/raw authoring retention | 24 hours from creation; accessed drafts do not silently extend expiry |
| Invocation metadata retention | 7 days or 10,000 records, whichever limit is reached first; omit raw arguments/results by default |
| Saved definitions | Until explicit deletion, maximum 100; never evict enabled definitions automatically |
| Authoring storage | 25 MiB per extension profile across drafts, recordings and definitions; purge expired data first, then fail STORAGE_LIMIT |
| Pending definitions/drafts | At most 50 combined; capacity rejection is visible |
| Cleanup | On startup, before writes and every 15 minutes while active |
| Page labels | Trimmed, 1–48 characters; default is title truncated to 48, then hostname fallback |
| Authoring store response | 10-second deadline; timeout stays pending/uncertain until an idempotent status retry resolves it |
| Unknown execution lock | No timer-based unlock; persists for that live document until termination is confirmed or it is destroyed |

The ordinary journey recorder remains at its existing 50-event display/history limit. Its buffer is not reused for bounded execution results or durable authoring. In v1 use IndexedDB for authoring artifacts; credentials and active document state remain in their separately scoped stores. Retention cleanup of evidence does not invalidate a saved compiled definition; that definition retains copied bindings/steps and only nonessential evidence IDs.

## 19. UI contract and milestone ownership

Implement these components as normal Svelte components within the existing settings and popup entrypoints. All mutations go through the background controller, which verifies that privileged UI messages originate from extension pages; content scripts cannot call pairing, approval or enablement actions. Form values and page labels are rendered as text.

### M1: BrowserPairingPanel.svelte

Location: a Browser connection section in `src/entrypoints/settings/App.svelte`; component path `src/components/browser-tools/BrowserPairingPanel.svelte`.

Fields: loopback WebSocket URL (default `ws://127.0.0.1:3457`), connection status, pairing ID and paired-client labels. Accept only `ws://` with host `127.0.0.1`, `localhost` or `[::1]`, a valid port, no credentials/query/fragment, and root path. The configurable port is also how the integration harness targets its isolated daemon.

States/actions:

- Unpaired: Pair generates/stores the background token and reveals a one-time Copy pairing JSON action. The payload is `{ pairingId, token }`. Display the proposed local command `janus-mcp pair --stdin`; do not interpolate the secret into shell text or logs.
- Awaiting daemon: show provision/connect instructions and Retry. Disable duplicate generation while a request is pending.
- Connecting/connected: show the actual handshake status. A TCP connection alone must not display Paired.
- Unreachable/authentication failed: show separate non-secret errors; Retry keeps the same credential. Do not automatically rotate on transient failures.
- Rotate: after confirmation, immediately disable control and invalidate the old local credential; show the replacement pairing payload. The daemon's local pair command replaces the previous token for that pairing ID and closes old executor connections.
- Forget: clear the local token, disable the enabled page and disconnect. Explain that the daemon's local revoke command is needed to delete its corresponding record too.

M1 adds local daemon admin commands `janus-mcp pair --stdin`, `janus-mcp revoke <pairingId>`, and `janus-mcp client create --pairing-id <id> --label <label> [--author]`. These are proposed new commands, not capabilities of the existing terminal-capture CLI. Client creation emits a separate MCP bearer token once; its scope is user-enabled pages of that pairing, plus authoring only with `--author`. Issued credentials never auto-enable a page. M2's draft UI selects one authoring principal supplied by the authenticated handshake.

### M1: PageAccessPanel.svelte

Location: `src/components/browser-tools/PageAccessPanel.svelte`, mounted in `src/entrypoints/popup/App.svelte`. Show current tab title/origin, editable label, native/generated capability status, and an Enable tools on this page toggle.

Disabled by default. While unpaired/unreachable, disable the toggle and link to connection settings. An enable request resolves the actual active top-level document, verifies host access and obtains its new page ID before reporting success. If another page is enabled, show its label and require an explicit Replace enabled page action; never move execution implicitly because the user switched tabs.

Disable withdraws tools immediately, cancels queued work and requests cancellation of running work; show Outcome unknown if termination cannot be established. Navigation disables the previous document and requires re-enabling the new one in v1. Ordinary popup closure or switching active tabs does not change the enabled document. Show a visible executing/busy state with Cancel while an invocation is pending; this panel remains available when recording is off.

### M1: PageLabelField.svelte

Location: `src/components/browser-tools/PageLabelField.svelte`, used by PageAccessPanel. Initialize from §18's default. Save on Enter or blur; Escape restores the prior label. Reject blank/overlong labels inline and retain the prior valid value. Show Saving/Failed feedback, disable duplicate writes, and apply acknowledged values only. Label changes update display metadata and notifications, never tool identity or revision. Labels persist for the enabled tab session; no automatic origin-wide aliasing.

### M2: ToolDraftReviewPanel.svelte

Location: `src/components/browser-tools/ToolDraftReviewPanel.svelte`, mounted in settings under Saved tools and linked from the popup. States are captured, awaiting agent, proposal received, validation failed, ready to test, test passed/failed, enabled and disabled. Show selected controls, parameter schemas, ordered operations, extraction source, effect classification and draft expiry. Read-only evidence is bounded/redacted; do not dump entire responses into the UI.

Actions: Copy draft ID, choose authorized authoring client, Test with explicit input, Enable this reviewed revision, Disable, Delete and Export. A failed/stale/unsupported draft cannot be enabled. Test is itself an explicit action that can change the page; display its inputs and consequential effects first. New or revised model submissions remain inactive. Export is v1 compiled definition JSON plus a packaged registration wrapper/runtime reference; it contains no credentials, examples or raw evidence. Cross-browser portability is a compatibility claim, not implied by export.

Before accepting calls, require local confirmation for consequential or unknown-effect tools; read-only reviewed tools can run under page enablement. Native annotations alone cannot waive confirmation. Prompt in the extension UI while the request is queued and within its 30-second deadline; absent/denied/expired confirmation fails before dispatch. This is the v1 default, not an unspecified future setting.

## 20. Integration harness: an M1 deliverable

Add a dedicated Playwright suite under `tests/e2e/` with its own `playwright.config.ts` and root `test:e2e` command. Keep Vitest/jsdom unit tests and exclude `tests/e2e/**` from both Vitest discovery configurations where applicable. Add a pinned Playwright dev dependency and lockfile/browser version during implementation; do not rely on an installed personal Chrome profile.

The runner builds the extension and daemon, then uses Playwright's bundled Chromium with a fresh persistent context and the unpacked `output/chrome-mv3/` build. Playwright documents this loading route; its browser runner is not evidence of Firefox support. [Playwright extension testing](https://playwright.dev/docs/chrome-extensions)

### Harness fixtures and lifecycle

- `tests/e2e/fixtures/daemon.ts`: spawn a daemon with `--mcp-port 0 --ws-port 0 --data-dir <temporary-directory> --bind 127.0.0.1`. M1 must add those options and an explicit readiness record containing the assigned URLs, never credentials. Provision executor/client credentials through the local admin path. Each test worker owns its daemon and data directory; no use of ports 3456/3457 or existing user configuration.
- `tests/e2e/fixtures/extension.ts`: create a fresh temporary browser profile, load the real built extension, discover its extension ID, and open settings/popup extension pages. Drive pairing URL, page enabling and label edits through the UI. Wait for observed states/messages, not arbitrary sleeps. Application messages use the actual extension WebSocket; do not replace it with a mock.
- `tests/e2e/fixtures/mcp.ts`: create two independent SDK clients over Streamable HTTP with separate credentials and sessions. Subscribe to tool-list notifications before causing changes; assert both notification delivery and subsequent `tools/list` contents. Send actual tool calls and correlate their results.
- `tests/e2e/fixtures/site.ts`: serve local fixtures on an ephemeral HTTP port. Include a deterministic search form and JSON endpoint, an observable counter, manually releasable delayed actions, background polling, and a same-origin iframe tool. A second fixture origin supplies a cross-origin iframe. Provide fixed native registrations only in the dedicated native lane; the generated lane must pass with native WebMCP unavailable.
- Teardown closes SDK sessions, then the browser context, fixture server and daemon, awaits termination, and removes only its own temporary artifacts. Capture sanitized daemon logs and test traces on failure; start traces after credential provisioning and exclude pairing secrets/raw sensitive payloads from artifacts.

### Milestone test ownership

| Milestone | Harness work and required scenarios |
| --- | --- |
| M1 | Build/provision/load lifecycle; real UI pairing and enablement; recording-off round trip; wrong credential and wrong document rejection; two sessions making overlapping calls; timeout quarantine; socket reconnect and worker restart without replay |
| M1.5 | Real tool-list notifications to two sessions with different scopes; stable name across revision update; stale revision rejected; name transform vectors and injected collision failure; session unsubscribe/cleanup |
| M2 | Draft schema and semantic rejection; a scripted MCP authoring client submits a deterministic proposal without needing a live model; extension review/test/enable UI; DOM and network extraction, polling ambiguity, limits and revoked access |
| M3 | Dedicated capture persistence/resume, overflow, expiry cleanup, sensitive-field exclusion and interleaved human/agent provenance |

For serialization tests, the local fixture holds the first invocation open until the harness releases it. Issue the second from a different MCP session and assert it has not entered the handler. Then release the first, verify order/results, and repeat with timeout and permission changes. This checks the shared queue rather than only inspecting a mock call order.

For reconnect/restart tests, stop the owned socket/worker through the fixture's browser/process controls, wait for explicit unavailable/resynchronized states and assert no duplicate page effects. Keep authentication and execution checks on the production code path; test-only fixtures may expose barriers and inspection data but must not bypass those checks.

Run the generated-tool suite as a required CI job, initially one Playwright worker and no automatic retries; pin its browser build in the test report. Add deterministic contract tests to the existing Node suite for unknown variants/keys, bad draft references and limits. The native lane records exact browser version, flags/origin-trial conditions and isolated-world behavior separately. An unsupported native API marks that experimental lane unsupported; it cannot count as a passing native release gate.

The third-party Basketful run in §13 remains a separate native acceptance exercise. Local fixtures make CI reproducible; they do not replace that behavioral requirement. Browser automation may provision the harness and verify outcomes, but the agent performing that native task still receives only Janus MCP tools, as specified in §13.
