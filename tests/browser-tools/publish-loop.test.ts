/**
 * The background republishes by asking the page for its tools, and `publish()`
 * is what answers. If answering always announces a change, that closes a cycle
 * — LIST_TOOLS -> publish -> TOOLS_CHANGED -> refreshTools -> LIST_TOOLS —
 * which spins a persistent background page at full speed.
 *
 * Neither existing suite could catch this: jsdom has no extension messaging,
 * and Chromium's service worker is torn down between wakeups often enough to
 * hide it. So the invariant is asserted directly on the announcement.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as pageTools from '../../src/lib/browser-tools/page-controller'

describe('publish announcements', () => {
  beforeEach(() => {
    pageTools.resetDocument()
    pageTools.setAutoOptions({ pageId: 'p1', allowWrites: false })
  })

  it('announces the first publish', async () => {
    const seen = vi.fn()
    const stop = pageTools.subscribeTools(seen)
    seen.mockClear() // subscribeTools pushes current state on subscribe

    await pageTools.publish()
    expect(seen).toHaveBeenCalledTimes(1)
    stop()
  })

  it('does not announce again when the tool set is unchanged', async () => {
    await pageTools.publish()

    const seen = vi.fn()
    const stop = pageTools.subscribeTools(seen)
    seen.mockClear()

    // Exactly what the background does on every refreshTools round.
    await pageTools.publish()
    await pageTools.publish()
    await pageTools.publish()

    expect(seen).not.toHaveBeenCalled()
    stop()
  })

  it('announces again after a new document resets the page', async () => {
    await pageTools.publish()

    const seen = vi.fn()
    const stop = pageTools.subscribeTools(seen)
    seen.mockClear()

    // The daemon dropped the old handle's tools, so an identical set on the
    // new document still has to be published.
    pageTools.resetDocument()
    pageTools.setAutoOptions({ pageId: 'p2', allowWrites: false })
    seen.mockClear()

    await pageTools.publish()
    expect(seen).toHaveBeenCalled()
    stop()
  })

  it('announces when opting the page into form tools changes the set', async () => {
    document.body.innerHTML = '<form><input name="q"><button type="submit">Go</button></form>'
    await pageTools.publish()

    const seen = vi.fn()
    const stop = pageTools.subscribeTools(seen)
    seen.mockClear()

    pageTools.setAutoOptions({ pageId: 'p1', allowWrites: true })
    await pageTools.publish()

    expect(seen).toHaveBeenCalled()
    stop()
  })
})
