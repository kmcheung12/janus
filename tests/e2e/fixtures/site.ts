/**
 * §20 local site fixtures on an ephemeral port.
 *
 * Provides the deterministic cases the suite needs: a search form with a JSON
 * endpoint, an observable counter, a manually-released delayed action (for
 * serialization tests), background polling (for response ambiguity), and a
 * cross-origin iframe that registers its own tools.
 *
 * Native WebMCP registrations appear only on the dedicated native lane, so the
 * generated lane genuinely proves independence from it.
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface SiteHandle {
  url: string
  /** Release a request the fixture is deliberately holding open. */
  release(): void
  /** How many times the search endpoint has been called. */
  searches(): number
  stop(): Promise<void>
}

export interface SiteOptions {
  /** Register native WebMCP tools on the page (native lane only). */
  native?: boolean
  /** Serve a page embedding a cross-origin iframe that registers tools. */
  iframeOrigin?: string
}

function page(options: SiteOptions): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Fixture shop</title></head>
<body>
  <h1>Fixture shop</h1>
  <form id="search">
    <label for="q">Query</label>
    <input id="q" name="q" type="text">
    <select id="category" name="category"><option value="all">All</option><option value="audio">Audio</option></select>
    <input id="pw" type="password" name="password">
    <button id="go" type="submit">Search</button>
  </form>
  <div id="results" role="status">no results</div>
  <button id="counter-btn">Increment</button>
  <div id="counter">0</div>
  <button id="slow-btn">Slow action</button>
  <div id="slow-state">idle</div>
  ${options.iframeOrigin ? `<iframe src="${options.iframeOrigin}/iframe.html"></iframe>` : ''}
<script>
  const form = document.getElementById('search')
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const q = document.getElementById('q').value
    const category = document.getElementById('category').value
    const res = await fetch('/api/search?q=' + encodeURIComponent(q) + '&category=' + category)
    const data = await res.json()
    document.getElementById('results').textContent = data.items.join(', ')
  })

  let counter = 0
  document.getElementById('counter-btn').addEventListener('click', () => {
    counter++
    document.getElementById('counter').textContent = String(counter)
  })

  document.getElementById('slow-btn').addEventListener('click', async () => {
    document.getElementById('slow-state').textContent = 'running'
    await fetch('/api/slow')
    document.getElementById('slow-state').textContent = 'done'
  })

  // Background polling: a second matching response the agent did not cause.
  setInterval(() => { fetch('/api/search?q=poll&category=all').catch(() => {}) }, 400)

  ${options.native ? `
  if (document.modelContext?.registerTool) {
    document.modelContext.registerTool({
      name: 'search_products',
      description: 'Search the fixture catalogue',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      annotations: { readOnlyHint: true, destructiveHint: false },
      execute: async ({ query }) => {
        const res = await fetch('/api/search?q=' + encodeURIComponent(query) + '&category=all')
        return res.json()
      },
    })
    document.modelContext.registerTool({
      name: 'increment_counter',
      description: 'Increment the visible counter',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: false, destructiveHint: true },
      execute: async () => {
        document.getElementById('counter-btn').click()
        return { counter: Number(document.getElementById('counter').textContent) }
      },
    })
  }` : ''}
</script>
</body></html>`
}

const IFRAME_PAGE = `<!doctype html><html><body><p>iframe</p>
<script>
  document.modelContext?.registerTool?.({
    name: 'iframe_tool',
    description: 'Should never be published by Janus in M1',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ ok: true }),
  })
</script></body></html>`

export async function startSite(options: SiteOptions = {}): Promise<SiteHandle> {
  let searches = 0
  let releaseSlow: (() => void) | null = null

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (url.pathname === '/api/search') {
      searches++
      const query = url.searchParams.get('q') ?? ''
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        items: query === 'poll' ? ['background'] : [`${query} pro`, `${query} lite`],
        total: 2,
      }))
      return
    }

    if (url.pathname === '/api/slow') {
      // Held open until the test releases it, so serialization can be asserted
      // against a real in-flight handler rather than a mocked call order.
      await new Promise<void>((resolve) => { releaseSlow = resolve })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ done: true }))
      return
    }

    if (url.pathname === '/iframe.html') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(IFRAME_PAGE)
      return
    }

    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(page(options))
  })

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    release: () => { releaseSlow?.(); releaseSlow = null },
    searches: () => searches,
    stop: () => new Promise<void>((r) => { releaseSlow?.(); server.close(() => r()) }),
  }
}
