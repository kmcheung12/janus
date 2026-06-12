# Janus

Software development isn't a pipeline from idea to product. A product is what generates the next idea — what broke, what confused users, what worked better than expected. Janus closes that loop.

Most coding agents work from specs and diffs. They don't know what actually happened in the browser. Janus captures real sessions — interactions, errors, network calls — and pipes them directly into Claude, so your agent starts from what's true instead of what's assumed.

Stop copy-pasting stack traces into Claude. Your browser can do that itself.

## Install the extension

**Chrome:**
1. `pnpm install && pnpm build`
2. Open `chrome://extensions`, enable Developer Mode, click "Load unpacked", select `output/chrome-mv3/`

**Firefox:**
1. `pnpm install && pnpm build:firefox`
2. Open `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on", select any file inside `output/firefox-mv2/`

## Install the MCP server

The MCP server is a local daemon that receives journey data from the extension over WebSocket and exposes it to Claude Code via four MCP tools: `list_journeys`, `get_journey_by_id`, `get_journeys_by_domain`, and `latest_journey`.

### 1. Build the server

```bash
cd packages/mcp-server
pnpm install
pnpm build
```

This compiles TypeScript to `packages/mcp-server/dist/`.

### 2. Start the daemon

Run this in a terminal (keep it running while using Claude Code):

```bash
node /path/to/janus/packages/mcp-server/dist/index.js
```

The server listens on two ports:
- `3456` — MCP SSE endpoint (`http://localhost:3456/sse`)
- `3457` — WebSocket endpoint for the extension (`ws://localhost:3457`)

### 3. Register with Claude Code

Add a `.mcp.json` to the root of **the project you want to use Janus in**:

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

Claude Code picks this up automatically when you open that project.

To register globally instead (available in all projects), add the same block to `~/.claude/settings.json` under `"mcpServers"`.

### 4. Verify

In Claude Code, the `mcp__janus__list_journeys` tool should be available. Start a recording in the extension, then call `list_journeys` — the journey should appear.

### Notes

- The daemon must be running **before** Claude Code connects. If you start it after, restart Claude Code or reconnect the MCP server.
- Journey data is in-memory only — it is lost when the daemon restarts. The extension will resync the active recording on reconnect, but stopped journeys are gone.
- Attached files are written to `$TMPDIR/janus-mcp/<journeyId>/` and survive daemon restarts at the filesystem level, but the in-memory journey record referencing them does not.

## Install the `janus` CLI

The `janus` CLI wraps any command and streams its output as a journey to the MCP server, so Claude can see what your processes are doing alongside browser sessions.

### 1. Build and install

```bash
cd packages/janus-cli
npm install
npm run build
npm link
```

This makes `janus` available on your PATH.

### Development (no build step)

```bash
cd packages/janus-cli
npm install
npm start -- echo "hello"          # runs via tsx directly
npm start -- -n 100 rails server   # with flags
echo "hello"|npm start             # pipe mode
```

Or from the repo root after installing tsx globally (`npm install -g tsx`):

```bash
tsx packages/janus-cli/src/index.ts echo "hello"
```

### 2. Use it

```bash
# Wrap a command — captures stdout and stderr separately
janus npm run dev
janus python server.py

# Rolling window — keep only the last N lines (useful for chatty daemons)
janus -n 100 rails server

# Pipe mode — filter output before it reaches Janus
long_running_command | grep ERROR | janus -n 50
```

Janus prints the journey ID to stderr on start:

```
[janus] journey: a1b2c3
```

Use that ID with `get_journey_by_id` or combine multiple journeys with `merge_journeys` to correlate CLI output with browser interactions.

### Notes

- The MCP server must be running before you use `janus` — if it's not reachable, the command runs normally with no MCP side effect
- Without `-n`, all output is buffered in memory — use `-n` for long-running processes
- `janus` exits with the wrapped command's exit code

## Development

```bash
pnpm dev          # extension hot-reload (Chrome)
pnpm dev:firefox  # extension hot-reload (Firefox)
pnpm test         # run tests
```
