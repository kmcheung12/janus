# Janus

Janus lets your coding agent observe what you observe while you're testing - without you having to describe it. Coding agents can read your code but they can't see your running application. When something looks wrong, developers become translators: reproducing issues, copying logs, describing browser behavior, pasting everything into chat.

Janus captures real sessions — interactions, console errors, network requests, screenshots, terminal output — and streams them directly to your agent. Your agent works from what was actually observed, not your description of it.

## Demo

<video src="https://github.com/user-attachments/assets/c956bf30-9810-4a03-9030-65a5ce0cfffc" controls width="100%"></video>

> Dev workflow for [splendor](https://github.com/kmcheung12/splendor).


## Architecture

```
  Browser                         Terminal
┌──────────────┐               ┌───────────┐
│  Extension   │               │ janus cli │
└──┬────────┬──┘               └─────┬─────┘
   │        │                        │
   │        │ control (authenticated)│ journeys
   │        │ ws://127.0.0.1:3457    │
   │        └────────────┬───────────┘
   │ journeys            │
   └─────────────────────┤
                  ┌──────▼──────┐
                  │  MCP server │  (daemon)
                  └──────┬──────┘
                         │ HTTP + bearer token
                  ┌──────▼──────┐
                  │ coding agent│
                  └─────────────┘
```

Janus does two separate things over one daemon:

- **Observe** — journeys from the extension and the `janus` CLI, queryable as
  `list_journeys`, `get_journey_by_id`, `get_journeys_by_domain`,
  `latest_journey`, `merge_journeys`. No pairing needed.
- **Act** — the browser command bridge. An agent discovers and invokes tools on
  pages you explicitly enable: a site's own [WebMCP](https://webmachinelearning.github.io/webmcp/)
  tools where it has them, or tools Janus generates where it doesn't. Requires
  pairing, and is off by default.

The extension also works standalone: capture in the sidebar and copy a prompt.
The `janus` CLI without the daemon is a no-op passthrough.

---

## Table of contents

- [Build everything](#build-everything)
- [Run the daemon](#run-the-daemon)
- [Observe: query journeys](#observe-query-journeys)
- [Act: pair a browser and invoke page tools](#act-pair-a-browser-and-invoke-page-tools)
- [`janus-mcp` command reference](#janus-mcp-command-reference)
- [Install the `janus` CLI](#install-the-janus-cli)

---

## Build everything

> Run from the **repo root** unless noted.

```bash
npm install
npm run build          # extension  -> output/chrome-mv3/
npm run build:server   # daemon     -> packages/mcp-server/dist/
```

### Extension

**Chrome** — `chrome://extensions` → enable Developer Mode → **Load unpacked** →
select `output/chrome-mv3/`.

**Firefox** — `npm run build:firefox`, then
`about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → select any
file inside `output/firefox-mv2/`.

Reload the extension from that page after every rebuild. The MV3 service worker
holds the control connection, so a stale worker keeps reporting "Connected"
while running old code.

### Daemon and the `janus-mcp` command

```bash
cd packages/mcp-server
npm install
npm run build
npm link               # puts `janus-mcp` on your PATH
```

`npm link` is optional — every command below also works as
`node /path/to/janus/packages/mcp-server/dist/index.js <args>`.

---

## Run the daemon

> Keep this terminal open. Admin commands go in a second terminal.

```bash
janus-mcp
```

It prints a readiness line with its URLs and listens on:

- `3456` — MCP, Streamable HTTP at `/mcp` and legacy SSE at `/sse`
- `3457` — WebSocket for the extension and the `janus` CLI

Both bind to loopback only. Options: `--mcp-port`, `--ws-port`, `--bind`,
`--data-dir` (default `~/.janus`). Port `0` picks an ephemeral port.

---

## Observe: query journeys

Journey capture itself needs no pairing, but the MCP endpoint always requires a
bearer token.

> **Rough edge:** client tokens are scoped to a browser pairing, so
> `client create` needs a `--pairing-id` that exists. Today that means even a
> journeys-only setup has to pair a browser first ([step 1](#1-pair-the-browser)).
> Scoping was designed for execution, and querying journeys inherited it.

Once you have a token:

```bash
claude mcp add --transport http janus http://127.0.0.1:3456/mcp \
  --header "Authorization: Bearer <token>"
```

Then `/mcp` in Claude Code should show janus connected, and `list_journeys`
should answer.

<details>
<summary>Other clients</summary>

**OpenCode** — `opencode.json` (project) or `~/.config/opencode/config.json`:
```json
{
  "mcp": {
    "janus": {
      "type": "remote",
      "url": "http://127.0.0.1:3456/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

**Cursor** — `.cursor/mcp.json` or `~/.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "janus": {
      "url": "http://127.0.0.1:3456/sse",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

**Codex CLI** — `~/.codex/config.yaml` (Streamable HTTP only):
```yaml
mcpServers:
  janus:
    url: "http://127.0.0.1:3456/mcp"
    headers:
      Authorization: "Bearer <token>"
```
</details>

Start a recording in the extension, or wrap a command with `janus {cmd}`, then
call `list_journeys`.

---

## Act: pair a browser and invoke page tools

Execution turns Janus from watching a session into driving one, so it is gated
behind an explicit pairing and per-page enablement.

### 1. Pair the browser

Extension **Settings → Browser connection → Pair with Janus**.

The extension generates a credential and immediately tries to connect. The
daemon refuses it — it has never been told about it — and the panel shows
**Awaiting daemon**. That is expected. Do **not** pair again; that mints a new
credential and invalidates the one on screen.

Click **Copy pairing JSON**, then in your second terminal:

```bash
pbpaste | janus-mcp pair --stdin        # macOS
# wl-paste | janus-mcp pair --stdin     # Linux/Wayland
```

Back in settings, click **Retry connection**. Status becomes **Connected**.

The secret is only ever passed on stdin, so it never reaches your shell history
or `ps`. The daemon stores a SHA-256 of it, never the token itself.

### 2. Mint a token for your agent

```bash
janus-mcp list                                   # find your pairing ID
janus-mcp client create --pairing-id <id> --label "claude code"
```

Printed once. Add `--author` to allow tool authoring (see below).

Register it with `claude mcp add` exactly as above. Scope notes:

- `--scope local` (default) writes `~/.claude.json`, mode `0600`, not in git
- avoid `--scope project` — that writes `.mcp.json`, and the token would be
  committed

### 3. Enable a page

Open the page, then the Janus popup → **Enable tools on this page**.

- Off by default, one page at a time, and switching tabs never moves it
- Navigating away invalidates the page handle; re-enable on the new document
- The popup reports whether native WebMCP is available on that page

### 4. Invoke

Each enabled action is published as its own MCP tool named
`web__<page>__<tool>__<id>`, carrying the site's real input schema. Ask your
agent to `list_pages`, then call one.

Names stay stable across revisions; the expected revision travels as a required
argument, so a call built against a stale schema is rejected with
`STALE_REVISION` rather than silently running.

### Native WebMCP (Chrome)

For sites that ship their own tools, enable
`chrome://flags/#enable-webmcp-testing` and relaunch. Without it
`document.modelContext` is absent and only Janus-generated tools are available.

Verified against <https://shopping-webmcp-demo.netlify.app/> on
Chrome 153.0.8010.12 — 11 tools discovered and driven end to end. This is a
flagged result, not an unflagged release claim.

### Generating tools for sites without WebMCP

With an `--author` token: capture a form on the enabled page, ask your agent to
call `list_tool_drafts` / `get_tool_draft` / `submit_tool_definition`, then
review and enable the result in **Settings → Saved tools**.

The agent proposes a name, description, schema and which captured steps to
keep. It cannot supply selectors, URLs or new steps — Janus copies those from
the draft — and a submitted definition stays inactive until you enable it.

---

## `janus-mcp` command reference

```
janus-mcp                                   start the daemon
janus-mcp pair --stdin                      provision a browser (JSON on stdin)
janus-mcp client create --pairing-id ID --label NAME [--author]
janus-mcp producer create --label NAME      journey capture only, no execution
janus-mcp revoke <pairingId>                remove a browser and its clients
janus-mcp list                              show pairings and clients
```

All accept `--data-dir DIR`. Credentials live in `~/.janus/credentials.json`
(`0600`).

Three credential kinds, deliberately not interchangeable: an **executor**
(browser) may publish pages and resolve calls; a **client** (agent) may discover
and invoke; a **producer** (journey capture) may never execute.

---

## Notes

- The daemon must be running **before** your agent connects. If not, restart the
  agent or reconnect the MCP server.
- Journey data is in-memory only and lost on daemon restart. The extension
  resyncs an active recording on reconnect; stopped journeys are gone.
- Attached files land in `$TMPDIR/janus-mcp/<journeyId>/` and survive restarts on
  disk, but the journey record referencing them does not.
- Credentials do persist, in `--data-dir`.
- A timed-out or disconnected invocation is reported as **outcome unknown** and
  never retried automatically — the page may already have acted.

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
npm test             # extension unit tests (vitest/jsdom)
npm run test:e2e     # builds both, then Playwright against a real browser
```

Daemon tests live in their own workspace:

```bash
cd packages/mcp-server && npm test
```

The end-to-end suite launches a real browser with the built extension and its
own daemon on ephemeral ports, so it never touches `3456`/`3457` or your real
credentials. It runs single-worker with no retries on purpose: it asserts
execution ordering, which parallelism would make meaningless and a retry would
mask.

`npm run dev` launches its own browser profile, so it will not pick up a
`chrome://flags` setting such as `enable-webmcp-testing`.
