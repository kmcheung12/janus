import { describe, it, expect } from 'vitest'
import { parseFrame } from '../src/file-store.js'

function buildFrame(header: object, data: Uint8Array): Buffer {
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8')
  const frame = Buffer.alloc(4 + headerBytes.length + data.length)
  frame.writeUInt32BE(headerBytes.length, 0)
  headerBytes.copy(frame, 4)
  Buffer.from(data).copy(frame, 4 + headerBytes.length)
  return frame
}

describe('parseFrame', () => {
  it('extracts header and data correctly', () => {
    const header = { type: 'file', journeyId: 'abc123', filename: 'shot.png', mimeType: 'image/png' }
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const frame = buildFrame(header, data)

    const result = parseFrame(frame)
    expect(result.header).toEqual(header)
    expect(result.data.equals(Buffer.from(data))).toBe(true)
  })

  it('handles empty data', () => {
    const header = { type: 'file', journeyId: 'x', filename: 'empty.bin', mimeType: 'application/octet-stream' }
    const frame = buildFrame(header, new Uint8Array(0))
    const result = parseFrame(frame)
    expect(result.data.length).toBe(0)
  })

  it('throws on truncated frame', () => {
    expect(() => parseFrame(Buffer.from([0, 0, 0, 100]))).toThrow()
  })
})
