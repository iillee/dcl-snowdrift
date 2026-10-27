/**
 * byofCheck.ts - Build Your Own Fire seed sanity check. Per seed: hidden
 * pits (expect 0), frontier wood per band, logs near the frozen monument,
 * and how many points along each hearth->monument line are valid build
 * spots (snow assumed cleared). Bundled by scripts/byofCheck.mjs.
 */
import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { pickHiddenCampfires } from 'src/shared/hiddenCampfire'
import { icedStationIndex } from 'src/shared/monumentIce'
import { RULESET, validateBuiltFireSpot } from 'src/shared/ruleset'
import { WORLD_PROFILE } from 'src/shared/settings'
import { getTerrain, offHearthCellsForMazeSeed } from 'src/shared/terrain/terrainCache'
import { cellCenterWorld } from 'src/shared/terrain/terrainMap'
import {
	computeWoodScatter, WOOD_BAND_FRONTIER_RING, WOOD_BAND_FRONTIER_ROUTE, WOOD_BAND_ICED_CLUSTER,
} from 'src/shared/woodScatter'
import { WOOD_KIND_LOG } from 'src/shared/woodKind'

const SEEDS = Number(process.argv[2] ?? 10)
const g0 = globalThis as { __realLog?: typeof console.log }
g0.__realLog ??= console.log
const say = g0.__realLog
console.log = () => {}

say(`[${WORLD_PROFILE}] ruleset=${RULESET} seeds=${SEEDS}`)
let noIced = 0
for (let s = 0; s < SEEDS; s++) {
	const seed = 20000 + s * 7
	const ms   = cycleMazeSeed(seed)
	const map  = getTerrain(ms)
	const pits = pickHiddenCampfires(seed).length
	const wood = computeWoodScatter(seed, offHearthCellsForMazeSeed(ms))
	const route = wood.filter((c) => c.band === WOOD_BAND_FRONTIER_ROUTE)
	const ring  = wood.filter((c) => c.band === WOOD_BAND_FRONTIER_RING)
	const iced  = wood.filter((c) => c.band === WOOD_BAND_ICED_CLUSTER)
	if (iced.length === 0) noIced++
	const k = icedStationIndex(map)
	let icedDist = -1
	if (k >= 0 && iced.length) {
		const m = cellCenterWorld(map.stations[k].cx, map.stations[k].cz)
		icedDist = Math.hypot(iced[0].worldX - m.x, iced[0].worldZ - m.z)
	}
	// Valid build spots every 8 m along each straight route line.
	const valid: string[] = []
	for (const st of map.stations) {
		const m = cellCenterWorld(st.cx, st.cz)
		const L = Math.hypot(m.x - CAMPFIRE_WORLD_X, m.z - CAMPFIRE_WORLD_Z)
		let ok = 0, n = 0
		for (let d = 16; d < L - 10; d += 8) {
			const t = d / L
			const x = CAMPFIRE_WORLD_X + (m.x - CAMPFIRE_WORLD_X) * t, z = CAMPFIRE_WORLD_Z + (m.z - CAMPFIRE_WORLD_Z) * t
			n++
			if (validateBuiltFireSpot(map, x, z, [], () => 0, 0) === 'ok') ok++
		}
		valid.push(`${ok}/${n}`)
	}
	const logs = (a: typeof wood) => a.filter((c) => c.kind === WOOD_KIND_LOG).length
	say(
		`  seed ${seed}: pits=${pits} route=${route.length}(${logs(route)} logs) ring=${ring.length}(${logs(ring)} logs) ` +
		`iced=${iced.length} @${icedDist.toFixed(0)}m  buildable-along-routes=${valid.join(' ')}`,
	)
}
say(`  seeds with no iced-monument cluster: ${noIced}`)