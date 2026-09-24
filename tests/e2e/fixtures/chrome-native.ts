/**
 * Real-Chrome launcher for the native WebMCP lane (§13).
 *
 * Uses Playwright's bundled Chromium rather than the installed Chrome, which
 * is not a preference but a constraint: Chrome 137+ removed support for
 * --load-extension, and none of the documented overrides
 * (--disable-features=DisableLoadExtensionCommandLineSwitch, with or without
 * ignoring Playwright's own --disable-features) restore it on Chrome 154.
 * Measured, not assumed — see tests/e2e/probe.spec.ts.
 *
 * The bundled build reports Chrome/153.0.8010.12 and both loads the extension
 * and exposes document.modelContext, so it is the only browser on this machine
 * that can exercise the whole path.
 *
 * The WebMCP experiment is seeded into the fresh profile's Local State, which
 * is where chrome://flags records it. That flag is load-bearing: without it
 * document.modelContext is absent entirely. Any result from this lane is
 * therefore a flagged development result, never an unflagged release claim.
 */

import { chromium, type BrowserContext } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const BUILD = resolve(dirname(fileURLToPath(import.meta.url)), '../../../output/chrome-mv3')

export const WEBMCP_FLAG = 'enable-webmcp-testing@1'

export interface NativeChrome {
  context: BrowserContext
  profile: string
  stop(): Promise<void>
}

export async function launchNativeChrome(options: { extension?: boolean } = {}): Promise<NativeChrome> {
  const profile = mkdtempSync(join(tmpdir(), 'janus-native-'))

  // Written before launch: Chrome reads Local State at startup, and an
  // experiment toggled afterwards needs a relaunch to take effect.
  mkdirSync(profile, { recursive: true })
  writeFileSync(
    join(profile, 'Local State'),
    JSON.stringify({ browser: { enabled_labs_experiments: [WEBMCP_FLAG] } }),
  )

  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: [
      ...(options.extension === false ? [] : [
        `--disable-extensions-except=${BUILD}`,
        `--load-extension=${BUILD}`,
      ]),
      '--no-first-run',
      '--no-default-browser-check',
    ],
  })

  return {
    context,
    profile,
    stop: async () => {
      await context.close()
      rmSync(profile, { recursive: true, force: true })
    },
  }
}
