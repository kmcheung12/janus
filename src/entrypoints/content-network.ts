import { defineContentScript } from 'wxt/sandbox'
import { patchNetwork } from '../lib/event-capture/interceptors/network'

export default defineContentScript({
  matches: ['<all_urls>'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    patchNetwork(document)
  },
})
