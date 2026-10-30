/**
 * crystalCheck - Floating Crystals sanity: charge-time table for fire
 * setups, per-seed buildable spots inside each obelisk's charge ring
 * (greedy at BUILT_FIRE_MIN_SPACING_M), guaranteed logs per obelisk and
 * the heat-zone held-cell count. Bundled by scripts/crystalCheck.mjs.
 */
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import {
	BUILT_FIRE_MIN_SPACING_M, OBELISK_LINK_RANGE_M, CHARGE_TARGET_S, CRYSTAL_HEAT_RADIUS_M,
	RULESET, chargeRatePerS, validateBuiltFireSpot, chargeHopWeight, chargeRateFromWeight,
} from 'src/shared/ruleset'
import { WORLD_PROFILE, isInsidePlayfield } from 'src/shared/settings'
import { getTerrain, offHearthCellsForMazeSeed } from 'src/shared/terrain/terrainCache'
import { cellCenterWorld } from 'src/shared/terrain/terrainMap'
import { computeWoodScatter, WOOD_BAND_ICED_CLUSTER } from 'src/shared/woodScatter'
import { CHARGE_LINK_END_HALF_M, OBELISK_NODE_ID_BASE } from 'src/shared/ruleset'
import { OBELISK_WIDTH_M, OBELISK_PIT_SIZE_M } from 'src/shared/terrain/terrainMap'
import { NETWORK_CUBE_SPACING_M, routeFireLink } from 'src/shared/fireNetwork'
import { levelAtWorld } from 'src/shared/terrain/terrainMap'
const noRouteWhy: Record<string, number> = {}
let faceMax = -Infinity, faceSum = 0
let linksOk = 0, linksNone = 0, orbsTotal = 0, orbsMaxRing = 0, gapMax = -Infinity, gapSum = 0, intoMax = 0

const SEEDS = Number(process.argv[2] ?? 10)
const g0 = globalThis as { __realLog?: typeof console.log; __crystalTable?: boolean }
g0.__realLog ??= console.log
const say = g0.__realLog
console.log = () => {}

const fmt = (d: number[]) => { const r = chargeRatePerS(d); return r > 0 ? `${(1 / r).toFixed(0)} s` : 'never' }
if (!g0.__crystalTable) {
	g0.__crystalTable = true
	say(`ruleset=${RULESET} linkRange=${OBELISK_LINK_RANGE_M} m target=${CHARGE_TARGET_S} s spacing=${BUILT_FIRE_MIN_SPACING_M} m`)
	const rows: [string, number[]][] = [
		['1 fire @ 20 m', [20]], ['2 fires @ 20 m', [20, 20]],
		['3 fires @ 15 m', [15, 15, 15]], ['3 fires @ 20 m (target)', [20, 20, 20]],
		['3 fires @ 25 m', [25, 25, 25]], ['3 fires @ 35 m', [35, 35, 35]],
		['3 fires @ 15/25/38 m', [15, 25, 38]], ['4 fires @ 20 m', [20, 20, 20, 20]], ['5 fires @ 25 m', [25, 25, 25, 25, 25]],
	]
	for (const [n, d] of rows) say(`  ${n.padEnd(24)} full charge in ${fmt(d)}`)
	// Chain mixes: [hop, dist] per fire (dist only matters at hop 1).
	const chain: [string, [number, number][]][] = [
		['chain 1+h2+h3 (line)', [[1, 20], [2, 0], [3, 0]]], ['chain 1+h2+h2 (fork)', [[1, 20], [2, 0], [2, 0]]],
		['2 direct + 1 h2', [[1, 20], [1, 20], [2, 0]]], ['3 direct + 2 h2', [[1, 20], [1, 20], [1, 20], [2, 0], [2, 0]]],
		['1 direct + 3 h2', [[1, 20], [2, 0], [2, 0], [2, 0]]], ['1 direct + h2 + 2 h3', [[1, 20], [2, 0], [3, 0], [3, 0]]],
	]
	for (const [n, fs] of chain) { const r = chargeRateFromWeight(fs.reduce((s, [h, d]) => s + chargeHopWeight(h, d), 0)); say(`  ${n.padEnd(24)} full charge in ${(1 / r).toFixed(0)} s`) }
}

say(`[${WORLD_PROFILE}] seeds=${SEEDS}`)
let minSpots = Infinity
for (let s = 0; s < SEEDS; s++) {
	const seed = 20000 + s * 7
	const ms   = cycleMazeSeed(seed)
	const map  = getTerrain(ms)
	const wood = computeWoodScatter(seed, offHearthCellsForMazeSeed(ms)).filter((c) => c.band === WOOD_BAND_ICED_CLUSTER)
	const per: string[] = []
	const held = new Set<number>()
	for (const st of map.stations) {
		const m = cellCenterWorld(st.cx, st.cz)
		// Greedy valid spots inside the ring (snow assumed cleared).
		const fires: { x: number; z: number }[] = []
		for (let r = 4; r <= OBELISK_LINK_RANGE_M; r += 2) {
			const steps = Math.max(8, Math.round((2 * Math.PI * r) / 2))
			for (let a = 0; a < steps; a++) {
				const x = m.x + Math.cos((a / steps) * 2 * Math.PI) * r
				const z = m.z + Math.sin((a / steps) * 2 * Math.PI) * r
				if (validateBuiltFireSpot(map, x, z, fires, () => 0, fires.length) === 'ok') fires.push({ x, z })
			}
		}
		const dists = fires.map((f) => Math.hypot(f.x - m.x, f.z - m.z)).sort((a, b) => a - b)
		// Charge links (same maths as stations.ts chargeSystem).
		let ringOrbs = 0
		fires.forEach((f, fi) => {
			const d = Math.hypot(f.x - m.x, f.z - m.z)
			const ux = (f.x - m.x) / d, uz = (f.z - m.z) / d
			const e = Math.min(CHARGE_LINK_END_HALF_M / Math.max(Math.abs(ux), Math.abs(uz)), Math.max(0, d - 1))
			const side = CHARGE_LINK_END_HALF_M
			const ends = [{ x: m.x + ux * e, z: m.z + uz * e }, ...[[side, 0], [-side, 0], [0, side], [0, -side]].map(([dx, dz]) => ({ x: m.x + dx, z: m.z + dz }))
				.sort((p, q) => Math.hypot(p.x - f.x, p.z - f.z) - Math.hypot(q.x - f.x, q.z - f.z))]
			let r = null as ReturnType<typeof routeFireLink>
			for (const en of ends) { r = routeFireLink(map, { id: fi + 1, x: f.x, z: f.z }, { id: OBELISK_NODE_ID_BASE, x: en.x, z: en.z }); if (r) break }
			if (!r) {
				linksNone++
				const lf = levelAtWorld(map, f.x, f.z), le = levelAtWorld(map, m.x + ux * e, m.z + uz * e)
				const rc = routeFireLink(map, { id: fi + 1, x: f.x, z: f.z }, { id: OBELISK_NODE_ID_BASE, x: m.x, z: m.z })
				noRouteWhy[lf === le ? (rc ? 'sameLevel-centreOK' : 'sameLevel-noRoute') : (rc ? 'crossLevel-centreOK' : 'crossLevel')] = (noRouteWhy[lf === le ? (rc ? 'sameLevel-centreOK' : 'sameLevel-noRoute') : (rc ? 'crossLevel-centreOK' : 'crossLevel')] ?? 0) + 1
				return
			}
			linksOk++
			// Obelisk end vs the base square edge (gap > 0 = short of it, < 0 = into it).
			const pts = r.runs.flatMap((q) => q.pts)
			let into = 0
			for (const p of pts) into = Math.max(into, OBELISK_PIT_SIZE_M / 2 - Math.max(Math.abs(p.x - m.x), Math.abs(p.z - m.z)))
			const last = pts[pts.length - 1]
			const gap = Math.max(Math.abs(last.x - m.x), Math.abs(last.z - m.z)) - OBELISK_PIT_SIZE_M / 2
			gapMax = Math.max(gapMax, gap); gapSum += gap; intoMax = Math.max(intoMax, into)
			const faceGap = Math.max(Math.abs(last.x - m.x), Math.abs(last.z - m.z)) - OBELISK_WIDTH_M / 2
			faceMax = Math.max(faceMax, faceGap); faceSum += faceGap
			if (faceGap > 0.6) fail(`obelisk end ${faceGap.toFixed(2)} m from the obelisk face (want <= 0.6)`)
			ringOrbs += Math.round(r.lengthM / NETWORK_CUBE_SPACING_M)
		})
		orbsTotal += ringOrbs
		orbsMaxRing = Math.max(orbsMaxRing, ringOrbs)
		minSpots = Math.min(minSpots, fires.length)
		const logs = wood.filter((c) => Math.hypot(c.worldX - m.x, c.worldZ - m.z) <= 45).length
		per.push(`spots=${fires.length} best3=${fmt(dists.slice(0, 3))} logs<=45m=${logs}`)
		const R = CRYSTAL_HEAT_RADIUS_M
		for (let z = Math.floor(m.z - R); z <= Math.ceil(m.z + R); z++)
			for (let x = Math.floor(m.x - R); x <= Math.ceil(m.x + R); x++) {
				const cx = x + 0.5, cz = z + 0.5
				if ((cx - m.x) ** 2 + (cz - m.z) ** 2 > R * R) continue
				if (!isInsidePlayfield(cx, cz)) continue
				held.add(z * 100000 + x)
			}
	}
	say(`  seed ${seed}: ${per.join(' | ')}  heat-zone held cells=${held.size}`)
}
say(`  min buildable spots in any ring: ${minSpots}`)
say(`  charge links (every spot lit): routed=${linksOk} no-route=${linksNone} orbs total=${orbsTotal} max per ring=${orbsMaxRing} avg per link=${(orbsTotal / Math.max(1, linksOk)).toFixed(1)}`)
say(`  obelisk end gap to obelisk face: avg ${(faceSum / Math.max(1, linksOk)).toFixed(2)} m max ${faceMax.toFixed(2)} m`)
say(`  obelisk end gap to base edge: avg ${(gapSum / Math.max(1, linksOk)).toFixed(2)} m max ${gapMax.toFixed(2)} m | deepest route point inside base ${intoMax.toFixed(2)} m`)
say(`  no-route reasons: ${JSON.stringify(noRouteWhy)}`)
linksOk = linksNone = orbsTotal = orbsMaxRing = 0; gapMax = -Infinity; gapSum = 0; intoMax = 0