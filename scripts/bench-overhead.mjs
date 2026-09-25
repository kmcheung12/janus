/**
 * Measures what the content scripts cost a page that is not being recorded.
 *
 * Runs an identical workload in a browser with the extension loaded and in a
 * clean one, so the difference is the extension. Recording is never started:
 * this is the cost every page pays all the time, which is the cost that shows
 * up as idle CPU.
 *
 *   node scripts/bench-overhead.mjs
 */

import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const BUILD = resolve(import.meta.dirname, '../output/chrome-mv3')

const CONTENT_HTML = '<!doctype html><title>bench</title><h1>bench</h1>' + '<p style=\"height:40px\">filler</p>'.repeat(400)

const PAYLOAD = JSON.stringify({ rows: Array.from({ length: 800 }, (_, i) => ({ i, s: 'x'.repeat(40) })) })

const server = createServer((req, res) => {
  if (req.url.startsWith('/api')) {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
    res.end(PAYLOAD)
    return
  }
  if (req.url.startsWith('/stream')) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' })
    let n = 0
    const timer = setInterval(() => { res.write(`data: tick ${n++}\n\n`) }, 20)
    req.on('close', () => clearInterval(timer))
    return
  }
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(CONTENT_HTML)
})

await new Promise((r) => server.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${server.address().port}/`

const WORKLOADS = {
  async fetch(page) {
    return page.evaluate(async () => {
      const t = performance.now()
      for (let i = 0; i < 200; i++) await fetch(`/api?i=${i}`).then((r) => r.json())
      return performance.now() - t
    })
  },
  async console(page) {
    return page.evaluate(() => {
      const t = performance.now()
      for (let i = 0; i < 3000; i++) console.log('bench message', i)
      return performance.now() - t
    })
  },
  async scroll(page) {
    return page.evaluate(() => {
      const t = performance.now()
      for (let i = 0; i < 2000; i++) {
        window.scrollTo(0, i % 400)
        document.dispatchEvent(new Event('scroll', { bubbles: true }))
      }
      return performance.now() - t
    })
  },
  async mousemove(page) {
    return page.evaluate(() => {
      const t = performance.now()
      document.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 0, clientY: 0, bubbles: true }))
      for (let i = 0; i < 4000; i++) {
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: i % 500, clientY: i % 300, bubbles: true }))
      }
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: 400, clientY: 200, bubbles: true }))
      return performance.now() - t
    })
  },
  async xhr(page) {
    return page.evaluate(async () => {
      const t = performance.now()
      for (let i = 0; i < 200; i++) {
        await new Promise((done) => {
          const x = new XMLHttpRequest()
          x.open('GET', `/api?x=${i}`)
          x.onloadend = done
          x.send()
        })
      }
      return performance.now() - t
    })
  },
}

async function run(withExtension) {
  const profile = mkdtempSync(join(tmpdir(), 'janus-bench-'))
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: withExtension
      ? [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--no-first-run']
      : ['--no-first-run'],
  })
  if (withExtension) {
    if (!context.serviceWorkers().length) await context.waitForEvent('serviceworker', { timeout: 20_000 })
  }

  const page = await context.newPage()
  await page.goto(url)
  await page.waitForTimeout(500)

  // Idle cost: no page work at all, just whatever the extension does on its own.
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  const readTask = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics')
    return metrics.find((m) => m.name === 'TaskDuration').value
  }
  const idleBefore = await readTask()
  await page.waitForTimeout(8000)
  const idleAfter = await readTask()

  // A long-lived streaming response: the app reads it incrementally and never
  // "finishes", which is the normal shape for SSE.
  await page.evaluate(() => {
    window.__got = 0
    fetch('/stream').then(async (r) => {
      const reader = r.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        window.__got += value.length
      }
    })
  })
  const streamBefore = await readTask()
  const heapBefore = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0)
  await page.waitForTimeout(10000)
  const streamAfter = await readTask()
  const heapAfter = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0)

  const results = {
    stream: (streamAfter - streamBefore) * 1000,
    streamHeapKb: (heapAfter - heapBefore) / 1024,
    idle: (idleAfter - idleBefore) * 1000 }
  for (const [name, workload] of Object.entries(WORKLOADS)) {
    await workload(page) // warm
    const runs = []
    for (let i = 0; i < 3; i++) runs.push(await workload(page))
    results[name] = Math.min(...runs)
  }

  await context.close()
  rmSync(profile, { recursive: true, force: true })
  return results
}

const off = await run(false)
const on = await run(true)

console.log('\nworkload      baseline    with ext    overhead')
for (const name of ['idle', 'stream', 'streamHeapKb', ...Object.keys(WORKLOADS)]) {
  const factor = (on[name] / off[name]).toFixed(2)
  console.log(
    `${name.padEnd(12)} ${off[name].toFixed(0).padStart(7)}ms ${on[name].toFixed(0).padStart(9)}ms` +
    `   ${factor}x`,
  )
}

server.close()
