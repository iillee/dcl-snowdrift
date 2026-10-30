/**
 * obeliskEdgeCheck - obelisk distance to the outer wall (terrainGen
 * outerWallDistanceM) over many seeds: median, min, share within 20 m.
 * Bundled by scripts/obeliskEdgeCheck.mjs.
 */
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { OBELISK_COUNT, OBELISK_EDGE_PREF_M } from 'src/shared/ruleset'
import { WORLD_PROFILE } from 'src/shared/settings'
import { getTerrain } from 'src/shared/terrain/terrainCache'
import { outerWallDistanceM } from 'src/shared/terrain/terrainGen'
import { TERRAIN_GRID_W } from 'src/shared/settings'

const g0 = globalThis as { __realLog?: typeof console.log }
g0.__realLog ??= console.log
const say = g0.__realLog
console.log = () => {}
const SEEDS = Number(process.argv[2] ?? 40)
const all: number[] = []
let short = 0
for (let s = 0; s < SEEDS; s++) {
	const map = getTerrain(cycleMazeSeed(20000 + s * 7))
	const d = outerWallDistanceM(map.levels)
	if (map.stations.length < OBELISK_COUNT) short++
	for (const st of map.stations) all.push(d[st.cz * TERRAIN_GRID_W + st.cx])
}
all.sort((a, b) => a - b)
const med = all[Math.floor(all.length / 2)] ?? 0
const near20 = all.filter((v) => v < 20).length
say(`  [${WORLD_PROFILE}] bias ${OBELISK_EDGE_PREF_M} m | obelisks=${all.length} over ${SEEDS} seeds | wall dist median=${med.toFixed(0)} m min=${(all[0] ?? 0).toFixed(0)} m p10=${(all[Math.floor(all.length * 0.1)] ?? 0).toFixed(0)} m | <20 m: ${near20} (${(100 * near20 / Math.max(1, all.length)).toFixed(0)}%) | short seeds=${short}`)
say(short === 0 ? '  ALL PASS' : `  ${short} seeds short FAIL`)