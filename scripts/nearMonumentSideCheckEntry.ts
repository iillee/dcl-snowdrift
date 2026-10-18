/** nearMonumentSideCheckEntry.ts - near monument side / distance vs the volcano over N seeds. Bundled by nearMonumentSideCheck.mjs. */
import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { TERRAIN_CELL_M, TERRAIN_LEVEL_HIGH, TERRAIN_LEVEL_LOW } from 'src/shared/settings'
import { generateTerrain, nearStationHasHearthLos } from 'src/shared/terrain/terrainGen'
import { LANDFORM_LAVA, LANDFORM_VOLCANO, cellCenterWorld } from 'src/shared/terrain/terrainMap'

const args = (globalThis as unknown as { __SIDE_ARGS: { profile: string; seeds: number } }).__SIDE_ARGS
const g0 = globalThis as { __realLog?: typeof console.log }
g0.__realLog ??= console.log
const real = g0.__realLog
let curPass = ''
let farOnly = 0
console.log = (...a: unknown[]) => {
	const s = String(a[0])
	const m = /near monument pass=(\S+)/.exec(s)
	if (m) curPass = m[1] + (s.includes('(alt') ? '+alt' : '')
	if (s.includes('far-only stations')) farOnly++
}
const passes: Record<string, number> = {}
const dists: number[] = []
const offs: number[] = []
const maxLos: number[] = []
const maxAny: number[] = []
let three = 0, nearOk = 0, losOk = 0, minSep = Infinity
for (let i = 0; i < args.seeds; i++) {
	curPass = ''
	const seed = cycleMazeSeed(1000 + i * 7919)
	const map = generateTerrain(seed)
	if (map.stations.length >= 3) three++
	const s = map.stations.find(st => st.near)
	if (map.volcano) {
		// Feasibility: farthest walkable cell in the ±75° away cone, with and without hearth LOS.
		const v0 = cellCenterWorld(map.volcano.cx, map.volcano.cz)
		const away0 = Math.atan2(v0.z - CAMPFIRE_WORLD_Z, v0.x - CAMPFIRE_WORLD_X) + Math.PI
		let bl = 0, ba = 0
		for (let cz = 2; cz < map.h - 2; cz++) for (let cx = 2; cx < map.w - 2; cx++) {
			const k = cz * map.w + cx
			if (map.routeDist[k] < 0 || map.levels[k] < TERRAIN_LEVEL_LOW || map.levels[k] > TERRAIN_LEVEL_HIGH) continue
			if (map.landforms[k] === LANDFORM_VOLCANO || map.landforms[k] === LANDFORM_LAVA) continue
			const w0 = cellCenterWorld(cx, cz)
			const dd = Math.hypot(w0.x - CAMPFIRE_WORLD_X, w0.z - CAMPFIRE_WORLD_Z)
			let o = Math.abs(Math.atan2(w0.z - CAMPFIRE_WORLD_Z, w0.x - CAMPFIRE_WORLD_X) - away0) % (Math.PI * 2)
			if (o > Math.PI) o = Math.PI * 2 - o
			if (o > 75 * Math.PI / 180) continue
			if (dd > ba) ba = dd
			if (dd > bl && nearStationHasHearthLos(map.levels, cx, cz)) bl = dd
		}
		maxLos.push(bl); maxAny.push(ba)
	}
	if (!s || !map.volcano) { real(`  seed#${i} ${seed}: NO near monument (stations ${map.stations.length})`); continue }
	nearOk++
	passes[curPass] = (passes[curPass] ?? 0) + 1
	const c = cellCenterWorld(s.cx, s.cz)
	const v = cellCenterWorld(map.volcano.cx, map.volcano.cz)
	const d = Math.hypot(c.x - CAMPFIRE_WORLD_X, c.z - CAMPFIRE_WORLD_Z)
	const angS = Math.atan2(c.z - CAMPFIRE_WORLD_Z, c.x - CAMPFIRE_WORLD_X)
	const angAway = Math.atan2(v.z - CAMPFIRE_WORLD_Z, v.x - CAMPFIRE_WORLD_X) + Math.PI
	let off = Math.abs(angS - angAway) % (Math.PI * 2)
	if (off > Math.PI) off = Math.PI * 2 - off
	const offDeg = off * 180 / Math.PI
	dists.push(d); offs.push(offDeg)
	const los = nearStationHasHearthLos(map.levels, s.cx, s.cz)
	if (los) losOk++
	for (let a = 0; a < map.stations.length; a++) for (let b = a + 1; b < map.stations.length; b++) {
		const p = cellCenterWorld(map.stations[a].cx, map.stations[a].cz)
		const q = cellCenterWorld(map.stations[b].cx, map.stations[b].cz)
		minSep = Math.min(minSep, Math.hypot(p.x - q.x, p.z - q.z))
	}
	real(`  seed#${i} ${seed}: near dist ${d.toFixed(0)} m, off-away ${offDeg.toFixed(0)} deg, hearth LOS ${los}, stations ${map.stations.length}, pass ${curPass}`)
}
const q = (a: number[], p: number): string => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))].toFixed(0) : '-' }
const n = args.seeds
real(`[${args.profile}] cell ${TERRAIN_CELL_M} m | seeds ${n} | near placed ${nearOk}/${n} | hearth LOS ${losOk}/${n} | 3 stations ${three}/${n} | far-only logs ${farOnly}`)
real(`  near dist m min/p10/med/p90/max ${q(dists,0)}/${q(dists,0.1)}/${q(dists,0.5)}/${q(dists,0.9)}/${q(dists,0.999)}`)
real(`  off-away deg min/p10/med/p90/max ${q(offs,0)}/${q(offs,0.1)}/${q(offs,0.5)}/${q(offs,0.9)}/${q(offs,0.999)} | <=75: ${offs.filter(o => o <= 75).length} | <=90: ${offs.filter(o => o <= 90).length} | volcano side (>90): ${offs.filter(o => o > 90).length}`)
real(`  feasible (±75° cone, walkable): farthest with hearth LOS min/p10/med/max ${q(maxLos,0)}/${q(maxLos,0.1)}/${q(maxLos,0.5)}/${q(maxLos,0.999)} m | farthest any ${q(maxAny,0)}/${q(maxAny,0.5)}/${q(maxAny,0.999)} m`)
real(`  passes ${JSON.stringify(passes)} | min monument spacing ${minSep.toFixed(0)} m`)
