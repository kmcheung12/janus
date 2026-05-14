import type { CapturedEvent } from '../lib/event-capture/types'

type Msg =
  | { type: 'JANUS_SYNC_EVENTS'; events: CapturedEvent[] }
  | { type: 'JANUS_GET_EVENTS' }
  | { type: 'JANUS_CLEAR_EVENTS' }
  | { type: 'JANUS_OPEN_POPUP' }
  | { type: 'JANUS_TOGGLE_RECORDING'; tabId?: number }
  | { type: 'JANUS_GET_RECORDING_STATE'; tabId?: number }
  | { type: 'JANUS_SIDEBAR_OPENED' }
  | { type: 'JANUS_SIDEBAR_CLOSED' }

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

  browser.runtime.onMessage.addListener((msg: Msg, sender) => {
    if (msg.type === 'JANUS_TOGGLE_RECORDING') {
      const tabId = msg.tabId ?? sender.tab?.id
      if (!tabId) return
      const next = !(tabRecording.get(tabId) ?? false)
      tabRecording.set(tabId, next)
      if (next) tabEvents.delete(tabId)
      setBadge(tabId, next)
      if (next) {
        browser.storage.session.set({ [`janus_recording_${tabId}`]: true }).catch(() => {})
      } else {
        browser.storage.session.remove(`janus_recording_${tabId}`).catch(() => {})
      }
      browser.tabs.sendMessage(tabId, { type: 'JANUS_RECORDING_CHANGED', recording: next }).catch(() => {})
      return Promise.resolve({ recording: next })
    }

    if (msg.type === 'JANUS_GET_RECORDING_STATE') {
      const tabId = msg.tabId ?? sender.tab?.id
      if (!tabId) return
      const recording = tabRecording.get(tabId) ?? false
      const sidebarOpen = tabSidebarOpen.get(tabId) ?? false
      // If both are absent from memory the SW may have restarted — fall back to session storage
      if (!recording && !sidebarOpen) {
        return browser.storage.session
          .get([`janus_sidebar_${tabId}`, `janus_recording_${tabId}`])
          .then(stored => ({
            recording: (stored[`janus_recording_${tabId}`] as boolean | undefined) ?? false,
            sidebarOpen: (stored[`janus_sidebar_${tabId}`] as boolean | undefined) ?? false,
          }))
          .catch(() => ({ recording: false, sidebarOpen: false }))
      }
      return Promise.resolve({ recording, sidebarOpen })
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
  })

  browser.tabs.onActivated.addListener(({ tabId }) => {
    setBadge(tabId, tabRecording.get(tabId) ?? false)
  })

  browser.tabs.onRemoved.addListener((tabId) => {
    tabEvents.delete(tabId)
    tabRecording.delete(tabId)
    tabSidebarOpen.delete(tabId)
    browser.storage.session.remove([`janus_sidebar_${tabId}`, `janus_recording_${tabId}`]).catch(() => {})
  })
})
