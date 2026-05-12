import type { CapturedEvent } from '../lib/event-capture/types'

type Msg =
  | { type: 'JANUS_SYNC_EVENTS'; events: CapturedEvent[] }
  | { type: 'JANUS_GET_EVENTS' }
  | { type: 'JANUS_CLEAR_EVENTS' }
  | { type: 'JANUS_OPEN_POPUP' }
  | { type: 'JANUS_TOGGLE_RECORDING'; tabId?: number }
  | { type: 'JANUS_GET_RECORDING_STATE'; tabId?: number }

function setBadge(tabId: number, recording: boolean) {
  const api = (browser as any).action || (browser as any).browserAction
  if (!api) return
  try {
    api.setBadgeText({ text: recording ? '●' : '', tabId })
    api.setBadgeBackgroundColor({ color: '#a6e3a1', tabId })
  } catch {
    // badge API not available
  }
}

export default defineBackground(() => {
  const tabEvents = new Map<number, CapturedEvent[]>()
  const tabRecording = new Map<number, boolean>()

  browser.runtime.onMessage.addListener((msg: Msg, sender) => {
    if (msg.type === 'JANUS_TOGGLE_RECORDING') {
      const tabId = msg.tabId ?? sender.tab?.id
      if (!tabId) return
      const next = !(tabRecording.get(tabId) ?? false)
      tabRecording.set(tabId, next)
      if (next) tabEvents.delete(tabId)
      setBadge(tabId, next)
      browser.tabs.sendMessage(tabId, { type: 'JANUS_RECORDING_CHANGED', recording: next }).catch(() => {})
      return Promise.resolve({ recording: next })
    }

    if (msg.type === 'JANUS_GET_RECORDING_STATE') {
      const tabId = msg.tabId ?? sender.tab?.id
      if (!tabId) return
      return Promise.resolve({ recording: tabRecording.get(tabId) ?? false })
    }

    const tabId = sender.tab?.id
    if (!tabId) return

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
      } catch {
        // openPopup not available in this browser
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
  })
})
