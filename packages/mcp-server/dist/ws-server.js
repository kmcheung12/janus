import { WebSocketServer } from 'ws';
import { upsertJourney, addEvent, setStatus, addFile } from './journey-store.js';
import { parseFrame, saveFile } from './file-store.js';
export function startWsServer(port) {
    const wss = new WebSocketServer({ port });
    wss.on('connection', (ws) => {
        ws.on('message', (data, isBinary) => {
            if (isBinary) {
                handleBinary(Buffer.isBuffer(data) ? data : Buffer.from(data));
            }
            else {
                handleText(data.toString());
            }
        });
    });
    wss.on('error', (err) => {
        console.error('[janus-mcp] WebSocket server error:', err.message);
    });
    return wss;
}
function handleText(raw) {
    let msg;
    try {
        msg = JSON.parse(raw);
    }
    catch {
        return;
    }
    switch (msg.type) {
        case 'sync':
            upsertJourney(msg.journeyId, msg.meta, msg.events);
            break;
        case 'event':
            addEvent(msg.journeyId, msg.event);
            break;
        case 'recording_stopped':
            setStatus(msg.journeyId, 'stopped');
            break;
    }
}
function handleBinary(buffer) {
    try {
        const { header, data } = parseFrame(buffer);
        if (header.type !== 'file')
            return;
        const path = saveFile(header.journeyId, header.filename, data);
        addFile(header.journeyId, { filename: header.filename, mimeType: header.mimeType, path });
    }
    catch (e) {
        console.error('[janus-mcp] Malformed binary frame:', e);
    }
}
