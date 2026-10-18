// Bundles and runs nearMonumentSideCheckEntry.ts per world profile.
// Usage: node scripts/nearMonumentSideCheck.mjs [seedCount] [profile...]
import { build } from 'esbuild'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const seeds = Number(process.argv[2] ?? 40)
const profiles = process.argv.length > 3 ? process.argv.slice(3) : ['playtest_52', 'full_100']
for (const profile of profiles) {
	const out = join(here, 'out', `nearMonumentSideCheck.${profile}.bundle.mjs`)
	await build({
		entryPoints: [join(here, 'nearMonumentSideCheckEntry.ts')],
		bundle: true, platform: 'node', format: 'esm', outfile: out,
		tsconfig: join(here, '..', 'tsconfig.json'), logLevel: 'warning',
		plugins: [{ name: 'profile', setup(b) {
			b.onLoad({ filter: /src[\\/]shared[\\/]settings\.ts$/ }, args => ({
				contents: readFileSync(args.path, 'utf8').replace(
					/export const WORLD_PROFILE: WorldProfile = '[a-z_0-9]+'/,
					`export const WORLD_PROFILE: WorldProfile = '${profile}'`),
				loader: 'ts' }))
		} }],
	})
	globalThis.__SIDE_ARGS = { profile, seeds }
	await import(pathToFileURL(out).href)
}
