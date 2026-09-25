import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { startDaemon, type DaemonHandle } from './fixtures/daemon'
import { startSite, type SiteHandle } from './fixtures/site'
import { launchNativeChrome, type NativeChrome } from './fixtures/chrome-native'

/**
 * Feature C's open question, settled empirically (§13, design §5 line 93).
 *
 * The design leaves untested "whether a tool registered from the extension's
 * isolated world is attributed to the page origin, to the extension, or is
 * visible at all to getTools() callers including the page's own agent". That
 * is exactly what decides whether a third-party WebMCP consumer running in the
 * page — the Model Context Tool Inspector, jev-webmcp-extension — can use
 * Janus's generated tools, so it is answered here rather than assumed.
 *
 * The site fixture registers nothing itself, so every tool the page can see
 * came from Janus. Playwright's page.evaluate runs in the main world, which is
 * where such a consumer's bridge runs.
 */

let daemon: DaemonHandle
let site: SiteHandle
let chrome: NativeChrome
let page: Page

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  daemon = await startDaemon()
  site = await startSite()
  chrome = await launchNativeChrome()

  const pairingId = `pair_${'c'.repeat(16)}`
  const token = 'd'.repeat(64)

  page = await chrome.context.newPage()
  await page.goto(site.url, { waitUntil: 'domcontentloaded' })

  const [worker] = chrome.context.serviceWorkers().length
    ? chrome.context.serviceWorkers()
    : [await chrome.context.waitForEvent('serviceworker', { timeout: 30_000 })]
  const extensionId = new URL(worker.url()).host

  await daemon.pair(pairingId, token)

  const settings = await chrome.context.newPage()
  await settings.goto(`chrome-extension://${extensionId}/settings.html`)
  await settings.evaluate(async ({ url, pairingId: id, token: t }) => {
    await chrome.runtime.sendMessage({
      type: 'JANUS_BT_SAVE_PAIRING',
      config: { url, pairingId: id, token: t, browserSessionId: 'browser_export' },
    })
  }, { url: daemon.wsUrl, pairingId, token })

  await settings.bringToFront()
  await settings.evaluate(async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true })
    const target = tabs.filter((t) => t.url?.startsWith('http')).at(-1)
    // Writes on: the point is whether acting tools cross, not just reads.
    await chrome.runtime.sendMessage({
      type: 'JANUS_BT_ENABLE_PAGE', tabId: target.id, allowAutoWrites: true,
    })
  })
  await settings.close()
  await page.bringToFront()
})

test.afterAll(async () => {
  await chrome?.stop()
  await site?.stop()
  await daemon?.stop()
})

/** What a consumer running in the page's own world can see. */
async function toolsVisibleToThePage() {
  return page.evaluate(async () => {
    const context = (document as unknown as {
      modelContext?: { getTools?: () => Promise<unknown[]> }
    }).modelContext
    if (!context?.getTools) return { supported: false, tools: [] as unknown[] }
    const tools = await context.getTools()
    return {
      supported: true,
      tools: (tools ?? []).map((t) => {
        const tool = t as { name?: string; description?: string; annotations?: unknown }
        return { name: tool.name, description: tool.description, annotations: tool.annotations }
      }),
    }
  })
}

test('the page\'s own world can see the tools Janus registered', async () => {
  await expect.poll(
    async () => (await toolsVisibleToThePage()).tools.length,
    { timeout: 30_000, message: 'Janus registered nothing the page can see' },
  ).toBeGreaterThan(0)

  const { supported, tools } = await toolsVisibleToThePage()
  expect(supported, 'document.modelContext is missing; the WebMCP flag did not take').toBe(true)

  const names = tools.map((t) => t.name)
  test.info().annotations.push({ type: 'visible to the page', description: names.join(', ') })

  // The read tools are published on any page without native tools of its own.
  expect(names).toContain('read_page')
  expect(names).toContain('find_text')
})

test('a consumer can tell a read from an act', async () => {
  // Without annotations every Janus tool looks equally safe to call
  // unattended, which is the one thing the hints exist to prevent.
  const { tools } = await toolsVisibleToThePage()
  const read = tools.find((t) => t.name === 'read_page')
  const annotations = read?.annotations as { readOnlyHint?: boolean } | undefined
  expect(annotations?.readOnlyHint).toBe(true)

  const click = tools.find((t) => t.name === 'click')
  expect(click, 'click was not registered; enable writes on the page').toBeTruthy()
  const clickAnnotations = click!.annotations as Record<string, unknown> | undefined
  expect(clickAnnotations?.readOnlyHint).toBe(false)

  /*
   * Pinned because it is observed, not documented.
   *
   * Chrome 153 keeps only the annotation keys it knows — `readOnlyHint` and
   * `untrustedContentHint` — and drops everything else, including BOTH
   * spellings of consequential that we register. So "this acts" survives the
   * crossing but "this is consequential" does not, from any registrant, Janus
   * or site. A page-world consumer therefore cannot distinguish a click from a
   * form submit, and must treat every non-read tool as needing confirmation.
   *
   * Both spellings stay in the registration: this costs nothing and starts
   * working the moment Chrome carries either. If this assertion ever fails,
   * that has happened — delete it and assert the hint instead.
   */
  expect(clickAnnotations).not.toHaveProperty('consequential')
  expect(clickAnnotations).not.toHaveProperty('consequentialHint')
})

test('the page can execute a Janus tool and get its result', async () => {
  const result = await page.evaluate(async () => {
    const context = (document as unknown as {
      modelContext?: {
        getTools?: () => Promise<unknown[]>
        executeTool?: (tool: unknown, input: unknown) => Promise<unknown>
      }
    }).modelContext
    const tools = (await context!.getTools!()) as Array<{ name?: string }>
    const tool = tools.find((t) => t.name === 'find_text')
    if (!tool) return { error: 'find_text was not visible' }
    // Chrome wants the arguments as a JSON string, not an object — passing the
    // object fails with "Failed to parse input arguments". Any consumer has to
    // do this, which is why Janus's own native adapter stringifies too.
    try {
      return { ok: await context!.executeTool!(tool, JSON.stringify({ query: 'Fixture' })) }
    } catch (e) {
      return { error: String((e as Error)?.message ?? e) }
    }
  })

  expect(JSON.stringify(result)).toContain('Fixture')
})
