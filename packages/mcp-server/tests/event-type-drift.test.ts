import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `packages/mcp-server/src/types.ts` is a hand-copy of the extension's
 * `src/lib/event-capture/types.ts`, and the two have no compile-time link.
 * Adding a field to one and forgetting the other produces events that
 * silently lose data crossing the WebSocket.
 *
 * This asserts the shared region stays identical. If it fails, copy the
 * extension definition across rather than editing only one side.
 */

const EXTENSION = resolve(__dirname, '../../../src/lib/event-capture/types.ts')
const DAEMON = resolve(__dirname, '../src/types.ts')

/** The daemon adds `cli_line`, which the extension has no reason to emit. */
const DAEMON_ONLY_EVENT_TYPES = new Set(['cli_line'])

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

function eventTypeUnion(source: string): Set<string> {
  const match = source.match(/export type EventType\s*=\s*([^\n]+)/)
  if (!match) throw new Error('EventType union not found')
  return new Set([...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]))
}

function baseEventFields(source: string): string[] {
  const match = source.match(/interface BaseEvent \{([\s\S]*?)\n\}/)
  if (!match) throw new Error('BaseEvent not found')
  return [...match[1].matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]).sort()
}

/**
 * The two files are formatted differently — the extension spreads members
 * across lines, the daemon keeps them on one — so compare normalized member
 * signatures rather than raw text.
 */
function interfaceMembers(source: string, name: string): string[] | undefined {
  const match = source.match(new RegExp(`export interface ${name} extends BaseEvent \\{([\\s\\S]*?)\\n?\\}`))
  if (!match) return undefined
  return match[1]
    .split(/[;\n]/)
    .map((member) => member.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .sort()
}

describe('event type drift between extension and daemon', () => {
  const extension = read(EXTENSION)
  const daemon = read(DAEMON)

  it('declares the same EventType members', () => {
    const fromDaemon = new Set([...eventTypeUnion(daemon)].filter((t) => !DAEMON_ONLY_EVENT_TYPES.has(t)))
    expect([...fromDaemon].sort()).toEqual([...eventTypeUnion(extension)].sort())
  })

  it('declares the same BaseEvent fields, including provenance', () => {
    const fields = baseEventFields(extension)
    expect(baseEventFields(daemon)).toEqual(fields)
    expect(fields).toContain('actor')
    expect(fields).toContain('invocationId')
  })

  it.each([
    'SessionEvent', 'NavigationEvent', 'ClickEvent', 'KeyboardInputEvent',
    'ApiEvent', 'ScrollEvent', 'ConsoleEvent', 'DragEvent', 'ResizeEvent',
  ])('declares %s identically', (name) => {
    const fromExtension = interfaceMembers(extension, name)
    expect(fromExtension).toBeDefined()
    expect(interfaceMembers(daemon, name)).toEqual(fromExtension)
  })
})
