import type { ResizeEvent, CapturedEvent } from '../types'
import { uuid } from '../../uuid'

export function attachResizeInterceptor(onEvent: (e: CapturedEvent) => void): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  function emit() {
    const event: ResizeEvent = {
      id: uuid(),
      type: 'resize',
      timestamp: Date.now(),
      width: window.innerWidth,
      height: window.innerHeight,
      orientation: window.screen?.orientation?.type,
    }
    onEvent(event)
  }

  function onResize() {
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      emit()
    }, 500)
  }

  function onOrientationChange() {
    emit()
  }

  window.addEventListener('resize', onResize)
  window.addEventListener('orientationchange', onOrientationChange)

  return () => {
    window.removeEventListener('resize', onResize)
    window.removeEventListener('orientationchange', onOrientationChange)
    if (debounceTimer !== null) clearTimeout(debounceTimer)
  }
}
