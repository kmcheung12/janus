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
    browser_specific_settings: {
      gecko: {
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
