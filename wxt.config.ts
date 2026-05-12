import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  outDir: 'output',
  modules: ['@wxt-dev/module-svelte'],
  dev: {
    reloadCommand: 'Ctrl+Shift+R' // or false to disable
  },
  manifest: {
    permissions: ['storage', 'tabs', 'scripting', 'webRequest'],
    browser_specific_settings: {
      gecko: {
        data_collection_permissions: {
          required: ['none'],
        },
      },
    },
  },
  vite: () => ({
    build: {
      sourcemap: true,
    },
  }),
});
