import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as native from '../../src/lib/browser-tools/native-adapter'

interface FakeTool {
  name: string
  description?: string
  inputSchema?: unknown
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
  origin?: string
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
      toolId: 'native:search',
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

    const outcome = await native.invoke('native:search', { query: 'x' })
    expect(outcome).toEqual({ status: 'completed', result: { items: 3 } })
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'search' }), { query: 'x' })
  })

  it('reports a handler throw as failed, not not_started', async () => {
    // The site's handler ran; it may well have had effects.
    install([{ name: 'buy', inputSchema: schema }], {
      execute: async () => { throw new Error('card declined') },
    })
    await native.discover()
    const outcome = await native.invoke('native:buy', {})
    expect(outcome).toMatchObject({ status: 'error', error: { execution: 'failed' } })
  })

  it('refuses a tool that was never discovered', async () => {
    install([{ name: 'search', inputSchema: schema }])
    await native.discover()
    const outcome = await native.invoke('native:ghost', {})
    expect(outcome).toMatchObject({
      status: 'error', error: { code: 'TOOL_UNAVAILABLE', execution: 'not_started' },
    })
  })

  it('refuses when the API is unavailable', async () => {
    const outcome = await native.invoke('native:search', {})
    expect(outcome).toMatchObject({ error: { code: 'TOOL_UNAVAILABLE', execution: 'not_started' } })
  })
})
