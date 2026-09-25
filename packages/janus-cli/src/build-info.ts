/**
 * The build this CLI came from.
 *
 * Read at runtime rather than inlined: this package is compiled by plain
 * `tsc`, with no bundler to substitute a constant. `scripts/build-stamp.mjs`
 * writes `build-info.json` next to the compiled output during the build.
 */

import { readFileSync } from 'node:fs'

export function buildLine(name: string): string {
  try {
    const raw = readFileSync(new URL('./build-info.json', import.meta.url), 'utf8')
    const { hash, time } = JSON.parse(raw) as { hash: string; time: string }
    return `${name} build ${hash} ${time}`
  } catch {
    return `${name} build unknown`
  }
}
