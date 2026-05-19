import type { CapturedEvent, DragEvent as CapturedDragEvent } from '../../event-capture/types'
import { registerReplayer } from '../registry'
import { getOverlay } from '../overlay'

function pathLength(points: Array<{ x: number; y: number }>): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    total += Math.sqrt(dx * dx + dy * dy)
  }
  return total
}

registerReplayer('drag', (event: CapturedEvent) => {
  const e = event as CapturedDragEvent
  if (e.path.length < 2) return
  const svg = getOverlay()
  if (!svg) return

  const len = pathLength(e.path)
  const points = e.path.map(p => `${p.x},${p.y}`).join(' ')

  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
  polyline.setAttribute('points', points)
  polyline.setAttribute('fill', 'none')
  polyline.setAttribute('stroke', '#89b4fa')
  polyline.setAttribute('stroke-width', '2')
  polyline.setAttribute('stroke-linecap', 'round')
  polyline.setAttribute('stroke-linejoin', 'round')
  polyline.style.setProperty('--path-len', `${len}px`)
  polyline.style.strokeDasharray = `${len}px`
  polyline.style.strokeDashoffset = `${len}px`
  polyline.style.animation = 'janus-drag-trace 800ms ease-out forwards'
  polyline.addEventListener('animationend', () => polyline.remove(), { once: true })
  svg.appendChild(polyline)
})
