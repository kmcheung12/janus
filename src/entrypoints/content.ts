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
import AgentToolsOverlay from '../components/browser-tools/AgentToolsOverlay.svelte'
import { loadShortcuts, matchesShortcut } from '../lib/shortcuts.svelte'
import type { StoredShortcuts } from '../lib/shortcuts.svelte'
import { loadCaptureConfig, DEFAULTS as CAPTURE_DEFAULTS } from '../lib/capture-config'
import type { CaptureConfig } from '../lib/capture-config'
import { uuid } from '../lib/uuid'
import { sanitizeUrl } from '../lib/browser-tools/url-safety'
import * as pageTools from '../lib/browser-tools/page-controller'
import { attribute } from '../lib/browser-tools/provenance'
import { scanForm } from '../lib/browser-tools/form-scanner'
import { run as runRecipe } from '../lib/browser-tools/recipe-runtime'
import * as demo from '../lib/browser-tools/demonstration-recorder'

/** Display preference for the on-page agent tools panel. Off unless set. */
const OVERLAY_KEY = 'janus_tools_overlay'

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

    // The content script is the half that tends to go stale unnoticed — the
    // background can reconnect and look healthy while pages still run the
    // previous build.
    console.log(`[janus] content ${__JANUS_BUILD__}`)

    let captureConfig: CaptureConfig = {
      click: true, keyboard: true, keyboard_keystrokes: false, navigation: true, api: true,
      scroll: true, drag: true, console_error: true, console_warn: true, console_log: false, resize: true,
    }

    let isRecording = false
    let currentJourneyId: string | null = null
    let updateSidebarJourneyId: ((id: string | null) => void) | null = null

    /**
     * Tell the MAIN-world console patch what to bother collecting.
     *
     * It cannot see the capture config or the recording state, so without this
     * it pays full cost — stringify, stack trace, serialize, dispatch — for
     * every console call on every page, including results this side throws
     * away a moment later.
     */
    function pushConsoleLevels() {
      document.dispatchEvent(new CustomEvent('janus:console-levels', {
        detail: JSON.stringify({
          error: isRecording && captureConfig.console_error,
          warn: isRecording && captureConfig.console_warn,
          log: isRecording && captureConfig.console_log,
        }),
      }))
    }

    function filteredAddEvent(event: CapturedEvent) {
      if (!isRecording) return
      // Tag provenance before any filtering, so agent effects stay
      // distinguishable from human ones in the journey (§10). Events observed
      // during an invocation are only marked 'unknown' — concurrent human
      // input and background work remain possible.
      Object.assign(event, attribute(false))
      if (event.type === 'console') {
        const c = event as ConsoleEvent
        if (c.level === 'error' && !captureConfig.console_error) return
        if (c.level === 'warn' && !captureConfig.console_warn) return
        if (c.level === 'log' && !captureConfig.console_log) return
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
        method: detail.method, url: sanitizeUrl(detail.url), status: detail.status,
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
    pushConsoleLevels()
    browser.storage.onChanged.addListener((changes) => {
      if ('janus_shortcuts' in changes) shortcuts = changes['janus_shortcuts'].newValue
      if ('janus_capture_config' in changes) {
        captureConfig = { ...CAPTURE_DEFAULTS, ...(changes['janus_capture_config'].newValue as Partial<CaptureConfig>) }
        pushConsoleLevels()
      }
      if (OVERLAY_KEY in changes) {
        if (changes[OVERLAY_KEY].newValue) openToolsOverlay()
        else closeToolsOverlay()
      }
    })

    // Sidebar
    let overlayHost: HTMLElement | null = null
    let overlayInstance: Record<string, unknown> | null = null
    let sidebarHost: HTMLElement | null = null
    let sidebarInstance: Record<string, unknown> | null = null
    let enterPickingMode: (() => void) | null = null
    let enterEventsMode: (() => void) | null = null
    let isPickingMode: (() => boolean) | null = null

    // Restore recording and sidebar state from background (persists across reloads / navigation)
    try {
      const res = await browser.runtime.sendMessage({ type: 'JANUS_GET_RECORDING_STATE' })
      isRecording = res?.recording ?? false
      pushConsoleLevels()
      currentJourneyId = res?.journeyId ?? null
      if (res?.sidebarOpen) openEventsSidebar()
    } catch (e) {
      console.error('Failed to restore state from background:', e)
    }

    // The panel is a persistent preference rather than per-tab state, so a
    // navigation or a new tab keeps showing it without being re-asked.
    if ((await browser.storage.local.get(OVERLAY_KEY))[OVERLAY_KEY]) openToolsOverlay()

    // Anchor the current page in the event log when recording is already active.
    // Only a navigation event is added here — session events are only emitted
    // when recording is explicitly started via JANUS_RECORDING_CHANGED.
    if (isRecording) {
      addEvent({
        id: uuid(), type: 'navigation', timestamp: Date.now(),
        url: sanitizeUrl(window.location.href), title: document.title,
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
        isPickingMode = null
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
          initialJourneyId: currentJourneyId,
          onClose: closeSidebar,
          onPickingRef: (fn) => { enterPickingMode = fn },
          onSidebarRef: (fn) => { enterEventsMode = fn },
          onIsPickingRef: (fn) => { isPickingMode = fn },
          onJourneyIdRef: (fn: (id: string | null) => void) => { updateSidebarJourneyId = fn },
        },
      })

      browser.runtime.sendMessage({ type: 'JANUS_SIDEBAR_OPENED' }).catch(() => {})
    }

    function openAnnotationSidebar() { openSidebar('picking') }
    function openEventsSidebar() { openSidebar('sidebar') }

    // ── Agent tools overlay ────────────────────────────────────────────────
    // Off by default and purely informational: it reports the published tool
    // set and the calls Janus ran, and cannot enable, disable or invoke
    // anything. Its visibility is a display preference, not an access control.
    function openToolsOverlay() {
      if (overlayHost?.isConnected) return
      if (overlayInstance) { unmount(overlayInstance); overlayInstance = null }
      if (!document.body) {
        document.addEventListener('DOMContentLoaded', openToolsOverlay, { once: true })
        return
      }
      overlayHost = document.createElement('div')
      overlayHost.id = 'janus-agent-tools-root'
      document.body.appendChild(overlayHost)
      overlayInstance = mount(AgentToolsOverlay, {
        target: overlayHost,
        // Dismissing from the page turns the preference off, so it does not
        // reappear on the next navigation as if the click had not happened.
        props: { onClose: () => { void browser.storage.local.set({ [OVERLAY_KEY]: false }) } },
      })
    }

    function closeToolsOverlay() {
      if (overlayInstance) { unmount(overlayInstance); overlayInstance = null }
      overlayHost?.remove()
      overlayHost = null
    }

    function closeSidebar() {
      if (sidebarInstance) {
        unmount(sidebarInstance)
        sidebarInstance = null
      }
      sidebarHost?.remove()
      sidebarHost = null
      enterPickingMode = null
      enterEventsMode = null
      isPickingMode = null
      browser.runtime.sendMessage({ type: 'JANUS_SIDEBAR_CLOSED' }).catch(() => {})
    }

    // Listen for messages from popup / background
    browser.runtime.onMessage.addListener((msg: { type: string; recording?: boolean; journeyId?: string }) => {
      if (msg.type === 'JANUS_ACTIVATE') {
        openAnnotationSidebar()
        return
      }
      if (msg.type === 'JANUS_OPEN_SIDEBAR') {
        openEventsSidebar()
        return
      }
      // ── Browser tool bridge (§6). These run regardless of recording state:
      // discovery and invocation must work with recording off.
      if (msg.type === 'JANUS_BT_DESCRIBE') {
        return pageTools.nativeToolCount().then((nativeToolCount) => ({
          documentId: pageTools.currentDocumentId(),
          nativeCapability: pageTools.nativeCapability(),
          nativeToolCount,
        }))
      }
      if (msg.type === 'JANUS_BT_LIST_TOOLS') {
        return pageTools.publish()
      }
      if (msg.type === 'JANUS_BT_INVOKE') {
        const m = msg as unknown as {
          requestId: string; toolId: string
          input: Record<string, never>; timeoutMs: number
        }
        return pageTools.invoke(m.toolId, m.input, m.requestId, m.timeoutMs).then((outcome) => ({
          outcome,
          // Only an unknown outcome may leave execution unresolved; the
          // runtime decides this, not the transport.
          executionStopped: !(outcome.status === 'error' && outcome.error.execution === 'outcome_unknown'),
        }))
      }
      if (msg.type === 'JANUS_BT_SCAN_FORM') {
        const m = msg as unknown as {
          principalId: string; browserSessionId: string; pageId: string; documentId: string
        }
        // Largest form on the page: a heuristic starting point the user
        // reviews. Scanning never submits anything.
        const forms = [...document.querySelectorAll('form')] as HTMLFormElement[]
        const form = forms.sort((a, b) => b.elements.length - a.elements.length)[0]
        if (!form) return Promise.resolve({ error: 'No form found' })
        return Promise.resolve(scanForm({ form, ...m }))
      }
      if (msg.type === 'JANUS_BT_DEMO_START') {
        return Promise.resolve(demo.start())
      }
      if (msg.type === 'JANUS_BT_DEMO_STATE') {
        return Promise.resolve(demo.current())
      }
      if (msg.type === 'JANUS_BT_DEMO_STOP') {
        return Promise.resolve(demo.stop('user'))
      }
      if (msg.type === 'JANUS_BT_DEMO_BUILD') {
        const m = msg as unknown as Omit<Parameters<typeof demo.buildDraft>[0], 'recording'> & {
          recording: Parameters<typeof demo.buildDraft>[0]['recording']
        }
        return Promise.resolve(demo.buildDraft(m))
      }
      if (msg.type === 'JANUS_BT_SET_AUTO_OPTIONS') {
        const m = msg as unknown as { pageId: string; allowWrites: boolean }
        pageTools.setAutoOptions({ pageId: m.pageId, allowWrites: m.allowWrites })
        return Promise.resolve({ ok: true })
      }
      if (msg.type === 'JANUS_BT_SET_ENABLED') {
        pageTools.setPageEnabled((msg as unknown as { enabled: boolean }).enabled)
        return Promise.resolve({ ok: true })
      }
      if (msg.type === 'JANUS_BT_SET_DEFINITIONS') {
        pageTools.setDefinitions((msg as unknown as { definitions: never[] }).definitions)
        return Promise.resolve({ ok: true })
      }
      if (msg.type === 'JANUS_BT_TEST_RUN') {
        const m = msg as unknown as {
          definition: Parameters<typeof runRecipe>[0]['definition']
          input: Record<string, never>; timeoutMs: number
        }
        return runRecipe({
          definition: m.definition, input: m.input,
          signal: new AbortController().signal, timeoutMs: m.timeoutMs,
        })
      }
      if (msg.type === 'JANUS_BT_CANCEL') {
        pageTools.cancel((msg as unknown as { requestId: string }).requestId)
        return
      }

      if (msg.type === 'JANUS_RECORDING_CHANGED') {
        isRecording = msg.recording ?? false
        pushConsoleLevels()
        if (isRecording) {
          currentJourneyId = msg.journeyId ?? null
          updateSidebarJourneyId?.(currentJourneyId)
          clearEvents()
          addEvent(sessionEvent())
          addEvent({
            id: uuid(), type: 'navigation', timestamp: Date.now(),
            url: sanitizeUrl(window.location.href), title: document.title,
          })
        }
        return
      }
    })

    window.addEventListener('pagehide', () => { demo.stop('navigation') }, { once: true })

    // Native registrations can change without navigation (§7), so republish
    // whenever the page's tool set moves.
    pageTools.observeToolChanges(() => {
      browser.runtime.sendMessage({ type: 'JANUS_BT_TOOLS_CHANGED' }).catch(() => {})
    })

    // Keyboard shortcuts
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (shortcuts.sidebar && matchesShortcut(e, shortcuts.sidebar)) {
        if (sidebarHost) closeSidebar()
        else openEventsSidebar()
      }
      if (shortcuts.annotate && matchesShortcut(e, shortcuts.annotate)) {
        if (sidebarHost && isPickingMode?.()) closeSidebar()
        else openAnnotationSidebar()
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
