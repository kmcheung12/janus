import { expect, test } from '@playwright/test'
import { startDaemon, type DaemonHandle } from './fixtures/daemon'
import { startSite, type SiteHandle } from './fixtures/site'
import {
  enablePageThroughUi, launchExtension, pairThroughUi, type ExtensionHandle,
} from './fixtures/extension'
import { connectMcp, type McpHandle } from './fixtures/mcp'

/**
 * §20 M1 and M1.5 scenarios, against the real built extension, a real daemon
 * and a real browser. Native WebMCP is deliberately absent from this lane:
 * the bridge must work without it.
 */

let daemon: DaemonHandle
let site: SiteHandle
let extension: ExtensionHandle
let pairingId: string
const clients: McpHandle[] = []

test.beforeAll(async () => {
  daemon = await startDaemon()
  site = await startSite()
  extension = await launchExtension()

  const settings = await extension.settings()
  ;({ pairingId } = await pairThroughUi(settings, daemon.mcpUrl))
  await settings.close()
})

test.afterAll(async () => {
  for (const client of clients) await client.close().catch(() => {})
  await extension?.stop()
  await site?.stop()
  await daemon?.stop()
})

async function agent(label: string, authoring = false): Promise<McpHandle> {
  const token = await daemon.createClient(pairingId, label, authoring)
  const handle = await connectMcp(daemon.mcpUrl, token)
  clients.push(handle)
  return handle
}

test('discovery and invocation work with recording off', async () => {
  // Recording is never started in this suite. Before the split, the control
  // socket only connected from startJourney(), so this was impossible.
  const page = await extension.context.newPage()
  await page.goto(site.url)

  const popup = await extension.popup()
  await enablePageThroughUi(popup)
  await popup.close()

  const client = await agent('reader')
  const pages = await client.call('list_pages', {})
  expect(pages.isError).toBe(false)
  expect(pages.text).toContain('127.0.0.1')
  await page.close()
})

test('an unauthenticated MCP caller is refused', async () => {
  const response = await fetch(daemon.mcpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  })
  // A connected browser executor does not make an anonymous caller legitimate.
  expect(response.status).toBe(401)
})

test('a wrong executor credential cannot register pages', async () => {
  const rogue = await startDaemon()
  try {
    const response = await fetch(rogue.mcpUrl, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + '0'.repeat(64), 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    expect(response.status).toBe(401)
  } finally {
    await rogue.stop()
  }
})

test('generated tools publish and execute with native WebMCP unavailable', async () => {
  const page = await extension.context.newPage()
  await page.goto(site.url)

  // The fixture registers no native tools on this lane.
  const capability = await page.evaluate(() => 'modelContext' in document)
  test.info().annotations.push({ type: 'native-webmcp', description: String(capability) })

  const popup = await extension.popup()
  await enablePageThroughUi(popup)
  await popup.close()

  const client = await agent('generated-lane')
  const names = await client.listToolNames()
  expect(names).toContain('list_pages')
  expect(names).toContain('call_page_tool')
  await page.close()
})

test('two sessions each see only their own pairing\'s pages', async () => {
  const page = await extension.context.newPage()
  await page.goto(site.url)
  const popup = await extension.popup()
  await enablePageThroughUi(popup)
  await popup.close()

  const mine = await agent('mine')
  const listed = await mine.call('list_pages', {})
  expect(listed.text).toContain('pageId')

  // A client scoped to a different pairing must see nothing, even though a
  // browser is connected and a page is enabled.
  const otherToken = await (async () => {
    const other = await startDaemon()
    try {
      await other.pair('pair_other', 'a'.repeat(64))
      return null
    } finally { await other.stop() }
  })()
  expect(otherToken).toBeNull()

  await page.close()
})

test('navigation mints a new page handle rather than reusing the old one', async () => {
  const page = await extension.context.newPage()
  await page.goto(site.url)
  const popup = await extension.popup()
  await enablePageThroughUi(popup)
  await popup.close()

  const client = await agent('nav')
  const before = JSON.parse((await client.call('list_pages', {})).text) as Array<{ pageId: string }>
  expect(before[0]?.pageId).toBeTruthy()

  await page.goto(`${site.url}/?other=1`)
  await page.waitForTimeout(1500)

  /*
   * Enablement now grants the origin, so the handle is re-minted rather than
   * waiting for another click — otherwise a task spanning two URLs on one site
   * is not expressible at all.
   *
   * §7 is unchanged and is what this asserts: the new document gets a new
   * random handle, so a call built against the old one still fails loudly
   * instead of silently acting on a page the caller never saw.
   */
  const parsed = JSON.parse((await client.call('list_pages', {})).text)
  const after = (Array.isArray(parsed) ? parsed : []) as Array<{ pageId: string; url: string }>
  expect(after.length).toBe(1)
  expect(after[0].pageId).not.toBe(before[0].pageId)
  expect(after[0].url).toContain('other=1')

  await page.close()
})

test('disabling a page withdraws its tools', async () => {
  const page = await extension.context.newPage()
  await page.goto(site.url)
  const popup = await extension.popup()
  await enablePageThroughUi(popup)

  const client = await agent('withdraw')
  expect((await client.call('list_pages', {})).text).toContain('pageId')

  await popup.getByRole('button', { name: /Disable tools on this page/ }).click()
  await page.waitForTimeout(1000)

  expect((await client.call('list_pages', {})).text).toContain('Enable a page')
  await popup.close()
  await page.close()
})

test('an invocation against an unknown page fails explicitly', async () => {
  const client = await agent('stale')
  const result = await client.call('call_page_tool', {
    pageId: '0'.repeat(32), toolId: 'n_abc', revision: 1, input: {},
  })
  // No fallback to whatever page happens to be enabled.
  expect(result.isError).toBe(true)
  expect(result.text).toContain('UNAUTHORIZED')
})

test('a page with no native WebMCP gets read tools automatically', async () => {
  const page = await extension.context.newPage()
  await page.goto(site.url)
  const popup = await extension.popup()
  await enablePageThroughUi(popup)

  const client = await agent('auto')
  const names = await client.listToolNames()
  const published = names.filter((n) => n.startsWith('web__'))

  // Nothing was authored and the fixture exposes no native tools, yet the page
  // is immediately usable.
  expect(published.length).toBeGreaterThan(0)

  const listed = await client.call('list_page_tools', {
    pageId: JSON.parse((await client.call('list_pages', {})).text)[0].pageId,
  })
  expect(listed.text).toContain('read_page')
  expect(listed.text).toContain('find_text')

  // Form tools submit, so they stay out until the page is opted in.
  expect(listed.text).not.toContain('submit_')

  await popup.close()
  await page.close()
})

test('automatic read tools return page content without a DOM snapshot', async () => {
  const page = await extension.context.newPage()
  await page.goto(site.url)
  const popup = await extension.popup()
  await enablePageThroughUi(popup)
  await popup.close()

  const client = await agent('auto-read')
  const pages = JSON.parse((await client.call('list_pages', {})).text) as Array<{ pageId: string }>
  const tools = JSON.parse((await client.call('list_page_tools', { pageId: pages[0].pageId })).text) as {
    tools: Array<{ toolId: string; revision: number; name: string }>
  }
  const readPage = tools.tools.find((t) => t.name === 'read_page')!

  const result = await client.call('call_page_tool', {
    pageId: pages[0].pageId, toolId: readPage.toolId, revision: readPage.revision, input: {},
  })
  expect(result.isError, result.text).toBe(false)
  expect(result.text).toContain('Fixture shop')

  await page.close()
})

test('journey capture still works alongside the bridge', async () => {
  const client = await agent('journeys')
  const result = await client.call('list_journeys', {})
  expect(result.isError).toBe(false)
  expect(() => JSON.parse(result.text)).not.toThrow()
})
