// Bundles and runs expeditionCheckEntry.ts (the NEW EXPEDITION reset: validation, one countdown, initiator-only cancel, deadline sync, reset).
// Usage: node scripts/expeditionCheck.mjs
import { build } from 'esbuild'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'out', 'expeditionCheck.bundle.mjs')
await build({ entryPoints: [join(here, 'expeditionCheckEntry.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, tsconfig: join(here, '..', 'tsconfig.json'), logLevel: 'warning' })
await import(pathToFileURL(out).href)