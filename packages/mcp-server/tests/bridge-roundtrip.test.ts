import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'
import type { WebSocketServer } from 'ws'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startWsServer, wireQueue } from '../src/ws-server.js'
import { createHttpHandler } from '../src/http-server.js'
import { generateToken, openCredentialStore, type CredentialStore } from '../src/credentials.js'
import * as registry from '../src/control/registry.js'
import * as connections from '../src/control/connections.js'
import * as queue from '../src/control/queue.js'
import * as sessions from '../src/control/sessions.js'
import type { ControlMessage, PageDescriptor, ToolDescriptor } from '../src/contracts/types.js'

/**
 * Full daemon round trip: an MCP client discovers a page tool and invokes it,
 * the frame reaches a simulated executor, and the result comes back to the
 * originating call. Uses the real HTTP handler, real WebSocket server and real
 * queue — only the browser is simulated.
 */

let wss: WebSocketServer
let http: Server
let dataDir: string
let credentials: CredentialStore
let wsUrl: string
let baseUrl: string
let clientToken: string
let secondToken: string
const executorToken = generateToken()

const PAIRING = 'pair_1'
const PAGE_ID = '00112233445566778899aabbccddeeff'

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'janus-rt-'))
  credentials = openCredentialStore(dataDir)
  credentials.upsertExecutor(PAIRING, executorToken, 'browser')
  clientToken = credentials.createClient([PAIRING], 'agent one', false).token
  secondToken = credentials.createClient([PAIRING], 'agent two', false).token

  wireQueue()
  wss = startWsServer({ port: 0, host: '127.0.0.1', credentials })
  await new Promise<void>((r) => wss.once('listening', r))
  wsUrl = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`

  http = createServer(createHttpHandler({ credentials }))
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
})

afterEach(async () => {
  connections.clear(); registry.clear(); queue.clear(); sessions.clear()
  await new Promise<void>((r) => wss.close(() => r()))
  await new Promise<void>((r) => http.close(() => r()))
  rmSync(dataDir, { recursive: true, force: true })
})

const tool: ToolDescriptor = {
  toolId: 'n_U2VhcmNoIHByb2R1Y3Rz', toolRevision: 3,
  source: { kind: 'native', nativeName: 'search' },
  name: 'Search products', description: 'Search the catalogue',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  readOnlyHint: true, consequentialHint: false,
}

const page: PageDescriptor = {
  pageId: PAGE_ID, browserSessionId: 'browser_1', tabId: 1, frameId: 0,
  documentId: 'doc_1', label: 'Basketful', title: 'Shop',
  url: 'https://shop.example/', origin: 'https://shop.example',
  nativeCapability: 'available', execution: { state: 'idle' },
}

/** A simulated extension that answers execute_tool frames. */
async function connectExecutor(respond: (message: ControlMessage) => unknown | undefined) {
  const socket = new WebSocket(wsUrl)
  await new Promise<void>((r) => socket.once('open', () => r()))
  let connectionId = ''
  let sequence = 0

  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString()) as ControlMessage
    if (message.type === 'hello_ack') {
      connectionId = message.connectionId
      socket.send(JSON.stringify({
        protocolVersion: 1, connectionId, type: 'pages_sync', sequence: ++sequence, pages: [page],
      }))
      socket.send(JSON.stringify({
        protocolVersion: 1, connectionId, type: 'tools_changed', sequence: ++sequence,
        pageId: PAGE_ID, documentId: 'doc_1', tools: [tool],
      }))
      return
    }
    const reply = respond(message)
    if (reply) socket.send(JSON.stringify(reply))
  })

  socket.send(JSON.stringify({
    protocolVersion: 1, type: 'hello', role: 'executor',
    pairingId: PAIRING, token: executorToken, browserSessionId: 'browser_1',
  }))

  await vi.waitFor(() => expect(registry.getTool(PAGE_ID, 'n_U2VhcmNoIHByb2R1Y3Rz')).toBeDefined())
  return { socket, get connectionId() { return connectionId } }
}

import { vi } from 'vitest'

async function mcp(body: object, sessionId?: string, token = clientToken) {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  const payload = text.includes('data: ')
    ? JSON.parse(text.match(/^data: (.+)$/m)![1])
    : JSON.parse(text || '{}')
  return { res, body: payload as { result?: Record<string, unknown> } }
}

async function session(token = clientToken) {
  const { res } = await mcp({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } },
  }, undefined, token)
  return res.headers.get('mcp-session-id')!
}

describe('discovery', () => {
  it('publishes the page tool with its own business schema', async () => {
    const executor = await connectExecutor(() => undefined)
    const sid = await session()

    const { body } = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, sid)
    const tools = (body.result as { tools: Array<{ name: string; inputSchema: Record<string, unknown> }> }).tools
    const published = tools.find((t) => t.name.startsWith('web__'))

    expect(published).toBeDefined()
    // The business schema is nested under `input`, not flattened or opaque.
    const properties = published!.inputSchema.properties as Record<string, { enum?: number[]; properties?: unknown }>
    expect(properties.revision.enum).toEqual([3])
    expect(properties.input.properties).toEqual({ query: { type: 'string' } })

    executor.socket.close()
  })

  it('does not publish another pairing\'s pages', async () => {
    credentials.upsertExecutor('pair_2', generateToken(), 'other browser')
    const outsiderToken = credentials.createClient(['pair_2'], 'outsider', false).token
    const executor = await connectExecutor(() => undefined)

    const sid = await session(outsiderToken)
    const { body } = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, sid, outsiderToken)
    const tools = (body.result as { tools: Array<{ name: string }> }).tools
    expect(tools.find((t) => t.name.startsWith('web__'))).toBeUndefined()

    executor.socket.close()
  })
})

describe('invocation round trip', () => {
  it('delivers a result to the originating call', async () => {
    const executor = await connectExecutor((message) => {
      if (message.type !== 'execute_tool') return undefined
      return {
        protocolVersion: 1, connectionId: executor.connectionId, type: 'tool_result',
        requestId: message.requestId, pageId: message.pageId, documentId: message.documentId,
        toolId: message.toolId, toolRevision: message.toolRevision,
        outcome: { status: 'completed', result: { items: ['headphones'], query: message.arguments.query } },
        executionStopped: true,
      }
    })

    const sid = await session()
    const { body: listed } = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, sid)
    const name = (listed.result as { tools: Array<{ name: string }> }).tools
      .find((t) => t.name.startsWith('web__'))!.name

    const { body } = await mcp({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name, arguments: { revision: 3, input: { query: 'headphones' } } },
    }, sid)

    const content = (body.result as { content: Array<{ text: string }> }).content
    expect(JSON.parse(content[0].text)).toEqual({ items: ['headphones'], query: 'headphones' })

    executor.socket.close()
  })

  it('rejects a stale revision without dispatching', async () => {
    let dispatches = 0
    const executor = await connectExecutor((message) => {
      if (message.type === 'execute_tool') dispatches++
      return undefined
    })

    const sid = await session()
    const { body } = await mcp({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'call_page_tool', arguments: { pageId: PAGE_ID, toolId: 'n_U2VhcmNoIHByb2R1Y3Rz', revision: 1, input: {} } },
    }, sid)

    const result = body.result as { content: Array<{ text: string }>; isError?: boolean }
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('STALE_REVISION')
    expect(dispatches).toBe(0)

    executor.socket.close()
  })

  it('routes concurrent calls from two sessions to the right caller', async () => {
    const pendingByRequest = new Map<string, string>()
    const executor = await connectExecutor((message) => {
      if (message.type !== 'execute_tool') return undefined
      pendingByRequest.set(message.requestId, String(message.arguments.query))
      return {
        protocolVersion: 1, connectionId: executor.connectionId, type: 'tool_result',
        requestId: message.requestId, pageId: message.pageId, documentId: message.documentId,
        toolId: message.toolId, toolRevision: message.toolRevision,
        outcome: { status: 'completed', result: { echo: message.arguments.query } },
        executionStopped: true,
      }
    })

    const [sidA, sidB] = [await session(clientToken), await session(secondToken)]
    const call = (sid: string, token: string, query: string) => mcp({
      jsonrpc: '2.0', id: 9, method: 'tools/call',
      params: { name: 'call_page_tool', arguments: { pageId: PAGE_ID, toolId: 'n_U2VhcmNoIHByb2R1Y3Rz', revision: 3, input: { query } } },
    }, sid, token)

    const [a, b] = await Promise.all([call(sidA, clientToken, 'alpha'), call(sidB, secondToken, 'beta')])

    const textOf = (r: typeof a) => (r.body.result as { content: Array<{ text: string }> }).content[0].text
    expect(JSON.parse(textOf(a))).toEqual({ echo: 'alpha' })
    expect(JSON.parse(textOf(b))).toEqual({ echo: 'beta' })
    // Serialized, not overlapped.
    expect(pendingByRequest.size).toBe(2)

    executor.socket.close()
  })

  it('fails explicitly when no executor is connected', async () => {
    registry.syncPages('ghost', PAIRING, [page])
    registry.syncTools('ghost', PAGE_ID, 'doc_1', [tool])

    const sid = await session()
    const { body } = await mcp({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'call_page_tool', arguments: { pageId: PAGE_ID, toolId: 'n_U2VhcmNoIHByb2R1Y3Rz', revision: 3, input: {} } },
    }, sid)

    const result = body.result as { content: Array<{ text: string }>; isError?: boolean }
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('DISCONNECTED')
  })
})

describe('session cleanup', () => {
  it('drops the session record when the client disconnects', async () => {
    const sid = await session()
    expect(sessions.getSession(sid)).toBeDefined()

    await fetch(`${baseUrl}/mcp`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${clientToken}`, 'mcp-session-id': sid },
    })
    expect(sessions.getSession(sid)).toBeUndefined()
  })
})
