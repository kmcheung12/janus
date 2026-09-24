import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [svelte()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    clearMocks: true,
    // This suite is the extension's, and runs under jsdom. Workspace packages
    // own their own configs and node environment; tests/e2e is a Playwright
    // suite. Vitest's default include glob would otherwise pull both in here
    // and fail them for the wrong reasons.
    exclude: ['**/node_modules/**', '**/dist/**', 'packages/**', 'tests/e2e/**'],
  },
})
