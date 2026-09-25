/**
 * Per-origin grants and agent navigation.
 *
 * Enablement used to die at every navigation, so a task spanning two URLs on
 * one site was not expressible. A grant is an origin; a page handle is still a
 * document, with its §7 guarantees intact — new document, new random handle,
 * nothing carried across. What changes is only that the human is no longer in
 * the loop between the two.
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

  client = await connectMcp(daemon.mcpUrl, await daemon.createClient(pairingId, 'grants'))
})

test.afterAll(async () => {
  await client?.close().catch(() => {})
  await extension?.stop()
  await site?.stop()
  await daemon?.stop()
})

/** list_pages answers with a hint object, not an array, when nothing is enabled. */
async function pageIds(): Promise<Array<{ pageId: string; url: string }>> {
  const parsed = JSON.parse((await client.call('list_pages', {})).text)
  return Array.isArray(parsed) ? parsed : []
}

async function navigateTool(pageId: string) {
  const listed = JSON.parse((await client.call('list_page_tools', { pageId })).text) as {
    tools: Array<{ name: string; toolId: string; revision: number }>
  }
  return listed.tools.find((t) => t.name === 'navigate')!
}

test('an agent can follow a link within the granted origin', async () => {
  const page = await extension.context.newPage()
  await page.goto(site.url)
  const popup = await extension.popup()
  await enablePageThroughUi(popup)
  await popup.close()

  const before = (await pageIds())[0]
  const navigate = await navigateTool(before.pageId)
  expect(navigate, 'navigate was not published').toBeTruthy()

  const result = await client.call('call_page_tool', {
    pageId: before.pageId,
    toolId: navigate.toolId,
    revision: navigate.revision,
    input: { url: '/landed?ref=abc' },
  })
  expect(result.isError, result.text).toBe(false)

  // The handle is new — §7 is unchanged — but the grant re-mints it without a
  // human, which is the whole point. navigate cannot return it: withdrawing
  // the old handle is what fails an in-flight call, so it answers first.
  let after = await pageIds()
  for (let i = 0; i < 20 && !after.some((p) => p.url.includes('/landed')); i++) {
    await page.waitForTimeout(250)
    after = await pageIds()
  }
  expect(after.length, 'the page was not re-minted after navigating').toBe(1)
  expect(after[0].pageId).not.toBe(before.pageId)
  expect(after[0].url).toContain('/landed')

  await page.close()
})

test('navigate refuses another origin and a URL carrying a token', async () => {
  const page = await extension.context.newPage()
  await page.goto(site.url)
  const popup = await extension.popup()
  await enablePageThroughUi(popup)
  await popup.close()

  const target = (await pageIds()).find((p) => p.url.startsWith(site.url))!
  const navigate = await navigateTool(target.pageId)

  const crossOrigin = await client.call('call_page_tool', {
    pageId: target.pageId,
    toolId: navigate.toolId,
    revision: navigate.revision,
    input: { url: 'https://example.com/' },
  })
  expect(crossOrigin.text).toMatch(/outside this grant/)

  // Read tools redact these on the way out, so a URL still carrying one did
  // not come from us — refusing beats quietly visiting /landed instead.
  const withToken = await client.call('call_page_tool', {
    pageId: target.pageId,
    toolId: navigate.toolId,
    revision: navigate.revision,
    input: { url: '/landed?ref=1&auth=deadbeef' },
  })
  expect(withToken.text).toMatch(/session token/)

  await page.close()
})
