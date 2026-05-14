import type { ClickEvent, DragEvent, CapturedEvent } from '../types'
import { resolveSelector } from '../../element-selector'
import { uuid } from '../../uuid'
import { rdp } from './rdp'
import type { Point } from './rdp'

const DRAG_THRESHOLD = 5
const RDP_EPSILON = 3

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

export function attachPointerInterceptor(onEvent: (e: CapturedEvent) => void): () => void {
  let startEl: Element | null = null
  let startX = 0
  let startY = 0
  let dragging = false
  let rawPath: Point[] = []

  function onMousedown(e: MouseEvent) {
    if (e.button !== 0) return
    const target = e.target as Element
    if (!target || target.closest('#janus-root')) return
    startEl = target
    startX = e.clientX
    startY = e.clientY
    dragging = false
    rawPath = [{ x: e.clientX, y: e.clientY }]
  }

  function onMousemove(e: MouseEvent) {
    if (!startEl) return
    rawPath.push({ x: e.clientX, y: e.clientY })
    if (!dragging) {
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
        dragging = true
      }
    }
  }

  function onMouseup(e: MouseEvent) {
    if (!startEl) return

    rawPath.push({ x: e.clientX, y: e.clientY })

    if (!dragging) {
      onEvent({
        id: uuid(),
        type: 'click',
        timestamp: Date.now(),
        selector: resolveSelector(startEl),
        label: resolveLabel(startEl),
        count: 1,
        x: startX,
        y: startY,
      } satisfies ClickEvent)
    } else {
      const path = rdp(rawPath, RDP_EPSILON)
      const start = path[0]
      const end = path[path.length - 1]
      const targetEl = document.elementFromPoint(e.clientX, e.clientY)

      onEvent({
        id: uuid(),
        type: 'drag',
        timestamp: Date.now(),
        sourceSelector: resolveSelector(startEl),
        targetSelector: targetEl && targetEl !== startEl ? resolveSelector(targetEl as Element) : null,
        path,
        deltaX: end.x - start.x,
        deltaY: end.y - start.y,
      } satisfies DragEvent)
    }

    startEl = null
    dragging = false
    rawPath = []
  }

  document.addEventListener('mousedown', onMousedown, { capture: true })
  document.addEventListener('mousemove', onMousemove, { capture: true })
  document.addEventListener('mouseup', onMouseup, { capture: true })

  return () => {
    document.removeEventListener('mousedown', onMousedown, { capture: true })
    document.removeEventListener('mousemove', onMousemove, { capture: true })
    document.removeEventListener('mouseup', onMouseup, { capture: true })
  }
}
