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
     * Not honoured here: every lane loads an extension, which needs
     * launchPersistentContext, and the fixtures launch that themselves. They
     * use the chromium channel, whose newer headless mode does load
     * extensions. JANUS_HEADED=1 to watch a run.
     */
  },
})
