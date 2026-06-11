import { createServer } from 'node:http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { startWsServer } from './ws-server.js';
import { createMcpServer } from './mcp-tools.js';
const WS_PORT = 3457;
const MCP_PORT = 3456;
startWsServer(WS_PORT);
const transports = new Map();
const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${MCP_PORT}`);
    if (req.method === 'GET' && url.pathname === '/sse') {
        const transport = new SSEServerTransport('/message', res);
        transports.set(transport.sessionId, transport);
        transport.onclose = () => transports.delete(transport.sessionId);
        const server = createMcpServer();
        await server.connect(transport);
        return;
    }
    if (req.method === 'POST' && url.pathname === '/message') {
        const sessionId = url.searchParams.get('sessionId') ?? '';
        const transport = transports.get(sessionId);
        if (!transport) {
            res.writeHead(404).end('Session not found');
            return;
        }
        await transport.handlePostMessage(req, res);
        return;
    }
    res.writeHead(404).end();
});
httpServer.listen(MCP_PORT, () => {
    console.error(`[janus-mcp] MCP SSE  → http://localhost:${MCP_PORT}/sse`);
    console.error(`[janus-mcp] WebSocket → ws://localhost:${WS_PORT}`);
});
