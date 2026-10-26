// Bundles and runs fireShareCheckEntry.ts (pure split math). Usage: node scripts/fireShareCheck.mjs
import { build } from 'esbuild'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'out', 'fireShareCheck.bundle.mjs')
await build({ entryPoints: [join(here, 'fireShareCheckEntry.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, tsconfig: join(here, '..', 'tsconfig.json'), logLevel: 'warning' })
await import(pathToFileURL(out).href)
