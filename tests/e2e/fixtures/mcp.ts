/**
 * §20 MCP client fixture.
 *
 * Real SDK clients over Streamable HTTP with their own credentials, so
 * multi-session scoping and tool-list notifications are exercised the way a
 * coding agent would exercise them.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'

export interface McpHandle {
  client: Client
  /** Tool-list change notifications received, in order. */
  notifications: number
  waitForNotification(previous: number, timeoutMs?: number): Promise<void>
  listToolNames(): Promise<string[]>
  call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }>
  close(): Promise<void>
}

export async function connectMcp(mcpUrl: string, token: string): Promise<McpHandle> {
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })

  const client = new Client({ name: 'janus-e2e', version: '0.0.0' }, { capabilities: {} })

  const handle: McpHandle = {
    client,
    notifications: 0,

    async waitForNotification(previous, timeoutMs = 15_000) {
      const deadline = Date.now() + timeoutMs
      while (handle.notifications <= previous) {
        if (Date.now() > deadline) throw new Error('No tools/list_changed notification arrived')
        await new Promise((r) => setTimeout(r, 50))
      }
    },

    async listToolNames() {
      const { tools } = await client.listTools()
      return tools.map((t) => t.name)
    },

    async call(name, args) {
      const result = await client.callTool({ name, arguments: args })
      const content = (result.content as Array<{ type: string; text?: string }>) ?? []
      return {
        text: content.map((c) => c.text ?? '').join('\n'),
        isError: result.isError === true,
      }
    },

    close: () => client.close(),
  }

  // Subscribe before connecting so no notification is missed between connect
  // and the first assertion.
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    handle.notifications++
  })

  await client.connect(transport)
  return handle
}
