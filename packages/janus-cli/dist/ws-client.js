import WebSocket from 'ws';
export class JanusWsClient {
    url;
    journeyId;
    getMeta;
    getEvents;
    ws = null;
    reconnectTimer = null;
    reconnectDelay = 1000;
    closed = false;
    pendingStopped = false;
    openCallbacks = [];
    constructor(url, journeyId, getMeta, getEvents) {
        this.url = url;
        this.journeyId = journeyId;
        this.getMeta = getMeta;
        this.getEvents = getEvents;
    }
    connect() {
        if (this.closed)
            return;
        try {
            this.ws = new WebSocket(this.url);
        }
        catch {
            this.scheduleReconnect();
            return;
        }
        this.ws.on('open', () => {
            this.reconnectDelay = 1000;
            const cbs = this.openCallbacks.splice(0);
            cbs.forEach(cb => cb());
            if (this.pendingStopped) {
                this.send({ type: 'recording_stopped', journeyId: this.journeyId });
                this.ws?.close();
                return;
            }
            this.sendSync();
        });
        this.ws.on('error', () => { });
        this.ws.on('close', () => {
            if (!this.closed)
                this.scheduleReconnect();
        });
    }
    waitForOpen(timeoutMs = 2000) {
        return new Promise((resolve) => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                resolve();
                return;
            }
            const cb = () => resolve();
            this.openCallbacks.push(cb);
            setTimeout(() => {
                this.openCallbacks = this.openCallbacks.filter(c => c !== cb);
                resolve(); // resolve anyway — command runs even if MCP is unreachable
            }, timeoutMs);
        });
    }
    sendSync() {
        this.send({ type: 'sync', journeyId: this.journeyId, meta: this.getMeta(), events: this.getEvents() });
    }
    sendStopped() {
        if (this.reconnectTimer)
            clearTimeout(this.reconnectTimer);
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.send({ type: 'recording_stopped', journeyId: this.journeyId });
            this.closed = true;
            this.ws.close();
        }
        else {
            // Not connected — attempt one reconnect just to deliver the stopped message
            this.pendingStopped = true;
            this.closed = false;
            this.connect();
            this.closed = true; // prevent further reconnects if this attempt also fails
        }
    }
    send(msg) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }
    scheduleReconnect() {
        if (this.closed)
            return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
            this.connect();
        }, this.reconnectDelay);
    }
    destroy() {
        this.closed = true;
        if (this.reconnectTimer)
            clearTimeout(this.reconnectTimer);
        this.ws?.close();
    }
}
