// Bundles and runs fireNetworkVCheckEntry.ts for each world profile.
// Usage: node scripts/fireNetworkVCheck.mjs [seedCount]
import { build } from 'esbuild'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
for (const profile of ['playtest_52']) {
	const out = join(here, 'out', `fireNetworkVCheck.${profile}.bundle.mjs`)
	await build({
		entryPoints: [join(here, 'fireNetworkVCheckEntry.ts')],
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
	globalThis.__FLOAT_PROFILE = profile
	await import(pathToFileURL(out).href)
}


