#!/usr/bin/env node
/**
 * Identifies the build a running artifact came from.
 *
 * Janus ships four artifacts that are loaded separately and reloaded by hand.
 * Rebuilding one and debugging a stale copy of another is the most common way
 * to waste an afternoon here, and nothing in the running system said which
 * build it was. This is what says it.
 *
 * As a module: `buildStamp()` returns the stamp, for a bundler to inline.
 * As a script: `node scripts/build-stamp.mjs <dir>` writes <dir>/build-info.json,
 * for the plain-tsc packages that have no bundler to inline anything.
 */

import { execSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function git(command) {
  try {
    return execSync(`git ${command}`, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim()
  } catch {
    // No git, no repo, or git not on PATH. A stamp is a convenience; failing
    // the build over it would be worse than saying "unknown".
    return ''
  }
}

export function buildStamp() {
  const hash = git('rev-parse --short HEAD') || 'nogit'
  // Uncommitted changes are the normal state while developing, and the whole
  // point is to tell two builds apart — a bare hash would claim they match.
  const dirty = git('status --porcelain') ? '-dirty' : ''
  return {
    hash: `${hash}${dirty}`,
    time: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  }
}

/** One line, same shape everywhere, so it is greppable across all four. */
export function formatStamp(stamp) {
  return `build ${stamp.hash} ${stamp.time}`
}

const invokedDirectly = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const target = process.argv[2]
  if (!target) {
    process.stderr.write('usage: build-stamp.mjs <output-dir>\n')
    process.exit(1)
  }
  const stamp = buildStamp()
  mkdirSync(target, { recursive: true })
  writeFileSync(resolve(target, 'build-info.json'), `${JSON.stringify(stamp, null, 2)}\n`)

  /*
   * tsc writes 0644 even for a file declared in "bin", so a shebang alone is
   * not enough to run it. This went unnoticed while a package-manager link
   * existed, because linking sets the bit on the target; running dist/index.js
   * directly is what exposes it, and a rebuild would strip it again.
   */
  const entry = resolve(target, 'index.js')
  if (existsSync(entry)) chmodSync(entry, 0o755)

  process.stdout.write(`${formatStamp(stamp)}\n`)
}
