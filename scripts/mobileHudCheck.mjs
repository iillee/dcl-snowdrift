// Bundles and runs mobileHudCheckEntry.ts (mobile HUD layout (top row buttons, eye + overview stack, hidden native slots)).
// Usage: node scripts/mobileHudCheck.mjs
import { build } from 'esbuild'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'out', 'mobileHudCheck.bundle.mjs')
await build({ entryPoints: [join(here, 'mobileHudCheckEntry.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, tsconfig: join(here, '..', 'tsconfig.json'), logLevel: 'warning' })
await import(pathToFileURL(out).href)