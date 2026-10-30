// Bundles and runs socketLavaCheckEntry.ts (lava in a released obelisk's socket: geometry, appearance timing, late-join determinism, relight range, wiring).
// Usage: node scripts/socketLavaCheck.mjs
import { build } from 'esbuild'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'out', 'socketLavaCheck.bundle.mjs')
await build({ entryPoints: [join(here, 'socketLavaCheckEntry.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, tsconfig: join(here, '..', 'tsconfig.json'), logLevel: 'warning' })
await import(pathToFileURL(out).href)