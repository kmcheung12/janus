/**
 * Daemon runtime options (§20 harness requirements).
 *
 * Port 0 asks the OS for an ephemeral port so parallel test workers never
 * collide, and --data-dir keeps each worker's credentials isolated from the
 * developer's real configuration.
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export interface DaemonConfig {
  mcpPort: number
  wsPort: number
  /** Loopback only. §12 requires both listeners to be bound explicitly. */
  bind: string
  dataDir: string
}

export const DEFAULT_MCP_PORT = 3456
export const DEFAULT_WS_PORT = 3457
export const DEFAULT_BIND = '127.0.0.1'

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1'])

export function defaultDataDir(): string {
  return join(homedir(), '.janus')
}

function parsePort(raw: string, flag: string): number {
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`${flag} must be an integer 0-65535 (0 selects an ephemeral port)`)
  }
  return port
}

export function parseConfig(argv: string[]): DaemonConfig {
  const config: DaemonConfig = {
    mcpPort: DEFAULT_MCP_PORT,
    wsPort: DEFAULT_WS_PORT,
    bind: DEFAULT_BIND,
    dataDir: defaultDataDir(),
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      const value = argv[++i]
      if (value === undefined) throw new Error(`${arg} requires a value`)
      return value
    }
    switch (arg) {
      case '--mcp-port': config.mcpPort = parsePort(next(), arg); break
      case '--ws-port': config.wsPort = parsePort(next(), arg); break
      case '--bind': config.bind = next(); break
      case '--data-dir': config.dataDir = resolve(next()); break
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  // Execution makes this daemon a remote-control surface for a logged-in
  // browser session. Binding beyond loopback would expose that to the network,
  // and the bearer-token model explicitly does not defend against that (§12).
  if (!LOOPBACK.has(config.bind)) {
    throw new Error(`--bind must be a loopback address (got "${config.bind}")`)
  }

  return config
}
