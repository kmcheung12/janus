import type { NavigationEvent, CapturedEvent } from '../types'
import { uuid } from '../../uuid'
import { sanitizeUrl } from '../../browser-tools/url-safety'

export function attachNavigationInterceptor(onEvent: (e: CapturedEvent) => void): () => void {
  function emit(url?: string) {
    const event: NavigationEvent = {
      id: uuid(),
      type: 'navigation',
      timestamp: Date.now(),
      // Same reason as the read tools: a page URL can carry a session token,
      // and a journey reaches agent context through get_journey_by_id.
      url: sanitizeUrl(url ?? window.location.href),
      title: document.title,
    }
    onEvent(event)
  }

  const originalPushState = history.pushState.bind(history)
  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    originalPushState(...args)
    emit(typeof args[2] === 'string' ? args[2] : window.location.href)
  }

  const originalReplaceState = history.replaceState.bind(history)
  history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
    originalReplaceState(...args)
    emit(typeof args[2] === 'string' ? args[2] : window.location.href)
  }

  const popstateHandler = () => emit()
  window.addEventListener('popstate', popstateHandler)

  return () => {
    history.pushState = originalPushState
    history.replaceState = originalReplaceState
    window.removeEventListener('popstate', popstateHandler)
  }
}
