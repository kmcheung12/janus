import { defineConfig } from 'wxt';
// @ts-expect-error - plain .mjs helper, shared with the node packages
import { buildStamp, formatStamp } from './scripts/build-stamp.mjs';

/**
 * Evaluated once per build and inlined, so a loaded extension can say which
 * build it is. Reloading an extension is manual, so a stale copy is easy to
 * debug by accident.
 */
const JANUS_BUILD = formatStamp(buildStamp());

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  outDir: 'output',
  modules: ['@wxt-dev/module-svelte'],
  dev: {
    reloadCommand: 'Ctrl+Shift+R' // or false to disable
  },
  manifest: {
    permissions: ['storage', 'tabs', 'scripting', 'webRequest', 'webNavigation'],
    /*
     * The daemon is loopback-only and sends no CORS headers, so without this
     * the browser blocks the extension's fetch before the app sees the
     * response. Every failure then looks like "could not reach the daemon",
     * including a daemon that answered and refused.
     */
    host_permissions: ['http://127.0.0.1/*', 'http://localhost/*'],
    browser_specific_settings: {
      gecko: {
        /*
         * Without an explicit id, Firefox gives a temporary add-on a fresh
         * identity on every reload: new storage, lost pairing, and a new
         * pairing ID that every existing agent token is out of scope for.
         * Reloading is routine during development, so that is a new bearer
         * token per reload.
         */
        id: 'janus@local',
        data_collection_permissions: {
          required: ['none'],
        },
      },
    },
  },
  vite: () => ({
    define: {
      __JANUS_BUILD__: JSON.stringify(JANUS_BUILD),
    },
    build: {
      sourcemap: true,
      minify:false,
    },
  }),
});
