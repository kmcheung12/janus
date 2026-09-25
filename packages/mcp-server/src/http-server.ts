import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpServer } from './mcp-tools.js'
import { generateId, generateToken, type ClientRecord, type CredentialStore } from './credentials.js'
import { getSession, registerSession, unregisterSession } from './control/sessions.js'

export interface HttpHandlerOptions {
  credentials: CredentialStore
  /** Refuse first-run self-enrolment; see the /pair handler below. */
  noAutoPair?: boolean
  /** Advertised to the extension so the user never has to know two ports. */
  webSocketUrl?: string
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

    /**
     * First-run enrolment.
     *
     * Requiring the user to copy a credential into a CLI before anything
     * worked made the product unusable, so the daemon issues the browser's
     * credential itself — but only while no browser is paired at all. Once one
     * is, this closes permanently and re-pairing goes back through the CLI.
     *
     * The trade is explicit: a local process could race the browser to claim
     * this. It is loopback-only, it closes after a single use, the daemon says
     * loudly what it issued, and --no-auto-pair turns it off. That is a better
     * bargain than a setup nobody finishes.
     */
    if (req.method === 'POST' && url.pathname === '/pair') {
      if (options.noAutoPair) {
        res.writeHead(403, { 'content-type': 'text/plain' })
        res.end('Automatic pairing is disabled. Use: janus-mcp pair --stdin')
        return
      }
      if (credentials.listExecutors().length > 0) {
        res.writeHead(409, { 'content-type': 'text/plain' })
        res.end('A browser is already paired. Use: janus-mcp pair --stdin')
        return
      }

      const pairingId = generateId('pair')
      const token = generateToken()
      credentials.upsertExecutor(pairingId, token, 'browser (auto-paired)')

      // An agent token is issued alongside it, because minting that separately
      // was the other half of the setup cost.
      const client = credentials.createClient([pairingId], 'local agent', true)
      const port = req.socket.localPort ?? 3456

      console.error(
        `[janus-mcp] Auto-paired a browser (${pairingId}); automatic pairing is now closed.\n`
        + `[janus-mcp] Connect an agent with:\n\n`
        + `  claude mcp add --transport http janus http://127.0.0.1:${port}/mcp \\\n`
        + `    --header "Authorization: Bearer ${client.token}"\n`,
      )

      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        pairingId,
        token,
        webSocket: options.webSocketUrl,
        agentToken: client.token,
      }))
      return
    }

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
