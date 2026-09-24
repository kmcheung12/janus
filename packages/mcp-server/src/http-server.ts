import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpServer } from './mcp-tools.js'
import type { ClientRecord, CredentialStore } from './credentials.js'
import { getSession, registerSession, unregisterSession } from './control/sessions.js'

export interface HttpHandlerOptions {
  credentials: CredentialStore
}

/**
 * §12: every MCP request carries `Authorization: Bearer <token>`, including
 * the legacy SSE/message routes. An MCP session ID is a correlation handle —
 * it travels in URLs and logs — so it never stands in for authentication.
 * Browser executor tokens cannot authorize MCP calls.
 */
function authenticate(req: IncomingMessage, credentials: CredentialStore): ClientRecord | undefined {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return undefined
  return credentials.verifyClient(header.slice('Bearer '.length).trim())
}

export function createHttpHandler(options: HttpHandlerOptions) {
  const { credentials } = options
  const sseTransports = new Map<string, SSEServerTransport>()
  const streamableTransports = new Map<string, StreamableHTTPServerTransport>()

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost')

    const principal = authenticate(req, credentials)
    if (!principal) {
      res.writeHead(401, { 'www-authenticate': 'Bearer', 'content-type': 'text/plain' })
      res.end('Unauthorized')
      return
    }

    // Legacy SSE transport
    if (req.method === 'GET' && url.pathname === '/sse') {
      const transport = new SSEServerTransport('/message', res)
      sseTransports.set(transport.sessionId, transport)
      const server = createMcpServer(principal)
      registerSession(transport.sessionId, server, principal)
      transport.onclose = () => {
        sseTransports.delete(transport.sessionId)
        unregisterSession(transport.sessionId)
      }
      await server.connect(transport)
      return
    }

    if (req.method === 'POST' && url.pathname === '/message') {
      const sessionId = url.searchParams.get('sessionId') ?? ''
      const transport = sseTransports.get(sessionId)
      if (!transport) { res.writeHead(404).end('Session not found'); return }
      // The session must belong to the authenticated caller; a session ID
      // observed elsewhere must not let another principal post into it.
      if (!ownsSession(sessionId, principal)) { res.writeHead(403).end('Forbidden'); return }
      await transport.handlePostMessage(req, res)
      return
    }

    // Streamable HTTP transport
    if (url.pathname === '/mcp') {
      const sessionId = req.headers['mcp-session-id'] as string | undefined

      if (req.method === 'POST') {
        if (!sessionId) {
          const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() })
          const server = createMcpServer(principal)
          await server.connect(transport)
          await transport.handleRequest(req, res)
          if (transport.sessionId) {
            registerSession(transport.sessionId, server, principal)
            transport.onclose = () => {
              streamableTransports.delete(transport.sessionId!)
              unregisterSession(transport.sessionId!)
            }
            streamableTransports.set(transport.sessionId, transport)
          }
          return
        }

        const transport = streamableTransports.get(sessionId)
        if (!transport) { res.writeHead(404).end('Session not found'); return }
        if (!ownsSession(sessionId, principal)) { res.writeHead(403).end('Forbidden'); return }
        await transport.handleRequest(req, res)
        return
      }

      if (req.method === 'GET') {
        const transport = sessionId ? streamableTransports.get(sessionId) : undefined
        if (!transport) { res.writeHead(404).end('Session not found'); return }
        if (!ownsSession(sessionId!, principal)) { res.writeHead(403).end('Forbidden'); return }
        await transport.handleRequest(req, res)
        return
      }

      if (req.method === 'DELETE') {
        const transport = sessionId ? streamableTransports.get(sessionId) : undefined
        if (transport && ownsSession(sessionId!, principal)) {
          await transport.close()
          streamableTransports.delete(sessionId!)
          unregisterSession(sessionId!)
        }
        res.writeHead(204).end()
        return
      }
    }

    res.writeHead(404).end()
  }
}

/**
 * A transport that predates session registration (the very first POST of a
 * Streamable session) has no record yet and is allowed through; once
 * registered, only its owning principal may drive it.
 */
function ownsSession(sessionId: string, principal: ClientRecord): boolean {
  const owner = getSession(sessionId)?.principal.clientId
  return owner === undefined || owner === principal.clientId
}
