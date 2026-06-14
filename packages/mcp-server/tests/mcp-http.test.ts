import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { createHttpHandler } from '../src/http-server.js'

let server: Server
let baseUrl: string

beforeAll(async () => {
  server = createServer(createHttpHandler())
  await new Promise<void>(resolve => server.listen(0, resolve))
  const addr = server.address() as { port: number }
  baseUrl = `http://localhost:${addr.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close(err => (err ? reject(err) : resolve()))
  )
})

async function mcpPost(body: object, sessionId?: string) {
  return fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(body),
  })
}

async function parseBody(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('text/event-stream')) {
    const match = text.match(/^data: (.+)$/m)
    if (!match) throw new Error(`No data line in SSE response:\n${text}`)
    return JSON.parse(match[1]) as Record<string, unknown>
  }
  return JSON.parse(text) as Record<string, unknown>
}

const INIT_REQUEST = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'test', version: '0.0.0' },
  },
}

describe('Streamable HTTP transport (/mcp)', () => {
  it('initialize returns 200 with mcp-session-id header', async () => {
    const res = await mcpPost(INIT_REQUEST)
    expect(res.status).toBe(200)
    expect(res.headers.get('mcp-session-id')).toBeTruthy()
  })

  it('tools/list returns all five janus tools', async () => {
    const initRes = await mcpPost(INIT_REQUEST)
    const sessionId = initRes.headers.get('mcp-session-id')!

    const res = await mcpPost(
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      sessionId,
    )
    expect(res.status).toBe(200)
    const body = await parseBody(res)
    const result = body.result as { tools: Array<{ name: string }> }
    const names = result.tools.map(t => t.name)
    expect(names).toContain('list_journeys')
    expect(names).toContain('latest_journey')
    expect(names).toContain('get_journey_by_id')
    expect(names).toContain('get_journeys_by_domain')
    expect(names).toContain('merge_journeys')
  })

  it('tools/call list_journeys returns empty array when no journeys recorded', async () => {
    const initRes = await mcpPost(INIT_REQUEST)
    const sessionId = initRes.headers.get('mcp-session-id')!

    const res = await mcpPost(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'list_journeys', arguments: {} },
      },
      sessionId,
    )
    expect(res.status).toBe(200)
    const body = await parseBody(res)
    const result = body.result as { content: Array<{ text: string }> }
    expect(JSON.parse(result.content[0].text)).toEqual([])
  })

  it('request without session ID (non-initialize) returns 400', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    expect(res.status).toBe(400)
  })

  it('request with unknown session ID returns 404', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      'nonexistent-session-id',
    )
    expect(res.status).toBe(404)
  })
})
