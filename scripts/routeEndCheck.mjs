// Bundles and runs routeEndCheckEntry.ts (full_100): trails overshooting their end fire.
import { build } from 'esbuild'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'out', 'routeEndCheck.bundle.mjs')
await build({ entryPoints: [join(here, 'routeEndCheckEntry.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, tsconfig: join(here, '..', 'tsconfig.json'), logLevel: 'warning' })
await import(pathToFileURL(out).href)