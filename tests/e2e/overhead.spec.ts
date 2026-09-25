/**
 * What Janus costs a page it is not actively working on.
 *
 * The regression test here is the important part. `publish()` answers the
 * background's own republish request, so announcing unconditionally closed a
 * cycle — LIST_TOOLS -> publish -> TOOLS_CHANGED -> refreshTools -> LIST_TOOLS
 * — that ran as fast as message passing allowed and pinned a core under
 * Firefox's persistent background page. It reached the daemon as an unbounded
 * stream of tool-list notifications, which is what this asserts against:
 * counting notifications is precise, where counting CPU is flaky.
 *
 * It only reproduces with a page *enabled*. An earlier version of this
 * benchmark measured an unenabled page, found nothing, and was used to say
 * there was no background spin.
 *
 * The CPU numbers below are opt-in, since they are a profiling aid rather than
 * a pass/fail:  JANUS_BENCH=1 npx playwright test tests/e2e/overhead.spec.ts
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

async function agent(label: string): Promise<McpHandle> {
  const handle = await connectMcp(daemon.mcpUrl, await daemon.createClient(pairingId, label))
  clients.push(handle)
  return handle
}

test('an enabled page stops republishing once its tool set settles', async () => {
  const client = await agent('idle-watch')
  const page = await extension.context.newPage()
  await page.goto(site.url)

  const popup = await extension.popup()
  await enablePageThroughUi(popup)
  await popup.close()

  // Enabling legitimately publishes. Let that settle before measuring.
  await page.waitForTimeout(1500)
  const settled = client.notifications

  await page.waitForTimeout(4000)
  const during = client.notifications - settled

  // A steady-state page announces nothing. One stray round is tolerated so a
  // late native-discovery pass cannot make this flaky; the bug produced
  // hundreds.
  expect(
    during,
    `${during} tool-list notifications arrived while idle — the republish cycle is back`,
  ).toBeLessThanOrEqual(1)

  await page.close()
})

test('page workloads are not measurably slowed', async () => {
  test.skip(!process.env.JANUS_BENCH, 'profiling aid; set JANUS_BENCH=1')

  const page = await extension.context.newPage()
  await page.goto(site.url)
  const popup = await extension.popup()
  await enablePageThroughUi(popup)
  await popup.close()

  const workloads = {
    async fetch() {
      return page.evaluate(async () => {
        const t = performance.now()
        for (let i = 0; i < 200; i++) await fetch(`/?i=${i}`).then((r) => r.text())
        return performance.now() - t
      })
    },
    async console() {
      return page.evaluate(() => {
        const t = performance.now()
        for (let i = 0; i < 3000; i++) console.log('bench message', i)
        return performance.now() - t
      })
    },
    // Recording is off here, so the MAIN-world console patch should be
    // rejecting these before it stringifies anything or builds a stack.
    async consoleError() {
      return page.evaluate(() => {
        const t = performance.now()
        for (let i = 0; i < 3000; i++) console.error('bench error', i)
        return performance.now() - t
      })
    },
  }

  const cdp = await extension.context.newCDPSession(page)
  await cdp.send('Performance.enable')
  const taskDuration = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics')
    return metrics.find((m) => m.name === 'TaskDuration')!.value
  }

  const idleBefore = await taskDuration()
  await page.waitForTimeout(5000)
  const idleMs = ((await taskDuration()) - idleBefore) * 1000

  const rows: string[] = [`idle (5s window)  ${idleMs.toFixed(0)}ms`]
  for (const [name, run] of Object.entries(workloads)) {
    await run()
    const runs = [await run(), await run(), await run()]
    rows.push(`${name.padEnd(17)} ${Math.min(...runs).toFixed(0)}ms`)
  }
  console.log(`\nwith an enabled page:\n${rows.join('\n')}\n`)

  await page.close()
})
