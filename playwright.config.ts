import { defineConfig } from '@playwright/test'

/**
 * §20 integration harness.
 *
 * Separate from the Vitest suites: these drive a real built extension in a
 * real browser against a real daemon. The root Vitest config excludes
 * tests/e2e for the same reason.
 *
 * One worker and no retries, deliberately. The suite asserts serialization
 * and unknown-execution locks; parallel workers sharing a daemon would make
 * those assertions meaningless, and a retry would mask exactly the
 * intermittent ordering bug this is meant to catch.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    trace: 'retain-on-failure',
    /*
     * Playwright's own headless switch cannot be used here: loading an
     * extension needs launchPersistentContext, which the fixture drives
     * itself. It passes --headless=new, Chrome's newer mode, which does load
     * extensions where the old one did not. JANUS_HEADED=1 to watch a run.
     */
    headless: false,
  },
})
