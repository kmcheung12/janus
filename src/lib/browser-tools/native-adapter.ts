/**
 * Native WebMCP discovery and invocation (§3 execution world, §7).
 *
 * `ModelContext` is exposed on `Document`, so this runs in the ordinary
 * isolated content-script world — no page-context script, no monkeypatching,
 * and no callback crossing an untrusted boundary.
 *
 * The API is still moving, so everything goes through capability checks and
 * nothing is assumed beyond `getTools`, `executeTool` and a change event.
 */

import type { Json, ToolDescriptor, ToolOutcome } from './contract'
import { LIMITS, jsonBytes } from './limits'

interface NativeTool {
  name: string
  title?: string
  description?: string
  /**
   * Chrome 154 hands this back as a JSON *string*, not an object. Treating it
   * as an object silently drops every tool on the page.
   */
  inputSchema?: unknown
  annotations?: {
    readOnlyHint?: boolean
    /** Chrome's name. The MCP-side spelling is `destructiveHint`. */
    consequentialHint?: boolean
    destructiveHint?: boolean
    untrustedContentHint?: boolean
  }
  /** Set by Chrome; the authoritative signal for descendant-frame filtering. */
  origin?: string
  window?: Window
}

/** Accept either an object or Chrome's JSON-encoded string form. */
function parseSchema(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined
    } catch {
      return undefined
    }
  }
  return raw && typeof raw === 'object' ? raw as Record<string, unknown> : undefined
}

interface NativeModelContext {
  getTools?: (options?: { fromOrigins?: string[] }) => Promise<NativeTool[]>
  executeTool?: (tool: NativeTool | string, input: unknown) => Promise<unknown>
  ontoolchange?: unknown
  addEventListener?: (type: string, listener: () => void) => void
}

function modelContext(): NativeModelContext | undefined {
  return (document as unknown as { modelContext?: NativeModelContext }).modelContext
}

export type NativeCapability = 'available' | 'unavailable' | 'untested'

export function capability(): NativeCapability {
  const context = modelContext()
  if (!context) return 'unavailable'
  // Present but without the members we need is not the same as absent; report
  // it as untested rather than claiming support.
  return typeof context.getTools === 'function' && typeof context.executeTool === 'function'
    ? 'available'
    : 'untested'
}

/**
 * `getTools()` resolves to tools from this document **and its descendants**,
 * so restricting M1 to the top-level document is active filtering, not
 * abstention. A tool that cannot be confidently attributed to this document's
 * own origin is not published.
 */
function ownedByThisDocument(tool: NativeTool): boolean {
  // Chrome exposes the registering window. Comparing it to our own `window`
  // does not work here: a content script runs in an isolated world whose
  // `window` is a different object from the page's, so identity would reject
  // every tool on the page.
  //
  // Asking whether the registering window is its own top frame is world-
  // independent and answers the actual question — is this a descendant
  // document — including for a same-origin iframe, which shares our origin.
  if (tool.window) {
    try {
      return tool.window.top === tool.window
    } catch {
      // Cross-origin access threw, which itself proves a foreign frame.
      return false
    }
  }
  if (tool.origin === undefined) return true
  return tool.origin === window.location.origin
}

/**
 * Tool names Janus itself registered into this document's ModelContext.
 *
 * `getTools()` hands them back like any other, and nothing on the returned
 * object says who registered it — so without this, our own auto tools come
 * back looking like the site's. `publish()` would then see a page that "has
 * native tools", suppress the auto tools it just registered, withdraw them,
 * and on the next round find nothing again: a tool list that flickers between
 * two sets forever, and an agent that sees our tools attributed to the site.
 */
let ownRegistrations = new Set<string>()

export function markOwnRegistrations(names: Iterable<string>): void {
  ownRegistrations = new Set(names)
}

let cache: NativeTool[] = []

export async function discover(): Promise<ToolDescriptor[]> {
  const context = modelContext()
  if (!context?.getTools) { cache = []; return [] }

  let tools: NativeTool[]
  try {
    // Ask for this origin only where the build supports it; the explicit
    // filter below still runs, because the option may be ignored.
    tools = await context.getTools({ fromOrigins: [window.location.origin] })
  } catch {
    try {
      tools = await context.getTools()
    } catch {
      cache = []
      return []
    }
  }

  const owned = (tools ?? [])
    .filter((tool) => !ownRegistrations.has(tool.name))
    .filter(ownedByThisDocument)
  cache = owned

  if (owned.length > LIMITS.nativeToolsPerPage) {
    // §18: overflow marks the catalog unsupported rather than silently
    // publishing an arbitrary subset the agent would believe is complete.
    return []
  }

  return owned.map(toDescriptor).filter((d): d is ToolDescriptor => d !== undefined)
}

/**
 * A tool ID must match `[A-Za-z0-9_-]{1,96}`, but a native tool's name is
 * arbitrary text. base64url encode it: the alphabet is exactly the allowed
 * set, and the mapping is reversible, so two differently-named tools can never
 * collapse onto one ID the way a sanitizing replace would allow.
 */
export function encodeNativeToolId(name: string): string {
  const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(name)))
  return `n_${base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

export function decodeNativeToolId(toolId: string): string | undefined {
  if (!toolId.startsWith('n_')) return undefined
  const base64 = toolId.slice(2).replace(/-/g, '+').replace(/_/g, '/')
  try {
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
    return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
  } catch {
    return undefined
  }
}

function toDescriptor(tool: NativeTool): ToolDescriptor | undefined {
  const schema = parseSchema(tool.inputSchema)
  if (!schema) return undefined
  if (jsonBytes(schema) > LIMITS.nativeBusinessSchemaMaxBytes) return undefined

  // Chrome spells this `consequentialHint`; MCP spells it `destructiveHint`.
  // Accept either, and treat an absent hint as consequential (§17) — an
  // unannotated checkout is not safe just because nobody labelled it.
  const declared = tool.annotations?.consequentialHint ?? tool.annotations?.destructiveHint

  return {
    // A native tool's name is its logical identity within this document.
    toolId: encodeNativeToolId(tool.name),
    toolRevision: 1,
    source: { kind: 'native', nativeName: tool.name },
    // `||`, not `??`: Chrome sets `title` to an empty string rather than
    // omitting it, and an empty name fails contract validation — which rejects
    // the whole tools_changed frame, not just this tool.
    name: tool.title || tool.name,
    description: tool.description || tool.name,
    inputSchema: schema as ToolDescriptor['inputSchema'],
    readOnlyHint: tool.annotations?.readOnlyHint === true,
    consequentialHint: declared !== false,
  }
}

export async function invoke(toolId: string, input: Record<string, Json>): Promise<ToolOutcome> {
  const context = modelContext()
  if (!context?.executeTool) {
    return error('TOOL_UNAVAILABLE', 'Native WebMCP is not available on this page', 'not_started')
  }

  const name = decodeNativeToolId(toolId) ?? toolId
  const tool = cache.find((t) => t.name === name)
  if (!tool) {
    return error('TOOL_UNAVAILABLE', `No native tool "${name}" is registered`, 'not_started')
  }

  try {
    // Chrome's executeTool takes arguments as a JSON string, symmetric with
    // returning inputSchema as one. Passing an object fails inside the site's
    // own handler with "Failed to parse input arguments", which looks like a
    // site bug rather than a calling-convention mismatch.
    let raw: unknown
    try {
      raw = await context.executeTool(tool, JSON.stringify(input))
    } catch (stringFormFailed) {
      // Fall back to the object form for builds that expect it.
      raw = await context.executeTool(tool, input)
    }
    return { status: 'completed', result: normalizeResult(raw) }
  } catch (e) {
    // The site's handler ran and threw. It may well have had effects, so this
    // is a failure of the call, not proof that nothing happened.
    return error('INTERNAL_ERROR', `The page's handler failed: ${String((e as Error)?.message ?? e)}`, 'failed')
  }
}

/**
 * Results may arrive as a value, as a JSON string, or as MCP-style content
 * blocks. Unwrap a single text block so the agent gets structured data rather
 * than a transport envelope, but never discard anything we cannot interpret.
 */
function normalizeResult(raw: unknown): Json {
  if (raw === undefined || raw === null) return null

  // Chrome returns a JSON string, and what it encodes is usually an MCP-style
  // envelope. Parse first, then unwrap — doing it the other way round leaves
  // the agent reading transport structure instead of the site's answer.
  let value: unknown = raw
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return value as Json }
  }

  const blocks = (value as { content?: Array<{ type?: string; text?: string }> })?.content
  if (Array.isArray(blocks) && blocks.length === 1 && typeof blocks[0]?.text === 'string') {
    const text = blocks[0].text
    try { return JSON.parse(text) as Json } catch { return text }
  }

  return value as Json
}

function error(
  code: 'TOOL_UNAVAILABLE' | 'INTERNAL_ERROR',
  message: string,
  execution: 'not_started' | 'failed',
): ToolOutcome {
  return { status: 'error', error: { code, message, execution } }
}

/** Native registrations can change without navigation (§7). */
export function onToolsChanged(listener: () => void): () => void {
  const context = modelContext()
  if (!context) return () => {}

  const target = ('ontoolchange' in (context as object) ? context : window) as unknown as {
    addEventListener?: (t: string, l: () => void) => void
    removeEventListener?: (t: string, l: () => void) => void
  }
  if (typeof target.addEventListener !== 'function') return () => {}

  for (const type of ['toolchange', 'toolschange']) {
    target.addEventListener(type, listener)
  }
  return () => {
    for (const type of ['toolchange', 'toolschange']) {
      target.removeEventListener?.(type, listener)
    }
  }
}
