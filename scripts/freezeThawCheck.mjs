// Bundles and runs freezeThawCheckEntry.ts (a frozen player / another player's torch thaw / wake at a living flame).
// Usage: node scripts/freezeThawCheck.mjs
import { build } from 'esbuild'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'out', 'freezeThawCheck.bundle.mjs')
await build({ entryPoints: [join(here, 'freezeThawCheckEntry.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, tsconfig: join(here, '..', 'tsconfig.json'), logLevel: 'warning' })
await import(pathToFileURL(out).href)