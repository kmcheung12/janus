import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    // WXT defines these at build time; Vitest needs them too, or any module
    // with a runtime (non-type) import from a workspace package fails to
    // resolve here while building fine in the extension.
    alias: {
      '@@': root,
      '@': `${root}src`,
      '~': `${root}src`,
    },
  },
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
