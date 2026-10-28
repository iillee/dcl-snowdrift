// Bundles and runs hiddenFireGroundCheckEntry.ts for each world profile.
// Usage: node scripts/hiddenFireGroundCheck.mjs [seedCount=40]
import { build } from 'esbuild'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
globalThis.__HF_SEEDS = Number(process.argv[2] ?? 40)
for (const profile of ['playtest_52', 'full_100', 'compact_3']) {
	const out = join(here, 'out', `hiddenFireGroundCheck.${profile}.bundle.mjs`)
	await build({
		entryPoints: [join(here, 'hiddenFireGroundCheckEntry.ts')],
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
	await import(pathToFileURL(out).href + `?p=${profile}`)
}
if (globalThis.__HF_FAIL) process.exit(1)
