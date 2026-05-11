import type { NavigationEvent, CapturedEvent } from '../types'

export function attachNavigationInterceptor(onEvent: (e: CapturedEvent) => void): () => void {
  function emit() {
    const event: NavigationEvent = {
      id: crypto.randomUUID(),
      type: 'navigation',
      timestamp: Date.now(),
      url: window.location.href,
    }
    onEvent(event)
  }

  const originalPushState = history.pushState.bind(history)
  history.pushState = function (...args) {
    originalPushState(...args)
    emit()
  }

  const originalReplaceState = history.replaceState.bind(history)
  history.replaceState = function (...args) {
    originalReplaceState(...args)
    emit()
  }

  window.addEventListener('popstate', emit)

  return () => {
    history.pushState = originalPushState
    history.replaceState = originalReplaceState
    window.removeEventListener('popstate', emit)
  }
}
