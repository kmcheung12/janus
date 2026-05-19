import { addEvent, loadPersistedEvents, clearEvents } from '../lib/event-capture/store'
import { attachPointerInterceptor } from '../lib/event-capture/interceptors/pointer'
import { attachKeyboardInterceptor } from '../lib/event-capture/interceptors/keyboard'
import { attachNavigationInterceptor } from '../lib/event-capture/interceptors/navigation'
import { attachScrollInterceptor } from '../lib/event-capture/interceptors/scroll'
import { attachResizeInterceptor } from '../lib/event-capture/interceptors/resize'
import { CONSOLE_EVENT_NAME } from '../lib/event-capture/interceptors/console'
import { NETWORK_EVENT_NAME } from '../lib/event-capture/interceptors/network'
import type { ApiEvent, CapturedEvent, ConsoleEvent, SessionEvent } from '../lib/event-capture/types'
import { mount, unmount } from 'svelte'
import Sidebar from '../components/sidebar/Sidebar.svelte'
import { loadShortcuts, matchesShortcut } from '../lib/shortcuts.svelte'
import type { StoredShortcuts } from '../lib/shortcuts.svelte'
import { loadCaptureConfig } from '../lib/capture-config'
import type { CaptureConfig } from '../lib/capture-config'
import { uuid } from '../lib/uuid'

function sessionEvent(): SessionEvent {
  return {
    id: uuid(),
    type: 'session',
    timestamp: Date.now(),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    dpr: window.devicePixelRatio,
    browser: navigator.userAgent,
  }
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  async main() {
    // Skip iframes
    if (window !== window.top) return

    let captureConfig: CaptureConfig = {
      click: true, keyboard: true, keyboard_keystrokes: false, navigation: true, api: true,
      scroll: true, drag: true, console_error: true, console_warn: true,
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
      attachPointerInterceptor(filteredAddEvent),
      attachKeyboardInterceptor(filteredAddEvent, () => captureConfig.keyboard_keystrokes),
      attachNavigationInterceptor(filteredAddEvent),
      attachScrollInterceptor(filteredAddEvent),
      attachResizeInterceptor(filteredAddEvent),
    ]
    window.addEventListener('pagehide', () => cleanups.forEach(fn => fn()), { once: true })

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
      const { level, message, source } = JSON.parse((e as CustomEvent<string>).detail)
      filteredAddEvent({ id: uuid(), type: 'console', level, message, source, timestamp: Date.now() })
    })

    await loadPersistedEvents()
    let shortcuts: StoredShortcuts = await loadShortcuts()
    captureConfig = await loadCaptureConfig()
    browser.storage.onChanged.addListener((changes) => {
      if ('janus_shortcuts' in changes) shortcuts = changes['janus_shortcuts'].newValue
      if ('janus_capture_config' in changes) captureConfig = changes['janus_capture_config'].newValue
    })

    // Sidebar
    let sidebarHost: HTMLElement | null = null
    let sidebarInstance: Record<string, unknown> | null = null
    let enterPickingMode: (() => void) | null = null
    let enterEventsMode: (() => void) | null = null

    // Restore recording and sidebar state from background (persists across reloads / navigation)
    try {
      const res = await browser.runtime.sendMessage({ type: 'JANUS_GET_RECORDING_STATE' })
      isRecording = res?.recording ?? false
      if (res?.sidebarOpen) openEventsSidebar()
    } catch (e) {
      console.error('Failed to restore state from background:', e)
    }

    // Anchor the current page in the event log when recording is already active.
    // Only a navigation event is added here — session events are only emitted
    // when recording is explicitly started via JANUS_RECORDING_CHANGED.
    if (isRecording) {
      addEvent({
        id: uuid(), type: 'navigation', timestamp: Date.now(),
        url: window.location.href, title: document.title,
      })
    }

    function openSidebar(initialMode: 'picking' | 'sidebar') {
      // SPA navigation can detach sidebarHost from the DOM without calling closeSidebar;
      // treat a disconnected host as if the sidebar was never opened.
      if (sidebarHost && !sidebarHost.isConnected) {
        if (sidebarInstance) { unmount(sidebarInstance); sidebarInstance = null }
        sidebarHost = null
        enterPickingMode = null
        enterEventsMode = null
      }

      if (sidebarHost) {
        if (initialMode === 'picking') enterPickingMode?.()
        else enterEventsMode?.()
        return
      }

      if (!document.body) {
        document.addEventListener('DOMContentLoaded', () => openSidebar(initialMode), { once: true })
        return
      }

      sidebarHost = document.createElement('div')
      sidebarHost.id = 'janus-root'
      document.body.appendChild(sidebarHost)

      sidebarInstance = mount(Sidebar, {
        target: sidebarHost,
        props: {
          initialMode,
          onClose: closeSidebar,
          onPickingRef: (fn) => { enterPickingMode = fn },
          onSidebarRef: (fn) => { enterEventsMode = fn },
        },
      })

      browser.runtime.sendMessage({ type: 'JANUS_SIDEBAR_OPENED' }).catch(() => {})
    }

    function openAnnotationSidebar() { openSidebar('picking') }
    function openEventsSidebar() { openSidebar('sidebar') }

    function closeSidebar() {
      if (sidebarInstance) {
        unmount(sidebarInstance)
        sidebarInstance = null
      }
      sidebarHost?.remove()
      sidebarHost = null
      enterPickingMode = null
      enterEventsMode = null
      browser.runtime.sendMessage({ type: 'JANUS_SIDEBAR_CLOSED' }).catch(() => {})
    }

    // Listen for messages from popup / background
    browser.runtime.onMessage.addListener((msg: { type: string; recording?: boolean }) => {
      if (msg.type === 'JANUS_ACTIVATE') {
        openAnnotationSidebar()
        return
      }
      if (msg.type === 'JANUS_OPEN_SIDEBAR') {
        openEventsSidebar()
        return
      }
      if (msg.type === 'JANUS_RECORDING_CHANGED') {
        isRecording = msg.recording ?? false
        if (isRecording) {
          clearEvents()
          addEvent(sessionEvent())
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
      if (shortcuts.sidebar && matchesShortcut(e, shortcuts.sidebar)) {
        if (sidebarHost) closeSidebar()
        else openEventsSidebar()
      }
      if (shortcuts.annotate && matchesShortcut(e, shortcuts.annotate)) {
        openAnnotationSidebar()
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
