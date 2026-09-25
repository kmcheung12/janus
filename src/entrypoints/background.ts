import type { CapturedEvent } from '../lib/event-capture/types'
import { sanitizeUrl } from '../lib/browser-tools/url-safety'
import { shortId } from '../lib/short-id'
import { startJourney, syncEvents, stopJourney, sendFile } from '../lib/mcp/ws-client'
import * as bridge from '../lib/browser-tools/background-bridge'
import { getStatus } from '../lib/browser-tools/control-client'

type Msg =
  | { type: 'JANUS_SYNC_EVENTS'; events: CapturedEvent[] }
  | { type: 'JANUS_GET_EVENTS' }
  | { type: 'JANUS_CLEAR_EVENTS' }
  | { type: 'JANUS_OPEN_POPUP' }
  | { type: 'JANUS_TOGGLE_RECORDING'; tabId?: number }
  | { type: 'JANUS_GET_RECORDING_STATE'; tabId?: number }
  | { type: 'JANUS_SIDEBAR_OPENED' }
  | { type: 'JANUS_SIDEBAR_CLOSED' }
  | { type: 'JANUS_SEND_FILE'; filename: string; mimeType: string; data: ArrayBuffer }
  | { type: 'JANUS_BT_GET_STATE' }
  | { type: 'JANUS_BT_SAVE_PAIRING' }
  | { type: 'JANUS_BT_ENABLE_PAGE' }
  | { type: 'JANUS_BT_DISABLE_PAGE' }
  | { type: 'JANUS_BT_SET_LABEL' }
  | { type: 'JANUS_BT_SET_AUTO_WRITES' }
  | { type: 'JANUS_BT_TOOLS_CHANGED' }
  | { type: 'JANUS_BT_RECONNECT' }
  | { type: 'JANUS_BT_GET_PROVISIONING_PAYLOAD' }
  | { type: 'JANUS_BT_AUTHORING_STATE' }
  | { type: 'JANUS_BT_CAPTURE_DRAFT' }
  | { type: 'JANUS_BT_SET_APPROVAL' }
  | { type: 'JANUS_BT_DELETE_DEFINITION' }
  | { type: 'JANUS_BT_EXPORT_DEFINITION' }
  | { type: 'JANUS_BT_TEST_DEFINITION' }
  | { type: 'JANUS_BT_DEMO' }
  | { type: 'JANUS_BT_DEMO_BUILD' }

function setBadge(tabId: number, recording: boolean) {
  const api = (browser as any).action || (browser as any).browserAction
  if (!api) return
  try {
    api.setBadgeText({ text: recording ? '●' : '', tabId })
    api.setBadgeBackgroundColor({ color: '#a6e3a1', tabId })
  } catch (e) {
    console.error('Failed to set badge:', e)
  }
}

export default defineBackground(() => {
  // Reloading an extension is manual, and a stale background context keeps
  // reporting "Connected" while running old code. Say which build this is.
  console.log(`[janus] background ${__JANUS_BUILD__}`)

  // The control connection's lifetime is the pairing credential, not a
  // recording: discovery and invocation must work with recording off (§14).
  void bridge.loadPairing().then(() => bridge.reconnect())

  const tabEvents = new Map<number, CapturedEvent[]>()
  const tabRecording = new Map<number, boolean>()
  const tabSidebarOpen = new Map<number, boolean>()
  const tabJourneyId = new Map<number, string>()

  browser.runtime.onMessage.addListener((msg: Msg, sender) => {
    // ── Browser tool bridge. Pairing, enablement and labels are privileged:
    // they are only accepted from extension pages, never content scripts (§19).
    //
    // The test is the sender's origin, not the absence of a tab: settings and
    // popup are extension pages that do run in tabs, while a content script
    // reports the host page's URL and is refused.
    const senderUrl = sender.url ?? ''
    const fromExtensionPage = senderUrl.startsWith(browser.runtime.getURL('/'))
    if (msg.type.startsWith('JANUS_BT_') && msg.type !== 'JANUS_BT_TOOLS_CHANGED') {
      if (!fromExtensionPage) return Promise.resolve({ error: 'forbidden' })
    }

    if (msg.type === 'JANUS_BT_GET_STATE') {
      const tabId = (msg as unknown as { tabId?: number }).tabId
      return Promise.resolve({
        status: getStatus(),
        // The page for the tab being asked about, plus everything enabled, so
        // the popup can show both "this tab" and "elsewhere".
        page: tabId !== undefined ? bridge.getEnabledPage(tabId) : null,
        pages: bridge.getEnabledPages(),
      })
    }
    if (msg.type === 'JANUS_BT_SAVE_PAIRING') {
      const m = msg as unknown as { config: Parameters<typeof bridge.savePairing>[0] }
      return bridge.savePairing(m.config).then(() => ({ ok: true }))
    }
    if (msg.type === 'JANUS_BT_ENABLE_PAGE') {
      const m = msg as unknown as { tabId: number; label?: string; allowAutoWrites?: boolean }
      return bridge.enablePage(m.tabId, m.label, m.allowAutoWrites).then(
        (page) => ({ page }),
        (e: Error) => ({ error: e.message }),
      )
    }
    if (msg.type === 'JANUS_BT_DISABLE_PAGE') {
      const m = msg as unknown as { tabId?: number; all?: boolean }
      if (m.all) bridge.disableAll('disabled')
      else if (m.tabId !== undefined) bridge.disablePage(m.tabId, 'disabled')
      return Promise.resolve({ ok: true, pages: bridge.getEnabledPages() })
    }
    if (msg.type === 'JANUS_BT_SET_AUTO_WRITES') {
      const m = msg as unknown as { tabId: number; allow: boolean }
      return bridge.setAutoWrites(m.tabId, m.allow).then((page) => ({ page }))
    }
    if (msg.type === 'JANUS_BT_SET_LABEL') {
      const m = msg as unknown as { tabId: number; label: string }
      try {
        return Promise.resolve({ page: bridge.setLabel(m.tabId, m.label) })
      } catch (e) {
        return Promise.resolve({ error: (e as Error).message })
      }
    }
    if (msg.type === 'JANUS_BT_GET_PROVISIONING_PAYLOAD') {
      return Promise.resolve({ payload: bridge.provisioningPayload() })
    }
    if (msg.type === 'JANUS_BT_RECONNECT') {
      return bridge.reconnect().then(() => ({ ok: true }))
    }
    if (msg.type === 'JANUS_BT_AUTHORING_STATE') {
      return bridge.authoringState()
    }
    if (msg.type === 'JANUS_BT_CAPTURE_DRAFT') {
      const m = msg as unknown as { tabId: number; principalId: string }
      return bridge.captureDraft(m.tabId, m.principalId)
    }
    if (msg.type === 'JANUS_BT_SET_APPROVAL') {
      const m = msg as unknown as { definitionId: string; state: 'enabled' | 'disabled' }
      return bridge.setApproval(m.definitionId, m.state).then((approval) => ({ approval }))
    }
    if (msg.type === 'JANUS_BT_DELETE_DEFINITION') {
      return bridge.deleteDefinition((msg as unknown as { definitionId: string }).definitionId)
        .then(() => ({ ok: true }))
    }
    if (msg.type === 'JANUS_BT_EXPORT_DEFINITION') {
      return bridge.exportDefinition((msg as unknown as { definitionId: string }).definitionId)
        .then((json) => ({ json }))
    }
    if (msg.type === 'JANUS_BT_TEST_DEFINITION') {
      const m = msg as unknown as { tabId: number; definitionId: string; input: Record<string, never> }
      return bridge.testDefinition(m.tabId, m.definitionId, m.input)
    }
    if (msg.type === 'JANUS_BT_DEMO') {
      const m = msg as unknown as { tabId: number; action: 'start' | 'stop' | 'state' }
      return bridge.demo(m.tabId, m.action)
    }
    if (msg.type === 'JANUS_BT_DEMO_BUILD') {
      const m = msg as unknown as {
        tabId: number; recording: unknown; parameterIndices: number[]; resultIndex?: number
      }
      return bridge.buildDemoDraft(m.tabId, m.recording, m.parameterIndices, m.resultIndex)
    }
    if (msg.type === 'JANUS_BT_TOOLS_CHANGED') {
      void bridge.refreshTools()
      return
    }

    if (msg.type === 'JANUS_TOGGLE_RECORDING') {
      const tabId = msg.tabId ?? sender.tab?.id
      if (!tabId) return
      const next = !(tabRecording.get(tabId) ?? false)
      tabRecording.set(tabId, next)
      if (next) tabEvents.delete(tabId)
      setBadge(tabId, next)

      if (next) {
        const journeyId = shortId()
        tabJourneyId.set(tabId, journeyId)
        return browser.tabs.get(tabId).then(tab => {
          // A tab URL can carry a session token as readily as a link can, and
          // journey metadata reaches agent context through list_journeys.
          const startUrl = sanitizeUrl(tab.url ?? '')
          const meta = {
            startTime: Date.now(),
            startUrl,
            tabTitle: tab.title ?? '',
            domain: (() => { try { return new URL(startUrl).hostname } catch { return startUrl } })(),
            status: 'recording' as const,
          }
          browser.storage.session.set({
            [`janus_recording_${tabId}`]: true,
            [`janus_journeyid_${tabId}`]: journeyId,
            [`janus_journeymeta_${tabId}`]: meta,
          }).catch(() => {})
          startJourney(journeyId, meta)
          browser.tabs.sendMessage(tabId, { type: 'JANUS_RECORDING_CHANGED', recording: true, journeyId }).catch(() => {})
          return { recording: true, journeyId }
        })
      } else {
        const journeyId = tabJourneyId.get(tabId)
        if (journeyId) stopJourney(journeyId)
        tabJourneyId.delete(tabId)
        browser.storage.session.remove([`janus_recording_${tabId}`, `janus_journeyid_${tabId}`, `janus_journeymeta_${tabId}`]).catch(() => {})
        browser.tabs.sendMessage(tabId, { type: 'JANUS_RECORDING_CHANGED', recording: false }).catch(() => {})
        return Promise.resolve({ recording: false })
      }
    }

    if (msg.type === 'JANUS_GET_RECORDING_STATE') {
      const tabId = msg.tabId ?? sender.tab?.id
      if (!tabId) return
      const recording = tabRecording.get(tabId) ?? false
      const sidebarOpen = tabSidebarOpen.get(tabId) ?? false
      const journeyId = tabJourneyId.get(tabId)
      if (!recording && !sidebarOpen) {
        return browser.storage.session
          .get([`janus_sidebar_${tabId}`, `janus_recording_${tabId}`, `janus_journeyid_${tabId}`])
          .then(stored => ({
            recording: (stored[`janus_recording_${tabId}`] as boolean | undefined) ?? false,
            sidebarOpen: (stored[`janus_sidebar_${tabId}`] as boolean | undefined) ?? false,
            journeyId: (stored[`janus_journeyid_${tabId}`] as string | undefined),
          }))
          .catch(() => ({ recording: false, sidebarOpen: false, journeyId: undefined }))
      }
      return Promise.resolve({ recording, sidebarOpen, journeyId })
    }

    const tabId = sender.tab?.id
    if (!tabId) return

    if (msg.type === 'JANUS_SIDEBAR_OPENED') {
      tabSidebarOpen.set(tabId, true)
      browser.storage.session.set({ [`janus_sidebar_${tabId}`]: true }).catch(() => {})
      return
    }
    if (msg.type === 'JANUS_SIDEBAR_CLOSED') {
      tabSidebarOpen.delete(tabId)
      browser.storage.session.remove(`janus_sidebar_${tabId}`).catch(() => {})
      return
    }

    if (msg.type === 'JANUS_SYNC_EVENTS') {
      tabEvents.set(tabId, msg.events)
      const journeyId = tabJourneyId.get(tabId)
      if (journeyId) {
        syncEvents(journeyId, msg.events)
      } else {
        // SW restarted — restore from session storage and re-establish WebSocket connection
        browser.storage.session.get([`janus_recording_${tabId}`, `janus_journeyid_${tabId}`, `janus_journeymeta_${tabId}`]).then(stored => {
          const recording = stored[`janus_recording_${tabId}`] as boolean | undefined
          const id = stored[`janus_journeyid_${tabId}`] as string | undefined
          const meta = stored[`janus_journeymeta_${tabId}`] as import('../lib/mcp/ws-client').JourneyMeta | undefined
          if (recording && id && meta) {
            tabRecording.set(tabId, true)
            tabJourneyId.set(tabId, id)
            startJourney(id, meta)    // re-opens WebSocket; onopen will send full sync
            syncEvents(id, msg.events) // pre-populates active.events so onopen sync includes them
          }
        }).catch(() => {})
      }
      return
    }
    if (msg.type === 'JANUS_GET_EVENTS') {
      return Promise.resolve(tabEvents.get(tabId) ?? [])
    }
    if (msg.type === 'JANUS_CLEAR_EVENTS') {
      tabEvents.delete(tabId)
      return
    }
    if (msg.type === 'JANUS_OPEN_POPUP') {
      try {
        const actionApi = (browser as any).action || (browser as any).browserAction
        if (typeof actionApi?.openPopup === 'function') {
          const opts = sender.tab?.windowId != null ? { windowId: sender.tab.windowId } : undefined
          actionApi.openPopup(opts)
        }
      } catch (e) {
        console.error('Failed to open popup:', e)
      }
      return
    }
    if (msg.type === 'JANUS_SEND_FILE') {
      const journeyId = tabJourneyId.get(tabId)
      if (!journeyId) return
      sendFile(journeyId, msg.filename, msg.mimeType, msg.data)
      return
    }
  })

  browser.tabs.onActivated.addListener(({ tabId }) => {
    setBadge(tabId, tabRecording.get(tabId) ?? false)
  })

  // Navigation replaces the document, which invalidates the page handle. v1
  // requires explicit re-enabling rather than silently following the user.
  browser.webNavigation?.onCommitted?.addListener(({ tabId, frameId }) => {
    if (frameId === 0) void bridge.onNavigated(tabId)
  })

  browser.tabs.onRemoved.addListener((tabId) => {
    bridge.disablePage(tabId, 'closed')
    tabEvents.delete(tabId)
    tabRecording.delete(tabId)
    tabSidebarOpen.delete(tabId)
    tabJourneyId.delete(tabId)
    browser.storage.session.remove([
      `janus_sidebar_${tabId}`,
      `janus_recording_${tabId}`,
      `janus_journeyid_${tabId}`,
      `janus_journeymeta_${tabId}`,
    ]).catch(() => {})
  })
})
