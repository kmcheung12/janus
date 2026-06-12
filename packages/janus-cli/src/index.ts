#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomBytes } from 'node:crypto'
import { RingBuffer } from './buffer.js'
import { JanusWsClient } from './ws-client.js'

function generateId(): string {
  return randomBytes(3).toString('hex')
}

function parseArgs(argv: string[]): { n: number; cmd: string[]; isPipe: boolean } {
  const args = argv.slice(2)
  let n = 0
  let i = 0
  while (i < args.length) {
    if (args[i] === '-n' && i + 1 < args.length) {
      n = parseInt(args[i + 1], 10)
      if (isNaN(n) || n <= 0) {
        process.stderr.write('janus: -n must be a positive integer\n')
        process.exit(1)
      }
      i += 2
    } else {
      break
    }
  }
  const cmd = args.slice(i)
  const isPipe = cmd.length === 0
  return { n, cmd, isPipe }
}

function makeMeta(title: string, status: 'recording' | 'stopped'): {
  startTime: number; startUrl: string; tabTitle: string; domain: string; status: 'recording' | 'stopped'
} {
  return { startTime: Date.now(), startUrl: '', tabTitle: title, domain: 'cli', status }
}

async function main() {
  const { n, cmd, isPipe } = parseArgs(process.argv)

  const journeyId = generateId()
  const buffer = new RingBuffer<{ id: string; type: 'cli_line'; timestamp: number; line: string; stream: 'stdout' | 'stderr' }>(n)
  let title = isPipe ? '' : cmd.join(' ')
  let startTime = Date.now()
  let status: 'recording' | 'stopped' = 'recording'

  const client = new JanusWsClient(
    'ws://localhost:3457',
    journeyId,
    () => ({ startTime, startUrl: '', tabTitle: title || 'cli', domain: 'cli', status }),
    () => buffer.toArray(),
  )
  client.connect()
  await client.waitForOpen(2000)

  process.stderr.write(`[janus] journey: ${journeyId}\n`)

  function addLine(line: string, stream: 'stdout' | 'stderr') {
    if (!title && isPipe) title = line.slice(0, 40)
    buffer.push({ id: randomBytes(4).toString('hex'), type: 'cli_line', timestamp: Date.now(), line, stream })
    client.sendSync()
  }

  if (isPipe) {
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
    rl.on('line', (line) => {
      process.stdout.write(line + '\n')
      addLine(line, 'stdout')
    })
    rl.on('close', () => {
      status = 'stopped'
      client.sendStopped()
      process.stderr.write(`[janus] journey: ${journeyId}\n`)
    })
    // Set title from first line after 1s fallback
    setTimeout(() => { if (!title) title = 'cli' }, 1000)
  } else {
    if (!cmd[0]) {
      process.stderr.write('janus: no command specified\n')
      process.exit(1)
    }

    const child = spawn(cmd[0], cmd.slice(1), { stdio: ['inherit', 'pipe', 'pipe'] })

    const rlOut = createInterface({ input: child.stdout!, crlfDelay: Infinity })
    rlOut.on('line', (line) => {
      process.stdout.write(line + '\n')
      addLine(line, 'stdout')
    })

    const rlErr = createInterface({ input: child.stderr!, crlfDelay: Infinity })
    rlErr.on('line', (line) => {
      process.stderr.write(line + '\n')
      addLine(line, 'stderr')
    })

    child.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        process.stderr.write(`janus: command not found: ${cmd[0]}\n`)
        process.exit(127)
      }
      process.stderr.write(`janus: ${err.message}\n`)
      process.exit(1)
    })

    child.on('close', (code) => {
      status = 'stopped'
      client.sendStopped()
      process.stderr.write(`[janus] journey: ${journeyId}\n`)
      setTimeout(() => process.exit(code ?? 0), 200)
    })
  }
}

main()
