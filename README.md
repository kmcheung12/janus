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
  tools where it has them, or tools Janus generates automatically where it
  doesn't. Enabling a page is always explicit and off by default.

The extension also works standalone: capture in the sidebar and copy a prompt.
The `janus` CLI without the daemon is a no-op passthrough.

---

## Table of contents

- [Build everything](#build-everything)
- [Run the daemon](#run-the-daemon)
- [Connect](#connect)
- [What tools a page gets](#what-tools-a-page-gets)
- [Manual pairing](#manual-pairing)
- [`janus-mcp` command reference](#janus-mcp-command-reference)
- [Install the `janus` CLI](#install-the-janus-cli)

---

## Build everything

> Run from the **repo root** unless noted.

```bash
npm install
npm run build          # everything
```

That builds all four artifacts:

| | |
| --- | --- |
| `output/chrome-mv3/` | Chrome extension |
| `output/firefox-mv2/` | Firefox extension |
| `packages/mcp-server/dist/` | daemon and `janus-mcp` |
| `packages/janus-cli/dist/` | the `janus` CLI |

Individually: `build:chrome`, `build:firefox`, `build:server`, `build:cli`.

### Extension

**Chrome** — `chrome://extensions` → enable Developer Mode → **Load unpacked** →
select `output/chrome-mv3/`.

**Firefox** — `about:debugging#/runtime/this-firefox` → **Load Temporary
Add-on** → select any file inside `output/firefox-mv2/`.

Reload the extension from that page after every rebuild. The MV3 service worker
holds the control connection, so a stale worker keeps reporting "Connected"
while running old code.

### Daemon and the `janus-mcp` command

Already built by `npm run build`. To put `janus-mcp` on your PATH:

```bash
npm --prefix packages/mcp-server link
```

`npm link` is optional — every command below also works as
`node /path/to/janus/packages/mcp-server/dist/index.js <args>`.

---

## Run the daemon

> Keep this terminal open.

```bash
janus-mcp
```

It prints its URLs and listens on:

- `3456` — MCP, Streamable HTTP at `/mcp` and legacy SSE at `/sse`
- `3457` — WebSocket for the extension and the `janus` CLI

Both bind to loopback only. Options: `--mcp-port`, `--ws-port`, `--bind`,
`--data-dir` (default `~/.janus`), `--no-auto-pair`. Port `0` picks an
ephemeral port.

---

## Connect

### 1. Pair, in one click

Extension **Settings → Browser connection → Pair with Janus**.

The extension asks the daemon to enrol it, and the daemon issues the
credential. The panel then shows a ready-to-run command with an agent token
already minted:

```bash
claude mcp add --transport http janus http://127.0.0.1:3456/mcp \
  --header "Authorization: Bearer <token>"
```

Run it once. That is the whole setup.

> **How this is bounded.** The daemon only enrols a browser while *no* browser
> is paired. After the first one, the endpoint closes permanently and pairing
> goes back through the CLI. `--no-auto-pair` disables it entirely.
>
> The trade is deliberate: a local process could race the browser to claim
> first enrolment. It is loopback-only, single-use, and the daemon prints
> exactly what it issued. A control that gets routed around is worth less than
> a weaker one that gets used — but if you want the strict path, see
> [manual pairing](#manual-pairing).

Verify with `/mcp` in Claude Code, then ask it to call `list_journeys`.

<details>
<summary>Other clients</summary>

**OpenCode** — `opencode.json` or `~/.config/opencode/config.json`:
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

At this point journeys work: record in the extension or wrap a command with
`janus {cmd}`, then call `list_journeys`.

### 2. Enable a page

Open the page, then the Janus popup → **Enable tools on this page**.

- Off by default. Enabling is what turns Janus from watching a session into
  driving one, so it is always explicit.
- Several tabs can be enabled at once; each is its own page handle. Calls to
  different pages run concurrently, calls to one page queue.
- Navigating away invalidates that page handle — re-enable on the new document.

### 3. Invoke

Each enabled action is published as its own MCP tool named
`web__<page>__<tool>__<id>`, carrying a real input schema. Ask your agent to
`list_pages`, then call one.

Names stay stable across revisions; the expected revision travels as a required
argument, so a call built against a stale schema is rejected with
`STALE_REVISION` rather than silently running.

---

## What tools a page gets

**If the site ships WebMCP**, its own tools are proxied through. They are always
preferred — a site describes its actions better than anything we can infer.

Enable `chrome://flags/#enable-webmcp-testing` and relaunch Chrome, or
`document.modelContext` is absent. Verified against
<https://shopping-webmcp-demo.netlify.app/> on Chrome 153.0.8010.12: 11 tools
discovered and driven end to end. That is a flagged result, not an unflagged
release claim.

**Otherwise Janus generates tools automatically**, with no authoring step and no
model involved:

| Tool | |
| --- | --- |
| `read_page()` | Title, headings, links and main text, with navigation stripped |
| `find_text(query)` | Where a phrase appears, with the nearest link |
| `list_forms()` | What is fillable on the page |

These are read-only and publish the moment a page is enabled.

**Form tools are separate.** They are derived automatically too, but publish only
once you tick **Allow form tools** for that page, because submitting a form on a
logged-in session is real authority. They are named from whatever the page says
about itself — Hacker News's search box becomes `search(q)`, Wikipedia's becomes
`search(search)`. Forms containing a password are skipped entirely, since
submitting one without it can only fail.

Bounds worth knowing: `read_page` caps at 8000 characters and reports
`truncated: true` rather than silently cutting. For a long article, `find_text`
is the better tool.

### Authoring a better tool

Automatic form tools are a floor, not a ceiling. With an authoring token you can
have an agent write a proper one — parameter names, a description, result
extraction — from a captured draft:

```bash
janus-mcp client create --pairing-id <id> --label authoring --author
```

The agent calls `list_tool_drafts` / `get_tool_draft` / `submit_tool_definition`.
It proposes semantics only: it cannot supply selectors, URLs or new steps, and
the result stays inactive until you enable it in **Settings → Saved tools**.

---

## Manual pairing

If you disabled auto-pairing, or are re-pairing a browser:

1. **Settings → Browser connection → Pair with Janus** (falls back automatically)
2. **Copy pairing JSON**
3. `pbpaste | janus-mcp pair --stdin`
4. **Retry connection**

The secret only ever travels on stdin, so it never reaches shell history or
`ps`. The daemon stores a SHA-256 of it, never the token.

Then mint an agent token:

```bash
janus-mcp list
janus-mcp client create --pairing-id <id> --label "claude code"
```

Running more than one browser? Repeat the flag and one token reaches both:

```bash
janus-mcp client create --pairing-id <firefox-id> --pairing-id <chrome-id> \
  --label "claude code"
```

Revoking a browser narrows such a token rather than deleting it; it is only
removed once it has no pairing left.

Scope note: `claude mcp add --scope local` (the default) writes
`~/.claude.json`, mode `0600`, outside git. Avoid `--scope project` — that
writes `.mcp.json` and would commit the token.

---

## `janus-mcp` command reference

```
janus-mcp                                   start the daemon
janus-mcp pair --stdin                      provision a browser (JSON on stdin)
janus-mcp client create --pairing-id ID [--pairing-id ID...] --label NAME [--author]
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

> Run from the **repo root**

Already built by `npm run build`. To put `janus` on your PATH:

```bash
npm --prefix packages/janus-cli link
```

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
