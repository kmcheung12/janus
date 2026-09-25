/**
 * Browser discovery, diagnostics and typed tool publication (§8).
 *
 * Two layers sit here:
 *
 *  - `list_pages` / `list_page_tools` / `call_page_tool` — management and the
 *    M1 spike path. Not the primary released interface, and deliberately not
 *    more capable than the typed one: identical authorization, revision checks
 *    and queue.
 *  - typed page tools (M1.5) — each enabled action published as its own MCP
 *    tool with its real business schema, so the agent supplies arguments
 *    directly instead of fetching a schema as text and wrapping it.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import type {
  Id, Json, JsonSchema, PageId, ToolDescriptor, ToolOutcome,
} from '../contracts/types.js'
import { LIMITS, jsonBytes, jsonDepth } from '../contracts/limits.js'
import { buildToolName, identityDigest, namespaceFor, toSlug } from '../contracts/naming.js'
import type { ClientRecord } from '../credentials.js'
import * as registry from './registry.js'
import * as queue from './queue.js'

export interface PublishedTool {
  mcpName: string
  pageId: PageId
  documentId: Id
  toolId: Id
  toolRevision: number
  descriptor: ToolDescriptor
}

interface NameRecord {
  mcpName: string
  frozenSlug: string
  digest: string
}

/** Frozen slugs and digests survive revision changes, so names stay stable. */
const nameRecords = new Map<string, NameRecord>()
/** mcpName -> identity digest, for collision detection. */
const nameOwners = new Map<string, string>()

function identityKey(pageId: PageId, toolId: Id): string {
  return `${pageId}::${toolId}`
}

export class NameCollisionError extends Error {
  constructor(public readonly mcpName: string) {
    super(`Tool name ${mcpName} already maps to a different identity`)
  }
}

/**
 * Resolve the published name for a tool, freezing its slug on first sight.
 * A later title change reuses the stored name rather than renaming the tool.
 */
export function publishedNameFor(
  browserSessionId: Id,
  pageId: PageId,
  descriptor: ToolDescriptor,
): string {
  const key = identityKey(pageId, descriptor.toolId)
  const existing = nameRecords.get(key)
  if (existing) return existing.mcpName

  const digest = identityDigest({
    browserSessionId,
    pageId,
    sourceKind: descriptor.source.kind,
    toolId: descriptor.toolId,
  })
  const frozenSlug = toSlug(descriptor.name)
  const mcpName = buildToolName(namespaceFor(pageId), frozenSlug, digest)

  const owner = nameOwners.get(mcpName)
  if (owner && owner !== digest) throw new NameCollisionError(mcpName)

  nameOwners.set(mcpName, digest)
  nameRecords.set(key, { mcpName, frozenSlug, digest })
  return mcpName
}

export function forgetPageNames(pageId: PageId): void {
  for (const [key, record] of nameRecords) {
    if (key.startsWith(`${pageId}::`)) {
      nameRecords.delete(key)
      nameOwners.delete(record.mcpName)
    }
  }
}

/** Every tool this principal may see, as published MCP tools. */
export function publishedToolsFor(principal: ClientRecord): PublishedTool[] {
  const published: PublishedTool[] = []
  for (const page of registry.pagesForPairings(principal.pairingIds)) {
    for (const descriptor of page.tools.values()) {
      let mcpName: string
      try {
        mcpName = publishedNameFor(page.descriptor.browserSessionId, page.descriptor.pageId, descriptor)
      } catch {
        // A colliding name is withheld rather than overwritten or suffixed.
        continue
      }
      published.push({
        mcpName,
        pageId: page.descriptor.pageId,
        documentId: page.descriptor.documentId,
        toolId: descriptor.toolId,
        toolRevision: descriptor.toolRevision,
        descriptor,
      })
    }
  }
  return published
}

/**
 * Wrap a business schema so the caller must state the revision it built its
 * arguments against. The enum pins it to exactly the live revision, so a
 * client working from a stale tool list is rejected by schema validation
 * before anything reaches the page.
 */
export function publishedInputSchema(descriptor: ToolDescriptor): JsonSchema {
  return {
    type: 'object',
    properties: {
      revision: {
        type: 'integer',
        enum: [descriptor.toolRevision],
        description: 'The tool revision these arguments were built for. Re-read the tool list if rejected.',
      },
      input: descriptor.inputSchema as Json,
    },
    required: ['revision', 'input'],
    additionalProperties: false,
  } as JsonSchema
}

export function toMcpTool(published: PublishedTool, pageLabel: string): Tool {
  const { descriptor } = published
  const source = descriptor.source.kind === 'native' ? 'native' : 'Janus-generated'
  return {
    name: published.mcpName,
    description:
      `${descriptor.description}\n\n` +
      `Page: ${pageLabel} (${source}). Revision ${descriptor.toolRevision}.`,
    inputSchema: publishedInputSchema(descriptor) as Tool['inputSchema'],
    annotations: {
      title: `${descriptor.name} — ${pageLabel}`,
      readOnlyHint: descriptor.readOnlyHint,
      destructiveHint: descriptor.consequentialHint,
    },
  }
}

/** Management tools; §8 keeps these available alongside the typed ones. */
export const browserTools: Tool[] = [
  {
    name: 'list_pages',
    description:
      'List browser pages you have enabled for tool execution, with their labels, origins and native WebMCP capability.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_page_tools',
    description:
      'List the tools a specific enabled page currently exposes, with their input schemas and current revisions.',
    inputSchema: {
      type: 'object',
      properties: { pageId: { type: 'string', description: 'Page ID from list_pages' } },
      required: ['pageId'],
    },
  },
  {
    name: 'call_page_tool',
    description:
      'Invoke one tool on an enabled page. Diagnostic path: prefer the published web__ tool, which carries the real input schema.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        toolId: { type: 'string' },
        revision: { type: 'integer', description: 'Revision from list_page_tools; a stale value is rejected' },
        input: { type: 'object', description: 'Business arguments only' },
      },
      required: ['pageId', 'toolId', 'revision', 'input'],
    },
  },
]

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

function errorText(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

export function listPages(principal: ClientRecord) {
  const pages = registry.pagesForPairings(principal.pairingIds).map((p) => ({
    pageId: p.descriptor.pageId,
    label: p.descriptor.label,
    title: p.descriptor.title,
    url: p.descriptor.url,
    origin: p.descriptor.origin,
    browserSessionId: p.descriptor.browserSessionId,
    nativeCapability: p.descriptor.nativeCapability,
    execution: p.descriptor.execution,
    toolCount: p.tools.size,
  }))
  return text(pages.length ? pages : { pages: [], hint: 'Enable a page in the Janus extension popup.' })
}

export function listBrowserTools(principal: ClientRecord, pageId: string) {
  const page = registry.getPage(pageId)
  if (!page || !principal.pairingIds.includes(page.pairingId)) return errorText(`No enabled page "${pageId}"`)
  return text({
    pageId,
    label: page.descriptor.label,
    documentId: page.descriptor.documentId,
    nativeCapability: page.descriptor.nativeCapability,
    tools: [...page.tools.values()].map((t) => ({
      toolId: t.toolId,
      revision: t.toolRevision,
      name: t.name,
      description: t.description,
      source: t.source.kind,
      inputSchema: t.inputSchema,
      readOnlyHint: t.readOnlyHint,
      consequentialHint: t.consequentialHint,
    })),
  })
}

export interface InvokeArgs {
  pageId: string
  toolId: string
  revision: number
  input: Record<string, Json>
}

export async function callBrowserTool(principal: ClientRecord, args: InvokeArgs) {
  const page = registry.getPage(args.pageId)
  if (!page || !principal.pairingIds.includes(page.pairingId)) {
    return errorText(`UNAUTHORIZED: no enabled page "${args.pageId}" for this client`)
  }

  const descriptor = page.tools.get(args.toolId)
  if (!descriptor) return errorText(`TOOL_UNAVAILABLE: no tool "${args.toolId}" on this page`)
  if (descriptor.toolRevision !== args.revision) {
    return errorText(
      `STALE_REVISION: tool is at revision ${descriptor.toolRevision}, you sent ${args.revision}. ` +
      `Re-read the tool list and rebuild your arguments.`,
    )
  }

  if (jsonBytes(args.input) > LIMITS.toolInputMaxBytes) {
    return errorText(`INVALID_INPUT: arguments exceed ${LIMITS.toolInputMaxBytes} bytes`)
  }
  if (jsonDepth(args.input) > LIMITS.toolInputMaxDepth) {
    return errorText(`INVALID_INPUT: arguments nested deeper than ${LIMITS.toolInputMaxDepth} levels`)
  }

  const outcome = await queue.enqueue({
    pageId: args.pageId,
    documentId: page.descriptor.documentId,
    toolId: args.toolId,
    toolRevision: args.revision,
    arguments: args.input,
    clientId: principal.clientId,
  })

  return formatOutcome(outcome)
}

export function formatOutcome(outcome: ToolOutcome) {
  if (outcome.status === 'completed') {
    if (jsonBytes(outcome.result) > LIMITS.toolResultMaxBytes) {
      // §18: no implicit truncation. A silently shortened result is worse than
      // an explicit failure, because the caller cannot tell it is incomplete.
      return errorText(`RESULT_LIMIT: result exceeds ${LIMITS.toolResultMaxBytes} bytes and was not truncated`)
    }
    // A site is free to answer in prose. JSON-encoding a string result would
    // hand the agent escaped newlines and quotes to undo for no reason.
    if (typeof outcome.result === 'string') {
      return { content: [{ type: 'text' as const, text: outcome.result }] }
    }
    return text(outcome.result)
  }
  const { code, message, execution } = outcome.error
  return errorText(`${code} (${execution}): ${message}`)
}
