// Bundles and runs spentFireCheckEntry.ts. Usage: node scripts/spentFireCheck.mjs
import { build } from 'esbuild'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
globalThis.__SRC = {}
for (const f of ['src/server/hiddenCampfire.ts', 'src/client/hiddenCampfire.ts', 'src/client/buildFire.ts', 'src/server/fireNetwork.ts', 'src/server/worldFlame.ts', 'src/server/hearthFuel.ts', 'src/server/stations.ts']) {
	globalThis.__SRC[f] = readFileSync(join(root, f), 'utf8')
}
const out = join(here, 'out', 'spentFireCheck.bundle.mjs')
await build({ entryPoints: [join(here, 'spentFireCheckEntry.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, tsconfig: join(root, 'tsconfig.json'), logLevel: 'warning' })
await import(pathToFileURL(out).href)