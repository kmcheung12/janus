/**
 * §12 pairing and caller authentication.
 *
 * Three separate credential kinds, deliberately non-interchangeable:
 *   executor  — one browser extension, may publish pages and resolve calls
 *   client    — one MCP caller, may discover and invoke; optionally author
 *   producer  — legacy journey capture, may never execute or register pages
 *
 * Tokens are stored as SHA-256 digests. A daemon compromise still leaks
 * nothing replayable, and comparisons are timing-safe. The daemon offers no
 * enrollment endpoint: records arrive through the local admin CLI only, so the
 * first client to connect cannot enroll itself.
 */

import { randomBytes, timingSafeEqual, createHash } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type Role = 'executor' | 'client' | 'producer'

export interface ExecutorRecord {
  pairingId: string
  tokenHash: string
  label: string
  createdAt: number
}

export interface ClientRecord {
  clientId: string
  tokenHash: string
  label: string
  /**
   * Scope: the executor pairings whose enabled pages this client may reach.
   *
   * A list because one person routinely runs more than one browser, and
   * making them configure a second MCP server to see the second browser buys
   * no isolation when both are the same user on the same loopback daemon.
   */
  pairingIds: string[]
  authoring: boolean
  createdAt: number
}

export interface ProducerRecord {
  producerId: string
  tokenHash: string
  label: string
  createdAt: number
}

interface CredentialFile {
  version: 1
  executors: ExecutorRecord[]
  clients: ClientRecord[]
  producers: ProducerRecord[]
}

const EMPTY: CredentialFile = { version: 1, executors: [], clients: [], producers: [] }

export const TOKEN_BYTES = 32 // 256 bits -> 64 lowercase hex characters
export const TOKEN_PATTERN = /^[0-9a-f]{64}$/

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex')
}

export function generateId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Constant-time comparison; both sides are fixed-length hex digests. */
function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  if (left.length !== right.length || left.length === 0) return false
  return timingSafeEqual(left, right)
}

export interface CredentialStore {
  path: string
  verifyExecutor(pairingId: string, token: string): ExecutorRecord | undefined
  verifyClient(token: string): ClientRecord | undefined
  verifyProducer(token: string): ProducerRecord | undefined
  upsertExecutor(pairingId: string, token: string, label: string): ExecutorRecord
  createClient(pairingIds: string[], label: string, authoring: boolean): { record: ClientRecord; token: string }
  createProducer(label: string): { record: ProducerRecord; token: string }
  revokePairing(pairingId: string): { executors: number; clients: number }
  revokeClient(clientId: string): boolean
  listExecutors(): ExecutorRecord[]
  listClients(): ClientRecord[]
}

function readFile(path: string): CredentialFile {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as CredentialFile
    if (parsed?.version !== 1) throw new Error('unsupported credential file version')
    return {
      version: 1,
      executors: parsed.executors ?? [],
      // v1 scoped a client to exactly one pairing. Widening the field rather
      // than the scope: an existing token keeps reaching exactly what it did.
      clients: (parsed.clients ?? []).map((c: ClientRecord & { pairingId?: string }) => (
        c.pairingIds ? c : { ...c, pairingIds: c.pairingId ? [c.pairingId] : [] }
      )),
      producers: parsed.producers ?? [],
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY }
    throw e
  }
}

/** Mutation marker for the cross-process reload above; 0 when absent. */
function mtimeOf(path: string): number {
  try { return statSync(path).mtimeMs } catch { return 0 }
}

function writeFileAtomic(path: string, data: CredentialFile): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
  renameSync(tmp, path)
  chmodSync(path, 0o600)
}

export function openCredentialStore(dataDir: string): CredentialStore {
  const path = join(dataDir, 'credentials.json')
  let state = readFile(path)
  let loadedAt = mtimeOf(path)

  /**
   * The admin CLI is a separate process writing the same file, and the
   * documented flow is to start the daemon *then* provision a browser. Without
   * this, a running daemon would keep rejecting a pairing that was added
   * moments ago and the user would have to restart it.
   */
  const refresh = () => {
    const mtime = mtimeOf(path)
    if (mtime === loadedAt) return
    state = readFile(path)
    loadedAt = mtime
  }

  const save = () => {
    writeFileAtomic(path, state)
    loadedAt = mtimeOf(path)
  }

  return {
    path,

    verifyExecutor(pairingId, token) {
      refresh()
      if (!TOKEN_PATTERN.test(token)) return undefined
      const record = state.executors.find((e) => e.pairingId === pairingId)
      // Hash regardless of whether the record exists, so a missing pairing ID
      // and a wrong token cost the same. §17: failed auth must not reveal
      // whether a pairing ID exists.
      const candidate = hashToken(token)
      if (!record) return undefined
      return digestsMatch(record.tokenHash, candidate) ? record : undefined
    },

    verifyClient(token) {
      refresh()
      if (!TOKEN_PATTERN.test(token)) return undefined
      const candidate = hashToken(token)
      return state.clients.find((c) => digestsMatch(c.tokenHash, candidate))
    },

    verifyProducer(token) {
      refresh()
      if (!TOKEN_PATTERN.test(token)) return undefined
      const candidate = hashToken(token)
      return state.producers.find((p) => digestsMatch(p.tokenHash, candidate))
    },

    upsertExecutor(pairingId, token, label) {
      const record: ExecutorRecord = {
        pairingId,
        tokenHash: hashToken(token),
        label,
        createdAt: Date.now(),
      }
      // Re-pairing replaces the previous token for that pairing ID; the
      // connection layer closes any executor connection still using the old one.
      state.executors = [...state.executors.filter((e) => e.pairingId !== pairingId), record]
      save()
      return record
    },

    createClient(pairingIds, label, authoring) {
      // A bare string is iterable, so it would silently become one "pairing"
      // per character and fail with a nonsense message about a single letter.
      if (typeof pairingIds === 'string') {
        throw new Error('createClient takes a list of pairing IDs, not a string')
      }
      if (!pairingIds.length) throw new Error('A client needs at least one pairing ID')
      for (const pairingId of pairingIds) {
        if (!state.executors.some((e) => e.pairingId === pairingId)) {
          throw new Error(`No paired browser with pairing ID "${pairingId}"`)
        }
      }
      const token = generateToken()
      const record: ClientRecord = {
        clientId: generateId('client'),
        tokenHash: hashToken(token),
        label,
        pairingIds: [...pairingIds],
        authoring,
        createdAt: Date.now(),
      }
      state.clients = [...state.clients, record]
      save()
      return { record, token }
    },

    createProducer(label) {
      const token = generateToken()
      const record: ProducerRecord = {
        producerId: generateId('producer'),
        tokenHash: hashToken(token),
        label,
        createdAt: Date.now(),
      }
      state.producers = [...state.producers, record]
      save()
      return { record, token }
    },

    revokePairing(pairingId) {
      const executors = state.executors.filter((e) => e.pairingId === pairingId).length
      // Narrow every client, then drop the ones left with no scope at all.
      // A client scoped to two browsers must survive losing one; a client
      // scoped only to this browser must not, because it would otherwise hold
      // a credential for pages that can no longer be enabled.
      const narrowed = state.clients.map((c) => ({
        ...c,
        pairingIds: c.pairingIds.filter((id) => id !== pairingId),
      }))
      const clients = narrowed.filter((c) => !c.pairingIds.length).length
      state.executors = state.executors.filter((e) => e.pairingId !== pairingId)
      state.clients = narrowed.filter((c) => c.pairingIds.length)
      save()
      return { executors, clients }
    },

    revokeClient(clientId) {
      const before = state.clients.length
      state.clients = state.clients.filter((c) => c.clientId !== clientId)
      const removed = state.clients.length !== before
      if (removed) save()
      return removed
    },

    listExecutors: () => [...state.executors],
    listClients: () => [...state.clients],
  }
}
