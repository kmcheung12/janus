# Janus CLI Design Spec

## Overview

`janus` is a CLI wrapper that runs any command, captures its stdout and stderr, and streams the output as a journey to the Janus MCP server. Claude can then query it alongside browser journeys to correlate what the code does in the terminal with what it does in the browser.

## Usage

```bash
janus npm run dev                  # wrap a command, unbounded
janus -n 100 python server.py      # rolling window of last 100 lines
janus -n 500 rails server

# Pipe fallback (when you don't control the command invocation)
some_command | janus -n 100
```

## Behaviour

### Wrapping a command (primary interface)

1. Janus connects to `ws://localhost:3457` (non-blocking — if the server isn't running, the child runs normally with no MCP side effect)
2. Generates a short journey ID (6 chars, same format as browser journeys)
3. Prints `[janus] journey: <id>` to **janus's own stderr** before spawning the child — visible in the terminal, never mixed with child output
4. Spawns the child with `spawn(cmd, args)`, piping its stdout and stderr separately
5. Each line from the child is:
   - Written to the corresponding janus stdout/stderr (transparent tee)
   - Tagged with `stream: 'stdout' | 'stderr'` and appended to the rolling buffer
   - Sent to the MCP server as a `sync` message containing the current buffer
6. On child exit: sends `recording_stopped`, exits with the child's exit code

### Pipe mode fallback (`cmd | janus`)

Same as above but reads from `process.stdin`. Stream is always `'stdout'` (indistinguishable in pipe mode). Journey title falls back to the first 40 chars of the first line of output, then `'cli'` if nothing arrives within 1 second.

### Rolling window (`-n`)

- A circular buffer of the last N lines is maintained in-memory by the CLI process
- On each new line: append to buffer (trim oldest if over N), send a full `sync` message
- `sync` replaces the journey's events atomically — the MCP server always holds exactly the last N lines
- Without `-n`: all lines are buffered (unbounded); fine for short-lived commands

### Reconnect

If the WebSocket connection drops (MCP server restart), the CLI reconnects with exponential backoff and sends a full `sync` with the current buffer on reconnect. No lines are lost from the CLI buffer during the outage.

### Exit code

`janus` always exits with the child process's exit code.

## Journey Metadata

| Field | Value |
|---|---|
| `id` | 6-char random ID |
| `domain` | `'cli'` |
| `tabTitle` | `argv.join(' ')` (the full command, e.g. `"npm run dev"`) |
| `startUrl` | `''` |
| `status` | `'recording'` while running, `'stopped'` on exit |

## New Event Type: `cli_line`

Added to `packages/mcp-server/src/types.ts`:

```typescript
interface CliLineEvent {
  id: string
  type: 'cli_line'
  timestamp: number
  line: string
  stream: 'stdout' | 'stderr'
}
```

Added to the `CapturedEvent` union.

## New MCP Tool: `merge_journeys`

```typescript
{
  name: 'merge_journeys',
  description: 'Merge events from multiple journeys sorted by timestamp. Use to correlate browser interactions with CLI output.',
  inputSchema: {
    type: 'object',
    properties: {
      ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Journey IDs to merge'
      }
    },
    required: ['ids']
  }
}
```

**Returns:** a flat array of all events from the specified journeys, sorted by `timestamp` ascending, with a `journeyId` field added to each event indicating its source. Journeys not found are silently skipped (their ID is noted in a `missing` field on the response).

```json
{
  "missing": [],
  "events": [
    { "journeyId": "abc123", "type": "navigation", "timestamp": 1000, ... },
    { "journeyId": "def456", "type": "cli_line",   "timestamp": 1050, "line": "GET /api/users 200", "stream": "stdout" },
    { "journeyId": "abc123", "type": "click",       "timestamp": 1100, ... }
  ]
}
```

## Package Structure

New package at `packages/janus-cli/`:

```
packages/janus-cli/
  src/
    index.ts       — entry point: arg parsing, child spawn or stdin mode, tee loop
    buffer.ts      — circular buffer (RingBuffer class)
    ws-client.ts   — WebSocket connect/reconnect/sync to ws://localhost:3457
  package.json     — bin: { janus: "dist/index.js" }, type: module
  tsconfig.json
```

Modified files:
- `packages/mcp-server/src/types.ts` — add `CliLineEvent` to `CapturedEvent` union
- `packages/mcp-server/src/mcp-tools.ts` — add `merge_journeys` tool

## Error Handling

- **MCP server not running:** child runs normally, no MCP output, no error shown to user
- **Child command not found:** exit with code 127 (standard shell convention)
- **WebSocket drops mid-run:** reconnect silently, resync on reconnect
- **`-n` not a positive integer:** print usage error to stderr, exit 1

## Installation

```bash
cd packages/janus-cli
pnpm install
pnpm build
pnpm link --global   # makes `janus` available on PATH
```
