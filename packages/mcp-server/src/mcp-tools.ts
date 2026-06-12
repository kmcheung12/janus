import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { getById, getByDomain, getLatest, listAll } from './journey-store.js'
import type { Journey } from './types.js'

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

export function createMcpServer(): Server {
  const server = new Server(
    { name: 'janus', version: '0.0.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params
    const a = args as Record<string, string>

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
      const events: Array<Record<string, unknown>> = []
      for (const id of ids) {
        const j = getById(id)
        if (!j) { missing.push(id); continue }
        for (const e of j.events) {
          events.push({ ...e, journeyId: id })
        }
      }
      events.sort((a, b) => (a.timestamp as number) - (b.timestamp as number))
      return { content: [{ type: 'text', text: JSON.stringify({ missing, events }, null, 2) }] }
    }
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] }
  })

  return server
}
