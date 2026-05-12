import { addEvent, loadPersistedEvents, clearEvents } from '../lib/event-capture/store'
import { attachClickInterceptor } from '../lib/event-capture/interceptors/click'
import { attachKeyboardInterceptor } from '../lib/event-capture/interceptors/keyboard'
import { attachNavigationInterceptor } from '../lib/event-capture/interceptors/navigation'
import { attachScrollInterceptor } from '../lib/event-capture/interceptors/scroll'
import { CONSOLE_EVENT_NAME } from '../lib/event-capture/interceptors/console'
import { NETWORK_EVENT_NAME } from '../lib/event-capture/interceptors/network'
import type { ApiEvent, CapturedEvent, ConsoleEvent } from '../lib/event-capture/types'
import { mount, unmount } from 'svelte'
import Overlay from '../components/annotation/Overlay.svelte'
import { loadShortcuts, matchesShortcut } from '../lib/shortcuts'
import type { StoredShortcuts } from '../lib/shortcuts'
import { loadCaptureConfig } from '../lib/capture-config'
import type { CaptureConfig } from '../lib/capture-config'
import { uuid } from '../lib/uuid'

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  async main() {
    // Skip iframes
    if (window !== window.top) return

    let captureConfig: CaptureConfig = {
      click: true, keyboard: true, navigation: true, api: true,
      scroll: true, console_error: true, console_warn: true,
    }

    let isRecording = false

    function filteredAddEvent(event: CapturedEvent) {
      if (!isRecording) return
      if (event.type === 'console') {
        const c = event as ConsoleEvent
        if (c.level === 'error' && !captureConfig.console_error) return
        if (c.level === 'warn' && !captureConfig.console_warn) return
      } else if (!captureConfig[event.type as keyof CaptureConfig]) {
        return
      }
      addEvent(event)
    }

    // All DOM listeners registered synchronously before any await — events
    // dispatched by the MAIN world script during storage reads are not lost
    const cleanups = [
      attachClickInterceptor(filteredAddEvent),
      attachKeyboardInterceptor(filteredAddEvent),
      attachNavigationInterceptor(filteredAddEvent),
      attachScrollInterceptor(filteredAddEvent),
    ]

    document.addEventListener(NETWORK_EVENT_NAME, (e: Event) => {
      const detail = JSON.parse((e as CustomEvent<string>).detail)
      const event: ApiEvent = {
        id: uuid(), type: 'api', timestamp: Date.now(),
        method: detail.method, url: detail.url, status: detail.status,
        requestBody: detail.requestBody, responseBody: detail.responseBody,
        errorDetails: detail.errorDetails, duration: detail.duration,
      }
      filteredAddEvent(event)
    })

    document.addEventListener(CONSOLE_EVENT_NAME, (e: Event) => {
      const { level, message } = JSON.parse((e as CustomEvent<string>).detail)
      filteredAddEvent({ id: uuid(), type: 'console', level, message, timestamp: Date.now() })
    })

    await loadPersistedEvents()
    let shortcuts: StoredShortcuts = await loadShortcuts()
    captureConfig = await loadCaptureConfig()
    browser.storage.onChanged.addListener((changes) => {
      if ('janus_shortcuts' in changes) shortcuts = changes['janus_shortcuts'].newValue
      if ('janus_capture_config' in changes) captureConfig = changes['janus_capture_config'].newValue
    })

    // Restore recording state from background (persists across reloads / navigation)
    try {
      const res = await browser.runtime.sendMessage({ type: 'JANUS_GET_RECORDING_STATE' })
      isRecording = res?.recording ?? false
    } catch {
      // background not ready yet
    }

    // Anchor the session with the current page — covers hard navigations and
    // the case where recording was already active when this page loaded.
    if (isRecording) {
      addEvent({
        id: uuid(), type: 'navigation', timestamp: Date.now(),
        url: window.location.href, title: document.title,
      })
    }

    // Annotation mode
    let overlayHost: HTMLElement | null = null
    let overlayInstance: Record<string, unknown> | null = null
    let enterPickingMode: (() => void) | null = null

    function openAnnotationMode() {
      if (overlayHost) {
        enterPickingMode?.()
        return
      }

      overlayHost = document.createElement('div')
      overlayHost.id = 'janus-root'
      document.body.appendChild(overlayHost)

      overlayInstance = mount(Overlay, {
        target: overlayHost,
        props: {
          onClose: closeAnnotationMode,
          onPickingRef: (fn) => { enterPickingMode = fn },
        },
      })
    }

    function closeAnnotationMode() {
      if (overlayInstance) {
        unmount(overlayInstance)
        overlayInstance = null
      }
      overlayHost?.remove()
      overlayHost = null
      enterPickingMode = null
    }

    // Listen for messages from popup / background
    browser.runtime.onMessage.addListener((msg: { type: string; recording?: boolean }) => {
      if (msg.type === 'JANUS_ACTIVATE') {
        openAnnotationMode()
        return
      }
      if (msg.type === 'JANUS_RECORDING_CHANGED') {
        isRecording = msg.recording ?? false
        if (isRecording) {
          clearEvents()
          addEvent({
            id: uuid(), type: 'navigation', timestamp: Date.now(),
            url: window.location.href, title: document.title,
          })
        }
        return
      }
    })

    // Keyboard shortcuts
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (shortcuts.annotate && matchesShortcut(e, shortcuts.annotate)) {
        openAnnotationMode()
      }
      if (shortcuts.templates && matchesShortcut(e, shortcuts.templates)) {
        browser.tabs.create({ url: browser.runtime.getURL('/prompt-manager.html') })
      }
      if (shortcuts.settings && matchesShortcut(e, shortcuts.settings)) {
        browser.tabs.create({ url: browser.runtime.getURL('/settings.html') })
      }
      if (shortcuts.record && matchesShortcut(e, shortcuts.record)) {
        e.preventDefault()
        browser.runtime.sendMessage({ type: 'JANUS_OPEN_POPUP' }).catch(() => {})
      }
    })
  },
})
