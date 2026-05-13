import type { ClickEvent, CapturedEvent } from '../types'
import { resolveSelector } from '../../element-selector'
import { uuid } from '../../uuid'

function resolveLabel(el: Element): string {
  if (el.getAttribute('aria-label')) return el.getAttribute('aria-label')!
  if (el.getAttribute('title')) return el.getAttribute('title')!
  if (el.tagName === 'IMG') return el.getAttribute('alt') ?? ''
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    return el.getAttribute('aria-labelledby')
      ? document.getElementById(el.getAttribute('aria-labelledby')!)?.textContent?.trim() ?? ''
      : el.getAttribute('placeholder') ?? el.getAttribute('name') ?? ''
  }
  const text = (el as HTMLElement).innerText?.trim() ?? el.textContent?.trim() ?? ''
  return text.split('\n').map(l => l.trim()).filter(Boolean)[0]?.slice(0, 120) ?? ''
}

export function attachClickInterceptor(onEvent: (e: CapturedEvent) => void): () => void {
  function handler(e: MouseEvent) {
    const target = e.target as Element
    if (!target) return
    if (target.closest('#janus-root')) return

    const event: ClickEvent = {
      id: uuid(),
      type: 'click',
      timestamp: Date.now(),
      selector: resolveSelector(target),
      label: resolveLabel(target),
      count: 1,
    }
    onEvent(event)
  }

  document.addEventListener('click', handler, { capture: true })
  return () => document.removeEventListener('click', handler, { capture: true })
}
