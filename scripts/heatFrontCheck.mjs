// Bundles and runs heatFrontCheckEntry.ts. Usage: node scripts/heatFrontCheck.mjs
import { build } from 'esbuild'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'out', 'heatFrontCheck.bundle.mjs')
await build({
	entryPoints: [join(here, 'heatFrontCheckEntry.ts')],
	bundle     : true,
	platform   : 'node',
	format     : 'esm',
	outfile    : out,
	tsconfig   : join(here, '..', 'tsconfig.json'),
	logLevel   : 'warning',
})
await import(pathToFileURL(out).href)