import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { startDaemon, type DaemonHandle } from './fixtures/daemon'
import { launchNativeChrome, type NativeChrome } from './fixtures/chrome-native'
import { connectMcp, type McpHandle } from './fixtures/mcp'

/**
 * §13 native end-to-end validation target.
 *
 * The success condition is behavioural, not structural: a client connected
 * only to Janus MCP drives a real third-party WebMCP site through a multi-step
 * task, with no DOM snapshot and no browser-automation tools.
 *
 * Playwright provisions the harness and verifies the outcome in the page —
 * §20 permits that — but every decision and every action below goes through
 * Janus MCP. The test never clicks anything on the site.
 */

const TARGET = process.env.JANUS_NATIVE_TARGET ?? 'https://shopping-webmcp-demo.netlify.app/'

let daemon: DaemonHandle
let chrome: NativeChrome
let site: Page
let client: McpHandle

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  daemon = await startDaemon()
  chrome = await launchNativeChrome()

  // Pair by writing the credential the extension would have generated, then
  // provisioning the daemon with it — the UI path is already covered by
  // bridge.spec.ts and is not what this lane is testing.
  const pairingId = `pair_${'a'.repeat(16)}`
  const token = 'b'.repeat(64)

  // Open the target first: real Chrome starts an MV3 service worker lazily, so
  // it only appears once a content script has something to talk to.
  site = await chrome.context.newPage()
  await site.goto(TARGET, { waitUntil: 'domcontentloaded' })

  const [worker] = chrome.context.serviceWorkers().length
    ? chrome.context.serviceWorkers()
    : [await chrome.context.waitForEvent('serviceworker', { timeout: 30_000 })]
  const extensionId = new URL(worker.url()).host

  await daemon.pair(pairingId, token)

  const settings = await chrome.context.newPage()
  await settings.goto(`chrome-extension://${extensionId}/settings.html`)
  await settings.evaluate(async ({ url, pairingId, token }) => {
    await chrome.runtime.sendMessage({
      type: 'JANUS_BT_SAVE_PAIRING',
      config: { url, pairingId, token, browserSessionId: 'browser_native' },
    })
  }, { url: daemon.wsUrl, pairingId, token })

  // Registration happens after hydration, not at DOMContentLoaded.
  await site.waitForFunction(
    async () => ((await document.modelContext?.getTools?.()) ?? []).length > 0,
    undefined,
    { timeout: 30_000 },
  )

  await settings.bringToFront()
  await settings.evaluate(async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true })
    const target = tabs.filter((t) => t.url?.startsWith('http')).at(-1)
    await chrome.runtime.sendMessage({ type: 'JANUS_BT_ENABLE_PAGE', tabId: target.id })
  })
  await settings.close()
  await site.bringToFront()

  const clientToken = await daemon.createClient(pairingId, 'native agent')
  client = await connectMcp(daemon.mcpUrl, clientToken)
})

test.afterAll(async () => {
  await client?.close().catch(() => {})
  await chrome?.stop()
  await daemon?.stop()
})

/** Every published Janus tool for the enabled page. */
async function publishedTools() {
  const { tools } = await client.client.listTools()
  return tools.filter((t) => t.name.startsWith('web__'))
}

test('the site\'s native tools reach the CLI through Janus MCP', async () => {
  const published = await publishedTools()

  const names = published.map((t) => (t.annotations?.title ?? t.name) as string)
  test.info().annotations.push({ type: 'tools', description: names.join(', ') })

  expect(published.length).toBeGreaterThanOrEqual(8)

  // Schemas arrive as real JSON Schema, not as text the agent must re-parse.
  // Chrome hands inputSchema back as a JSON string; if that were passed
  // through unparsed, every tool here would have been dropped.
  for (const tool of published) {
    const properties = tool.inputSchema.properties as Record<string, unknown>
    expect(properties.revision).toBeDefined()
    expect(properties.input).toBeDefined()
  }

  const search = published.find((t) => String(t.annotations?.title).includes('search_products'))
  expect(search, 'search_products should be published').toBeDefined()
  const input = (search!.inputSchema.properties as { input: { properties: Record<string, unknown> } }).input
  expect(Object.keys(input.properties ?? {}).length).toBeGreaterThan(0)
})

test('effect annotations survive the crossing', async () => {
  const published = await publishedTools()
  const checkout = published.find((t) => String(t.annotations?.title).includes('start_checkout'))
  expect(checkout).toBeDefined()
  // Chrome spells it consequentialHint; an unannotated or false-y hint must
  // never silently become "safe".
  expect(checkout!.annotations?.readOnlyHint).toBe(false)
})

test('an agent completes a multi-step task using only Janus MCP', async () => {
  const published = await publishedTools()
  const byName = (needle: string) => {
    const tool = published.find((t) => String(t.annotations?.title).includes(needle))
    if (!tool) throw new Error(`No published tool matching "${needle}"`)
    return tool
  }

  const revisionOf = (tool: { inputSchema: { properties?: unknown } }) =>
    ((tool.inputSchema.properties as { revision: { enum: number[] } }).revision.enum)[0]

  // ── Step 1: read the cart. Nothing about the DOM is known to the caller.
  const cartTool = byName('get_cart')
  const before = await client.call(cartTool.name, {
    revision: revisionOf(cartTool), input: {},
  })
  expect(before.isError, before.text).toBe(false)

  // ── Step 2: search. The site answers with its own precondition — "No store
  // is open yet. Call choose_store first with one of: ..." — which is the
  // clearest possible evidence that the agent is talking to real application
  // logic rather than to a DOM scrape.
  const searchTool = byName('search_products')
  let searchResult = await client.call(searchTool.name, {
    revision: revisionOf(searchTool), input: { query: 'banana' },
  })

  if (searchResult.isError || /choose_store/.test(searchResult.text)) {
    const offered = searchResult.text.match(/one of:\s*([^."]+)/)?.[1]
    const store = offered?.split(',')[0]?.trim()
    expect(store, `no store offered in:\n${searchResult.text}`).toBeTruthy()

    const chooseTool = byName('choose_store')
    const chosen = await client.call(chooseTool.name, {
      revision: revisionOf(chooseTool), input: { store },
    })
    expect(chosen.isError, chosen.text).toBe(false)
    test.info().annotations.push({ type: 'recovered', description: `chose store "${store}"` })

    searchResult = await client.call(searchTool.name, {
      revision: revisionOf(searchTool), input: { query: 'banana' },
    })
  }
  expect(searchResult.isError, searchResult.text).toBe(false)

  // ── Step 3: the next call is built from the previous result, which is what
  // makes this a chain rather than independent invocations.
  // Basketful answers in prose — "- Bananas — $0.29 (each) — in stock" — which
  // is what a real site's tool is free to do. Reading it is the agent's job;
  // Janus's job is to deliver it unmangled.
  const product = searchResult.text.match(/^\s*-\s*(.+?)\s+—/m)?.[1]
    ?? searchResult.text.match(/"(?:name|product)"\s*:\s*"([^"]+)"/)?.[1]
  expect(product, `no product name in:\n${searchResult.text}`).toBeTruthy()

  // Arguments are constructed from the published schema, not guessed. This
  // tool takes a list of items rather than a flat product/quantity pair, and
  // the schema is the only place that says so — which is the whole point of
  // publishing it instead of an opaque dispatcher.
  const addTool = byName('add_to_cart')
  const addSchema = (addTool.inputSchema.properties as {
    input: { properties?: Record<string, unknown> }
  }).input
  const addProperties = Object.keys(addSchema.properties ?? {})
  expect(addProperties.length, 'add_to_cart published no business schema').toBeGreaterThan(0)

  const addInput = addProperties.includes('items')
    ? { items: [{ product, quantity: 2 }] }
    : { product, quantity: 2 }

  const added = await client.call(addTool.name, {
    revision: revisionOf(addTool), input: addInput,
  })
  expect(added.isError, added.text).toBe(false)
  test.info().annotations.push({
    type: 'schema-driven',
    description: `add_to_cart accepts {${addProperties.join(', ')}}; called with ${JSON.stringify(addInput)}`,
  })

  // ── Step 4: read the cart back and confirm the agent's report.
  const after = await client.call(cartTool.name, {
    revision: revisionOf(cartTool), input: {},
  })
  expect(after.isError, after.text).toBe(false)
  expect(
    after.text,
    `add_to_cart said:\n${added.text}\n\nbut the cart reads:\n${after.text}`,
  ).toContain(product!)
  expect(after.text).not.toEqual(before.text)

  // ── Step 5: the browser's own state must match what the agent reported.
  const visible = await site.evaluate(() => document.body.innerText)
  expect(visible.toLowerCase()).toContain(String(product).toLowerCase().split(' ')[0])

  test.info().annotations.push({
    type: 'task',
    description: `get_cart → search_products(banana) → add_to_cart(${product}, 2) → get_cart`,
  })
})

test('a stale revision is rejected before it reaches the page', async () => {
  const published = await publishedTools()
  const cart = published.find((t) => String(t.annotations?.title).includes('get_cart'))!
  const result = await client.call(cart.name, { revision: 9999, input: {} })
  expect(result.isError).toBe(true)
})

test('records the exact browser and flag state for the release claim', async () => {
  const session = await chrome.context.newCDPSession(site)
  const { product } = await session.send('Browser.getVersion')

  const capability = await site.evaluate(() => ({
    present: 'modelContext' in document,
    members: ['getTools', 'executeTool', 'registerTool', 'unregisterTool']
      .filter((m) => typeof (document.modelContext as Record<string, unknown>)?.[m] === 'function'),
    secureContext: window.isSecureContext,
  }))

  // §13 requires the tested browser and conditions to be pinned alongside the
  // result: a flagged pass is not an unflagged release claim.
  test.info().annotations.push(
    { type: 'browser', description: product },
    { type: 'flag', description: 'enable-webmcp-testing (seeded into profile Local State)' },
    { type: 'target', description: TARGET },
    { type: 'api', description: capability.members.join(', ') },
    { type: 'tested', description: new Date().toISOString().slice(0, 10) },
  )

  expect(capability.present).toBe(true)
  expect(capability.secureContext).toBe(true)
  expect(capability.members).toContain('getTools')
  expect(capability.members).toContain('executeTool')
  // The draft has no unregisterTool; withdrawal is via AbortSignal.
  expect(capability.members).not.toContain('unregisterTool')
})
