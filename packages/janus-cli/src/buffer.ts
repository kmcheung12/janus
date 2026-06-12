export class RingBuffer<T> {
  private buf: T[] = []
  private capacity: number

  constructor(capacity: number) {
    this.capacity = capacity
  }

  push(item: T): void {
    this.buf.push(item)
    if (this.capacity > 0 && this.buf.length > this.capacity) {
      this.buf.shift()
    }
  }

  toArray(): T[] {
    return [...this.buf]
  }

  get size(): number {
    return this.buf.length
  }
}
