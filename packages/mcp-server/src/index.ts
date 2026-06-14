import { createServer } from 'node:http'
import { startWsServer } from './ws-server.js'
import { createHttpHandler } from './http-server.js'

const WS_PORT = 3457
const MCP_PORT = 3456

startWsServer(WS_PORT)

const httpServer = createServer(createHttpHandler())

httpServer.listen(MCP_PORT, () => {
  console.error(`[janus-mcp] MCP SSE          → http://localhost:${MCP_PORT}/sse`)
  console.error(`[janus-mcp] MCP Streamable   → http://localhost:${MCP_PORT}/mcp`)
  console.error(`[janus-mcp] WebSocket        → ws://localhost:${WS_PORT}`)
})
