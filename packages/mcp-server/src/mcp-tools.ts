import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { getById, getByDomain, getLatest, listAll } from './journey-store.js'
import type { Journey, CapturedEvent } from './types.js'
import type { ClientRecord } from './credentials.js'
import { getPage } from './control/registry.js'
import {
  browserTools, callBrowserTool, listBrowserTools, listPages,
  publishedToolsFor, toMcpTool, type InvokeArgs,
} from './control/browser-tools.js'
import {
  authoringTools, getDraft, listDrafts, submitDefinition, type SubmitDeps,
} from './control/drafts.js'

function summarise(j: Journey) {
  return {
    id: j.id,
    startTime: new Date(j.meta.startTime).toISOString(),
    startUrl: j.meta.startUrl,
    tabTitle: j.meta.tabTitle,
    domain: j.meta.domain,
    status: j.meta.status,
    eventCount: j.events.length,
    fileCount: j.files.length,
  }
}

const TOOLS: Tool[] = [
  {
    name: 'list_journeys',
    description: 'List all recorded user journeys (metadata only, no events)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_journey_by_id',
    description: 'Get a full journey (events + attached files) by its short ID. The ID is shown in the Janus sidebar.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Journey ID shown in the extension sidebar (e.g. "abc123")' } },
      required: ['id'],
    },
  },
  {
    name: 'get_journeys_by_domain',
    description: 'Get all journeys for a domain. Partial match — "google" matches google.com and mail.google.com.',
    inputSchema: {
      type: 'object',
      properties: { domain: { type: 'string', description: 'Partial domain string to search for' } },
      required: ['domain'],
    },
  },
  {
    name: 'latest_journey',
    description: 'Get the most recently started journey with full events and files',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'merge_journeys',
    description: 'Merge events from multiple journeys sorted by timestamp. Use to correlate browser interactions with CLI output.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Journey IDs to merge'
        }
      },
      required: ['ids'],
    },
  },
]

/**
 * How a compiled definition reaches the owning extension for storage. Wired by
 * the transport layer; defaults to refusing, so a misconfigured daemon reports
 * a storage failure rather than claiming a definition was saved.
 */
let submitDeps: SubmitDeps = { store: async () => false }

export function setSubmitDeps(deps: SubmitDeps): void {
  submitDeps = deps
}

export function createMcpServer(principal: ClientRecord): Server {
  const server = new Server(
    { name: 'janus', version: '0.0.0' },
    // §8: listChanged is advertised because enabled pages publish and withdraw
    // tools as the user navigates.
    { capabilities: { tools: { listChanged: true } } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const published = publishedToolsFor(principal).map((p) => {
      const page = getPage(p.pageId)
      return toMcpTool(p, page?.descriptor.label ?? 'browser page')
    })
    // Authoring tools are only offered to a client that actually has the
    // scope, so a read-only agent is not shown work it cannot do.
    const authoring = principal.authoring ? authoringTools : []
    return { tools: [...TOOLS, ...browserTools, ...authoring, ...published] }
  })

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params
    const a = args as Record<string, string>

    if (name === 'list_tool_drafts') return listDrafts(principal)
    if (name === 'get_tool_draft') return getDraft(principal, a.draftId)
    if (name === 'submit_tool_definition') {
      const raw = args as unknown as Parameters<typeof submitDefinition>[1]
      return submitDefinition(principal, raw, submitDeps)
    }

    if (name === 'list_pages') return listPages(principal)
    if (name === 'list_page_tools') return listBrowserTools(principal, a.pageId)
    if (name === 'call_page_tool') {
      const raw = args as unknown as InvokeArgs
      return callBrowserTool(principal, {
        pageId: raw.pageId,
        toolId: raw.toolId,
        revision: raw.revision,
        input: raw.input ?? {},
      })
    }

    // Typed page tools carry their real business schema; the revision is a
    // required argument so a stale caller fails before anything is dispatched.
    const typed = publishedToolsFor(principal).find((p) => p.mcpName === name)
    if (typed) {
      const call = args as unknown as { revision?: number; input?: Record<string, never> }
      return callBrowserTool(principal, {
        pageId: typed.pageId,
        toolId: typed.toolId,
        revision: call.revision ?? -1,
        input: call.input ?? {},
      })
    }

    if (name === 'list_journeys') {
      return { content: [{ type: 'text', text: JSON.stringify(listAll().map(summarise), null, 2) }] }
    }
    if (name === 'get_journey_by_id') {
      const j = getById(a.id)
      if (!j) return { content: [{ type: 'text', text: `No journey found with id "${a.id}"` }] }
      return { content: [{ type: 'text', text: JSON.stringify(j, null, 2) }] }
    }
    if (name === 'get_journeys_by_domain') {
      return { content: [{ type: 'text', text: JSON.stringify(getByDomain(a.domain), null, 2) }] }
    }
    if (name === 'latest_journey') {
      const j = getLatest()
      if (!j) return { content: [{ type: 'text', text: 'No journeys recorded yet' }] }
      return { content: [{ type: 'text', text: JSON.stringify(j, null, 2) }] }
    }
    if (name === 'merge_journeys') {
      const ids = (args as { ids: string[] }).ids ?? []
      const missing: string[] = []
      const events: Array<CapturedEvent & { journeyId: string }> = []
      for (const id of ids) {
        const j = getById(id)
        if (!j) { missing.push(id); continue }
        for (const e of j.events) {
          events.push({ ...e, journeyId: id })
        }
      }
      events.sort((a, b) => a.timestamp - b.timestamp)
      return { content: [{ type: 'text', text: JSON.stringify({ missing, events }, null, 2) }] }
    }
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] }
  })

  return server
}
