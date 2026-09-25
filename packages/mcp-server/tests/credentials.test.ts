import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateToken, hashToken, openCredentialStore, type CredentialStore } from '../src/credentials.js'
import { parseConfig, DEFAULT_MCP_PORT } from '../src/config.js'

let dir: string
let store: CredentialStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'janus-cred-'))
  store = openCredentialStore(dir)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('executor pairing', () => {
  it('verifies a provisioned token and rejects a wrong one', () => {
    const token = generateToken()
    store.upsertExecutor('pair_1', token, 'laptop')
    expect(store.verifyExecutor('pair_1', token)?.label).toBe('laptop')
    expect(store.verifyExecutor('pair_1', generateToken())).toBeUndefined()
  })

  it('rejects a valid token presented under the wrong pairing ID', () => {
    const token = generateToken()
    store.upsertExecutor('pair_1', token, 'laptop')
    expect(store.verifyExecutor('pair_2', token)).toBeUndefined()
  })

  it('rejects malformed tokens without consulting records', () => {
    store.upsertExecutor('pair_1', generateToken(), 'laptop')
    expect(store.verifyExecutor('pair_1', 'short')).toBeUndefined()
    expect(store.verifyExecutor('pair_1', 'A'.repeat(64))).toBeUndefined()
  })

  it('replaces the token on re-pairing', () => {
    const first = generateToken()
    const second = generateToken()
    store.upsertExecutor('pair_1', first, 'laptop')
    store.upsertExecutor('pair_1', second, 'laptop')
    expect(store.verifyExecutor('pair_1', first)).toBeUndefined()
    expect(store.verifyExecutor('pair_1', second)).toBeDefined()
    expect(store.listExecutors()).toHaveLength(1)
  })

  it('never stores the plaintext token', () => {
    const token = generateToken()
    store.upsertExecutor('pair_1', token, 'laptop')
    const onDisk = statSync(store.path)
    expect(onDisk.isFile()).toBe(true)
    const contents = require('node:fs').readFileSync(store.path, 'utf8') as string
    expect(contents).not.toContain(token)
    expect(contents).toContain(hashToken(token))
  })

  it('writes credentials with owner-only permissions', () => {
    store.upsertExecutor('pair_1', generateToken(), 'laptop')
    expect(statSync(store.path).mode & 0o777).toBe(0o600)
  })

  it('persists across reopen', () => {
    const token = generateToken()
    store.upsertExecutor('pair_1', token, 'laptop')
    expect(openCredentialStore(dir).verifyExecutor('pair_1', token)).toBeDefined()
  })
})

describe('client credentials', () => {
  it('cannot be created without a paired browser', () => {
    expect(() => store.createClient(['missing'], 'cli', false)).toThrow(/No paired browser/)
  })

  it('is separate from the executor credential', () => {
    const executorToken = generateToken()
    store.upsertExecutor('pair_1', executorToken, 'laptop')
    const { token: clientToken } = store.createClient(['pair_1'], 'cli', false)

    // An executor token must not authorize MCP calls, and vice versa.
    expect(store.verifyClient(executorToken)).toBeUndefined()
    expect(store.verifyExecutor('pair_1', clientToken)).toBeUndefined()
    expect(store.verifyClient(clientToken)?.label).toBe('cli')
  })

  it('records authoring scope explicitly', () => {
    store.upsertExecutor('pair_1', generateToken(), 'laptop')
    const plain = store.createClient(['pair_1'], 'reader', false)
    const author = store.createClient(['pair_1'], 'writer', true)
    expect(store.verifyClient(plain.token)?.authoring).toBe(false)
    expect(store.verifyClient(author.token)?.authoring).toBe(true)
  })

  it('revoking a pairing revokes its scoped clients', () => {
    store.upsertExecutor('pair_1', generateToken(), 'laptop')
    const { token } = store.createClient(['pair_1'], 'cli', false)
    expect(store.revokePairing('pair_1')).toEqual({ executors: 1, clients: 1 })
    expect(store.verifyClient(token)).toBeUndefined()
  })
})

describe('producer credentials', () => {
  it('cannot be used as a client or executor', () => {
    const { token } = store.createProducer('janus cli')
    expect(store.verifyProducer(token)).toBeDefined()
    expect(store.verifyClient(token)).toBeUndefined()
    expect(store.verifyExecutor('pair_1', token)).toBeUndefined()
  })
})

describe('daemon config', () => {
  it('defaults to loopback and the documented ports', () => {
    const c = parseConfig([])
    expect(c.bind).toBe('127.0.0.1')
    expect(c.mcpPort).toBe(DEFAULT_MCP_PORT)
  })

  it('accepts ephemeral ports for isolated test workers', () => {
    const c = parseConfig(['--mcp-port', '0', '--ws-port', '0'])
    expect(c.mcpPort).toBe(0)
    expect(c.wsPort).toBe(0)
  })

  it('refuses a non-loopback bind address', () => {
    expect(() => parseConfig(['--bind', '0.0.0.0'])).toThrow(/loopback/)
  })

  it('rejects unknown options and bad ports', () => {
    expect(() => parseConfig(['--wat'])).toThrow(/Unknown option/)
    expect(() => parseConfig(['--mcp-port', '99999'])).toThrow(/0-65535/)
  })
})

describe('multi-pairing clients', () => {
  it('reaches pages from every pairing it is scoped to', () => {
    store.upsertExecutor('pair_1', generateToken(), 'firefox')
    store.upsertExecutor('pair_2', generateToken(), 'chrome')

    const { token } = store.createClient(['pair_1', 'pair_2'], 'both browsers', false)
    expect(store.verifyClient(token)!.pairingIds).toEqual(['pair_1', 'pair_2'])
  })

  it('narrows a multi-pairing client when one browser is revoked', () => {
    store.upsertExecutor('pair_1', generateToken(), 'firefox')
    store.upsertExecutor('pair_2', generateToken(), 'chrome')
    const { token } = store.createClient(['pair_1', 'pair_2'], 'both', false)

    const { clients } = store.revokePairing('pair_1')

    // Still usable for the browser it can still reach, so it is not counted
    // as revoked.
    expect(clients).toBe(0)
    expect(store.verifyClient(token)!.pairingIds).toEqual(['pair_2'])
  })

  it('revokes a client left with no pairing at all', () => {
    store.upsertExecutor('pair_1', generateToken(), 'firefox')
    const { token } = store.createClient(['pair_1'], 'one', false)

    const { clients } = store.revokePairing('pair_1')

    // Leaving it live would be a credential for pages that can no longer be
    // enabled, which is what the single-pairing version deleted it to avoid.
    expect(clients).toBe(1)
    expect(store.verifyClient(token)).toBeUndefined()
  })

  it('refuses a string, which would become one pairing per character', () => {
    store.upsertExecutor('pair_1', generateToken(), 'firefox')
    expect(() => (store.createClient as unknown as (
      p: string, l: string, a: boolean,
    ) => unknown)('pair_1', 'cli', false)).toThrow(/list of pairing IDs/)
  })
})
