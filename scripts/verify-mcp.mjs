/**
 * End-to-end verification: extension → WebSocket → MCP server → Claude
 *
 * Flow:
 *   1. Start MCP server (WebSocket on 3457 + MCP stdio)
 *   2. Launch Chrome with Janus extension loaded
 *   3. Navigate to google.com
 *   4. Start recording via background SW
 *   5. Type in Google search field
 *   6. Query MCP latest_journey tool
 *   7. Print captured events
 */

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const EXTENSION_PATH = path.join(ROOT, 'output/chrome-mv3')
const MCP_SERVER_PATH = path.join(ROOT, 'packages/mcp-server/dist/index.js')
const USER_DATA_DIR = '/tmp/janus-verify-playwright'

// ── MCP server (SSE daemon) ───────────────────────────────────────────────────

const mcpServer = spawn('node', [MCP_SERVER_PATH], {
  stdio: ['ignore', 'ignore', 'inherit'],
})

mcpServer.on('error', err => { console.error('MCP server failed to start:', err); process.exit(1) })

// Give WS + HTTP servers time to bind
await new Promise(r => setTimeout(r, 1000))

const MCP_BASE = 'http://localhost:3456'

async function callTool(name, args = {}) {
  return new Promise(async (resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout calling ${name}`)), 15_000)

    // Open SSE stream
    const sseRes = await fetch(`${MCP_BASE}/sse`, { headers: { Accept: 'text/event-stream' } })
    const reader = sseRes.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let endpoint = null
    let result = null

    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()
        for (const line of lines) {
          if (line.startsWith('event: endpoint')) continue
          if (line.startsWith('data: ') && !endpoint) {
            endpoint = line.slice(6).trim()
            // Now POST the tool call
            const postRes = await fetch(`${MCP_BASE}${endpoint}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
            })
            if (!postRes.ok) { reject(new Error(`POST failed: ${postRes.status}`)); return }
          }
          if (line.startsWith('data: ') && endpoint) {
            try {
              const msg = JSON.parse(line.slice(6))
              if (msg.id === 1 && msg.result) {
                result = msg
                clearTimeout(timer)
                reader.cancel()
                resolve(result)
                return
              }
            } catch {}
          }
        }
      }
    }

    pump().catch(reject)
  })
}

// ── Browser ───────────────────────────────────────────────────────────────────

await rm(USER_DATA_DIR, { recursive: true, force: true })

console.log('Launching Chrome with Janus extension…')
const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
  headless: false,
  args: [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    '--no-first-run',
  ],
})

// Grab the background service worker URL to extract extension ID
const background = await new Promise(resolve => {
  const existing = context.serviceWorkers()
  if (existing.length > 0) return resolve(existing[0])
  context.once('serviceworker', resolve)
})

const extensionId = background.url().split('/')[2]
console.log(`Extension ID: ${extensionId}`)

// ── Navigate to Google ────────────────────────────────────────────────────────

const page = context.pages()[0] || await context.newPage()
console.log('Navigating to google.com…')
await page.goto('https://www.google.com', { waitUntil: 'commit' }).catch(() => {})
await page.waitForLoadState('domcontentloaded').catch(() => {})
await page.waitForTimeout(1500)

// ── Start recording via popup page (extension page has chrome API access) ────

console.log('Starting recording…')

// Get Google tab's ID from the background SW
const tabId = await background.evaluate(async () => {
  const tabs = await chrome.tabs.query({ url: 'https://www.google.com/*' })
  return tabs[0]?.id ?? null
})
if (!tabId) throw new Error('Could not find Google tab via background SW')
console.log('Google tab ID:', tabId)

// Open the popup page — it's an extension page so it can call browser.runtime.sendMessage
const popupPage = await context.newPage()
await popupPage.goto(`chrome-extension://${extensionId}/popup.html`)
await popupPage.waitForLoadState('domcontentloaded')
await popupPage.waitForTimeout(300)

// Trigger recording with the specific tabId (bypasses the popup's tabs.query)
const recordingResult = await popupPage.evaluate(async (tid) => {
  return new Promise(resolve => {
    // eslint-disable-next-line no-undef
    browser.runtime.sendMessage({ type: 'JANUS_TOGGLE_RECORDING', tabId: tid }, resolve)
  })
}, tabId)
console.log('Recording state:', recordingResult)
await popupPage.close()
await page.bringToFront()
await page.waitForTimeout(800)

// ── Interact with Google ──────────────────────────────────────────────────────

console.log('Typing in search field…')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const searchBox = page.locator('textarea[name="q"], input[name="q"]').first()
await searchBox.click({ force: true })
await page.waitForTimeout(300)
await searchBox.type('hello from janus playwright test', { delay: 60 })
await page.waitForTimeout(500)

// Navigate somewhere to generate a navigation event
await page.keyboard.press('Enter')
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1500)

// ── Stop recording ────────────────────────────────────────────────────────────

console.log('Stopping recording…')
await background.evaluate(async (tid) => {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'JANUS_TOGGLE_RECORDING', tabId: tid }, resolve)
  })
}, tabId)

await page.waitForTimeout(600)

// ── Query MCP ─────────────────────────────────────────────────────────────────

console.log('\n─── Calling MCP: latest_journey ───')
const response = await callTool('latest_journey')

if (response.error) {
  console.error('MCP error:', response.error)
  process.exit(1)
}

const text = response.result?.content?.[0]?.text
if (!text) {
  console.error('Unexpected MCP response shape:', JSON.stringify(response, null, 2))
  process.exit(1)
}

const journey = JSON.parse(text)

console.log('\n═══ Journey metadata ═══')
console.log(`  ID:        ${journey.id}`)
console.log(`  Domain:    ${journey.meta?.domain}`)
console.log(`  Start URL: ${journey.meta?.startUrl}`)
console.log(`  Status:    ${journey.meta?.status}`)
console.log(`  Events:    ${journey.events?.length ?? 0}`)
console.log(`  Files:     ${journey.files?.length ?? 0}`)

console.log('\n═══ Captured events ═══')
for (const e of journey.events ?? []) {
  const note = e.note ?? `[${e.type}]`
  console.log(`  ${e.type.padEnd(12)} ${note}`)
}

const hasKeyboard = journey.events?.some(e => e.type === 'keyboard')
const hasSession  = journey.events?.some(e => e.type === 'session')
const hasNav      = journey.events?.some(e => e.type === 'navigation')

console.log('\n═══ Verification ═══')
console.log(`  session event:    ${hasSession  ? '✅' : '❌'}`)
console.log(`  navigation event: ${hasNav      ? '✅' : '❌'}`)
console.log(`  keyboard event:   ${hasKeyboard ? '✅' : '❌'}`)

const passed = hasSession && hasNav && hasKeyboard
console.log(`\n  ${passed ? '✅ PASS' : '❌ FAIL'} — journey contains expected event types`)

// ── Cleanup ───────────────────────────────────────────────────────────────────

await context.close()
mcpServer.kill()
await new Promise(r => setTimeout(r, 200))
process.exit(passed ? 0 : 1)
