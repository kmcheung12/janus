# Proposal: automated Firefox coverage

## Why

Firefox is a shipped target — `dev:firefox`, `build:firefox`, documented
install steps — with no automated coverage at all. Two Firefox-only defects
shipped through a fully green suite in a single day:

1. **`URLSearchParams` iteration under Xray wrappers.** `[...params.keys()]`
   throws in a Firefox content script. `read_page` was completely broken;
   288 unit tests (jsdom) and 18 e2e tests (Chromium) passed.
2. **The tool republish loop.** Both engines were affected, but the symptom
   was only loud enough to notice under Firefox's persistent MV2 background
   page. It was found by hand, and the first explanation written into the
   commit message was wrong.

Neither was bad luck. The suite is structurally blind to an entire engine:
Playwright cannot load extensions in Firefox, so `tests/e2e` is Chromium-only
by construction, and jsdom has neither Xray wrappers nor extension messaging.

The class of bug is specific and recurring: **anything touching a DOM object
or an extension API behaves differently under Firefox's content-script
isolation.** That is most of `auto-tools`, `recipe-runtime` and `form-scanner`.

## What not to do

- **Port the whole e2e suite.** It drives pairing through real UI against a
  real daemon; reproducing that under a second harness doubles the maintenance
  for mostly duplicate coverage.
- **Wait for Playwright to support Firefox extensions.** WebDriver BiDi has
  `webExtension.install`, and Playwright may expose it eventually, but that is
  not a plan with a date.

## Proposal: a smoke lane, not a second suite

One spec, run against Firefox, asserting only what is engine-specific. Target
is ~5 minutes to write per case and under 30 seconds to run.

**Harness: `web-ext` + `geckodriver`.** `web-ext run` loads a temporary add-on
from `output/firefox-mv2/` and can attach to a marionette port. The thin path
is `npm i -D web-ext geckodriver selenium-webdriver`, then install the built
add-on via geckodriver's `installAddon(path, temporary: true)` and drive an
ordinary page. No pairing, no daemon.

**Cases, in priority order:**

| | Catches |
| --- | --- |
| `read_page` returns a title and links on a fixture page | Xray iteration, `getComputedStyle`, `closest` — the class that broke |
| `find_text` returns a match | `TreeWalker` under Xrays |
| `list_forms` returns the fixture's two forms | `form.elements` behaviour |
| Console patch stays quiet with no recording, emits when told | The MAIN-world shim, which WXT implements differently on Firefox |
| Background logs its build stamp within N seconds | MV2 background page boots at all |

Invoked through the same content-script message handlers the daemon uses
(`JANUS_BT_LIST_TOOLS`, `JANUS_BT_INVOKE`), so the assertions exercise the
real path rather than a test-only entry point.

**Deliberately excluded:** pairing, the daemon, the MCP surface, grants,
queueing, revision handling. Those are engine-independent and already covered
under Chromium. This lane exists to answer one question — *does the extension
work when the JS boundary is different* — and it should stay small enough that
nobody is tempted to skip it.

## Cost and honesty

- Three new dev dependencies, one spec file, one npm script (`test:firefox`).
- Runs headed or under `xvfb`; geckodriver has no equivalent of Chrome's new
  headless extension support, so CI needs a display. That is the main cost.
- It will not catch Firefox-specific *timing* or background-lifetime issues,
  which is where the republish loop actually hurt. Those need the profiler.

Not proposed as a gate on every commit. Running it before a release, and after
any change to `auto-tools`, `recipe-runtime`, `form-scanner` or the MAIN-world
scripts, would have caught both of today's defects.

## Alternative if the dependency cost is unwanted

A single `npm run verify:firefox` that builds, launches Firefox with the
add-on, opens a fixture page, and prints the result of `read_page` for a human
to glance at. Not a test, but it turns "nobody checked Firefox" into a
ten-second habit, and it is perhaps twenty lines.
