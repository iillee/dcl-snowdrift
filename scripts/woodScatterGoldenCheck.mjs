// Bundles and runs woodScatterGoldenCheckEntry.ts: the buried / scatter wood and tree layout must not drift. Usage: node scripts/woodScatterGoldenCheck.mjs
import { build } from 'esbuild'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'out', 'woodScatterGoldenCheck.bundle.mjs')
await build({ entryPoints: [join(here, 'woodScatterGoldenCheckEntry.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, tsconfig: join(here, '..', 'tsconfig.json'), logLevel: 'warning' })
await import(pathToFileURL(out).href)