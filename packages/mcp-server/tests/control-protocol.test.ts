import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'
import type { WebSocketServer } from 'ws'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startWsServer, wireQueue } from '../src/ws-server.js'
import { generateToken, openCredentialStore, type CredentialStore } from '../src/credentials.js'
import * as registry from '../src/control/registry.js'
import * as connections from '../src/control/connections.js'
import * as queue from '../src/control/queue.js'
import type { ControlMessage, PageDescriptor } from '../src/contracts/types.js'

let wss: WebSocketServer
let url: string
let dataDir: string
let credentials: CredentialStore
let executorToken: string

const PAIRING = 'pair_1'
const PAGE_ID = '00112233445566778899aabbccddeeff'

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'janus-ctl-'))
  credentials = openCredentialStore(dataDir)
  executorToken = generateToken()
  credentials.upsertExecutor(PAIRING, executorToken, 'test browser')

  wireQueue()
  wss = startWsServer({ port: 0, host: '127.0.0.1', credentials })
  await new Promise<void>((r) => wss.once('listening', r))
  url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`
})

afterEach(async () => {
  connections.clear()
  registry.clear()
  queue.clear()
  await new Promise<void>((r) => wss.close(() => r()))
  rmSync(dataDir, { recursive: true, force: true })
})

/** Open a socket and collect every decoded frame it receives. */
async function open() {
  const socket = new WebSocket(url)
  const received: ControlMessage[] = []
  socket.on('message', (raw) => received.push(JSON.parse(raw.toString()) as ControlMessage))
  await new Promise<void>((res, rej) => { socket.once('open', res); socket.once('error', rej) })

  const closed = new Promise<number>((res) => socket.once('close', (code) => res(code)))
  return {
    socket,
    received,
    closed,
    send: (message: unknown) => socket.send(JSON.stringify(message)),
    next: async <T extends ControlMessage>(type: T['type']): Promise<T> => {
      for (let i = 0; i < 100; i++) {
        const found = received.find((m) => m.type === type)
        if (found) return found as T
        await new Promise((r) => setTimeout(r, 10))
      }
      throw new Error(`No ${type} frame; saw ${received.map((m) => m.type).join(', ') || 'nothing'}`)
    },
  }
}

const hello = (overrides: Record<string, unknown> = {}) => ({
  protocolVersion: 1, type: 'hello', role: 'executor',
  pairingId: PAIRING, token: executorToken, browserSessionId: 'browser_1', ...overrides,
})

function pageDescriptor(overrides: Partial<PageDescriptor> = {}): PageDescriptor {
  return {
    pageId: PAGE_ID, browserSessionId: 'browser_1', tabId: 1, frameId: 0,
    documentId: 'doc_1', label: 'Shop', title: 'Shop',
    url: 'https://shop.example/', origin: 'https://shop.example',
    nativeCapability: 'available', execution: { state: 'idle' }, ...overrides,
  }
}

describe('handshake', () => {
  it('accepts a provisioned executor and assigns a connection ID', async () => {
    const c = await open()
    c.send(hello())
    const ack = await c.next<{ type: 'hello_ack'; connectionId: string; heartbeatIntervalMs: number }>('hello_ack')
    expect(ack.connectionId).toBeTruthy()
    expect(ack.heartbeatIntervalMs).toBe(15000)
    c.socket.close()
  })

  it('never echoes the credential back', async () => {
    const c = await open()
    c.send(hello())
    const ack = await c.next('hello_ack')
    expect(JSON.stringify(ack)).not.toContain(executorToken)
    c.socket.close()
  })

  it('closes on a wrong token', async () => {
    const c = await open()
    c.send(hello({ token: generateToken() }))
    expect(await c.closed).toBe(4401)
  })

  it('closes identically for an unknown pairing ID', async () => {
    // A caller must not be able to probe which pairing IDs exist.
    const c = await open()
    c.send(hello({ pairingId: 'pair_does_not_exist' }))
    expect(await c.closed).toBe(4401)
  })

  it('refuses to act before authentication', async () => {
    const c = await open()
    c.send({ protocolVersion: 1, connectionId: 'made-up', type: 'pages_sync', sequence: 1, pages: [] })
    await c.closed
    expect(registry.pagesForPairing(PAIRING)).toHaveLength(0)
  })

  it('rejects an oversized pre-auth frame', async () => {
    const c = await open()
    c.send(hello({ browserSessionId: 'x'.repeat(8192) }))
    expect(await c.closed).toBeGreaterThanOrEqual(1000)
    expect(registry.pagesForPairing(PAIRING)).toHaveLength(0)
  })

  it('rejects a frame using the wrong connection ID', async () => {
    const c = await open()
    c.send(hello())
    await c.next('hello_ack')
    c.send({ protocolVersion: 1, connectionId: 'not-mine', type: 'pages_sync', sequence: 1, pages: [] })
    expect(await c.closed).toBe(1008)
  })
})

describe('page and tool publication', () => {
  async function connected() {
    const c = await open()
    c.send(hello())
    const ack = await c.next<{ type: 'hello_ack'; connectionId: string }>('hello_ack')
    return { ...c, connectionId: ack.connectionId }
  }

  it('publishes an enabled page scoped to its pairing', async () => {
    const c = await connected()
    c.send({
      protocolVersion: 1, connectionId: c.connectionId,
      type: 'pages_sync', sequence: 1, pages: [pageDescriptor()],
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(registry.pagesForPairing(PAIRING)).toHaveLength(1)
    expect(registry.pagesForPairing('other')).toHaveLength(0)
    c.socket.close()
  })

  it('closes the connection on a sequence gap', async () => {
    const c = await connected()
    c.send({
      protocolVersion: 1, connectionId: c.connectionId,
      type: 'pages_sync', sequence: 1, pages: [pageDescriptor()],
    })
    await new Promise((r) => setTimeout(r, 20))
    // Skipping sequence 2 means we missed a snapshot; our view may be wrong.
    c.send({
      protocolVersion: 1, connectionId: c.connectionId,
      type: 'pages_sync', sequence: 3, pages: [],
    })
    expect(await c.closed).toBe(1008)
  })

  it('drops the page when the executor disconnects', async () => {
    const c = await connected()
    c.send({
      protocolVersion: 1, connectionId: c.connectionId,
      type: 'pages_sync', sequence: 1, pages: [pageDescriptor()],
    })
    await new Promise((r) => setTimeout(r, 20))
    c.socket.close()
    await new Promise((r) => setTimeout(r, 30))
    expect(registry.pagesForPairing(PAIRING)).toHaveLength(0)
  })

  it('answers a ping with a matching nonce and does not echo a pong', async () => {
    const c = await connected()
    c.send({
      protocolVersion: 1, connectionId: c.connectionId,
      type: 'heartbeat', kind: 'ping', nonce: 'nonce_1',
    })
    const pong = await c.next<{ type: 'heartbeat'; kind: string; nonce: string }>('heartbeat')
    expect(pong.kind).toBe('pong')
    expect(pong.nonce).toBe('nonce_1')

    const before = c.received.length
    c.send({
      protocolVersion: 1, connectionId: c.connectionId,
      type: 'heartbeat', kind: 'pong', nonce: 'nonce_2',
    })
    await new Promise((r) => setTimeout(r, 30))
    expect(c.received.length).toBe(before)
    c.socket.close()
  })
})

describe('legacy journey capture', () => {
  it('still accepts unauthenticated journey traffic', async () => {
    const { getById } = await import('../src/journey-store.js')
    const socket = new WebSocket(url)
    await new Promise<void>((r) => socket.once('open', () => r()))
    socket.send(JSON.stringify({
      type: 'sync', journeyId: 'j1',
      meta: { startTime: Date.now(), startUrl: 'https://x.test/', tabTitle: 'x', domain: 'x.test', status: 'recording' },
      events: [],
    }))
    await new Promise((r) => setTimeout(r, 30))
    expect(getById('j1')).toBeDefined()
    socket.close()
  })
})
