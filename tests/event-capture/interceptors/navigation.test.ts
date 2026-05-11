import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { attachNavigationInterceptor } from '../../../src/lib/event-capture/interceptors/navigation'
import type { NavigationEvent } from '../../../src/lib/event-capture/types'

describe('attachNavigationInterceptor', () => {
  let detach: () => void
  let captured: NavigationEvent[] = []

  beforeEach(() => {
    captured = []
    detach = attachNavigationInterceptor(e => captured.push(e as NavigationEvent))
  })

  afterEach(() => detach())

  it('captures pushState navigation', () => {
    history.pushState({}, '', '/new-page')
    expect(captured).toHaveLength(1)
    expect(captured[0].type).toBe('navigation')
    expect(captured[0].url).toContain('/new-page')
  })

  it('captures popstate events', () => {
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(captured).toHaveLength(1)
    expect(captured[0].type).toBe('navigation')
  })
})
