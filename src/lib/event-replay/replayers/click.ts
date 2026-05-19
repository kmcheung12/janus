import type { CapturedEvent, ClickEvent } from '../../event-capture/types'
import { registerReplayer } from '../registry'
import { getOverlay } from '../overlay'

registerReplayer('click', (event: CapturedEvent) => {
  const e = event as ClickEvent
  const svg = getOverlay()
  if (!svg) return

  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  circle.setAttribute('cx', String(e.x))
  circle.setAttribute('cy', String(e.y))
  circle.setAttribute('r', '30')
  circle.setAttribute('fill', 'none')
  circle.setAttribute('stroke', '#cba6f7')
  circle.setAttribute('stroke-width', '2')
  circle.style.animation = 'janus-click-ripple 400ms ease-out forwards'
  circle.addEventListener('animationend', () => circle.remove(), { once: true })
  svg.appendChild(circle)
})
