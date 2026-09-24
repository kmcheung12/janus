/**
 * MCP session registry (§8).
 *
 * `http-server.ts` previously kept transports but discarded the `Server`
 * objects, so there was nowhere to emit `notifications/tools/list_changed`
 * from. Sessions are retained here as `{ server, transport, principal }`,
 * subscribed to the page/tool registry, and disposed on close.
 *
 * Each session only ever sees tools for its own pairing scope, so a
 * notification for another principal's page never reaches it.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { ClientRecord } from '../credentials.js'
import { LIMITS } from '../contracts/limits.js'
import * as registry from './registry.js'

export interface McpSession {
  sessionId: string
  server: Server
  principal: ClientRecord
  dispose: () => void
}

const sessions = new Map<string, McpSession>()

export function registerSession(sessionId: string, server: Server, principal: ClientRecord): McpSession {
  unregisterSession(sessionId)

  let pending: NodeJS.Timeout | undefined

  const notify = () => {
    // §18: local invalidation is immediate, only the notification coalesces.
    // A burst of registry churn during page load would otherwise produce a
    // notification per tool.
    if (pending) return
    pending = setTimeout(() => {
      pending = undefined
      void server.sendToolListChanged().catch(() => {
        // The session is going away; cleanup runs through the transport's
        // own close path.
      })
    }, LIMITS.toolListNotifyCoalesceMs)
  }

  const unsubscribe = registry.subscribe((event) => {
    if (event.kind === 'pages_changed') { notify(); return }
    // Scope check: only notify when the change touches a page this principal
    // can actually see.
    const page = registry.getPage(event.pageId)
    if (!page || page.pairingId === principal.pairingId) notify()
  })

  const session: McpSession = {
    sessionId,
    server,
    principal,
    dispose: () => {
      if (pending) clearTimeout(pending)
      unsubscribe()
    },
  }
  sessions.set(sessionId, session)
  return session
}

export function unregisterSession(sessionId: string): void {
  const existing = sessions.get(sessionId)
  if (!existing) return
  existing.dispose()
  sessions.delete(sessionId)
}

export function getSession(sessionId: string): McpSession | undefined {
  return sessions.get(sessionId)
}

export function sessionCount(): number {
  return sessions.size
}

/** Drop every session belonging to a revoked principal (§12). */
export function unregisterClient(clientId: string): void {
  for (const [sessionId, session] of sessions) {
    if (session.principal.clientId === clientId) unregisterSession(sessionId)
  }
}

export function clear(): void {
  for (const sessionId of [...sessions.keys()]) unregisterSession(sessionId)
}
