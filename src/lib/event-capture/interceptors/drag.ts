import type { DragEvent, CapturedEvent } from '../types'
import { resolveSelector } from '../../element-selector'
import { uuid } from '../../uuid'

const DRAG_THRESHOLD = 5
const RDP_EPSILON = 3

type Point = { x: number; y: number }

function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (dx === 0 && dy === 0) {
    return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2)
  }
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / Math.sqrt(dx * dx + dy * dy)
}

function rdp(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points

  let maxDist = 0
  let maxIndex = 0
  const first = points[0]
  const last = points[points.length - 1]

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last)
    if (d > maxDist) {
      maxDist = d
      maxIndex = i
    }
  }

  if (maxDist > epsilon) {
    const left = rdp(points.slice(0, maxIndex + 1), epsilon)
    const right = rdp(points.slice(maxIndex), epsilon)
    return [...left.slice(0, -1), ...right]
  }

  return [first, last]
}

export function attachDragInterceptor(onEvent: (e: CapturedEvent) => void): () => void {
  let startEl: Element | null = null
  let startX = 0
  let startY = 0
  let dragging = false
  let rawPath: Point[] = []

  function onMousedown(e: MouseEvent) {
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
    if (!startEl || !dragging) {
      startEl = null
      dragging = false
      rawPath = []
      return
    }

    rawPath.push({ x: e.clientX, y: e.clientY })
    const path = rdp(rawPath, RDP_EPSILON)
    const start = path[0]
    const end = path[path.length - 1]

    const targetEl = document.elementFromPoint(e.clientX, e.clientY)

    const event: DragEvent = {
      id: uuid(),
      type: 'drag',
      timestamp: Date.now(),
      sourceSelector: resolveSelector(startEl),
      targetSelector: targetEl && targetEl !== startEl ? resolveSelector(targetEl as Element) : null,
      path,
      deltaX: end.x - start.x,
      deltaY: end.y - start.y,
    }
    onEvent(event)

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
