import type { KeyboardInputEvent, CapturedEvent } from '../types'
import { resolveSelector } from '../../element-selector'

export function attachKeyboardInterceptor(onEvent: (e: CapturedEvent) => void): () => void {
  function handler(e: Event) {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement
    if (!target) return
    if (target.closest('#janus-root')) return
    if ((target as HTMLInputElement).type === 'password') return

    const inputType = (target as HTMLInputElement).type ?? 'text'

    const event: KeyboardInputEvent = {
      id: crypto.randomUUID(),
      type: 'keyboard',
      timestamp: Date.now(),
      selector: resolveSelector(target),
      inputType,
      count: 1,
    }
    onEvent(event)
  }

  document.addEventListener('input', handler, { capture: true })
  return () => document.removeEventListener('input', handler, { capture: true })
}
