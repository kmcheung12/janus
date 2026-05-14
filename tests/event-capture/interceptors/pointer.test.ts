import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { attachPointerInterceptor } from '../../../src/lib/event-capture/interceptors/pointer'
import type { ClickEvent, DragEvent, CapturedEvent } from '../../../src/lib/event-capture/types'

function mousedown(target: Element, x = 0, y = 0) {
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: x, clientY: y }))
}

function mousemove(x: number, y: number) {
  document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }))
}

function mouseup(x = 0, y = 0) {
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }))
}

describe('attachPointerInterceptor', () => {
  let detach: () => void
  let captured: CapturedEvent[] = []

  beforeEach(() => {
    captured = []
    detach = attachPointerInterceptor(e => captured.push(e))
  })

  afterEach(() => detach())

  describe('click', () => {
    it('emits ClickEvent on mousedown + mouseup with no movement', () => {
      const btn = document.createElement('button')
      btn.id = 'my-btn'
      btn.textContent = 'Submit'
      document.body.appendChild(btn)
      mousedown(btn, 100, 200)
      mouseup(100, 200)
      document.body.removeChild(btn)

      expect(captured).toHaveLength(1)
      expect(captured[0].type).toBe('click')
    })

    it('emits ClickEvent when movement is below threshold', () => {
      const btn = document.createElement('button')
      document.body.appendChild(btn)
      mousedown(btn, 100, 100)
      mousemove(103, 101)  // ~3.2px — below 5px threshold
      mouseup(103, 101)
      document.body.removeChild(btn)

      expect(captured).toHaveLength(1)
      expect(captured[0].type).toBe('click')
    })

    it('uses mousedown coordinates for click x/y', () => {
      const btn = document.createElement('button')
      document.body.appendChild(btn)
      mousedown(btn, 50, 60)
      mouseup(50, 60)
      document.body.removeChild(btn)

      const click = captured[0] as ClickEvent
      expect(click.x).toBe(50)
      expect(click.y).toBe(60)
    })

    it('resolves selector and label', () => {
      const btn = document.createElement('button')
      btn.id = 'pay-btn'
      btn.textContent = 'Pay Now'
      document.body.appendChild(btn)
      mousedown(btn, 0, 0)
      mouseup(0, 0)
      document.body.removeChild(btn)

      const click = captured[0] as ClickEvent
      expect(click.selector).toContain('pay-btn')
      expect(click.label).toBe('Pay Now')
    })

    it('ignores right-click (button !== 0)', () => {
      const btn = document.createElement('button')
      document.body.appendChild(btn)
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2, clientX: 0, clientY: 0 }))
      mouseup(0, 0)
      document.body.removeChild(btn)

      expect(captured).toHaveLength(0)
    })

    it('ignores clicks inside #janus-root', () => {
      const root = document.createElement('div')
      root.id = 'janus-root'
      const btn = document.createElement('button')
      root.appendChild(btn)
      document.body.appendChild(root)
      mousedown(btn, 0, 0)
      mouseup(0, 0)
      document.body.removeChild(root)

      expect(captured).toHaveLength(0)
    })

    it('detach stops capturing', () => {
      detach()
      const btn = document.createElement('button')
      document.body.appendChild(btn)
      mousedown(btn, 0, 0)
      mouseup(0, 0)
      document.body.removeChild(btn)

      expect(captured).toHaveLength(0)
    })
  })

  describe('drag', () => {
    it('emits DragEvent when movement exceeds threshold', () => {
      const el = document.createElement('div')
      document.body.appendChild(el)
      mousedown(el, 0, 0)
      mousemove(100, 0)
      mouseup(100, 0)
      document.body.removeChild(el)

      expect(captured).toHaveLength(1)
      expect(captured[0].type).toBe('drag')
    })

    it('path starts at mousedown and ends at mouseup', () => {
      const el = document.createElement('div')
      document.body.appendChild(el)
      mousedown(el, 0, 0)
      mousemove(100, 0)
      mouseup(100, 0)
      document.body.removeChild(el)

      const drag = captured[0] as DragEvent
      expect(drag.path[0]).toEqual({ x: 0, y: 0 })
      expect(drag.path[drag.path.length - 1]).toEqual({ x: 100, y: 0 })
    })

    it('RDP compresses a straight-line path to 2 points', () => {
      const el = document.createElement('div')
      document.body.appendChild(el)
      mousedown(el, 0, 0)
      mousemove(50, 0)
      mousemove(100, 0)
      mousemove(150, 0)
      mouseup(200, 0)
      document.body.removeChild(el)

      const drag = captured[0] as DragEvent
      expect(drag.path).toHaveLength(2)
    })

    it('deltaX and deltaY reflect start-to-end displacement', () => {
      const el = document.createElement('div')
      document.body.appendChild(el)
      mousedown(el, 10, 20)
      mousemove(110, 20)
      mouseup(110, 20)
      document.body.removeChild(el)

      const drag = captured[0] as DragEvent
      expect(drag.deltaX).toBe(100)
      expect(drag.deltaY).toBe(0)
    })

    it('ignores drag starting inside #janus-root', () => {
      const root = document.createElement('div')
      root.id = 'janus-root'
      const el = document.createElement('div')
      root.appendChild(el)
      document.body.appendChild(root)
      mousedown(el, 0, 0)
      mousemove(100, 0)
      mouseup(100, 0)
      document.body.removeChild(root)

      expect(captured).toHaveLength(0)
    })
  })
})
