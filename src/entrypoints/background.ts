import type { CapturedEvent } from '../lib/event-capture/types'
import { shortId } from '../lib/short-id'
import { startJourney, syncEvents, stopJourney, sendFile } from '../lib/mcp/ws-client'

type Msg =
  | { type: 'JANUS_SYNC_EVENTS'; events: CapturedEvent[] }
  | { type: 'JANUS_GET_EVENTS' }
  | { type: 'JANUS_CLEAR_EVENTS' }
  | { type: 'JANUS_OPEN_POPUP' }
  | { type: 'JANUS_TOGGLE_RECORDING'; tabId?: number }
  | { type: 'JANUS_GET_RECORDING_STATE'; tabId?: number }
  | { type: 'JANUS_SIDEBAR_OPENED' }
  | { type: 'JANUS_SIDEBAR_CLOSED' }
  | { type: 'JANUS_SEND_FILE'; filename: string; mimeType: string; data: string }

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
  const tabEvents = new Map<number, CapturedEvent[]>()
  const tabRecording = new Map<number, boolean>()
  const tabSidebarOpen = new Map<number, boolean>()
  const tabJourneyId = new Map<number, string>()

  browser.runtime.onMessage.addListener((msg: Msg, sender) => {
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
        browser.storage.session.set({
          [`janus_recording_${tabId}`]: true,
          [`janus_journeyid_${tabId}`]: journeyId,
        }).catch(() => {})
        return browser.tabs.get(tabId).then(tab => {
          const startUrl = tab.url ?? ''
          startJourney(journeyId, {
            startTime: Date.now(),
            startUrl,
            tabTitle: tab.title ?? '',
            domain: (() => { try { return new URL(startUrl).hostname } catch { return startUrl } })(),
            status: 'recording',
          })
          browser.tabs.sendMessage(tabId, { type: 'JANUS_RECORDING_CHANGED', recording: true, journeyId }).catch(() => {})
          return { recording: true, journeyId }
        })
      } else {
        const journeyId = tabJourneyId.get(tabId)
        if (journeyId) stopJourney(journeyId)
        tabJourneyId.delete(tabId)
        browser.storage.session.remove([`janus_recording_${tabId}`, `janus_journeyid_${tabId}`]).catch(() => {})
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
        // SW restarted — check session storage for active recording and restore
        browser.storage.session.get([`janus_recording_${tabId}`, `janus_journeyid_${tabId}`]).then(stored => {
          const recording = stored[`janus_recording_${tabId}`] as boolean | undefined
          const id = stored[`janus_journeyid_${tabId}`] as string | undefined
          if (recording && id) {
            tabRecording.set(tabId, true)
            tabJourneyId.set(tabId, id)
            syncEvents(id, msg.events)
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
      const binary = atob(msg.data)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      sendFile(journeyId, msg.filename, msg.mimeType, bytes.buffer)
      return
    }
  })

  browser.tabs.onActivated.addListener(({ tabId }) => {
    setBadge(tabId, tabRecording.get(tabId) ?? false)
  })

  browser.tabs.onRemoved.addListener((tabId) => {
    tabEvents.delete(tabId)
    tabRecording.delete(tabId)
    tabSidebarOpen.delete(tabId)
    tabJourneyId.delete(tabId)
    browser.storage.session.remove([
      `janus_sidebar_${tabId}`,
      `janus_recording_${tabId}`,
      `janus_journeyid_${tabId}`,
    ]).catch(() => {})
  })
})
