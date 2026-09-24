/**
 * §20 extension fixture.
 *
 * Loads the real built extension into a fresh persistent context and drives
 * pairing and page enablement through the actual UI. Nothing is stubbed:
 * application messages travel over the extension's own WebSocket, and
 * authentication runs on the production code path.
 */

import { chromium, type BrowserContext, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BUILD = resolve(dirname(fileURLToPath(import.meta.url)), '../../../output/chrome-mv3')

export interface ExtensionHandle {
  context: BrowserContext
  extensionId: string
  settings(): Promise<Page>
  popup(): Promise<Page>
  stop(): Promise<void>
}

export async function launchExtension(): Promise<ExtensionHandle> {
  const profile = mkdtempSync(join(tmpdir(), 'janus-profile-'))

  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: [
      `--disable-extensions-except=${BUILD}`,
      `--load-extension=${BUILD}`,
      '--no-first-run',
    ],
  })

  // The service worker appears shortly after launch; its URL carries the ID.
  let [worker] = context.serviceWorkers()
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20_000 })
  const extensionId = new URL(worker.url()).host

  return {
    context,
    extensionId,
    settings: async () => {
      const page = await context.newPage()
      await page.goto(`chrome-extension://${extensionId}/settings.html`)
      return page
    },
    popup: async () => {
      const page = await context.newPage()
      await page.goto(`chrome-extension://${extensionId}/popup.html`)
      return page
    },
    stop: async () => {
      await context.close()
      rmSync(profile, { recursive: true, force: true })
    },
  }
}

/**
 * Pair through the settings UI and hand the generated payload to the daemon,
 * exactly as a user would. Returns the pairing ID.
 */
export async function pairThroughUi(
  settings: Page,
  wsUrl: string,
  provision: (pairingId: string, token: string) => Promise<void>,
): Promise<string> {
  await settings.getByRole('button', { name: 'Browser connection' }).click()

  const address = settings.getByLabel('Daemon address').or(settings.locator('input[type="text"]').first())
  await address.fill(wsUrl)

  await settings.getByRole('button', { name: 'Pair with Janus' }).click()
  await settings.getByRole('button', { name: /Copy pairing JSON/ }).waitFor()

  // Read the payload the extension generated rather than inventing one, so the
  // test exercises the real credential path.
  const payload = await settings.evaluate(async () => {
    const stored = await chrome.storage.local.get('janus_browser_tools')
    return stored.janus_browser_tools as { pairingId: string; token: string }
  })

  // The extension already tried to connect and was rejected: the daemon did
  // not know this pairing yet. It deliberately does not retry a rejected
  // credential on a schedule, so reconnecting is an explicit user action.
  await provision(payload.pairingId, payload.token)
  await settings.getByRole('button', { name: 'Retry connection' }).click()
  await settings.getByText('Connected').waitFor({ timeout: 20_000 })

  return payload.pairingId
}

export async function enablePageThroughUi(popup: Page): Promise<void> {
  await popup.getByRole('button', { name: /Enable tools on this page/ }).click()
  await popup.getByText('Enabled').waitFor({ timeout: 15_000 })
}
