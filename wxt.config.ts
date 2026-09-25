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
        /*
         * Explicit so the add-on's internal moz-extension:// UUID can be
         * pinned by a profile pref. Firefox assigns a random one per profile
         * otherwise, and the Firefox smoke lane has to address an extension
         * page to reach the content script the way the daemon does.
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
