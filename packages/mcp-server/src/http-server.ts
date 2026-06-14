import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpServer } from './mcp-tools.js'

export function createHttpHandler() {
  const sseTransports = new Map<string, SSEServerTransport>()
  const streamableTransports = new Map<string, StreamableHTTPServerTransport>()

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost')

    // Legacy SSE transport
    if (req.method === 'GET' && url.pathname === '/sse') {
      const transport = new SSEServerTransport('/message', res)
      sseTransports.set(transport.sessionId, transport)
      transport.onclose = () => sseTransports.delete(transport.sessionId)
      const server = createMcpServer()
      await server.connect(transport)
      return
    }

    if (req.method === 'POST' && url.pathname === '/message') {
      const sessionId = url.searchParams.get('sessionId') ?? ''
      const transport = sseTransports.get(sessionId)
      if (!transport) { res.writeHead(404).end('Session not found'); return }
      await transport.handlePostMessage(req, res)
      return
    }

    // Streamable HTTP transport
    if (url.pathname === '/mcp') {
      const sessionId = req.headers['mcp-session-id'] as string | undefined

      if (req.method === 'POST') {
        if (!sessionId) {
          const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() })
          const server = createMcpServer()
          await server.connect(transport)
          await transport.handleRequest(req, res)
          if (transport.sessionId) {
            transport.onclose = () => streamableTransports.delete(transport.sessionId!)
            streamableTransports.set(transport.sessionId, transport)
          }
          return
        }

        const transport = streamableTransports.get(sessionId)
        if (!transport) { res.writeHead(404).end('Session not found'); return }
        await transport.handleRequest(req, res)
        return
      }

      if (req.method === 'GET') {
        const transport = sessionId ? streamableTransports.get(sessionId) : undefined
        if (!transport) { res.writeHead(404).end('Session not found'); return }
        await transport.handleRequest(req, res)
        return
      }

      if (req.method === 'DELETE') {
        const transport = sessionId ? streamableTransports.get(sessionId) : undefined
        if (transport) {
          await transport.close()
          streamableTransports.delete(sessionId!)
        }
        res.writeHead(204).end()
        return
      }
    }

    res.writeHead(404).end()
  }
}
