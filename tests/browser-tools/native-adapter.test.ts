import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as native from '../../src/lib/browser-tools/native-adapter'
import { decodeNativeToolId, encodeNativeToolId } from '../../src/lib/browser-tools/native-adapter'

interface FakeTool {
  name: string
  title?: string
  description?: string
  inputSchema?: unknown
  annotations?: {
    readOnlyHint?: boolean
    consequentialHint?: boolean
    destructiveHint?: boolean
  }
  origin?: string
  window?: Window
}

function install(tools: FakeTool[], options: { execute?: (t: unknown, i: unknown) => Promise<unknown>; honourFromOrigins?: boolean } = {}) {
  const context = {
    getTools: vi.fn(async (opts?: { fromOrigins?: string[] }) => {
      if (options.honourFromOrigins && opts?.fromOrigins) {
        return tools.filter((t) => t.origin === undefined || opts.fromOrigins!.includes(t.origin))
      }
      return tools
    }),
    executeTool: options.execute ?? vi.fn(async () => ({ ok: true })),
  }
  Object.defineProperty(document, 'modelContext', { value: context, configurable: true, writable: true })
  return context
}

function uninstall() {
  Reflect.deleteProperty(document as unknown as Record<string, unknown>, 'modelContext')
}

const schema = { type: 'object', properties: { query: { type: 'string' } } }

afterEach(uninstall)

describe('capability reporting', () => {
  it('reports unavailable when the API is absent', () => {
    expect(native.capability()).toBe('unavailable')
  })

  it('distinguishes a partial API from an absent one', () => {
    // Present but missing members is not the same as unsupported; claiming
    // support would produce confusing downstream failures.
    Object.defineProperty(document, 'modelContext', { value: {}, configurable: true, writable: true })
    expect(native.capability()).toBe('untested')
  })

  it('reports available when both members exist', () => {
    install([])
    expect(native.capability()).toBe('available')
  })
})

describe('discovery', () => {
  it('maps a native tool to a descriptor', async () => {
    install([{ name: 'search', description: 'Search', inputSchema: schema, annotations: { readOnlyHint: true, destructiveHint: false } }])
    const [tool] = await native.discover()
    expect(tool).toMatchObject({
      toolId: encodeNativeToolId('search'),
      source: { kind: 'native', nativeName: 'search' },
      readOnlyHint: true,
      consequentialHint: false,
    })
  })

  it('defaults unknown effects to consequential', async () => {
    install([{ name: 'doThing', inputSchema: schema }])
    const [tool] = await native.discover()
    expect(tool.consequentialHint).toBe(true)
    expect(tool.readOnlyHint).toBe(false)
  })

  it('skips a tool with no usable input schema', async () => {
    install([{ name: 'broken' }])
    expect(await native.discover()).toHaveLength(0)
  })

  it('requests this origin only', async () => {
    const context = install([{ name: 'search', inputSchema: schema }])
    await native.discover()
    expect(context.getTools).toHaveBeenCalledWith({ fromOrigins: [window.location.origin] })
  })

  it('excludes descendant-frame tools even when fromOrigins is ignored', async () => {
    // getTools() returns tools from this document *and its descendants*, so
    // top-level-only is an active filter, not an abstention.
    install([
      { name: 'ours', inputSchema: schema, origin: window.location.origin },
      { name: 'iframe', inputSchema: schema, origin: 'https://ads.example' },
    ])
    const tools = await native.discover()
    expect(tools.map((t) => t.name)).toEqual(['ours'])
  })

  it('falls back to an unfiltered call when fromOrigins is unsupported', async () => {
    const context = {
      getTools: vi.fn()
        .mockRejectedValueOnce(new TypeError('unexpected argument'))
        .mockResolvedValueOnce([{ name: 'search', inputSchema: schema }]),
      executeTool: vi.fn(),
    }
    Object.defineProperty(document, 'modelContext', { value: context, configurable: true, writable: true })
    expect(await native.discover()).toHaveLength(1)
  })

  it('marks an oversized catalog unsupported rather than publishing a subset', async () => {
    // A silently truncated list would look complete to the agent.
    install(Array.from({ length: 40 }, (_, i) => ({ name: `t${i}`, inputSchema: schema })))
    expect(await native.discover()).toHaveLength(0)
  })

  it('returns nothing when the API is absent', async () => {
    expect(await native.discover()).toHaveLength(0)
  })
})

describe('invocation', () => {
  it('passes business arguments to the page handler', async () => {
    const execute = vi.fn(async () => ({ items: 3 }))
    install([{ name: 'search', inputSchema: schema }], { execute })
    await native.discover()

    const outcome = await native.invoke(encodeNativeToolId('search'), { query: 'x' })
    expect(outcome).toEqual({ status: 'completed', result: { items: 3 } })
    // Chrome takes arguments as a JSON string, symmetric with returning
    // inputSchema as one. Passing an object fails inside the site's handler.
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'search' }),
      JSON.stringify({ query: 'x' }),
    )
  })

  it('reports a handler throw as failed, not not_started', async () => {
    // The site's handler ran; it may well have had effects.
    install([{ name: 'buy', inputSchema: schema }], {
      execute: async () => { throw new Error('card declined') },
    })
    await native.discover()
    const outcome = await native.invoke(encodeNativeToolId('buy'), {})
    expect(outcome).toMatchObject({ status: 'error', error: { execution: 'failed' } })
  })

  it('refuses a tool that was never discovered', async () => {
    install([{ name: 'search', inputSchema: schema }])
    await native.discover()
    const outcome = await native.invoke(encodeNativeToolId('ghost'), {})
    expect(outcome).toMatchObject({
      status: 'error', error: { code: 'TOOL_UNAVAILABLE', execution: 'not_started' },
    })
  })

  it('refuses when the API is unavailable', async () => {
    const outcome = await native.invoke(encodeNativeToolId('search'), {})
    expect(outcome).toMatchObject({ error: { code: 'TOOL_UNAVAILABLE', execution: 'not_started' } })
  })
})

describe('tool ID encoding', () => {
  it('produces an ID matching the contract pattern', () => {
    for (const name of ['search', 'Search products', 'add to cart / basket', '商品を検索', 'a+b/c=d']) {
      expect(encodeNativeToolId(name)).toMatch(/^[A-Za-z0-9_-]{1,96}$/)
    }
  })

  it('round-trips arbitrary names', () => {
    for (const name of ['search', 'Search products', '商品を検索', 'a+b/c=d']) {
      expect(decodeNativeToolId(encodeNativeToolId(name))).toBe(name)
    }
  })

  it('never collapses two distinct names onto one ID', () => {
    // A sanitizing replace would map both of these to the same string.
    expect(encodeNativeToolId('add to cart')).not.toBe(encodeNativeToolId('add/to/cart'))
  })

  it('returns undefined for an ID that is not native', () => {
    expect(decodeNativeToolId('g_def_1')).toBeUndefined()
  })
})

describe('Chrome calling conventions', () => {
  // Every case here was observed against Chrome 153/154 on the Basketful
  // fixture; each one silently broke the lane before it was handled.

  it('accepts inputSchema delivered as a JSON string', async () => {
    install([{ name: 'search', inputSchema: JSON.stringify(schema) }])
    const [tool] = await native.discover()
    expect(tool?.inputSchema).toEqual(schema)
  })

  it('ignores an unparseable schema rather than publishing a broken tool', async () => {
    install([{ name: 'broken', inputSchema: '{not json' }])
    expect(await native.discover()).toHaveLength(0)
  })

  it('reads consequentialHint, which is what Chrome actually sets', async () => {
    install([
      { name: 'safe', inputSchema: schema, annotations: { readOnlyHint: true, consequentialHint: false } },
      { name: 'risky', inputSchema: schema, annotations: { readOnlyHint: false, consequentialHint: true } },
    ])
    const [safe, risky] = await native.discover()
    expect(safe.consequentialHint).toBe(false)
    expect(risky.consequentialHint).toBe(true)
  })

  it('falls back to the tool name when title is an empty string', async () => {
    // Chrome sets title to '' rather than omitting it. An empty name fails
    // contract validation, which rejects the entire tools_changed frame.
    install([{ name: 'search_products', title: '', inputSchema: schema }])
    const [tool] = await native.discover()
    expect(tool.name).toBe('search_products')
  })

  it('excludes a tool registered by a subframe window', async () => {
    // Identity against our own `window` cannot be used: a content script runs
    // in an isolated world whose window differs from the page's.
    const top = { top: undefined as unknown }
    top.top = top
    const frame = { top }
    install([
      { name: 'ours', inputSchema: schema, window: top as unknown as Window },
      { name: 'theirs', inputSchema: schema, window: frame as unknown as Window },
    ])
    expect((await native.discover()).map((t) => t.name)).toEqual(['ours'])
  })

  it.each([
    ['plain value', { items: 3 }, { items: 3 }],
    ['JSON string', JSON.stringify({ items: 3 }), { items: 3 }],
    ['content envelope', JSON.stringify({ content: [{ type: 'text', text: 'hello' }] }), 'hello'],
    ['envelope wrapping JSON', JSON.stringify({ content: [{ type: 'text', text: '{"a":1}' }] }), { a: 1 }],
    ['prose', 'Showing 2 results', 'Showing 2 results'],
  ])('unwraps a result delivered as %s', async (_label, returned, expected) => {
    install([{ name: 'search', inputSchema: schema }], { execute: async () => returned })
    await native.discover()
    const outcome = await native.invoke(encodeNativeToolId('search'), {})
    expect(outcome).toEqual({ status: 'completed', result: expected })
  })

  it('preserves a site\'s own error payload for the agent to act on', async () => {
    // Basketful answers "No store is open yet. Call choose_store first" this
    // way; discarding it would strip the recovery instruction.
    const envelope = { content: [{ type: 'text', text: 'Call choose_store first.' }], isError: true }
    install([{ name: 'search', inputSchema: schema }], { execute: async () => JSON.stringify(envelope) })
    await native.discover()
    const outcome = await native.invoke(encodeNativeToolId('search'), {})
    expect(JSON.stringify(outcome)).toContain('choose_store')
  })
})

describe('Janus own registrations', () => {
  beforeEach(() => native.markOwnRegistrations([]))
  afterEach(() => native.markOwnRegistrations([]))

  it('does not rediscover the tools Janus registered as the site\'s own', async () => {
    /*
     * registerTool() and getTools() are the same registry, so our auto tools
     * come back indistinguishable from the page's. publish() would read that
     * as "this page has native tools", suppress the auto tools it had just
     * registered, withdraw them, and find nothing on the next round — a tool
     * list oscillating between two sets, with our tools credited to the site.
     */
    install([
      { name: 'read_page', description: 'ours', inputSchema: schema },
      { name: 'find_text', description: 'ours', inputSchema: schema },
      { name: 'add_to_basket', description: 'the site\'s', inputSchema: schema },
    ])
    native.markOwnRegistrations(['read_page', 'find_text'])

    const discovered = await native.discover()
    expect(discovered.map((t) => t.name)).toEqual(['add_to_basket'])
  })

  it('keeps a name the site owns, which we never registered', async () => {
    // registerTool throws on a duplicate, so a clash means the site won and
    // its tool must keep being published as native.
    install([{ name: 'search', description: 'the site\'s', inputSchema: schema }])
    native.markOwnRegistrations([])

    const discovered = await native.discover()
    expect(discovered.map((t) => t.name)).toEqual(['search'])
  })
})
