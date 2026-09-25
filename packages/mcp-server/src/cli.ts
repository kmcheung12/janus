/**
 * §19 local daemon admin commands.
 *
 *   janus-mcp pair --stdin            provision a browser's pairing payload
 *   janus-mcp revoke <pairingId>      remove a browser and its scoped clients
 *   janus-mcp client create ...       mint one MCP caller token
 *   janus-mcp producer create ...     mint one journey-capture token
 *   janus-mcp list                    show records, never secrets
 *
 * Secrets arrive on stdin and are printed exactly once. Nothing is accepted as
 * a command-line argument, where it would land in shell history and `ps`.
 */

import { inScope, openCredentialStore, TOKEN_PATTERN } from './credentials.js'
import { defaultDataDir } from './config.js'
import { resolve } from 'node:path'

const USAGE = `janus-mcp — local admin

  pair --stdin [--data-dir DIR] [--label NAME]
      Read {"pairingId","token"} JSON from stdin, as copied from the
      extension's Browser connection settings.

  revoke <pairingId> [--data-dir DIR]
      Remove that browser and every MCP client scoped to it.

  revoke all [--data-dir DIR]
      Remove every pairing, client and producer. Start from nothing.

  client create (--pairing-id ID... | --all-browsers) --label NAME [--author]
      Print one bearer token for an MCP caller. Shown once.
      --all-browsers covers every paired browser, including ones paired
      later, so reloading an extension does not invalidate the token.

  client scope <clientId> (--pairing-id ID... | --all-browsers)
      Re-point an existing client at other browsers, keeping its token.
      Use this after re-pairing, when an agent authenticates but sees no
      pages: its scope still names the pairing the browser abandoned.

  producer create --label NAME [--data-dir DIR]
      Print one bearer token for journey capture. No execution rights.

  list [--data-dir DIR]
      Show pairings and clients. Never prints secrets.
`

function readStdin(): Promise<string> {
  return new Promise((res, rej) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => { data += chunk })
    process.stdin.on('end', () => res(data))
    process.stdin.on('error', rej)
  })
}

interface Flags { [key: string]: string | boolean | string[] }

function parseFlags(argv: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = []
  const flags: Flags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) { positional.push(arg); continue }
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) { flags[key] = true; continue }
    // Repeatable: --pairing-id A --pairing-id B scopes one client to both.
    const existing = flags[key]
    if (existing === undefined) flags[key] = next
    else if (Array.isArray(existing)) existing.push(next)
    else if (typeof existing === 'string') flags[key] = [existing, next]
    i++
  }
  return { positional, flags }
}

function dataDirFrom(flags: Flags): string {
  const value = flags['data-dir']
  return typeof value === 'string' ? resolve(value) : defaultDataDir()
}

function requireString(flags: Flags, key: string): string {
  const value = flags[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`--${key} is required`)
  return value.trim()
}

/** For repeatable flags; one occurrence is still a list of one. */
function requireStrings(flags: Flags, key: string): string[] {
  const value = flags[key]
  const list = (Array.isArray(value) ? value : [value])
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean)
  if (!list.length) throw new Error(`--${key} is required`)
  return list
}

export async function runCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  const { positional, flags } = parseFlags(rest)

  if (!command || command === 'help' || flags.help) {
    process.stdout.write(USAGE)
    return command ? 0 : 1
  }

  const store = () => openCredentialStore(dataDirFrom(flags))

  switch (command) {
    case 'pair': {
      if (!flags.stdin) throw new Error('pair requires --stdin; secrets are not accepted as arguments')
      const raw = await readStdin()
      let payload: { pairingId?: unknown; token?: unknown }
      try {
        payload = JSON.parse(raw) as typeof payload
      } catch {
        throw new Error('stdin must be the pairing JSON copied from the extension')
      }
      const pairingId = String(payload.pairingId ?? '')
      const token = String(payload.token ?? '')
      if (!/^[A-Za-z0-9_-]{1,96}$/.test(pairingId)) throw new Error('invalid pairingId')
      if (!TOKEN_PATTERN.test(token)) throw new Error('token must be 64 lowercase hex characters')

      const label = typeof flags.label === 'string' ? flags.label : 'browser'
      const s = store()
      const existed = s.listExecutors().some((e) => e.pairingId === pairingId)
      s.upsertExecutor(pairingId, token, label)

      // Both of these are consequences of pairing that the user cannot see and
      // will otherwise read as "pairing did not work": the extension has
      // already been refused once and has stopped retrying on purpose, and any
      // client scoped to a single pairing still names the one just superseded.
      const stranded = s.listClients().filter((c) => !inScope(c.pairingIds, pairingId))
      process.stdout.write(
        `${existed ? 'Replaced' : 'Paired'} browser ${pairingId} (${label}).\n` +
        `Credentials: ${s.path}\n` +
        (existed ? 'Existing executor connections using the old token will be closed.\n' : '') +
        'If the extension was already refused with this credential it has stopped\n' +
        'retrying; click Retry in its Browser connection settings. A reload or a\n' +
        'service-worker restart reconnects on its own.\n' +
        (stranded.length
          ? `\n${stranded.length} client(s) cannot see this browser and will list no pages:\n`
            + stranded.map((c) => `  janus-mcp client scope ${c.clientId} --all-browsers\n`).join('')
          : ''),
      )
      return 0
    }

    case 'revoke': {
      if (positional[0] === 'all' || flags.all === true) {
        const s = store()
        const { executors, clients, producers } = s.revokeAll()
        // Loud about the consequence, because the recovery is manual: every
        // browser re-pairs and every agent needs a new token.
        process.stdout.write(
          `Revoked everything: ${executors} pairing(s), ${clients} client(s), `
          + `${producers} producer(s).\n`
          + `Every browser must pair again, and every agent needs a new token.\n`,
        )
        return 0
      }

      const pairingId = positional[0]
      if (!pairingId) throw new Error('revoke requires a pairing ID, or "all"')
      const s = store()
      const { executors, clients } = s.revokePairing(pairingId)
      if (!executors) { process.stderr.write(`No pairing "${pairingId}".\n`); return 1 }
      process.stdout.write(`Revoked pairing ${pairingId} and ${clients} scoped client(s).\n`)
      return 0
    }

    case 'client': {
      if (positional[0] === 'scope') {
        const clientId = positional[1]
        if (!clientId) throw new Error('usage: client scope <clientId> (--pairing-id ID... | --all-browsers)')
        const s = store()
        const scope = flags['all-browsers'] === true ? ['*'] : requireStrings(flags, 'pairing-id')
        const record = s.setClientScope(clientId, scope)
        if (!record) { process.stderr.write(`No client "${clientId}".\n`); return 1 }
        process.stdout.write(
          `Client ${record.clientId} (${record.label}) now covers ${record.pairingIds.join(', ')}.\n`
          + 'Its existing token is unchanged.\n',
        )
        return 0
      }

      if (positional[0] !== 'create') {
        throw new Error(
          'usage: client create (--pairing-id ID... | --all-browsers) --label NAME [--author]\n'
          + '   or: client scope <clientId> (--pairing-id ID... | --all-browsers)',
        )
      }
      const s = store()
      const { record, token } = s.createClient(
        flags['all-browsers'] === true ? ['*'] : requireStrings(flags, 'pairing-id'),
        requireString(flags, 'label'),
        flags.author === true,
      )
      process.stdout.write(
        `Client ${record.clientId} (${record.label})${record.authoring ? ' with authoring' : ''}.\n` +
        `Send this header on every MCP request. It is not stored and cannot be shown again:\n\n` +
        `  Authorization: Bearer ${token}\n\n`,
      )
      return 0
    }

    case 'producer': {
      if (positional[0] !== 'create') throw new Error('usage: producer create --label NAME')
      const s = store()
      const { record, token } = s.createProducer(requireString(flags, 'label'))
      process.stdout.write(
        `Producer ${record.producerId} (${record.label}); journey capture only.\n\n  ${token}\n\n`,
      )
      return 0
    }

    case 'list': {
      const s = store()
      const executors = s.listExecutors()
      const clients = s.listClients()
      process.stdout.write(`Credentials: ${s.path}\n\nPairings (${executors.length}):\n`)
      for (const e of executors) {
        process.stdout.write(`  ${e.pairingId}  ${e.label}\n`)
      }
      process.stdout.write(`\nClients (${clients.length}):\n`)
      for (const c of clients) {
        const scope = c.pairingIds.join(', ') || '(no pairing)'
        process.stdout.write(`  ${c.clientId}  ${c.label}  -> ${scope}${c.authoring ? '  [author]' : ''}\n`)
      }
      return 0
    }

    default:
      throw new Error(`Unknown command: ${command}`)
  }
}
