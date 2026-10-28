// Bundles and runs compactProfileCheckEntry.ts for each world profile.
// Usage: node scripts/compactProfileCheck.mjs [seedCount]
import { build } from 'esbuild'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
let failed = false
for (const profile of ['playtest_52', 'full_100', 'compact_3']) {
	const out = join(here, 'out', `compactProfileCheck.${profile}.bundle.mjs`)
	await build({
		entryPoints: [join(here, 'compactProfileCheckEntry.ts')],
		bundle     : true,
		platform   : 'node',
		format     : 'esm',
		outfile    : out,
		tsconfig   : join(here, '..', 'tsconfig.json'),
		logLevel   : 'warning',
		plugins    : [{
			name : 'profile',
			setup(b) {
				b.onLoad({ filter: /src[\\/]shared[\\/]settings\.ts$/ }, args => ({
					contents: readFileSync(args.path, 'utf8').replace(
						/export const WORLD_PROFILE: WorldProfile = '[a-z_0-9]+'/,
						`export const WORLD_PROFILE: WorldProfile = '${profile}'`),
					loader: 'ts',
				}))
			},
		}],
	})
	await import(pathToFileURL(out).href)
	if (process.exitCode) failed = true
}
if (failed) process.exitCode = 1
