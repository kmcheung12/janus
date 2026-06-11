# MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local MCP server that receives user journey events from the Janus browser extension over WebSocket and exposes them to Claude Code via MCP stdio tools.

**Architecture:** A `packages/mcp-server/` Node.js package runs two servers in one process — a WebSocket server (port 3457) that receives events from the extension, and an MCP stdio server that Claude Code spawns and queries. The extension's background service worker manages the WebSocket client, streaming events as they're captured and syncing full state on reconnect.

**Tech Stack:** Node.js 22, TypeScript (ESM), `@modelcontextprotocol/sdk`, `ws`, `vitest`. Extension side uses native browser `WebSocket` API.

---

## File Map

**New — MCP server package:**
- `packages/mcp-server/package.json` — package manifest, dependencies
- `packages/mcp-server/tsconfig.json` — TypeScript config
- `packages/mcp-server/vitest.config.ts` — vitest node environment
- `packages/mcp-server/src/types.ts` — `CapturedEvent` copy + `Journey`, `FileAttachment`, `WsTextMessage`, `FileMessageHeader`
- `packages/mcp-server/src/journey-store.ts` — in-memory `Map<id, Journey>`, all query functions
- `packages/mcp-server/src/file-store.ts` — `parseFrame()` binary framing, `saveFile()` to tmpdir
- `packages/mcp-server/src/ws-server.ts` — `WebSocketServer`, routes text/binary messages to store
- `packages/mcp-server/src/mcp-tools.ts` — `createMcpServer()`, four tool definitions + handlers
- `packages/mcp-server/src/index.ts` — entry point, starts both servers
- `packages/mcp-server/tests/journey-store.test.ts`
- `packages/mcp-server/tests/file-store.test.ts`

**New — Extension:**
- `src/lib/short-id.ts` — `shortId()` for 6-char journey IDs
- `src/lib/mcp/ws-client.ts` — WebSocket client: connect/reconnect, sync, event, stop, file upload

**Modified — Extension:**
- `src/entrypoints/background.ts` — wire ws-client; generate journeyId on record start; handle `JANUS_SEND_FILE`
- `src/entrypoints/content.ts` — track `currentJourneyId`; pass `onJourneyIdRef` callback to Sidebar
- `src/components/sidebar/Sidebar.svelte` — display journeyId in toolbar; file picker button

---

### Task 1: MCP server package scaffold and types

**Files:**
- Create: `packages/mcp-server/package.json`
- Create: `packages/mcp-server/tsconfig.json`
- Create: `packages/mcp-server/vitest.config.ts`
- Create: `packages/mcp-server/src/types.ts`

- [ ] **Step 1: Create packages directory and package.json**

```bash
mkdir -p packages/mcp-server/src packages/mcp-server/tests
```

`packages/mcp-server/package.json`:
```json
{
  "name": "@janus/mcp-server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ws": "^8.5.13",
    "typescript": "^5.9.3",
    "vitest": "^4.1.5"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

`packages/mcp-server/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true
  },
  "include": ["src"],
  "exclude": ["tests", "dist"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

`packages/mcp-server/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node' } })
```

- [ ] **Step 4: Create src/types.ts**

Copy `CapturedEvent` and all event types from the extension, plus MCP server types. The extension's `src/lib/event-capture/types.ts` is the source of truth — copy it verbatim and add the server types below.

`packages/mcp-server/src/types.ts`:
```typescript
// --- Copied from src/lib/event-capture/types.ts ---
export type EventType = 'session' | 'navigation' | 'click' | 'keyboard' | 'api' | 'scroll' | 'console' | 'drag' | 'element_pick' | 'resize'

interface BaseEvent {
  id: string
  type: EventType
  timestamp: number
  note?: string
  excluded?: boolean
}

export interface SessionEvent extends BaseEvent { type: 'session'; viewport: { width: number; height: number }; dpr: number; browser: string }
export interface NavigationEvent extends BaseEvent { type: 'navigation'; url: string; title: string }
export interface ClickEvent extends BaseEvent { type: 'click'; selector: string; label: string; count: number; x: number; y: number }
export interface DragEvent extends BaseEvent { type: 'drag'; sourceSelector: string; targetSelector: string | null; path: Array<{ x: number; y: number }>; deltaX: number; deltaY: number }
export interface KeyboardInputEvent extends BaseEvent { type: 'keyboard'; selector: string; inputType: string; count: number; key?: string; keys?: string[] }
export interface ApiEvent extends BaseEvent { type: 'api'; method: string; url: string; status: number | null; requestBody: string | null; responseBody: string | null; errorDetails: string | null; duration: number | null }
export interface ScrollEvent extends BaseEvent { type: 'scroll'; selector: string; direction: 'up' | 'down' | 'left' | 'right'; count: number; deltaX: number; deltaY: number }
export interface ConsoleEvent extends BaseEvent { type: 'console'; level: 'error' | 'warn' | 'log'; message: string; source?: string | null }
export interface ElementPickEvent extends BaseEvent { type: 'element_pick'; selector: string; text: string; attributes: Record<string, string>; styles: Record<string, string> }
export interface ResizeEvent extends BaseEvent { type: 'resize'; width: number; height: number; orientation?: string }

export type CapturedEvent =
  | SessionEvent | NavigationEvent | ClickEvent | KeyboardInputEvent
  | ApiEvent | ScrollEvent | ConsoleEvent | DragEvent | ElementPickEvent | ResizeEvent

// --- MCP server types ---
export interface JourneyMeta {
  startTime: number
  startUrl: string
  tabTitle: string
  domain: string
  status: 'recording' | 'stopped'
}

export interface FileAttachment {
  filename: string
  mimeType: string
  path: string
}

export interface Journey {
  id: string
  meta: JourneyMeta
  events: CapturedEvent[]
  files: FileAttachment[]
}

export type WsTextMessage =
  | { type: 'sync'; journeyId: string; meta: JourneyMeta; events: CapturedEvent[] }
  | { type: 'event'; journeyId: string; event: CapturedEvent }
  | { type: 'recording_stopped'; journeyId: string }

export interface FileMessageHeader {
  type: 'file'
  journeyId: string
  filename: string
  mimeType: string
}
```

- [ ] **Step 5: Install dependencies**

```bash
cd packages/mcp-server && pnpm install
```

Expected: `node_modules` created, no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp-server/package.json packages/mcp-server/tsconfig.json packages/mcp-server/vitest.config.ts packages/mcp-server/src/types.ts packages/mcp-server/pnpm-lock.yaml
git commit -m "feat: scaffold mcp-server package with types"
```

---

### Task 2: Journey store

**Files:**
- Create: `packages/mcp-server/src/journey-store.ts`
- Create: `packages/mcp-server/tests/journey-store.test.ts`

- [ ] **Step 1: Write failing tests**

`packages/mcp-server/tests/journey-store.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import {
  upsertJourney, getById, getByDomain, getLatest, listAll,
  setStatus, addFile, addEvent, clear,
} from '../src/journey-store.js'
import type { JourneyMeta, FileAttachment } from '../src/types.js'

const meta = (domain: string, startTime = 1000): JourneyMeta => ({
  startTime, startUrl: `https://${domain}/`, tabTitle: domain, domain, status: 'recording',
})

beforeEach(() => clear())

describe('upsertJourney', () => {
  it('creates a new journey', () => {
    upsertJourney('abc', meta('google.com'), [])
    expect(getById('abc')).toMatchObject({ id: 'abc', meta: { domain: 'google.com' } })
  })

  it('replaces events on resync but preserves files', () => {
    upsertJourney('abc', meta('google.com'), [])
    const file: FileAttachment = { filename: 'shot.png', mimeType: 'image/png', path: '/tmp/shot.png' }
    addFile('abc', file)
    upsertJourney('abc', meta('google.com'), [])
    const j = getById('abc')!
    expect(j.events).toHaveLength(0)
    expect(j.files).toHaveLength(1)
  })
})

describe('addEvent', () => {
  it('appends event to existing journey', () => {
    upsertJourney('abc', meta('google.com'), [])
    const event = { id: 'e1', type: 'navigation' as const, timestamp: 1, url: 'https://google.com', title: 'G' }
    addEvent('abc', event)
    expect(getById('abc')?.events).toHaveLength(1)
  })

  it('silently ignores unknown journeyId', () => {
    expect(() => addEvent('nope', { id: 'e1', type: 'navigation' as const, timestamp: 1, url: '', title: '' })).not.toThrow()
  })
})

describe('setStatus', () => {
  it('updates status to stopped', () => {
    upsertJourney('abc', meta('google.com'), [])
    setStatus('abc', 'stopped')
    expect(getById('abc')?.meta.status).toBe('stopped')
  })
})

describe('getByDomain', () => {
  it('matches partial hostname case-insensitively', () => {
    upsertJourney('a', meta('mail.google.com', 1000), [])
    upsertJourney('b', meta('github.com', 2000), [])
    const results = getByDomain('Google')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('a')
  })

  it('returns multiple matching journeys', () => {
    upsertJourney('a', meta('docs.google.com', 1000), [])
    upsertJourney('b', meta('mail.google.com', 2000), [])
    upsertJourney('c', meta('github.com', 3000), [])
    expect(getByDomain('google')).toHaveLength(2)
  })
})

describe('getLatest', () => {
  it('returns undefined when empty', () => {
    expect(getLatest()).toBeUndefined()
  })

  it('returns journey with highest startTime', () => {
    upsertJourney('a', meta('a.com', 1000), [])
    upsertJourney('b', meta('b.com', 3000), [])
    upsertJourney('c', meta('c.com', 2000), [])
    expect(getLatest()?.id).toBe('b')
  })
})

describe('listAll', () => {
  it('returns all journeys', () => {
    upsertJourney('a', meta('a.com'), [])
    upsertJourney('b', meta('b.com'), [])
    expect(listAll()).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd packages/mcp-server && pnpm test
```

Expected: `Cannot find module '../src/journey-store.js'`

- [ ] **Step 3: Implement journey-store.ts**

`packages/mcp-server/src/journey-store.ts`:
```typescript
import type { Journey, JourneyMeta, CapturedEvent, FileAttachment } from './types.js'

const store = new Map<string, Journey>()

export function upsertJourney(id: string, meta: JourneyMeta, events: CapturedEvent[]): void {
  const existing = store.get(id)
  store.set(id, { id, meta, events, files: existing?.files ?? [] })
}

export function addEvent(journeyId: string, event: CapturedEvent): void {
  const j = store.get(journeyId)
  if (!j) return
  j.events.push(event)
}

export function setStatus(journeyId: string, status: 'recording' | 'stopped'): void {
  const j = store.get(journeyId)
  if (!j) return
  j.meta.status = status
}

export function addFile(journeyId: string, file: FileAttachment): void {
  const j = store.get(journeyId)
  if (!j) return
  j.files.push(file)
}

export function getById(id: string): Journey | undefined {
  return store.get(id)
}

export function getByDomain(domain: string): Journey[] {
  const lower = domain.toLowerCase()
  return [...store.values()].filter(j => j.meta.domain.toLowerCase().includes(lower))
}

export function getLatest(): Journey | undefined {
  if (store.size === 0) return undefined
  return [...store.values()].reduce((a, b) => a.meta.startTime > b.meta.startTime ? a : b)
}

export function listAll(): Journey[] {
  return [...store.values()]
}

export function clear(): void {
  store.clear()
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd packages/mcp-server && pnpm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-server/src/journey-store.ts packages/mcp-server/tests/journey-store.test.ts
git commit -m "feat: add in-memory journey store"
```

---

### Task 3: File store

**Files:**
- Create: `packages/mcp-server/src/file-store.ts`
- Create: `packages/mcp-server/tests/file-store.test.ts`

- [ ] **Step 1: Write failing tests**

`packages/mcp-server/tests/file-store.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd packages/mcp-server && pnpm test
```

Expected: `Cannot find module '../src/file-store.js'`

- [ ] **Step 3: Implement file-store.ts**

`packages/mcp-server/src/file-store.ts`:
```typescript
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
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd packages/mcp-server && pnpm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-server/src/file-store.ts packages/mcp-server/tests/file-store.test.ts
git commit -m "feat: add binary file frame parsing and storage"
```

---

### Task 4: WebSocket server

**Files:**
- Create: `packages/mcp-server/src/ws-server.ts`

- [ ] **Step 1: Implement ws-server.ts**

`packages/mcp-server/src/ws-server.ts`:
```typescript
import { WebSocketServer } from 'ws'
import type { RawData } from 'ws'
import { upsertJourney, addEvent, setStatus, addFile } from './journey-store.js'
import { parseFrame, saveFile } from './file-store.js'
import type { WsTextMessage } from './types.js'

export function startWsServer(port: number): WebSocketServer {
  const wss = new WebSocketServer({ port })

  wss.on('connection', (ws) => {
    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        handleBinary(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer))
      } else {
        handleText(data.toString())
      }
    })
  })

  wss.on('error', (err) => {
    console.error('[janus-mcp] WebSocket server error:', err.message)
  })

  return wss
}

function handleText(raw: string): void {
  let msg: WsTextMessage
  try {
    msg = JSON.parse(raw) as WsTextMessage
  } catch {
    return
  }
  switch (msg.type) {
    case 'sync':
      upsertJourney(msg.journeyId, msg.meta, msg.events)
      break
    case 'event':
      addEvent(msg.journeyId, msg.event)
      break
    case 'recording_stopped':
      setStatus(msg.journeyId, 'stopped')
      break
  }
}

function handleBinary(buffer: Buffer): void {
  try {
    const { header, data } = parseFrame(buffer)
    if (header.type !== 'file') return
    const path = saveFile(header.journeyId, header.filename, data)
    addFile(header.journeyId, { filename: header.filename, mimeType: header.mimeType, path })
  } catch (e) {
    console.error('[janus-mcp] Malformed binary frame:', e)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/mcp-server/src/ws-server.ts
git commit -m "feat: add WebSocket server with message routing"
```

---

### Task 5: MCP tools

**Files:**
- Create: `packages/mcp-server/src/mcp-tools.ts`

- [ ] **Step 1: Implement mcp-tools.ts**

`packages/mcp-server/src/mcp-tools.ts`:
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { getById, getByDomain, getLatest, listAll } from './journey-store.js'
import type { Journey } from './types.js'

function summarise(j: Journey) {
  return {
    id: j.id,
    startTime: new Date(j.meta.startTime).toISOString(),
    startUrl: j.meta.startUrl,
    tabTitle: j.meta.tabTitle,
    domain: j.meta.domain,
    status: j.meta.status,
    eventCount: j.events.length,
    fileCount: j.files.length,
  }
}

const TOOLS: Tool[] = [
  {
    name: 'list_journeys',
    description: 'List all recorded user journeys (metadata only, no events)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_journey_by_id',
    description: 'Get a full journey (events + attached files) by its short ID. The ID is shown in the Janus sidebar.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Journey ID shown in the extension sidebar (e.g. "abc123")' } },
      required: ['id'],
    },
  },
  {
    name: 'get_journeys_by_domain',
    description: 'Get all journeys for a domain. Partial match — "google" matches google.com and mail.google.com.',
    inputSchema: {
      type: 'object',
      properties: { domain: { type: 'string', description: 'Partial domain string to search for' } },
      required: ['domain'],
    },
  },
  {
    name: 'latest_journey',
    description: 'Get the most recently started journey with full events and files',
    inputSchema: { type: 'object', properties: {} },
  },
]

export function createMcpServer(): Server {
  const server = new Server(
    { name: 'janus', version: '0.0.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params
    const a = args as Record<string, string>

    if (name === 'list_journeys') {
      return { content: [{ type: 'text', text: JSON.stringify(listAll().map(summarise), null, 2) }] }
    }
    if (name === 'get_journey_by_id') {
      const j = getById(a.id)
      if (!j) return { content: [{ type: 'text', text: `No journey found with id "${a.id}"` }] }
      return { content: [{ type: 'text', text: JSON.stringify(j, null, 2) }] }
    }
    if (name === 'get_journeys_by_domain') {
      return { content: [{ type: 'text', text: JSON.stringify(getByDomain(a.domain), null, 2) }] }
    }
    if (name === 'latest_journey') {
      const j = getLatest()
      if (!j) return { content: [{ type: 'text', text: 'No journeys recorded yet' }] }
      return { content: [{ type: 'text', text: JSON.stringify(j, null, 2) }] }
    }
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] }
  })

  return server
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/mcp-server/src/mcp-tools.ts
git commit -m "feat: add MCP tool definitions and handlers"
```

---

### Task 6: Entry point, build, and Claude config

**Files:**
- Create: `packages/mcp-server/src/index.ts`

- [ ] **Step 1: Implement index.ts**

`packages/mcp-server/src/index.ts`:
```typescript
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { startWsServer } from './ws-server.js'
import { createMcpServer } from './mcp-tools.js'

const WS_PORT = 3457

startWsServer(WS_PORT)

const server = createMcpServer()
const transport = new StdioServerTransport()
await server.connect(transport)
```

- [ ] **Step 2: Build and verify**

```bash
cd packages/mcp-server && pnpm build
```

Expected: `dist/` directory created, no TypeScript errors.

- [ ] **Step 3: Smoke-test startup**

```bash
cd packages/mcp-server && echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js
```

Expected: JSON response containing the four tool names (`list_journeys`, `get_journey_by_id`, `get_journeys_by_domain`, `latest_journey`).

- [ ] **Step 4: Register with Claude Code**

Add to `~/.claude/settings.json` under `mcpServers`:
```json
"janus": {
  "command": "node",
  "args": ["/Users/alan/code/janus/packages/mcp-server/dist/index.js"],
  "type": "stdio"
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-server/src/index.ts
git commit -m "feat: add mcp-server entry point and build"
```

---

### Task 7: Extension — shortId + WebSocket client

**Files:**
- Create: `src/lib/short-id.ts`
- Create: `src/lib/mcp/ws-client.ts`

- [ ] **Step 1: Create short-id.ts**

`src/lib/short-id.ts`:
```typescript
export function shortId(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('').slice(0, 6)
}
```

- [ ] **Step 2: Create ws-client.ts**

`src/lib/mcp/ws-client.ts`:
```typescript
import type { CapturedEvent } from '../event-capture/types'

const WS_URL = 'ws://localhost:3457'
const RECONNECT_DELAY_MS = 2000

interface JourneyMeta {
  startTime: number
  startUrl: string
  tabTitle: string
  domain: string
  status: 'recording' | 'stopped'
}

interface ActiveJourney {
  journeyId: string
  meta: JourneyMeta
  events: CapturedEvent[]
}

let ws: WebSocket | null = null
let active: ActiveJourney | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

export function startJourney(journeyId: string, meta: JourneyMeta): void {
  active = { journeyId, meta, events: [] }
  connect()
}

export function syncEvents(journeyId: string, events: CapturedEvent[]): void {
  if (!active || active.journeyId !== journeyId) return
  active.events = events
  send({ type: 'sync', journeyId, meta: active.meta, events })
}

export function stopJourney(journeyId: string): void {
  if (!active || active.journeyId !== journeyId) return
  active.meta.status = 'stopped'
  send({ type: 'recording_stopped', journeyId })
}

export function sendFile(journeyId: string, filename: string, mimeType: string, bytes: ArrayBuffer): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  const headerJson = JSON.stringify({ type: 'file', journeyId, filename, mimeType })
  const headerBytes = new TextEncoder().encode(headerJson)
  const frame = new ArrayBuffer(4 + headerBytes.length + bytes.byteLength)
  const view = new DataView(frame)
  view.setUint32(0, headerBytes.length, false)
  new Uint8Array(frame, 4, headerBytes.length).set(headerBytes)
  new Uint8Array(frame, 4 + headerBytes.length).set(new Uint8Array(bytes))
  ws.send(frame)
}

function connect(): void {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return
  ws = new WebSocket(WS_URL)

  ws.onopen = () => {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    if (active) {
      send({ type: 'sync', journeyId: active.journeyId, meta: active.meta, events: active.events })
    }
  }

  ws.onclose = () => {
    if (active) {
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS)
    }
  }

  ws.onerror = () => ws?.close()
}

function send(msg: object): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/short-id.ts src/lib/mcp/ws-client.ts
git commit -m "feat: add shortId utility and WebSocket client for MCP server"
```

---

### Task 8: Extension — background.ts wiring

**Files:**
- Modify: `src/entrypoints/background.ts`

- [ ] **Step 1: Update background.ts**

Add imports at the top, extend the `Msg` type, add `tabJourneyId` map, and wire the four call sites. Replace the entire file:

`src/entrypoints/background.ts`:
```typescript
import type { CapturedEvent } from '../lib/event-capture/types'
import { shortId } from '../lib/short-id'
import { startJourney, syncEvents, stopJourney, sendFile } from '../lib/mcp/ws-client'

type Msg =
  | { type: 'JANUS_SYNC_EVENTS'; events: CapturedEvent[] }
  | { type: 'JANUS_GET_EVENTS' }
  | { type: 'JANUS_CLEAR_EVENTS' }
  | { type: 'JANUS_OPEN_POPUP' }
  | { type: 'JANUS_TOGGLE_RECORDING'; tabId?: number }
  | { type: 'JANUS_GET_RECORDING_STATE'; tabId?: number }
  | { type: 'JANUS_SIDEBAR_OPENED' }
  | { type: 'JANUS_SIDEBAR_CLOSED' }
  | { type: 'JANUS_SEND_FILE'; filename: string; mimeType: string; data: string }

function setBadge(tabId: number, recording: boolean) {
  const api = (browser as any).action || (browser as any).browserAction
  if (!api) return
  try {
    api.setBadgeText({ text: recording ? '●' : '', tabId })
    api.setBadgeBackgroundColor({ color: '#a6e3a1', tabId })
  } catch (e) {
    console.error('Failed to set badge:', e)
  }
}

export default defineBackground(() => {
  const tabEvents = new Map<number, CapturedEvent[]>()
  const tabRecording = new Map<number, boolean>()
  const tabSidebarOpen = new Map<number, boolean>()
  const tabJourneyId = new Map<number, string>()

  browser.runtime.onMessage.addListener((msg: Msg, sender) => {
    if (msg.type === 'JANUS_TOGGLE_RECORDING') {
      const tabId = msg.tabId ?? sender.tab?.id
      if (!tabId) return
      const next = !(tabRecording.get(tabId) ?? false)
      tabRecording.set(tabId, next)
      if (next) tabEvents.delete(tabId)
      setBadge(tabId, next)

      if (next) {
        const journeyId = shortId()
        tabJourneyId.set(tabId, journeyId)
        browser.storage.session.set({
          [`janus_recording_${tabId}`]: true,
          [`janus_journeyid_${tabId}`]: journeyId,
        }).catch(() => {})
        return browser.tabs.get(tabId).then(tab => {
          const startUrl = tab.url ?? ''
          startJourney(journeyId, {
            startTime: Date.now(),
            startUrl,
            tabTitle: tab.title ?? '',
            domain: (() => { try { return new URL(startUrl).hostname } catch { return startUrl } })(),
            status: 'recording',
          })
          browser.tabs.sendMessage(tabId, { type: 'JANUS_RECORDING_CHANGED', recording: true, journeyId }).catch(() => {})
          return { recording: true, journeyId }
        })
      } else {
        const journeyId = tabJourneyId.get(tabId)
        if (journeyId) stopJourney(journeyId)
        tabJourneyId.delete(tabId)
        browser.storage.session.remove([`janus_recording_${tabId}`, `janus_journeyid_${tabId}`]).catch(() => {})
        browser.tabs.sendMessage(tabId, { type: 'JANUS_RECORDING_CHANGED', recording: false }).catch(() => {})
        return Promise.resolve({ recording: false })
      }
    }

    if (msg.type === 'JANUS_GET_RECORDING_STATE') {
      const tabId = msg.tabId ?? sender.tab?.id
      if (!tabId) return
      const recording = tabRecording.get(tabId) ?? false
      const sidebarOpen = tabSidebarOpen.get(tabId) ?? false
      const journeyId = tabJourneyId.get(tabId)
      if (!recording && !sidebarOpen) {
        return browser.storage.session
          .get([`janus_sidebar_${tabId}`, `janus_recording_${tabId}`, `janus_journeyid_${tabId}`])
          .then(stored => ({
            recording: (stored[`janus_recording_${tabId}`] as boolean | undefined) ?? false,
            sidebarOpen: (stored[`janus_sidebar_${tabId}`] as boolean | undefined) ?? false,
            journeyId: (stored[`janus_journeyid_${tabId}`] as string | undefined),
          }))
          .catch(() => ({ recording: false, sidebarOpen: false, journeyId: undefined }))
      }
      return Promise.resolve({ recording, sidebarOpen, journeyId })
    }

    const tabId = sender.tab?.id
    if (!tabId) return

    if (msg.type === 'JANUS_SIDEBAR_OPENED') {
      tabSidebarOpen.set(tabId, true)
      browser.storage.session.set({ [`janus_sidebar_${tabId}`]: true }).catch(() => {})
      return
    }
    if (msg.type === 'JANUS_SIDEBAR_CLOSED') {
      tabSidebarOpen.delete(tabId)
      browser.storage.session.remove(`janus_sidebar_${tabId}`).catch(() => {})
      return
    }

    if (msg.type === 'JANUS_SYNC_EVENTS') {
      tabEvents.set(tabId, msg.events)
      const journeyId = tabJourneyId.get(tabId)
      if (journeyId) {
        syncEvents(journeyId, msg.events)
      } else if (tabRecording.get(tabId)) {
        // SW restarted — restore journeyId from session storage then resync
        browser.storage.session.get(`janus_journeyid_${tabId}`).then(stored => {
          const id = stored[`janus_journeyid_${tabId}`] as string | undefined
          if (id) {
            tabJourneyId.set(tabId, id)
            syncEvents(id, msg.events)
          }
        }).catch(() => {})
      }
      return
    }
    if (msg.type === 'JANUS_GET_EVENTS') {
      return Promise.resolve(tabEvents.get(tabId) ?? [])
    }
    if (msg.type === 'JANUS_CLEAR_EVENTS') {
      tabEvents.delete(tabId)
      return
    }
    if (msg.type === 'JANUS_OPEN_POPUP') {
      try {
        const actionApi = (browser as any).action || (browser as any).browserAction
        if (typeof actionApi?.openPopup === 'function') {
          const opts = sender.tab?.windowId != null ? { windowId: sender.tab.windowId } : undefined
          actionApi.openPopup(opts)
        }
      } catch (e) {
        console.error('Failed to open popup:', e)
      }
      return
    }
    if (msg.type === 'JANUS_SEND_FILE') {
      const journeyId = tabJourneyId.get(tabId)
      if (!journeyId) return
      const binary = atob(msg.data)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      sendFile(journeyId, msg.filename, msg.mimeType, bytes.buffer)
      return
    }
  })

  browser.tabs.onActivated.addListener(({ tabId }) => {
    setBadge(tabId, tabRecording.get(tabId) ?? false)
  })

  browser.tabs.onRemoved.addListener((tabId) => {
    tabEvents.delete(tabId)
    tabRecording.delete(tabId)
    tabSidebarOpen.delete(tabId)
    tabJourneyId.delete(tabId)
    browser.storage.session.remove([
      `janus_sidebar_${tabId}`,
      `janus_recording_${tabId}`,
      `janus_journeyid_${tabId}`,
    ]).catch(() => {})
  })
})
```

- [ ] **Step 2: Build extension and verify no TypeScript errors**

```bash
cd /Users/alan/code/janus && pnpm check
```

Expected: no errors (or only pre-existing ones unrelated to background.ts).

- [ ] **Step 3: Commit**

```bash
git add src/entrypoints/background.ts src/lib/short-id.ts
git commit -m "feat: wire WebSocket client into background recording lifecycle"
```

---

### Task 9: Extension UI — journeyId display and file picker

**Files:**
- Modify: `src/entrypoints/content.ts`
- Modify: `src/components/sidebar/Sidebar.svelte`

- [ ] **Step 1: Update content.ts to track and forward journeyId**

In `content.ts`, add `currentJourneyId` tracking and pass `onJourneyIdRef` to Sidebar. The changes are:

1. Add `let currentJourneyId = $state<string | null>(null)` — but this is plain TS, not Svelte. Use a plain variable with a callback ref instead.

Add after the existing `let isRecording = false` line:
```typescript
let currentJourneyId: string | null = null
let updateSidebarJourneyId: ((id: string | null) => void) | null = null
```

2. In the state restoration block (after `await browser.runtime.sendMessage({ type: 'JANUS_GET_RECORDING_STATE' })`), add:
```typescript
const res = await browser.runtime.sendMessage({ type: 'JANUS_GET_RECORDING_STATE' })
isRecording = res?.recording ?? false
currentJourneyId = res?.journeyId ?? null
if (res?.sidebarOpen) openEventsSidebar()
```

3. In the `JANUS_RECORDING_CHANGED` handler, add journeyId tracking:
```typescript
if (msg.type === 'JANUS_RECORDING_CHANGED') {
  isRecording = msg.recording ?? false
  if (isRecording) {
    currentJourneyId = (msg as any).journeyId ?? null
    updateSidebarJourneyId?.(currentJourneyId)
    clearEvents()
    addEvent(sessionEvent())
    addEvent({ id: uuid(), type: 'navigation', timestamp: Date.now(), url: window.location.href, title: document.title })
  } else {
    currentJourneyId = null
    updateSidebarJourneyId?.(null)
  }
  return
}
```

4. In the `mount(Sidebar, { ... props: { ... } })` call, add:
```typescript
onJourneyIdRef: (fn: (id: string | null) => void) => { updateSidebarJourneyId = fn },
```

And pass the initial value by calling the ref after mount:
```typescript
sidebarInstance = mount(Sidebar, { ... })
updateSidebarJourneyId?.(currentJourneyId)
```

- [ ] **Step 2: Update Sidebar.svelte — add journeyId state, display, and file picker**

In `Sidebar.svelte`:

1. Add `onJourneyIdRef` to the props destructure:
```typescript
let { onClose, onPickingRef, onSidebarRef, onIsPickingRef, onJourneyIdRef }: {
  onClose: () => void
  onPickingRef?: (fn: () => void) => void
  onSidebarRef?: (fn: () => void) => void
  onIsPickingRef?: (fn: () => boolean) => void
  onJourneyIdRef?: (fn: (id: string | null) => void) => void
} = $props()
```

2. Add reactive state for journeyId and register the ref callback in `onMount`:
```typescript
let journeyId = $state<string | null>(null)

onMount(() => {
  onPickingRef?.(() => { mode = 'picking' })
  onSidebarRef?.(() => { mode = 'sidebar' })
  onIsPickingRef?.(() => mode === 'picking')
  onJourneyIdRef?.((id) => { journeyId = id })
  return subscribe(updated => { events = updated })
})
```

3. Add a `handleFileUpload` function:
```typescript
async function handleFileUpload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file || !journeyId) return
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  const data = btoa(binary)
  browser.runtime.sendMessage({
    type: 'JANUS_SEND_FILE',
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    data,
  }).catch(() => {})
  // Reset input so same file can be re-selected
  ;(e.target as HTMLInputElement).value = ''
}
```

4. In the toolbar template, add the journeyId display and file input after the `<span class="janus-logo">Janus</span>`:
```svelte
<span class="janus-logo">Janus</span>
{#if journeyId}
  <span class="janus-journey-id" title="Journey ID">{journeyId}</span>
{/if}
<label class="janus-file-btn" title="Attach file to journey">
  +
  <input type="file" style="display:none" onchange={handleFileUpload} />
</label>
```

5. Add styles:
```css
.janus-journey-id {
  font-family: monospace;
  font-size: 11px;
  color: #a6e3a1;
  background: #1e1e2e;
  border: 1px solid #313244;
  border-radius: 3px;
  padding: 2px 5px;
  letter-spacing: 0.05em;
  cursor: default;
  user-select: all;
}
.janus-file-btn {
  background: #313244;
  border: none;
  color: #cdd6f4;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  display: inline-block;
}
```

- [ ] **Step 3: Build extension**

```bash
cd /Users/alan/code/janus && pnpm build
```

Expected: build succeeds, no TypeScript errors.

- [ ] **Step 4: Manual smoke test**

1. Load the built extension in Chrome (`chrome://extensions` → Load unpacked → `output/chrome-mv3/`)
2. Rebuild MCP server: `cd packages/mcp-server && pnpm build`
3. Start a Claude Code session (which spawns the MCP server)
4. Navigate to any page, start recording via the popup
5. Verify: journeyId appears in the sidebar toolbar (green monospace badge)
6. Perform a few actions (clicks, navigation)
7. In Claude Code: use `latest_journey` tool — verify events appear
8. Stop recording, attach a file — verify it appears in `get_journey_by_id` response under `files`

- [ ] **Step 5: Commit**

```bash
git add src/entrypoints/content.ts src/components/sidebar/Sidebar.svelte
git commit -m "feat: show journey ID in sidebar and add file attachment picker"
```
