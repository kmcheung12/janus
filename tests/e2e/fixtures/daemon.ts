/**
 * §20 daemon fixture.
 *
 * Every worker gets its own daemon on ephemeral ports with its own data
 * directory, so the suite never touches 3456/3457 or the developer's real
 * credentials.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../../..')
const ENTRY = join(ROOT, 'packages/mcp-server/dist/index.js')

export interface DaemonHandle {
  mcpUrl: string
  wsUrl: string
  dataDir: string
  pair(pairingId: string, token: string): Promise<void>
  createClient(pairingId: string, label: string, authoring?: boolean): Promise<string>
  logs(): string
  stop(): Promise<void>
}

interface Readiness {
  janus: 'ready'
  mcpStreamable: string
  webSocket: string
  dataDir: string
}

function runAdmin(args: string[], dataDir: string, stdin?: string): Promise<string> {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [ENTRY, ...args, '--data-dir', dataDir], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (c) => { out += c })
    child.stderr.on('data', (c) => { err += c })
    child.on('close', (code) => (code === 0 ? res(out) : rej(new Error(err || out))))
    if (stdin !== undefined) child.stdin.write(stdin)
    child.stdin.end()
  })
}

export async function startDaemon(): Promise<DaemonHandle> {
  const dataDir = mkdtempSync(join(tmpdir(), 'janus-e2e-'))
  let buffered = ''

  const child: ChildProcess = spawn(
    process.execPath,
    [ENTRY, '--mcp-port', '0', '--ws-port', '0', '--bind', '127.0.0.1', '--data-dir', dataDir],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )

  child.stdout?.on('data', (c) => { buffered += c })

  // The daemon prints a machine-readable readiness record so the harness can
  // discover ephemeral ports without scraping log prose. It never contains
  // credentials.
  const ready = await new Promise<Readiness>((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`Daemon did not become ready:\n${buffered}`)), 20_000)
    child.stderr?.on('data', (chunk: Buffer) => {
      buffered += chunk.toString()
      for (const line of chunk.toString().split('\n')) {
        try {
          const parsed = JSON.parse(line) as Readiness
          if (parsed?.janus === 'ready') { clearTimeout(timer); res(parsed) }
        } catch { /* ordinary log line */ }
      }
    })
    child.on('exit', (code) => { clearTimeout(timer); rej(new Error(`Daemon exited ${code}:\n${buffered}`)) })
  })

  return {
    mcpUrl: ready.mcpStreamable,
    wsUrl: ready.webSocket,
    dataDir,

    async pair(pairingId, token) {
      // Secrets go over stdin, exactly as a user would provision them.
      await runAdmin(['pair', '--stdin'], dataDir, JSON.stringify({ pairingId, token }))
    },

    async createClient(pairingId, label, authoring = false) {
      const out = await runAdmin(
        ['client', 'create', '--pairing-id', pairingId, '--label', label, ...(authoring ? ['--author'] : [])],
        dataDir,
      )
      const match = out.match(/Bearer ([0-9a-f]{64})/)
      if (!match) throw new Error(`No token in client create output:\n${out}`)
      return match[1]
    },

    logs: () => buffered,

    async stop() {
      child.kill('SIGTERM')
      await new Promise((r) => child.once('exit', r))
      rmSync(dataDir, { recursive: true, force: true })
    },
  }
}
