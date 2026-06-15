# Janus

Janus lets your coding agent observe what you observe while you're testing - without you having to describe it. Coding agents can read your code but they can't see your running application. When something looks wrong, developers become translators: reproducing issues, copying logs, describing browser behavior, pasting everything into chat.

Janus captures real sessions — interactions, console errors, network requests, screenshots, terminal output — and streams them directly to your agent. Your agent works from what was actually observed, not your description of it.

## Demo

<video src="https://github.com/user-attachments/assets/c956bf30-9810-4a03-9030-65a5ce0cfffc" controls width="100%"></video>

> Dev workflow for [splendor](https://github.com/kmcheung12/splendor).


## Architecture

```
  Browser                Terminal
┌──────────┐          ┌───────────┐
│Extension │          │ janus cli │
└────┬─────┘          └─────┬─────┘
     │ WebSocket            │ WebSocket
     │ ws://localhost:3457  │ 
     │                      │
     └──────────────────────┘
                    │
             ┌──────▼──────┐
             │  MCP server │
             └──────┬──────┘
                    │ SSE
             ┌──────▼──────┐
             │    Claude   │
             └─────────────┘
```

**Extension** - works standalone without the MCP server. Captures interactions in the sidebar and lets you copy a formatted prompt directly. The MCP server adds ambient, queryable access for Claude.

**`janus` CLI** - without the MCP server it's a no-op passthrough. The MCP server is required for CLI journeys to be queryable.

---

## Table of contents

- [Install the extension](#install-the-extension)
- [Install the MCP server](#install-the-mcp-server)
- [Install the `janus` CLI](#install-the-janus-cli)

---

## Install the extension

> Run from the **repo root** (`/path/to/janus`)

**Chrome:**
1. `npm install && npm run build`
2. Open `chrome://extensions`, enable Developer Mode, click "Load unpacked", select `output/chrome-mv3/`

**Firefox:**
1. `npm install && npm run build:firefox`
2. Open `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on", select any file inside `output/firefox-mv2/`

## Install the MCP server

The MCP server is a local daemon that receives journey data from the extension and `janus` CLI over WebSocket, and exposes it to Claude Code via four MCP tools: `list_journeys`, `get_journey_by_id`, `get_journeys_by_domain`, and `latest_journey`.

### 1. Build the server

> Run from **`packages/mcp-server`**

```bash
cd packages/mcp-server
npm install
npm run build
```

This compiles TypeScript to `packages/mcp-server/dist/`.

### 2. Start the daemon

> Run from anywhere - keep this terminal open while using Claude Code

```bash
node /path/to/janus/packages/mcp-server/dist/index.js
```

The server listens on two ports:
- `3456` - MCP SSE endpoint (`http://localhost:3456/sse`) - Claude talks here
  - streamable http endpoint (`http://localhost:3456/mcp`) - OpenCode talks here
- `3457` - WebSocket endpoint (`ws://localhost:3457`) - extension and CLI talk here

### 3a. Register with Claude Code

> Run from the **root of the project you want to use Janus in** (not the Janus repo)

```bash
cat > .mcp.json << 'EOF'
{
  "mcpServers": {
    "janus": {
      "type": "sse",
      "url": "http://localhost:3456/sse"
    }
  }
}
EOF
```

### 3b. Register with OpenCode

> **Scope:** project or global

To configure Janus per project, add to `opencode.json` in the project root:
```json
{
  "mcp": {
    "janus": {
      "type": "remote",
      "url": "http://localhost:3456/mcp"
    }
  }
}
```

To register globally, add the same block to `~/.config/opencode/config.json`.

### 3c. Register with Cursor

> **Scope:** project or global — uses **SSE** transport (`/sse` endpoint)

To configure per project, add to `.cursor/mcp.json` in the project root:
```json
{
  "mcpServers": {
    "janus": {
      "url": "http://localhost:3456/sse"
    }
  }
}
```

To register globally, add the same block to `~/.cursor/mcp.json`.

### 3d. Register with Codex CLI

> **Scope:** global only — uses **Streamable HTTP** transport (`/mcp` endpoint)

Codex does not support SSE transport. Add to `~/.codex/config.yaml`:
```yaml
mcpServers:
  janus:
    url: "http://localhost:3456/mcp"
```

### 4. Verify

In Claude Code, the `mcp__janus__list_journeys` tool should be available. Type `/mcp`, you should see janus connected.

In OpenCode, use `/mcps` to see available mcps.

Start a recording in the extension, or wrap a command line call with `janus {cmd}`, then call `list_journeys` - the journey should appear.

### Notes

- The daemon must be running **before** your coding agent connects. If you start it after, restart the agent or reconnect the MCP server.
- Journey data is in-memory only - it is lost when the daemon restarts. The extension will resync the active recording on reconnect, but stopped journeys are gone.
- Attached files are written to `$TMPDIR/janus-mcp/<journeyId>/` and survive daemon restarts at the filesystem level, but the in-memory journey record referencing them does not.

## Install the `janus` CLI

The `janus` CLI wraps any command and streams its output as a journey to the MCP server, so Claude can see what your processes are doing alongside browser sessions.

### 1. Build and install

> Run from **`packages/janus-cli`**

```bash
cd packages/janus-cli
npm install
npm run build
npm link
```

This makes `janus` available on your PATH.

### Development (no build step)

> Run from **`packages/janus-cli`**

```bash
npm install
npm start -- echo "hello"          # runs via tsx directly
npm start -- -n 100 rails server   # with flags
echo "hello" | npm start           # pipe mode
```

Or from anywhere after installing tsx globally (`npm install -g tsx`):

```bash
tsx /path/to/janus/packages/janus-cli/src/index.ts echo "hello"
```

### 2. Use it

> Run from anywhere

```bash
# Wrap a command - captures stdout and stderr separately
janus npm run dev
janus python server.py

# Rolling window - keep only the last N lines (useful for chatty daemons)
janus -n 100 rails server

# Pipe mode - filter output before it reaches Janus
long_running_command | grep ERROR | janus -n 50
```

Janus prints the journey ID to stderr on start and again on exit:

```
[janus] journey: a1b2c3
...
[janus] journey: a1b2c3
```

Use that ID with `get_journey_by_id` or combine multiple journeys with `merge_journeys` to correlate CLI output with browser interactions.

### Notes

- The MCP server must be running before you use `janus` - if it's not reachable, the command runs normally with no MCP side effect
- Without `-n`, all output is buffered in memory - use `-n` for long-running processes
- `janus` exits with the wrapped command's exit code

## Development

> Run from the **repo root** (`/path/to/janus`)

```bash
npm run dev          # extension hot-reload (Chrome)
npm run dev:firefox  # extension hot-reload (Firefox)
npm test             # run tests
```
