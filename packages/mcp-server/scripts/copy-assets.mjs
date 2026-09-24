// tsc does not emit non-TypeScript files. The contract schema is loaded at
// runtime by src/contracts/validate.ts, so it has to reach dist/ alongside it.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const assets = ['contracts/contracts.schema.json']

for (const asset of assets) {
  const to = resolve(root, 'dist', asset)
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(resolve(root, 'src', asset), to)
  console.log(`[copy-assets] ${asset}`)
}
