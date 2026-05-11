import type { NavigationEvent, CapturedEvent } from '../types'

export function attachNavigationInterceptor(onEvent: (e: CapturedEvent) => void): () => void {
  function emit(url?: string) {
    const event: NavigationEvent = {
      id: crypto.randomUUID(),
      type: 'navigation',
      timestamp: Date.now(),
      url: url ?? window.location.href,
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
