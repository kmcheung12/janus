#!/usr/bin/env node
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { startWsServer, wireQueue } from './ws-server.js'
import { createHttpHandler } from './http-server.js'
import { parseConfig } from './config.js'
import { openCredentialStore } from './credentials.js'
import { runCli } from './cli.js'
import { buildLine } from './build-info.js'
import { setSubmitDeps } from './mcp-tools.js'
import { storeDefinition } from './control/connections.js'
import { LIMITS } from './contracts/limits.js'

const ADMIN_COMMANDS = new Set(['pair', 'revoke', 'client', 'producer', 'list', 'help'])

async function main(): Promise<number | undefined> {
  const argv = process.argv.slice(2)

  // First line of every invocation, admin commands included, so a report of
  // daemon behaviour can always be tied to a build.
  process.stdout.write(`${buildLine('janus-mcp')}\n`)

  if (argv[0] && ADMIN_COMMANDS.has(argv[0])) {
    return runCli(argv)
  }

  const config = parseConfig(argv)
  const credentials = openCredentialStore(config.dataDir)

  wireQueue()
  setSubmitDeps({
    store: (pairingId, draft, definition) =>
      storeDefinition(pairingId, draft, definition, LIMITS.authoringStoreDeadlineMs),
  })
  const wss = startWsServer({ port: config.wsPort, host: config.bind, credentials })
  // address() is null until the socket is actually listening, and the WS URL is
  // now needed up front to hand to the extension during enrolment.
  await new Promise<void>((res) => {
    if (wss.address()) { res(); return }
    wss.once('listening', () => res())
  })
  const wsPort = (wss.address() as AddressInfo).port
  const host = config.bind.includes(':') ? `[${config.bind}]` : config.bind

  const httpServer = createServer(createHttpHandler({
    credentials,
    noAutoPair: config.noAutoPair,
    // Handed to the extension during enrolment so the user never has to know
    // that there are two ports.
    webSocketUrl: `ws://${host}:${wsPort}`,
  }))

  await new Promise<void>((res) => httpServer.listen(config.mcpPort, config.bind, res))
  const mcpPort = (httpServer.address() as AddressInfo).port

  // §20: an explicit readiness record so the harness can discover ephemeral
  // ports without scraping log prose. Never contains credentials.
  console.error(JSON.stringify({
    janus: 'ready',
    mcpSse: `http://${host}:${mcpPort}/sse`,
    mcpStreamable: `http://${host}:${mcpPort}/mcp`,
    webSocket: `ws://${host}:${wsPort}`,
    dataDir: config.dataDir,
  }))

  if (credentials.listExecutors().length === 0) {
    console.error(
      config.noAutoPair
        ? '[janus-mcp] No paired browser. Run: janus-mcp pair --stdin'
        : '[janus-mcp] No browser paired yet. Open the Janus extension and click Pair — it will '
          + 'provision itself, and the agent connect command will be printed here.',
    )
  }

  return undefined
}

main().then(
  (code) => { if (code !== undefined) process.exit(code) },
  (err: Error) => { console.error(`[janus-mcp] ${err.message}`); process.exit(1) },
)
