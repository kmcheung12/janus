/**
 * The MAIN-world console patch collects when asked and stays quiet otherwise.
 *
 * It is told which levels to collect so it can skip stringifying arguments and
 * building a stack trace for output nobody wants — which is most console calls
 * on most pages, since nothing is captured unless a recording is running. The
 * failure mode of getting that wrong is silent: console events stop appearing
 * in journeys with no error anywhere.
 *
 * Asserted on the DOM event the patch dispatches rather than on a journey: the
 * journey socket is hardcoded to ws://localhost:3457, while this harness uses
 * ephemeral ports so it never touches a developer's real daemon. Journey
 * delivery is therefore not reachable from here at all.
 */

import { expect, test } from '@playwright/test'
import { startSite, type SiteHandle } from './fixtures/site'
import { launchExtension, type ExtensionHandle } from './fixtures/extension'

let site: SiteHandle
let extension: ExtensionHandle

test.beforeAll(async () => {
  site = await startSite()
  extension = await launchExtension()
})

test.afterAll(async () => {
  await extension?.stop()
  await site?.stop()
})

/** Counts the events the MAIN-world patch dispatches, from the page itself. */
async function watchConsoleEvents(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    ;(window as unknown as { __seen: number }).__seen = 0
    document.addEventListener('janus:console-event', () => {
      ;(window as unknown as { __seen: number }).__seen++
    })
  })
}

const seen = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __seen: number }).__seen)

test('console output is collected while recording and ignored otherwise', async () => {
  const page = await extension.context.newPage()
  await page.goto(site.url)
  await page.waitForTimeout(500)
  await watchConsoleEvents(page)

  // Recording is off: the patch should reject before doing any work.
  await page.evaluate(() => { console.error('quiet-marker') })
  await page.waitForTimeout(300)
  expect(await seen(page), 'collected console output with no recording running')
    .toBe(0)

  // Addressed by tab id rather than through the popup button: the popup opens
  // as a tab here, and App.svelte's toggleRecording targets the active tab
  // without the resolveTargetTab() guard PageAccessPanel uses, so the button
  // would start recording the popup instead.
  const popup = await extension.popup()
  await popup.evaluate(async (origin) => {
    const tabs = await chrome.tabs.query({})
    const tab = tabs.find((t) => t.url?.startsWith(origin))
    await chrome.runtime.sendMessage({ type: 'JANUS_TOGGLE_RECORDING', tabId: tab!.id })
  }, site.url)
  await popup.close()
  await page.waitForTimeout(500)

  // A distinct message: the patch suppresses repeats, so reusing the first one
  // would pass whether or not the level push worked.
  await page.evaluate(() => { console.error('recorded-marker') })
  await page.waitForTimeout(300)
  expect(await seen(page), 'dropped console output while recording was running')
    .toBeGreaterThan(0)

  await page.close()
})
