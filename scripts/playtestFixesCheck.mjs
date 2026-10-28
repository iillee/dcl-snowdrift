// Bundles and runs playtestFixesCheckEntry.ts (one snow republish per join / throttled leaderboard saves / log noise / frost rejection logs).
// Usage: node scripts/playtestFixesCheck.mjs
import { build } from 'esbuild'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'out', 'playtestFixesCheck.bundle.mjs')
await build({ entryPoints: [join(here, 'playtestFixesCheckEntry.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, tsconfig: join(here, '..', 'tsconfig.json'), logLevel: 'warning' })
await import(pathToFileURL(out).href)