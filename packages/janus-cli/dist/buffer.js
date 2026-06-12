export class RingBuffer {
    buf = [];
    capacity;
    constructor(capacity) {
        this.capacity = capacity;
    }
    push(item) {
        this.buf.push(item);
        if (this.capacity > 0 && this.buf.length > this.capacity) {
            this.buf.shift();
        }
    }
    toArray() {
        return [...this.buf];
    }
    get size() {
        return this.buf.length;
    }
}
