import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { attachResizeInterceptor } from '../../../src/lib/event-capture/interceptors/resize'
import type { ResizeEvent } from '../../../src/lib/event-capture/types'

describe('attachResizeInterceptor', () => {
  let detach: () => void
  let captured: ResizeEvent[]

  beforeEach(() => {
    vi.useFakeTimers()
    captured = []
    detach = attachResizeInterceptor(e => captured.push(e as ResizeEvent))
  })

  afterEach(() => {
    detach()
    vi.useRealTimers()
  })

  it('emits a resize event after 500ms debounce', () => {
    window.dispatchEvent(new Event('resize'))
    expect(captured).toHaveLength(0)
    vi.advanceTimersByTime(499)
    expect(captured).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(captured).toHaveLength(1)
    expect(captured[0].type).toBe('resize')
    expect(captured[0].width).toBe(window.innerWidth)
    expect(captured[0].height).toBe(window.innerHeight)
  })

  it('debounces multiple resize events into one', () => {
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(200)
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(200)
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(500)
    expect(captured).toHaveLength(1)
  })

  it('emits an orientationchange event immediately', () => {
    window.dispatchEvent(new Event('orientationchange'))
    expect(captured).toHaveLength(1)
    expect(captured[0].type).toBe('resize')
  })

  it('includes orientation when screen.orientation is available', () => {
    Object.defineProperty(window.screen, 'orientation', {
      value: { type: 'landscape-primary' },
      configurable: true,
    })
    window.dispatchEvent(new Event('orientationchange'))
    expect(captured[0].orientation).toBe('landscape-primary')
  })

  it('omits orientation when screen.orientation is unavailable', () => {
    Object.defineProperty(window.screen, 'orientation', {
      value: undefined,
      configurable: true,
    })
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(500)
    expect(captured[0].orientation).toBeUndefined()
  })

  it('detach stops capturing resize events', () => {
    detach()
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(500)
    expect(captured).toHaveLength(0)
  })

  it('detach stops capturing orientationchange events', () => {
    detach()
    window.dispatchEvent(new Event('orientationchange'))
    expect(captured).toHaveLength(0)
  })
})
