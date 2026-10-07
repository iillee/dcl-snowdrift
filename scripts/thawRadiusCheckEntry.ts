/** thawRadiusCheckEntry.ts - prints thaw-zone radius + coverage per seed. Bundled by thawRadiusCheck.mjs. */
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { WORLD_PROFILE } from 'src/shared/settings'
import { SNOW_TILES_X, SNOW_TILES_Z, SNOW_TILE_M } from 'src/shared/snowGrid'
import { getTerrain } from 'src/shared/terrain/terrainCache'
import { thawWaveCentre } from 'src/shared/terrain/thawWave'

const g0 = globalThis as { __realLog?: typeof console.log }
g0.__realLog ??= console.log
const real = g0.__realLog
console.log = () => {}
let minR = Infinity, maxR = 0, minCov = 1
for (let i = 0; i < 12; i++) {
	const map = getTerrain(cycleMazeSeed(1000 + i * 7919))
	const c = thawWaveCentre(map)
	let inside = 0
	for (let z = 0; z < SNOW_TILES_Z; z++) for (let x = 0; x < SNOW_TILES_X; x++) {
		if (Math.hypot(x - c.tx, z - c.tz) <= c.radius) inside++
	}
	const cov = inside / (SNOW_TILES_X * SNOW_TILES_Z)
	minR = Math.min(minR, c.radiusM); maxR = Math.max(maxR, c.radiusM); minCov = Math.min(minCov, cov)
}
real(`[${WORLD_PROFILE}] map ${SNOW_TILES_X * SNOW_TILE_M} m: thaw radius ${minR.toFixed(0)}-${maxR.toFixed(0)} m over 12 seeds, min coverage ${(minCov * 100).toFixed(1)}%`)
