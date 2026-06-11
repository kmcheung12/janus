import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { startWsServer } from './ws-server.js'
import { createMcpServer } from './mcp-tools.js'

const WS_PORT = 3457

startWsServer(WS_PORT)

const server = createMcpServer()
const transport = new StdioServerTransport()
await server.connect(transport)
