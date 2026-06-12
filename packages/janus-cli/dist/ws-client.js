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
            this.sendSync();
        });
        this.ws.on('error', () => { });
        this.ws.on('close', () => {
            if (!this.closed)
                this.scheduleReconnect();
        });
    }
    sendSync() {
        this.send({ type: 'sync', journeyId: this.journeyId, meta: this.getMeta(), events: this.getEvents() });
    }
    sendStopped() {
        this.send({ type: 'recording_stopped', journeyId: this.journeyId });
        this.closed = true;
        this.ws?.close();
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
