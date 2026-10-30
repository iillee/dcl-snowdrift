/**
 * obeliskCountCheck - floating-crystals obelisk placement per seed:
 * count placed vs OBELISK_COUNT, distance from the hearth (sorted),
 * min pairwise spacing, guaranteed logs per obelisk, heat-zone cells.
 */
import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { CRYSTAL_HEAT_RADIUS_M, OBELISK_COUNT, RULESET } from 'src/shared/ruleset'
import { WORLD_PROFILE, isInsidePlayfield } from 'src/shared/settings'
import { getTerrain, offHearthCellsForMazeSeed } from 'src/shared/terrain/terrainCache'
import { cellCenterWorld } from 'src/shared/terrain/terrainMap'
import { computeWoodScatter, WOOD_BAND_ICED_CLUSTER } from 'src/shared/woodScatter'

const SEEDS = Number(process.argv[2] ?? 12)
const g0 = globalThis as { __realLog?: typeof console.log }
g0.__realLog ??= console.log
const say = g0.__realLog
const pullLog: string[] = []
console.log = (...a: any[]) => { const t = String(a[0]); if (t.includes('near obelisk pull')) pullLog.push(t) }
say(`[${WORLD_PROFILE}] ruleset=${RULESET} want=${OBELISK_COUNT} seeds=${SEEDS}`)
let short = 0, minSepAll = Infinity, nearMin = Infinity, nearMax = 0, maxHeld = 0
for (let s = 0; s < SEEDS; s++) {
	const seed = 20000 + s * 7
	pullLog.length = 0
	const ms = cycleMazeSeed(seed)
	const map = getTerrain(ms)
	const pos = map.stations.map((st) => cellCenterWorld(st.cx, st.cz))
	const d = pos.map((p) => Math.hypot(p.x - CAMPFIRE_WORLD_X, p.z - CAMPFIRE_WORLD_Z))
	let minSep = Infinity
	for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) minSep = Math.min(minSep, Math.hypot(pos[i].x - pos[j].x, pos[i].z - pos[j].z))
	minSepAll = Math.min(minSepAll, minSep)
	const near = Math.min(...d); if (process.env.MONDBG) say('   seed', seed, 'near', near.toFixed(0), 'st0', d[0].toFixed(0), pullLog.join(' | ')); nearMin = Math.min(nearMin, near); nearMax = Math.max(nearMax, near)
	if (pos.length < OBELISK_COUNT) short++
	const wood = computeWoodScatter(seed, offHearthCellsForMazeSeed(ms)).filter((c) => c.band === WOOD_BAND_ICED_CLUSTER)
	const logs = pos.map((p) => wood.filter((c) => Math.hypot(c.worldX - p.x, c.worldZ - p.z) <= 45).length)
	const held = new Set<number>()
	const R = CRYSTAL_HEAT_RADIUS_M
	for (const m of pos) for (let z = Math.floor(m.z - R); z <= Math.ceil(m.z + R); z++) for (let x = Math.floor(m.x - R); x <= Math.ceil(m.x + R); x++) {
		if ((x + 0.5 - m.x) ** 2 + (z + 0.5 - m.z) ** 2 > R * R || !isInsidePlayfield(x + 0.5, z + 0.5)) continue
		held.add(z * 100000 + x)
	}
	maxHeld = Math.max(maxHeld, held.size)
	say(`  seed ${seed}: ${pos.length}/${OBELISK_COUNT} dist m [${d.map((v) => v.toFixed(0)).sort((a, b) => +a - +b).join(' ')}] min spacing ${minSep.toFixed(0)} m logs<=45m [${logs.join(' ')}] held cells ${held.size}`)
}
say(`  seeds short of ${OBELISK_COUNT}: ${short}/${SEEDS} | nearest obelisk ${nearMin.toFixed(0)}-${nearMax.toFixed(0)} m | min spacing any seed ${minSepAll.toFixed(0)} m | max heat-zone held cells ${maxHeld}`)