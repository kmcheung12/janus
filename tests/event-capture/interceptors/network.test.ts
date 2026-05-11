import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { patchNetwork, NETWORK_EVENT_NAME } from '../../../src/lib/event-capture/interceptors/network'

describe('patchNetwork', () => {
  let unpatch: () => void
  let received: CustomEvent[] = []
  let handler: (e: Event) => void

  beforeEach(() => {
    received = []
    handler = (e) => received.push(e as CustomEvent)
    document.addEventListener(NETWORK_EVENT_NAME, handler)
    unpatch = patchNetwork(document)
  })

  afterEach(() => {
    unpatch()
    document.removeEventListener(NETWORK_EVENT_NAME, handler)
  })

  it('captures a successful fetch call', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })
    )
    // Re-patch after replacing global.fetch
    unpatch()
    unpatch = patchNetwork(document)

    await fetch('/api/test')

    expect(received).toHaveLength(1)
    expect(received[0].detail.method).toBe('GET')
    expect(received[0].detail.url).toContain('/api/test')
    expect(received[0].detail.status).toBe(200)
  })

  it('captures fetch errors', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network failure'))
    unpatch()
    unpatch = patchNetwork(document)

    try { await fetch('/api/fail') } catch {}

    expect(received).toHaveLength(1)
    expect(received[0].detail.errorDetails).toContain('Network failure')
    expect(received[0].detail.status).toBeNull()
  })

  it('truncates request and response bodies to 500 chars', async () => {
    const longBody = 'x'.repeat(1000)
    global.fetch = vi.fn().mockResolvedValue(
      new Response(longBody, { status: 200 })
    )
    unpatch()
    unpatch = patchNetwork(document)

    await fetch('/api/big', { method: 'POST', body: longBody })

    expect(received[0].detail.requestBody.length).toBeLessThanOrEqual(500)
    expect(received[0].detail.responseBody.length).toBeLessThanOrEqual(500)
  })
})
