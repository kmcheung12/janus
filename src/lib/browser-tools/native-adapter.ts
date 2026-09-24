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
  description?: string
  inputSchema?: unknown
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
  /** Present on some builds; used only for descendant-frame filtering. */
  origin?: string
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
  if (tool.origin === undefined) return true
  return tool.origin === window.location.origin
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

  const owned = (tools ?? []).filter(ownedByThisDocument)
  cache = owned

  if (owned.length > LIMITS.nativeToolsPerPage) {
    // §18: overflow marks the catalog unsupported rather than silently
    // publishing an arbitrary subset the agent would believe is complete.
    return []
  }

  return owned.map(toDescriptor).filter((d): d is ToolDescriptor => d !== undefined)
}

function toDescriptor(tool: NativeTool, index: number): ToolDescriptor | undefined {
  const schema = tool.inputSchema
  if (!schema || typeof schema !== 'object') return undefined
  if (jsonBytes(schema) > LIMITS.nativeBusinessSchemaMaxBytes) return undefined

  return {
    // A native tool's name is its logical identity within this document.
    toolId: `native:${tool.name}`,
    toolRevision: 1,
    source: { kind: 'native', nativeName: tool.name },
    name: tool.name,
    description: tool.description ?? tool.name,
    inputSchema: schema as ToolDescriptor['inputSchema'],
    readOnlyHint: tool.annotations?.readOnlyHint === true,
    // Unknown effects default to consequential (§17).
    consequentialHint: tool.annotations?.destructiveHint !== false,
  }
}

export async function invoke(toolId: string, input: Record<string, Json>): Promise<ToolOutcome> {
  const context = modelContext()
  if (!context?.executeTool) {
    return error('TOOL_UNAVAILABLE', 'Native WebMCP is not available on this page', 'not_started')
  }

  const name = toolId.startsWith('native:') ? toolId.slice('native:'.length) : toolId
  const tool = cache.find((t) => t.name === name)
  if (!tool) {
    return error('TOOL_UNAVAILABLE', `No native tool "${name}" is registered`, 'not_started')
  }

  try {
    const result = await context.executeTool(tool, input)
    return { status: 'completed', result: (result ?? null) as Json }
  } catch (e) {
    // The site's handler ran and threw. It may well have had effects, so this
    // is a failure of the call, not proof that nothing happened.
    return error('INTERNAL_ERROR', `The page's handler failed: ${String((e as Error)?.message ?? e)}`, 'failed')
  }
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
