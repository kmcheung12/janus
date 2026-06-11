import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FileMessageHeader } from './types.js'

export function parseFrame(buffer: Buffer): { header: FileMessageHeader; data: Buffer } {
  if (buffer.length < 4) throw new Error('Frame too short')
  const headerLen = buffer.readUInt32BE(0)
  if (buffer.length < 4 + headerLen) throw new Error('Frame truncated')
  const headerJson = buffer.subarray(4, 4 + headerLen).toString('utf8')
  const header = JSON.parse(headerJson) as FileMessageHeader
  const data = buffer.subarray(4 + headerLen)
  return { header, data }
}

export function saveFile(journeyId: string, filename: string, data: Buffer): string {
  const dir = join(tmpdir(), 'janus-mcp', journeyId)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, filename)
  writeFileSync(path, data)
  return path
}
