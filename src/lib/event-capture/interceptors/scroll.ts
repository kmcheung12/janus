import type { ScrollEvent, CapturedEvent } from '../types'
import { uuid } from '../../uuid'
import { resolveSelector } from '../../element-selector'

export function attachScrollInterceptor(onEvent: (e: CapturedEvent) => void): () => void {
  const prevScroll = new WeakMap<Element, { x: number; y: number }>()
  let prevWindowX = window.scrollX
  let prevWindowY = window.scrollY
  const timers = new WeakMap<Element | Window, ReturnType<typeof setTimeout>>()
  let windowTimer: ReturnType<typeof setTimeout> | null = null

  function emit(selector: string, direction: ScrollEvent['direction'], deltaX: number, deltaY: number) {
    const event: ScrollEvent = {
      id: uuid(),
      type: 'scroll',
      timestamp: Date.now(),
      selector,
      direction,
      count: 1,
      deltaX,
      deltaY,
    }
    onEvent(event)
  }

  function handler(e: Event) {
    const target = e.target as Element | Document

    if (target === document || target === document.documentElement || target === document.body) {
      if (windowTimer !== null) clearTimeout(windowTimer)
      windowTimer = setTimeout(() => {
        const dy = window.scrollY - prevWindowY
        const dx = window.scrollX - prevWindowX
        prevWindowY = window.scrollY
        prevWindowX = window.scrollX
        const direction = Math.abs(dy) >= Math.abs(dx)
          ? (dy >= 0 ? 'down' : 'up')
          : (dx >= 0 ? 'right' : 'left')
        emit('window', direction, dx, dy)
        windowTimer = null
      }, 200)
      return
    }

    const el = target as Element
    if (el.closest?.('#janus-root')) return

    const prev = prevScroll.get(el) ?? { x: el.scrollLeft, y: el.scrollTop }
    const existing = timers.get(el)
    if (existing !== undefined) clearTimeout(existing)

    timers.set(el, setTimeout(() => {
      const dy = el.scrollTop - prev.y
      const dx = el.scrollLeft - prev.x
      prevScroll.set(el, { x: el.scrollLeft, y: el.scrollTop })
      timers.delete(el)
      const direction = Math.abs(dy) >= Math.abs(dx)
        ? (dy >= 0 ? 'down' : 'up')
        : (dx >= 0 ? 'right' : 'left')
      emit(resolveSelector(el), direction, dx, dy)
    }, 200))

    prevScroll.set(el, prev)
  }

  document.addEventListener('scroll', handler, { capture: true, passive: true })
  return () => document.removeEventListener('scroll', handler, { capture: true })
}
