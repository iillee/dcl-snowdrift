// Bundles and runs nearMonumentCheckEntry.ts per world profile (and a no-near baseline for timing).
// Usage: node scripts/nearMonumentCheck.mjs [seedCount]
import { build } from 'esbuild'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const seeds = Number(process.argv[2] ?? 200)
for (const profile of ['playtest_52', 'full_100']) {
	for (const baseline of [false, true]) {
		const out = join(here, 'out', `nearMonumentCheck.${profile}.${baseline ? 'base' : 'near'}.bundle.mjs`)
		await build({
			entryPoints: [join(here, 'nearMonumentCheckEntry.ts')],
			bundle: true, platform: 'node', format: 'esm', outfile: out,
			tsconfig: join(here, '..', 'tsconfig.json'), logLevel: 'warning',
			plugins: [{ name: 'profile', setup(b) {
				b.onLoad({ filter: /src[\\/]shared[\\/]settings\.ts$/ }, args => ({
					contents: readFileSync(args.path, 'utf8').replace(
						/export const WORLD_PROFILE: WorldProfile = '[a-z_0-9]+'/,
						`export const WORLD_PROFILE: WorldProfile = '${profile}'`),
					loader: 'ts' }))
				if (baseline) b.onLoad({ filter: /terrainGen\.ts$/ }, args => ({
					contents: readFileSync(args.path, 'utf8').replace(
						'const near = pickNearStation(', 'const near = null && pickNearStation('),
					loader: 'ts' }))
			} }],
		})
		globalThis.__NEAR_ARGS = { profile, seeds, baseline }
		await import(pathToFileURL(out).href)
	}
}
