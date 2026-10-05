// terrainPreview.mjs — bundle the terrain generator for Node and render
// a contact sheet of seeds to scripts/out/terrain-preview.png.
//
// Usage: node scripts/terrainPreview.mjs [count] [firstRun]
//   count     seeds to render (default 12)
//   firstRun  first cycle seed; layout seed = cycleMazeSeed(run) (default 1)

import { build } from 'esbuild'
import { mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const here    = dirname(fileURLToPath(import.meta.url))
const outDir  = join(here, 'out')
const bundled = join(outDir, 'terrainPreview.bundle.mjs')

mkdirSync(outDir, { recursive: true })

await build({
	entryPoints : [join(here, 'terrainPreviewEntry.ts')],
	bundle      : true,
	platform    : 'node',
	format      : 'esm',
	outfile     : bundled,
	tsconfig    : join(here, '..', 'tsconfig.json'),
	logLevel    : 'warning',
})

await import(pathToFileURL(bundled).href)
