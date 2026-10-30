// Bundles and runs torchWatchdogCheckEntry.ts (the hand-torch watchdog). Usage: node scripts/torchWatchdogCheck.mjs
import { build } from 'esbuild'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'out', 'torchWatchdogCheck.bundle.mjs')
await build({ entryPoints: [join(here, 'torchWatchdogCheckEntry.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, tsconfig: join(here, '..', 'tsconfig.json'), logLevel: 'warning' })
await import(pathToFileURL(out).href)