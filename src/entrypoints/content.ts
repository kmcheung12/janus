import { addEvent } from '../lib/event-capture/store'
import { attachClickInterceptor } from '../lib/event-capture/interceptors/click'
import { attachKeyboardInterceptor } from '../lib/event-capture/interceptors/keyboard'
import { attachNavigationInterceptor } from '../lib/event-capture/interceptors/navigation'
import { NETWORK_EVENT_NAME } from '../lib/event-capture/interceptors/network'
import type { ApiEvent } from '../lib/event-capture/types'
import { mount, unmount } from 'svelte'
import Overlay from '../components/annotation/Overlay.svelte'

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    // Skip iframes
    if (window !== window.top) return

    // Attach DOM interceptors
    const cleanups = [
      attachClickInterceptor(addEvent),
      attachKeyboardInterceptor(addEvent),
      attachNavigationInterceptor(addEvent),
    ]

    // Relay network events from MAIN world into the store
    document.addEventListener(NETWORK_EVENT_NAME, (e: Event) => {
      const detail = (e as CustomEvent).detail
      const event: ApiEvent = {
        id: crypto.randomUUID(),
        type: 'api',
        timestamp: Date.now(),
        method: detail.method,
        url: detail.url,
        status: detail.status,
        requestBody: detail.requestBody,
        responseBody: detail.responseBody,
        errorDetails: detail.errorDetails,
        duration: detail.duration,
      }
      addEvent(event)
    })

    // Annotation mode
    let overlayHost: HTMLElement | null = null
    let overlayInstance: Record<string, unknown> | null = null

    function openAnnotationMode() {
      if (overlayHost) return

      overlayHost = document.createElement('div')
      overlayHost.id = 'janus-root'
      document.body.appendChild(overlayHost)

      overlayInstance = mount(Overlay, {
        target: overlayHost,
        props: { onClose: closeAnnotationMode },
      })
    }

    function closeAnnotationMode() {
      if (overlayInstance) {
        unmount(overlayInstance)
        overlayInstance = null
      }
      overlayHost?.remove()
      overlayHost = null
    }

    // Listen for activate message from popup
    browser.runtime.onMessage.addListener((msg: { type: string }) => {
      if (msg.type === 'JANUS_ACTIVATE') openAnnotationMode()
    })

    // Keyboard shortcut: Alt+Shift+J
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && e.code === 'KeyJ') {
        overlayHost ? closeAnnotationMode() : openAnnotationMode()
      }
    })
  },
})
