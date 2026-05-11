import type { ClickEvent, CapturedEvent } from '../types'
import { resolveSelector } from '../../element-selector'

export function attachClickInterceptor(onEvent: (e: CapturedEvent) => void): () => void {
  function handler(e: MouseEvent) {
    const target = e.target as Element
    if (!target) return

    const event: ClickEvent = {
      id: crypto.randomUUID(),
      type: 'click',
      timestamp: Date.now(),
      selector: resolveSelector(target),
      label: target.textContent?.trim().slice(0, 50) ?? '',
      count: 1,
    }
    onEvent(event)
  }

  document.addEventListener('click', handler, { capture: true })
  return () => document.removeEventListener('click', handler, { capture: true })
}
