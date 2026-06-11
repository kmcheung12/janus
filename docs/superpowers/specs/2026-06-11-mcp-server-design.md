# MCP Server for Janus — Design Spec

## Overview

A local MCP server that receives user journey data from the Janus browser extension over WebSocket, and exposes it to Claude Code via MCP stdio transport. Claude can query journeys by ID, domain, or recency to gain context about what the user was doing in the browser.

## Architecture

Two servers in one Node.js process:

- **WebSocket server** on port `3457` — receives events from the extension
- **MCP stdio server** — spawned by Claude Code, exposes journey query tools

```
Extension  →  ws://localhost:3457  →  MCP process (in-memory store)
Claude Code  →  stdio  →  MCP process
```

Registered in `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "janus": {
      "command": "node",
      "args": ["/Users/alan/code/janus/packages/mcp-server/dist/index.js"],
      "type": "stdio"
    }
  }
}
```

The WebSocket server lives only while a Claude Code session is active. The extension reconnects naturally on session start via the sync-on-connect design.

## Package Structure

New package at `packages/mcp-server/` in the existing monorepo:

```
packages/mcp-server/
  src/
    index.ts          — entry point, starts WS server + MCP stdio server
    ws-server.ts      — WebSocket server, routes messages and binary frames
    journey-store.ts  — in-memory Map<journeyId, Journey>
    file-store.ts     — writes binary uploads to os.tmpdir()/janus-mcp/<journeyId>/
    mcp-tools.ts      — MCP tool definitions
    types.ts          — WS message types, Journey interface
  package.json
  tsconfig.json
```

Shares `CapturedEvent` types from `src/lib/event-capture/types.ts` via a path alias or relative import.

## Data Model

```typescript
interface Journey {
  id: string
  meta: {
    startTime: number       // ms since epoch
    startUrl: string
    tabTitle: string
    domain: string          // extracted hostname, e.g. "google.com"
    status: 'recording' | 'stopped'
  }
  events: CapturedEvent[]
  files: FileAttachment[]
}

interface FileAttachment {
  filename: string
  mimeType: string
  path: string              // absolute path in os.tmpdir()/janus-mcp/<journeyId>/
}
```

## WebSocket Protocol

### Text messages (JSON)

| Message | Direction | When |
|---------|-----------|------|
| `sync` | ext → server | Recording start, SW restart, or post-edit resync |
| `event` | ext → server | Each new event captured during recording |
| `recording_stopped` | ext → server | User stops recording |

```typescript
type WsMessage =
  | { type: 'sync'; journeyId: string; meta: Journey['meta']; events: CapturedEvent[] }
  | { type: 'event'; journeyId: string; event: CapturedEvent }
  | { type: 'recording_stopped'; journeyId: string }
```

**`sync` upserts** the journey — creates it if new, replaces events if reconnecting with an existing ID.

### Binary messages (file upload)

Single WebSocket binary frame:
- Bytes 0–3: 4-byte big-endian uint32 — length of JSON header
- Bytes 4–(4+N): JSON header `{ type: 'file', journeyId: string, filename: string, mimeType: string }`
- Bytes (4+N)–end: raw file bytes

Server writes file to `os.tmpdir()/janus-mcp/<journeyId>/<filename>` and appends a `FileAttachment` to the journey.

## Data Flow

**Recording start:**
1. Extension generates a short random `journeyId` (6 chars), displays it in sidebar
2. Extension opens WebSocket to `ws://localhost:3457`
3. Sends `sync` with metadata and empty events array
4. Server upserts journey in store

**During recording:**
- New event captured → `event` message
- User edits/excludes an event → `sync` with full current event array
- User attaches a file → binary frame

**Recording stop:**
- Extension sends `recording_stopped`
- Server sets `status: 'stopped'`; journey remains queryable
- Socket stays open — further edits trigger `sync` messages
- Socket closes when user starts a new recording (new `sync` with new journeyId opens a fresh connection)

**SW restart:**
- Extension reconnects to `ws://localhost:3457`
- Sends `sync` with existing journeyId and full current events
- Server upserts — journey state restored

## MCP Tools

| Tool | Arguments | Returns |
|------|-----------|---------|
| `list_journeys` | — | All journeys: metadata + file count, no events |
| `get_journey_by_id` | `id: string` | Full journey: metadata + events + file paths |
| `get_journeys_by_domain` | `domain: string` | All journeys where hostname contains `domain` (case-insensitive); full journeys |
| `latest_journey` | — | Most recent journey by `startTime`; full journey |

File paths in tool responses are absolute — Claude can read them directly from the filesystem.

## Extension Changes

### New: `src/lib/mcp/ws-client.ts`
WebSocket client module:
- `connect(journeyId, meta, events)` — opens socket, sends initial sync
- `sendEvent(journeyId, event)` — sends single event message
- `sendSync(journeyId, meta, events)` — sends full resync
- `sendRecordingStopped(journeyId)` — sends stop signal
- `sendFile(journeyId, filename, mimeType, bytes)` — sends binary frame
- Auto-reconnect with backoff; on reconnect sends full sync for active recording

### Modified: `src/entrypoints/background.ts`
- On recording start: generate journeyId, call `ws-client.connect()`
- On `JANUS_SYNC_EVENTS`: call `ws-client.sendEvent()` for new events, `ws-client.sendSync()` for edits
- On recording stop: call `ws-client.sendRecordingStopped()`

### Modified: `src/components/sidebar/EventSidebar.svelte`
- Display `journeyId` prominently (e.g. top of sidebar, monospace, copyable)
- Add file picker button — on file selected, read as `ArrayBuffer`, call `ws-client.sendFile()`

### Note on journeyId generation
Use the existing `src/lib/uuid.ts` or replace with a 6-char nanoid for a shorter, user-friendly ID.

## Error Handling

- **MCP server starts, no extension connected**: tools return empty results or a helpful message
- **Extension connects, MCP not running**: WebSocket connection fails silently; extension continues capturing events normally
- **SW killed mid-session**: on restart, extension reconnects and resyncs; server upserts journey preserving continuity
- **File write fails**: log error, skip attachment; do not crash
