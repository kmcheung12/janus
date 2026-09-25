/**
 * Firefox smoke lane.
 *
 * Firefox is a shipped target with no coverage in either existing suite:
 * Playwright cannot load extensions there, and jsdom has neither Xray wrappers
 * nor extension messaging. Two Firefox-only defects shipped through a fully
 * green suite in one day, the sharpest being `[...params.keys()]` throwing
 * under an Xray wrapper, which broke read_page entirely.
 *
 * So this asserts only what is engine-specific — that the content script's DOM
 * work survives Firefox's isolation — and deliberately covers none of the
 * daemon, pairing, MCP or grants, which are engine-independent and already
 * covered under Chromium. It is a smoke lane, not a second suite.
 *
 *   npm run test:firefox          (needs a display; see the proposal doc)
 */

import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Builder } from 'selenium-webdriver'
import firefox from 'selenium-webdriver/firefox.js'

const BUILD = resolve(import.meta.dirname, '../../output/firefox-mv2')

/** Pinned so extension pages are addressable; see the gecko id in wxt.config. */
const ADDON_ID = 'janus@local'
const ADDON_UUID = '01234567-89ab-cdef-0123-456789abcdef'

const FIXTURE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Firefox fixture</title></head>
<body>
  <h1>Firefox fixture</h1>
  <p>Some prose the read tools should find, mentioning marmalade.</p>
  <a href="/other?id=7&auth=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef">a link</a>
  <div style="position: fixed" id="sticky">sticky</div>
  <form id="lookup" method="get" action="/other">
    <label for="ref">Reference</label>
    <input id="ref" name="ref" type="text">
    <button type="submit">Look up</button>
  </form>
</body></html>`

const checks = []
function check(name, fn) { checks.push({ name, fn }) }

// ── the cases ───────────────────────────────────────────────────────────────

check('read_page returns the page under Xray wrappers', async (call) => {
  const outcome = await call('a_read_page', {})
  assert.equal(outcome.status, 'completed', JSON.stringify(outcome))

  const result = outcome.result
  assert.equal(result.title, 'Firefox fixture')
  assert.ok(result.text.includes('marmalade'), 'main text was not extracted')
  assert.ok(result.links.length > 0, 'no links were extracted')

  // The defect that motivated this lane: URLSearchParams iteration throws
  // under an Xray wrapper, so every href went through a path that crashed.
  const link = result.links.find((l) => l.href.includes('/other'))
  assert.ok(link, 'the fixture link was not returned')
  assert.ok(!link.href.includes('deadbeef'), 'a session token survived sanitising')
  assert.ok(link.href.includes('id=7'), 'an addressing parameter was stripped')
})

check('find_text walks the document', async (call) => {
  const outcome = await call('a_find_text', { query: 'marmalade' })
  assert.equal(outcome.status, 'completed', JSON.stringify(outcome))
  assert.ok(outcome.result.matches.length > 0, 'TreeWalker found nothing')
})

check('list_forms reads form elements', async (call) => {
  const outcome = await call('a_list_forms', {})
  assert.equal(outcome.status, 'completed', JSON.stringify(outcome))
  const form = outcome.result.forms.find((f) => f.fields.some((x) => x.name === 'ref'))
  assert.ok(form, 'the fixture form was not described')
})

// ── harness ─────────────────────────────────────────────────────────────────

/**
 * A copy of Firefox the test owns.
 *
 * Launching the installed application applies whatever update it has staged,
 * and applying an update invokes org.mozilla.updater — a macOS prompt for
 * admin rights that blocks startup. The staging area is keyed to the
 * application's path, so a throwaway profile does not avoid it; a copy at a
 * different path does.
 *
 * Kept between runs, since copying ~150MB per test run would be worse than
 * the problem. FIREFOX_BIN overrides this entirely.
 */
function firefoxBinary() {
  if (process.env.FIREFOX_BIN) return process.env.FIREFOX_BIN
  if (process.platform !== 'darwin') return undefined

  const source = '/Applications/Firefox.app'
  if (!existsSync(source)) return undefined

  const cached = join(tmpdir(), 'janus-firefox', 'Firefox.app')
  const binary = join(cached, 'Contents/MacOS/firefox')
  if (!existsSync(binary)) {
    process.stdout.write('  (copying Firefox once, so the test never triggers its updater)\n')
    mkdirSync(join(tmpdir(), 'janus-firefox'), { recursive: true })
    cpSync(source, cached, { recursive: true, verbatimSymlinks: true })
  }
  return binary
}

async function main() {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(FIXTURE)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}/`

  const options = new firefox.Options()
  options.setBinary(firefoxBinary())
  if (!process.env.JANUS_HEADED) options.addArguments('-headless')
  // Pin the internal UUID so moz-extension:// pages are addressable. Firefox
  // randomises it per profile otherwise.
  options.setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: ADDON_UUID }))

  /*
   * No updater. A throwaway profile still runs the real application, and on
   * macOS Firefox will try to install its privileged updater helper — a modal
   * asking for admin rights, which blocks startup until answered and then
   * fails as "could not read marionette port". A test has no business
   * prompting for privileges.
   */
  // The pref Mozilla's own test infrastructure uses. The app.update.auto and
  // .enabled pair govern whether to *check* for updates, not whether to
  // elevate, which is why setting them did not stop the prompt.
  options.setPreference('app.update.disabledForTesting', true)
  options.setPreference('app.update.auto', false)
  options.setPreference('app.update.background.enabled', false)
  options.setPreference('app.update.staging.enabled', false)
  options.setPreference('browser.shell.checkDefaultBrowser', false)

  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build()
  let failures = 0

  try {
    await driver.installAddon(BUILD, true)

    // The extension page is opened first, in the tab the session starts with.
    // Navigating a tab created by switchTo().newWindow() to moz-extension://
    // is refused as "not allowed in this context".
    await driver.get(`moz-extension://${ADDON_UUID}/settings.html`)

    // The fixture goes in a second tab; the calls are issued from the
    // extension page, which is the path the daemon uses.
    const extensionHandle = await driver.getWindowHandle()
    await driver.switchTo().newWindow('tab')
    await driver.get(url)
    await driver.switchTo().window(extensionHandle)

    const call = async (toolId, input) => driver.executeAsyncScript(
      // eslint-disable-next-line no-undef
      function (targetUrl, id, args, done) {
        browser.tabs.query({}).then((tabs) => {
          const tab = tabs.find((t) => t.url && t.url.startsWith(targetUrl))
          if (!tab) return done({ status: 'error', error: { message: 'fixture tab not found' } })
          return browser.tabs.sendMessage(tab.id, {
            type: 'JANUS_BT_INVOKE',
            requestId: String(Math.random()),
            toolId: id,
            input: args,
            timeoutMs: 15000,
          }).then((response) => done(response.outcome), (e) => done({
            status: 'error', error: { message: String(e && e.message ? e.message : e) },
          }))
        })
      },
      url, toolId, input,
    )

    for (const { name, fn } of checks) {
      try {
        await fn(call)
        process.stdout.write(`  ok   ${name}\n`)
      } catch (e) {
        failures++
        process.stdout.write(`  FAIL ${name}\n       ${String(e.message).split('\n')[0]}\n`)
      }
    }
  } finally {
    await driver.quit().catch(() => {})
    server.close()
  }

  process.stdout.write(`\n${checks.length - failures}/${checks.length} passed\n`)
  process.exit(failures ? 1 : 0)
}

main().catch((e) => {
  process.stderr.write(`${e?.stack ?? e}\n`)
  process.exit(1)
})
