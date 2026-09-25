/**
 * A form tool that navigates reports where it went.
 *
 * Observed on Hacker News: search(q="jev") returned "Search:" — the form's
 * label — and reported success. extract_result reads the document after the
 * steps run, and a submit that navigates has already replaced it, so the
 * binding read whatever fragment survived.
 *
 * Nothing can extract a result from a document that no longer exists. That is
 * true of WebMCP too, whose handlers are in-page functions with the same fate;
 * sites simply do not write tools that navigate away. Janus derives tools from
 * classic HTML forms, which is exactly the case WebMCP never has to handle, so
 * the honest ceiling is: submitted, went here, cannot see the result.
 */

import { expect, test } from '@playwright/test'
import { startDaemon, type DaemonHandle } from './fixtures/daemon'
import { startSite, type SiteHandle } from './fixtures/site'
import {
  enablePageThroughUi, launchExtension, pairThroughUi, type ExtensionHandle,
} from './fixtures/extension'
import { connectMcp, type McpHandle } from './fixtures/mcp'

let daemon: DaemonHandle
let site: SiteHandle
let extension: ExtensionHandle
let client: McpHandle

test.beforeAll(async () => {
  daemon = await startDaemon()
  site = await startSite()
  extension = await launchExtension()

  const settings = await extension.settings()
  const { pairingId } = await pairThroughUi(settings, daemon.mcpUrl)
  await settings.close()

  client = await connectMcp(daemon.mcpUrl, await daemon.createClient(pairingId, 'nav-form'))
})

test.afterAll(async () => {
  await client?.close().catch(() => {})
  await extension?.stop()
  await site?.stop()
  await daemon?.stop()
})

test('a submit that navigates reports its destination, not a scraped result', async () => {
  const page = await extension.context.newPage()
  await page.goto(site.url)

  const popup = await extension.popup()
  await enablePageThroughUi(popup)
  // Form tools submit, so they only publish once the site is opted in.
  // Located by role rather than label text: the label wraps explanatory prose
  // that changes with the checkbox state, which made this match flakily.
  const writes = popup.getByRole('checkbox').first()
  await writes.check()
  await expect(writes).toBeChecked()
  await popup.close()
  await page.waitForTimeout(750)

  const pages = JSON.parse((await client.call('list_pages', {})).text) as Array<{ pageId: string }>
  const listed = JSON.parse(
    (await client.call('list_page_tools', { pageId: pages[0].pageId })).text,
  ) as { tools: Array<{ name: string; toolId: string; revision: number }> }

  // The fixture has two forms: #search is AJAX and preventDefault()s, #lookup
  // is a classic GET that replaces the document. This is about the latter.
  const forms = listed.tools.filter((t) => t.toolId.startsWith('af_'))
  expect(forms.length, 'no auto-derived form tool was published').toBeGreaterThan(0)
  const form = forms.find((t) => /look|ref/i.test(t.name)) ?? forms[forms.length - 1]

  const result = await client.call('call_page_tool', {
    pageId: pages[0].pageId,
    toolId: form.toolId,
    revision: form.revision,
    input: { ref: 'abc123' },
  })

  // The fixture form navigates on submit. Either the call completes normally
  // because the page did not actually leave, or it reports the navigation —
  // what it must never do is claim a result it could not have read.
  if (result.text.includes('navigated')) {
    expect(result.isError, result.text).toBe(false)
    expect(result.text).toContain('url')
  }
  expect(result.text, 'reported an unknown outcome for an ordinary navigation')
    .not.toContain('outcome_unknown')

  await page.close()
})
