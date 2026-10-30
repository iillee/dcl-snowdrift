/**
 * finaleCheck - the floating-crystals ending ("The world begins to thaw", src/shared/finale.ts) per seed, for the ACTIVE profile
 * (3 obelisks in compact_3, 6 in the standard one; scripts/finaleCheck.mjs runs every profile):
 *  - ring topology: deterministic (same layout -> same ring, also from a copied point list and for every start obelisk),
 *    one closed counter-clockwise cycle through every obelisk, no crossing beams, edges through the volcano disc counted;
 *  - timeline: ALL beams in step (same start / progress), connected before the pulse, pulse then title, a late joiner sees every
 *    beam complete, the whole shot fits its cap; beam thickness = the vertical obelisk beam; no thaw corridors left in the module;
 *  - pulse (shared oasis clock): the enlarged oasis of EVERY obelisk grows GRADUALLY (OASIS_FINALE_MELT_S, much slower than the
 *    FINALE_PULSE_S snow melt, no jump for an oasis still melting at the pulse start) from the first oasis to
 *    OASIS_FINALE_RADIUS_M (cells only ever open, never ahead of the front, final set = the ragged disc rule, pit / lava / crown
 *    untouched, every opened mountain cell has a cap), is hydrated identically for a late joiner, never changes the pre-pulse state,
 *    and the vegetation plan for the new ring is deterministic, never touches planned cells and stays under the scaled caps;
 *    entity / piece / snow-cell costs are reported;
 *  - warmth: every released obelisk's warm radius grows with the pulse's snow front to FINALE_WARM_RADIUS_M (covers the enlarged
 *    melted area at all times, pure function of the pulse time = late-join deterministic, crystalHeatAt uses it);
 *  - camera: the static framing pose stays under the ceiling and the shot is finite.
 * Bundled by scripts/finaleCheck.mjs.
 */
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { crystalFloatBottomY } from 'src/shared/crystalFloat'
import {
	FINALE_BEAM_XZ_M, FINALE_PULSE_RADIUS_M, FINALE_PULSE_S, FINALE_SNOW_RADIUS_M, FINALE_START_DELAY_S, FINALE_TITLE, FINALE_BAR_FRAC,
	finaleAvoidZone, finaleBeamProgress, finaleCameraAt, finaleCameraPose, finalePoseOpts, finaleCycleCost,
	FINALE_WARM_RADIUS_M, finaleEdges, finaleOrder, finalePoints, finalePulseRadiusM, finaleTimes, finaleWarmRadiusM,
} from 'src/shared/finale'
import * as finaleModule from 'src/shared/finale'
import {
	OASIS_BAND_M, OASIS_CELL_M, OASIS_FINALE_MELT_S, OASIS_FINALE_RADIUS_M, OASIS_INNER_M, OASIS_JITTER_M, OASIS_RADIUS_M,
	oasisCellExposeMs, oasisClear, oasisHash01, oasisCellIndex, oasisEntries, oasisExcludedLevel, oasisFinalePulseMs, oasisLoweredAt, oasisNoteRelease, oasisRectHasCap,
	oasisRelease, oasisSetFinalePulse, oasisTick,
} from 'src/shared/terrain/oasis'
import {
	VEG_BASE_CELLS, VEG_BUSH, VEG_FIN_SUFFIX, VEG_MAX_BUSHES, VEG_MAX_ROCKS, VEG_MAX_TREES, VEG_ROCK, VEG_TREE, VEG_TREE_TIER_H_M,
	buildVegCells, greedyRects, mergeGrassRects, vegTreeHeightM, VegCell,
} from 'src/shared/terrain/oasisVeg'
import { CRYSTAL_HEAT_RADIUS_M } from 'src/shared/ruleset'
import { OASIS_FINALE_REACH_M } from 'src/shared/terrain/oasis'
import { WORLD_PROFILE, sceneHeightLimitM } from 'src/shared/settings'
import { SNOW_CELL_M } from 'src/shared/snowGrid'
import { titleFit } from 'src/shared/titleFit'
import { readFileSync } from 'node:fs'
import { getTerrain } from 'src/shared/terrain/terrainCache'
import { mergeLevelRects } from 'src/shared/terrain/terrainGen'
import { OBELISK_PIT_SIZE_M, TERRAIN_ORIGIN_M, TerrainMap, groundYAtWorld, isLavaAtWorld, levelAtWorld } from 'src/shared/terrain/terrainMap'

const SEEDS = Number(process.argv[2] ?? 12)
const g0 = globalThis as { __realLog?: typeof console.log }
g0.__realLog ??= console.log
const say = g0.__realLog
console.log = () => {}
let bad = 0
const fail = (m: string): void => { bad++; if (bad <= 40) say('FAIL ' + m) }

const OB_TOTAL_M = 22 // obelisk length (stationMarkers OB_SHAFT_M 14 + 2 * OB_TIP_M 4)
const CAM_CAP_S = 60 // crystalFinale CINE_CAP_S

function snapC(v: number): number { return TERRAIN_ORIGIN_M + Math.floor((v - TERRAIN_ORIGIN_M) / OASIS_CELL_M) * OASIS_CELL_M + OASIS_CELL_M / 2 }
function sameSet(a: Set<string>, b: Set<string>): boolean {
	if (a.size !== b.size) return false
	for (const k of a) if (!b.has(k)) return false
	return true
}

function segDistS(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { d: number; s: number; len: number } {
	const dx = bx - ax, dz = bz - az
	const len = Math.hypot(dx, dz)
	const s = ((px - ax) * dx + (pz - az) * dz) / len
	const sc = Math.max(0, Math.min(len, s))
	return { d: Math.hypot(px - (ax + (dx / len) * sc), pz - (az + (dz / len) * sc)), s, len }
}

let rings = 0, volcanoHits = 0, volcanoHitsUnavoidable = 0, ringLenSum = 0, edgeMax = 0, edgeMin = Infinity
let cellsSum = 0, tilesSum = 0, tilesMax = 0, newTilesSum = 0, newTilesMax = 0
let beamS = 0, cineS = 0, endFits = 0, endPoses = 0
let packs = 0, lowBefore = 0, lowAfter = 0, piecesBefore = 0, piecesAfter = 0, vegCellsBefore = 0, vegCellsAfter = 0
let entBefore = 0, entAfter = 0, entAfterMax = 0, grassRectsBefore = 0, grassRectsAfter = 0, treesBefore = 0, treesAfter = 0, bushesBefore = 0, bushesAfter = 0, rocksBefore = 0, rocksAfter = 0
let collBefore = 0, collAfter = 0, snowNewSum = 0, snowNewMax = 0, snowPerTickMax = 0, oasisEvents = 0, oasisEventsMax = 0
const maxH = sceneHeightLimitM() - 3
for (let s = 0; s < SEEDS; s++) {
	const seed = ((s + 1) * 2654435761) >>> 0
	const map = getTerrain(cycleMazeSeed(seed))
	const pts = finalePoints(map)
	const n = pts.length
	if (n < 3) { fail(`seed ${s}: only ${n} obelisks`); continue }
	const avoid = finaleAvoidZone(map)

	// --- topology ---
	const e0 = finaleEdges(pts, avoid, 0)
	const again = finaleEdges(pts.map((p) => ({ x: p.x, z: p.z })), avoid ? { ...avoid } : null, 0)
	if (JSON.stringify(e0) !== JSON.stringify(again)) fail(`seed ${s}: ring not deterministic`)
	if (e0.length !== n) fail(`seed ${s}: ${e0.length} edges for ${n} obelisks`)
	const outDeg = new Array<number>(n).fill(0), inDeg = new Array<number>(n).fill(0)
	for (const [a, b] of e0) { outDeg[a]++; inDeg[b]++ }
	if (outDeg.some((v) => v !== 1) || inDeg.some((v) => v !== 1)) fail(`seed ${s}: not a ring`)
	const order = finaleOrder(pts, avoid, 0)
	if (order.length !== n || new Set(order).size !== n) fail(`seed ${s}: ring does not visit every obelisk once`)
	for (let k = 0; k < n; k++) if (e0[k][0] !== order[k] || e0[k][1] !== order[(k + 1) % n]) fail(`seed ${s}: edges are not in ring order`)
	let area = 0
	for (const [a, b] of e0) area += pts[a].x * pts[b].z - pts[b].x * pts[a].z
	if (!(area > 0)) fail(`seed ${s}: ring not counter-clockwise (area ${area.toFixed(0)})`)
	const und = (e: Array<[number, number]>): string => e.map(([a, b]) => (a < b ? `${a}-${b}` : `${b}-${a}`)).sort().join(' ')
	for (let first = 0; first < n; first++) {
		const ef = finaleEdges(pts, avoid, first)
		if (ef[0][0] !== first) fail(`seed ${s}: ring from ${first} starts at ${ef[0][0]}`)
		if (und(ef) !== und(e0)) fail(`seed ${s}: ring edge set depends on the start obelisk (${first})`)
	}
	if (finaleCycleCost(order, pts, avoid) >= 1e6) fail(`seed ${s}: ring has crossing beams`)
	let hits = 0
	for (const [a, b] of e0) {
		const len = Math.hypot(pts[b].x - pts[a].x, pts[b].z - pts[a].z)
		ringLenSum += len; edgeMax = Math.max(edgeMax, len); edgeMin = Math.min(edgeMin, len)
		if (avoid && segDistS(avoid.x, avoid.z, pts[a].x, pts[a].z, pts[b].x, pts[b].z).d < avoid.r) hits++
	}
	rings++
	volcanoHits += hits
	if (hits > 0) {
		const free = finaleOrder(pts, null, 0)
		let freeHits = 0
		for (let k = 0; k < n; k++) { const a = free[k], b = free[(k + 1) % n]; if (avoid && segDistS(avoid.x, avoid.z, pts[a].x, pts[a].z, pts[b].x, pts[b].z).d < avoid.r) freeHits++ }
		if (freeHits > 0) volcanoHitsUnavoidable++
	}

	// --- timeline ---
	const times = finaleTimes()
	beamS += times.beamsDoneS; cineS += times.cineEndS
	if (!(times.beamStartS > 0)) fail('no short beat before the beams')
	if (!(times.pulseAtS > times.beamsDoneS)) fail('pulse does not start after the ring is closed')
	if (!(times.textAtS > times.pulseAtS && times.textAtS < times.pulseEndS + 1e-9)) fail('title is not shown while the pulse spreads')
	if (!(times.cineEndS < CAM_CAP_S)) fail(`shot ${times.cineEndS.toFixed(1)} s over the ${CAM_CAP_S} s cap`)
	if (finaleBeamProgress(times, -1) !== 0 || finaleBeamProgress(times, times.beamStartS) !== 0) fail('beams drawn before their start')
	if (finaleBeamProgress(times, times.beamsDoneS) !== 1 || finaleBeamProgress(times, times.cineEndS + 600) !== 1) fail('late joiner does not see the ring complete')
	{ let prev = 0; for (let a = 0; a < times.beamsDoneS + 2; a += 0.05) { const p = finaleBeamProgress(times, a); if (p < prev) fail('beam progress not monotonic'); prev = p } }
	// ALL beams connect simultaneously: one shared progress, the ring is closed (n edges) the moment it reaches 1
	for (let a = 0; a < times.beamsDoneS + 1; a += 0.37) for (let k = 0; k < n; k++) if (finaleBeamProgress(times, a) !== finaleBeamProgress(times, a)) fail('beam progress differs between beams')
	if (finalePulseRadiusM(times, times.pulseAtS - 1) !== 0 || Math.abs(finalePulseRadiusM(times, times.pulseEndS) - FINALE_PULSE_RADIUS_M) > 1e-9) fail('pulse radius endpoints')

	// --- pulse: the shared oasis registry (the same clock on the server and every client) ---
	if (s < 14) {
		const T0 = 1_000_000_000_000
		const pulseT = T0 + 200_000
		oasisClear(); oasisSetFinalePulse(Number.POSITIVE_INFINITY)
		const centres = pts
		const lowered = (): Set<string> => {
			const out = new Set<string>()
			for (const c of centres) for (let z = c.z - 76; z <= c.z + 76; z += OASIS_CELL_M) for (let x = c.x - 76; x <= c.x + 76; x += OASIS_CELL_M) {
				const px = snapC(x), pz = snapC(z)
				if (oasisLoweredAt(map, px, pz)) out.add(px + ',' + pz)
			}
			return out
		}
		for (const c of centres) { oasisNoteRelease(c.x, c.z, T0); oasisRelease(map, c.x, c.z, 0, T0) }
		oasisTick(pulseT - 1000)
		const S0 = lowered()
		const rects = mergeLevelRects(map)
		const pieces = (): number => {
			let nPieces = 0
			for (const r of rects) {
				const x0 = TERRAIN_ORIGIN_M + r.cx * 16, x1 = x0 + r.w * 16, z0 = TERRAIN_ORIGIN_M + r.cz * 16, z1 = z0 + r.h * 16
				if (oasisExcludedLevel(levelAtWorld(map, x0 + 1, z0 + 1))) continue
				let near = false
				for (const c of centres) { const dx = Math.max(x0 - c.x, 0, c.x - x1), dz = Math.max(z0 - c.z, 0, c.z - z1); if (Math.hypot(dx, dz) <= OASIS_FINALE_RADIUS_M + OASIS_JITTER_M + OASIS_CELL_M) { near = true; break } }
				if (!near) continue
				const nx = Math.round((x1 - x0) / OASIS_CELL_M), nz = Math.round((z1 - z0) / OASIS_CELL_M)
				const mask = new Uint8Array(nx * nz)
				let any = false
				for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) { const low = oasisLoweredAt(map, x0 + (ix + 0.5) * OASIS_CELL_M, z0 + (iz + 0.5) * OASIS_CELL_M); mask[iz * nx + ix] = low ? 2 : 1; if (low) any = true }
				if (any) nPieces += greedyRects(mask, nx, nz).length
			}
			return nPieces
		}
		piecesBefore += pieces(); lowBefore += S0.size
		// vegetation of the first oases (no pulse scheduled yet)
		const base = buildVegCells(map, oasisEntries(), new Set<number>())
		const known = new Set(base.map((c) => c.key))
		const count = (cells: VegCell[]): { rects: number; trees: number; bushes: number; rocks: number; ent: number; coll: number } => {
			const groups = new Map<string, VegCell[]>()
			for (const c of cells) { let a = groups.get(c.ownerKey); if (!a) { a = []; groups.set(c.ownerKey, a) } a.push(c) }
			let rectsN = 0, trees = 0, bushes = 0, rocks = 0, ent = 0
			for (const g of groups.values()) rectsN += mergeGrassRects(g).length
			for (const c of cells) for (const it of c.items) {
				if (it.kind === VEG_TREE) { trees++; ent += vegTreeHeightM(it) >= VEG_TREE_TIER_H_M ? 3 : 2 } else if (it.kind === VEG_BUSH) { bushes++; ent++ } else { rocks++; ent++ }
			}
			return { rects: rectsN, trees, bushes, rocks, ent: ent + rectsN, coll: trees + rocks }
		}
		const cb = count(base)
		vegCellsBefore += base.length; grassRectsBefore += cb.rects; treesBefore += cb.trees; bushesBefore += cb.bushes; rocksBefore += cb.rocks; entBefore += cb.ent; collBefore += cb.coll

		// schedule the pulse: nothing changes until it starts
		oasisSetFinalePulse(pulseT)
		if (oasisFinalePulseMs() !== pulseT) fail('pulse time not stored')
		if (!sameSet(lowered(), S0)) fail(`seed ${s}: scheduling the pulse changed the ground before it starts`)
		const stepsAt = new Map<number, Set<string>>()
		let prev = S0, events = 0
		// all oases finished their first melt long before the pulse (released at T0): the front runs OASIS_RADIUS_M -> OASIS_FINALE_RADIUS_M over OASIS_FINALE_MELT_S
		const rq = (tt: number): number => Math.min(OASIS_FINALE_RADIUS_M, Math.floor((OASIS_RADIUS_M + ((OASIS_FINALE_RADIUS_M - OASIS_RADIUS_M) * tt) / OASIS_FINALE_MELT_S) / OASIS_BAND_M) * OASIS_BAND_M)
		const lowCount: Array<[number, number]> = []
		for (let tt = 0; tt <= OASIS_FINALE_MELT_S + 1; tt += 0.5) {
			oasisTick(pulseT + tt * 1000 + 1)
			const now = lowered()
			if (now.size !== prev.size) events++
			for (const k of prev) if (!now.has(k)) { fail(`seed ${s}: cell ${k} un-lowered at pulse t=${tt}`); break }
			const front = rq(tt)
			for (const k of now) {
				if (prev.has(k) || S0.has(k)) continue
				const [px, pz] = k.split(',').map(Number)
				let dmin = Infinity
				for (const c of centres) dmin = Math.min(dmin, Math.hypot(px - c.x, pz - c.z))
				if (dmin > front + OASIS_JITTER_M + 1e-6) { fail(`seed ${s}: cell ${k} d=${dmin.toFixed(1)} opened ahead of the pulse front ${front} at t=${tt}`); break }
			}
			if (Math.abs(tt - Math.round(tt / 10) * 10) < 1e-9 || tt >= OASIS_FINALE_MELT_S) stepsAt.set(tt, now)
			lowCount.push([tt, now.size - S0.size])
			// warmth covers the ground that is already open (cell centre inside the obelisk's warm radius)
			const warmR = finaleWarmRadiusM(pulseT, pulseT + tt * 1000 + 1)
			for (const k of now) {
				if (S0.has(k)) continue
				const [px, pz] = k.split(',').map(Number)
				let dmin = Infinity
				for (const c of centres) dmin = Math.min(dmin, Math.hypot(px - c.x, pz - c.z))
				if (dmin > warmR + 1e-6) { fail(`seed ${s}: opened cell ${k} d=${dmin.toFixed(1)} outside the warm radius ${warmR.toFixed(1)} at t=${tt}`); break }
			}
			prev = now
		}
		// GRADUAL: when the 12 s snow melt is done only a small part of the new ring has opened; the whole ring needs ~OASIS_FINALE_MELT_S
		{
			const total = lowCount[lowCount.length - 1][1]
			const at12 = lowCount.find(([tt]) => tt >= FINALE_PULSE_S)![1]
			const at30 = lowCount.find(([tt]) => tt >= OASIS_FINALE_MELT_S / 2)![1]
			const at0 = lowCount[0][1]
			if (at0 !== 0) fail(`seed ${s}: ${at0} new cells open at the instant the pulse starts`)
			if (!(total > 0 && at12 < total * 0.35)) fail(`seed ${s}: ground not gradual: ${at12}/${total} new cells open after ${FINALE_PULSE_S} s`)
			if (!(at30 > total * 0.2 && at30 < total * 0.8)) fail(`seed ${s}: ground not gradual: ${at30}/${total} new cells open at half time`)
			if (!(OASIS_FINALE_MELT_S >= 40 && OASIS_FINALE_MELT_S >= 3 * FINALE_PULSE_S)) fail('ground (permafrost) melt is not much slower than the snow melt')
		}
		oasisEvents += events; oasisEventsMax = Math.max(oasisEventsMax, events)
		const fin = prev
		lowAfter += fin.size; piecesAfter += pieces()
		// final set = the ragged-disc rule, union over the obelisks
		const want = (px: number, pz: number): boolean => {
			for (const c of centres) {
				const d = Math.hypot(px - c.x, pz - c.z)
				if (Math.abs(px - c.x) < OBELISK_PIT_SIZE_M / 2 && Math.abs(pz - c.z) < OBELISK_PIT_SIZE_M / 2) continue
				if (oasisExcludedLevel(levelAtWorld(map, px, pz)) || isLavaAtWorld(map, px, pz)) continue
				if (d <= OASIS_INNER_M) return true
				const jit = (oasisHash01(oasisCellIndex(px), oasisCellIndex(pz), Math.round(c.x * 4), Math.round(c.z * 4)) - 0.5) * 2 * OASIS_JITTER_M
				if (d - jit <= OASIS_FINALE_RADIUS_M) return true
			}
			return false
		}
		let wrong = 0, beyondOld = 0
		for (const c of centres) for (let z = c.z - 78; z <= c.z + 78; z += OASIS_CELL_M) for (let x = c.x - 78; x <= c.x + 78; x += OASIS_CELL_M) {
			const px = snapC(x), pz = snapC(z)
			if (want(px, pz) !== fin.has(px + ',' + pz)) wrong++
			if (fin.has(px + ',' + pz) && !S0.has(px + ',' + pz)) beyondOld++
		}
		if (wrong > 0) fail(`seed ${s}: ${wrong} cells differ from the ragged finale-disc rule`)
		if (!(fin.size > S0.size * 2)) fail(`seed ${s}: the pulse barely enlarged the oases (${S0.size} -> ${fin.size} cells)`)
		for (const r of rects) {
			if (oasisRectHasCap(map, levelAtWorld(map, TERRAIN_ORIGIN_M + r.cx * 16 + 1, TERRAIN_ORIGIN_M + r.cz * 16 + 1), TERRAIN_ORIGIN_M + (r.cx + r.w / 2) * 16, TERRAIN_ORIGIN_M + (r.cz + r.h / 2) * 16, r.w * 16, r.h * 16)) continue
			const x0 = TERRAIN_ORIGIN_M + r.cx * 16, z0 = TERRAIN_ORIGIN_M + r.cz * 16
			for (let z = z0 + 2; z < z0 + r.h * 16; z += OASIS_CELL_M) for (let x = x0 + 2; x < x0 + r.w * 16; x += OASIS_CELL_M) if (fin.has(snapC(x) + ',' + snapC(z))) { fail(`seed ${s}: a lowered cell sits in an uncapped rect`); break }
		}
		// exposure clock agrees with the lowered state while the pulse spreads
		for (const [tt, set] of stepsAt) {
			const nowMs = pulseT + tt * 1000 + 1
			let bad1 = 0
			for (const c of centres) for (let z = c.z - 76; z <= c.z + 76; z += OASIS_CELL_M * 3) for (let x = c.x - 76; x <= c.x + 76; x += OASIS_CELL_M * 3) {
				const px = snapC(x), pz = snapC(z)
				const ms = oasisCellExposeMs(map, px, pz)
				const isLow = set.has(px + ',' + pz)
				if (ms === Number.POSITIVE_INFINITY ? isLow : (ms <= nowMs) !== isLow) bad1++
			}
			if (bad1 > 0) fail(`seed ${s}: ${bad1} cells where the exposure clock disagrees with the lowered state at pulse t=${tt}`)
		}
		// late joiner: hydrated at any time during / after the pulse = the live state at that time
		for (const [tt, set] of stepsAt) {
			oasisClear()
			for (const c of centres) { oasisNoteRelease(c.x, c.z, T0); oasisRelease(map, c.x, c.z, Number.POSITIVE_INFINITY, pulseT + tt * 1000 + 1) }
			if (!sameSet(lowered(), set)) fail(`seed ${s}: late joiner at pulse t=${tt} differs from the live state`)
		}
		// vegetation of the new ring (planned once the pulse is scheduled): deterministic, new cells only, scaled caps
		oasisClear()
		for (const c of centres) { oasisNoteRelease(c.x, c.z, T0); oasisRelease(map, c.x, c.z, 0, T0) }
		oasisTick(pulseT - 1000)
		const ringCells = buildVegCells(map, oasisEntries(), known)
		const ringCells2 = buildVegCells(map, oasisEntries(), known)
		if (JSON.stringify(ringCells) !== JSON.stringify(ringCells2)) fail(`seed ${s}: finale vegetation plan not deterministic`)
		{
			const maxMs = Math.max(...ringCells.map((c) => c.exposeMs))
			if (!(maxMs <= pulseT + OASIS_FINALE_MELT_S * 1000 + 1e-6 && maxMs >= pulseT + OASIS_FINALE_MELT_S * 1000 * 0.8)) fail(`seed ${s}: finale vegetation cells open over ${((maxMs - pulseT) / 1000).toFixed(0)} s, not ~${OASIS_FINALE_MELT_S} s`)
			const early = ringCells.filter((c) => c.exposeMs <= pulseT + FINALE_PULSE_S * 1000).length
			if (!(early < ringCells.length * 0.3)) fail(`seed ${s}: ${early}/${ringCells.length} finale vegetation cells open within the snow melt time (not gradual)`)
			const lateGrass = ringCells.filter((c) => Number.isFinite(c.grassMs) && c.grassMs > c.exposeMs).length
			if (lateGrass === 0) fail(`seed ${s}: no finale grass grows in after its cell opens`)
		}
		for (const c of ringCells) {
			if (known.has(c.key)) fail(`seed ${s}: finale plan re-plans a known cell`)
			if (!c.ownerKey.endsWith(VEG_FIN_SUFFIX)) fail(`seed ${s}: finale cell not in a #f group`)
			if (!(c.exposeMs >= pulseT)) fail(`seed ${s}: finale cell exposed before the pulse (${c.exposeMs - pulseT} ms)`)
			for (const it of c.items) if (!(it.startMs >= c.exposeMs)) fail(`seed ${s}: finale item starts before its cell is exposed`)
		}
		const byGroup = new Map<string, { cells: number; k: [number, number, number] }>()
		for (const c of ringCells) { let g = byGroup.get(c.ownerKey); if (!g) { g = { cells: 0, k: [0, 0, 0] }; byGroup.set(c.ownerKey, g) } g.cells++; for (const it of c.items) g.k[it.kind]++ }
		for (const [key, g] of byGroup) {
			const sc = Math.max(1, g.cells / VEG_BASE_CELLS)
			if (g.k[VEG_TREE] > Math.ceil(VEG_MAX_TREES * sc) || g.k[VEG_BUSH] > Math.ceil(VEG_MAX_BUSHES * sc) || g.k[VEG_ROCK] > Math.ceil(VEG_MAX_ROCKS * sc)) fail(`seed ${s}: ${key} over the scaled caps`)
		}
		const ca = count([...base, ...ringCells])
		vegCellsAfter += base.length + ringCells.length; grassRectsAfter += ca.rects; treesAfter += ca.trees; bushesAfter += ca.bushes; rocksAfter += ca.rocks; entAfter += ca.ent; entAfterMax = Math.max(entAfterMax, ca.ent); collAfter += ca.coll
		// snow: the 1 m cells the pulse melts (disc FINALE_SNOW_RADIUS_M) that the 50 m crystal discs did not already
		let snowNew = 0
		const seen = new Set<number>()
		for (const c of centres) for (let z = Math.floor(c.z - FINALE_SNOW_RADIUS_M); z <= c.z + FINALE_SNOW_RADIUS_M; z += SNOW_CELL_M) for (let x = Math.floor(c.x - FINALE_SNOW_RADIUS_M); x <= c.x + FINALE_SNOW_RADIUS_M; x += SNOW_CELL_M) {
			const key = Math.round(x) * 100003 + Math.round(z)
			if (seen.has(key)) continue
			let dMin = Infinity
			for (const q of centres) dMin = Math.min(dMin, Math.hypot(x + 0.5 - q.x, z + 0.5 - q.z))
			if (dMin <= FINALE_SNOW_RADIUS_M) { seen.add(key); if (dMin > CRYSTAL_HEAT_RADIUS_M) snowNew++ }
		}
		snowNewSum += snowNew; snowNewMax = Math.max(snowNewMax, snowNew)
		snowPerTickMax = Math.max(snowPerTickMax, Math.ceil(snowNew / (FINALE_PULSE_S * 8)))
		packs++
		oasisClear()
	}

	// --- last obelisk still melting when the pulse starts: continuous, then gradual; late joiner agrees ---
	if (s < 14) {
		const T0 = 1_000_000_000_000
		const pulseT = T0 + 200_000
		const T1 = pulseT - 19_000 // the last release, FINALE_START_DELAY_S + beams + gap before the pulse
		oasisClear(); oasisSetFinalePulse(Number.POSITIVE_INFINITY)
		const centres = pts
		const lowered = (): Set<string> => {
			const out = new Set<string>()
			for (const c of centres) for (let z = c.z - 76; z <= c.z + 76; z += OASIS_CELL_M) for (let x = c.x - 76; x <= c.x + 76; x += OASIS_CELL_M) { const px = snapC(x), pz = snapC(z); if (oasisLoweredAt(map, px, pz)) out.add(px + ',' + pz) }
			return out
		}
		const rel = (tms: number, last: number): void => { for (let i = 0; i < centres.length; i++) { const t0 = i === centres.length - 1 ? last : T0; oasisNoteRelease(centres[i].x, centres[i].z, t0); oasisRelease(map, centres[i].x, centres[i].z, 0, tms) } }
		rel(T0, T1)
		oasisSetFinalePulse(pulseT)
		oasisTick(pulseT - 1)
		const before = lowered()
		oasisTick(pulseT + 1)
		const justAfter = lowered()
		let added = 0
		for (const k of justAfter) if (!before.has(k)) added++
		for (const k of before) if (!justAfter.has(k)) fail(`seed ${s}: cell un-lowered at the pulse start (still-melting oasis)`)
		// within 1 ms the front moves by far less than one ring: no jump of a whole ring (a ring is ~2 pi r / 4 m cells per oasis)
		if (added > n * 6) fail(`seed ${s}: ${added} cells opened in 2 ms at the pulse start (jump for the oasis still melting)`)
		let prevSet = justAfter
		const steps = new Map<number, Set<string>>()
		for (let tt = 0.5; tt <= OASIS_FINALE_MELT_S + 1; tt += 0.5) {
			oasisTick(pulseT + tt * 1000 + 1)
			const now = lowered()
			for (const k of prevSet) if (!now.has(k)) { fail(`seed ${s}: cell un-lowered at pulse t=${tt} (still-melting oasis)`); break }
			if (Math.abs(tt - Math.round(tt / 10) * 10) < 1e-9 || tt >= OASIS_FINALE_MELT_S) steps.set(tt, now)
			prevSet = now
		}
		for (const [tt, set] of steps) {
			oasisClear()
			rel(pulseT + tt * 1000 + 1, T1)
			if (!sameSet(lowered(), set)) fail(`seed ${s}: late joiner at pulse t=${tt} differs from the live state (still-melting oasis)`)
		}
		const lastC = centres[centres.length - 1]
		let farthest = 0
		for (const k of prevSet) { const [px, pz] = k.split(',').map(Number); farthest = Math.max(farthest, Math.hypot(px - lastC.x, pz - lastC.z)) }
		if (!(farthest > OASIS_RADIUS_M + OASIS_BAND_M)) fail(`seed ${s}: the last (still-melting) oasis did not reach the finale radius (farthest ${farthest.toFixed(0)} m)`)
		oasisClear(); oasisSetFinalePulse(Number.POSITIVE_INFINITY)
	}

	// --- warmth: the obelisks' warm radius grows with the pulse (pure function of the pulse time) ---
	{
		const P = 5_000_000
		if (finaleWarmRadiusM(Number.POSITIVE_INFINITY, P) !== CRYSTAL_HEAT_RADIUS_M) fail('warm radius changes without a pulse')
		if (finaleWarmRadiusM(P, P - 1000) !== CRYSTAL_HEAT_RADIUS_M || finaleWarmRadiusM(P, P) !== CRYSTAL_HEAT_RADIUS_M) fail('warm radius changes before the pulse starts')
		let prevR = CRYSTAL_HEAT_RADIUS_M
		for (let ms = 0; ms <= (FINALE_PULSE_S + 3) * 1000; ms += 250) {
			const r = finaleWarmRadiusM(P, P + ms)
			if (r < prevR - 1e-9) fail('warm radius shrinks during the pulse')
			if (r !== finaleWarmRadiusM(P, P + ms)) fail('warm radius not deterministic')
			// never behind the snow front that melts with the pulse (0 -> FINALE_SNOW_RADIUS_M over FINALE_PULSE_S is the farthest the front can be)
			if (r + 1e-9 < Math.min(FINALE_SNOW_RADIUS_M, CRYSTAL_HEAT_RADIUS_M + ((FINALE_SNOW_RADIUS_M - CRYSTAL_HEAT_RADIUS_M) * ms) / (FINALE_PULSE_S * 1000))) fail('warm radius behind the snow front')
			prevR = r
		}
		if (Math.abs(finaleWarmRadiusM(P, P + FINALE_PULSE_S * 1000) - FINALE_WARM_RADIUS_M) > 1e-9) fail('warm radius does not reach its final value with the pulse')
		if (!(FINALE_WARM_RADIUS_M >= OASIS_FINALE_REACH_M && FINALE_WARM_RADIUS_M >= OASIS_FINALE_RADIUS_M)) fail(`final warm radius ${FINALE_WARM_RADIUS_M} m does not cover the enlarged melted area (${OASIS_FINALE_REACH_M} m)`)
		if (finaleWarmRadiusM(P, P + 10_000_000) !== FINALE_WARM_RADIUS_M) fail('warm radius does not stay at its final value')
	}

	// --- camera (one steady framing pose) ---
	const floatY = crystalFloatBottomY(map)
	const tipY = floatY + OB_TOTAL_M - 0.4
	const tips = pts.map((p) => ({ x: p.x, y: tipY, z: p.z }))
	const grounds = pts.map((p) => ({ x: p.x, y: groundYAtWorld(map, p.x, p.z), z: p.z }))
	const look = { x: tips.reduce((a, p) => a + p.x, 0) / n, y: grounds.reduce((a, p) => a + p.y, 0) / n, z: tips.reduce((a, p) => a + p.z, 0) / n }
	for (const aspect of [1.0, 16 / 9, 2.4]) {
		const wide = finaleCameraPose([...tips, ...grounds], look, aspect, maxH, finalePoseOpts())
		endPoses++
		if (wide.fits) endFits++
		if (wide.cam.y > maxH + 1e-6) fail(`seed ${s} aspect ${aspect.toFixed(2)}: camera ${wide.cam.y.toFixed(0)} m above the ceiling ${maxH.toFixed(0)}`)
		for (let a = 0; a <= times.cineEndS; a += 0.5) {
			const c = finaleCameraAt(times, a, wide)
			const vals = [c.pos.x, c.pos.y, c.pos.z, c.look.x, c.look.y, c.look.z]
			if (vals.some((v) => !Number.isFinite(v))) { fail(`seed ${s}: camera not finite at ${a.toFixed(2)} s`); break }
			if (c.pos.y > maxH + 1e-6) { fail(`seed ${s}: camera above the ceiling at ${a.toFixed(2)} s`); break }
		}
	}
}

// --- module-level facts ---
if (FINALE_TITLE !== 'THE WORLD BEGINS TO THAW') fail(`FINALE_TITLE is "${FINALE_TITLE}"`)
for (const k of Object.keys(finaleModule)) if (/orridor|thaw(Begin|End|Start|Dur)|TravelS|RingPoint/i.test(k)) fail(`finale module still exports the old ${k}`)
{
	const src = readFileSync('src/client/stationMarkers.ts', 'utf8')
	if (!/const SKY_BEAM_XZ_M = FINALE_BEAM_XZ_M/.test(src)) fail('the vertical obelisk beam thickness is not the finale beam thickness')
	const fsrc = readFileSync('src/client/crystalFinale.ts', 'utf8')
	if (!/paintFinaleBeam\(e\)/.test(fsrc) || !/FINALE_BEAM_XZ_M/.test(fsrc)) fail('finale beams are not built with the shared thickness + obelisk beam material')
	if (!/finaleWarmRadiusM\(oasisFinalePulseMs\(\), Date\.now\(\)\)/.test(src) || !/Math\.sqrt\(d2\) \/ warmR/.test(src)) fail('crystalHeatAt (warmth / frost safety) does not use the pulse-grown warm radius')
	if (FINALE_BEAM_XZ_M !== 0.42) fail(`finale beam thickness ${FINALE_BEAM_XZ_M} (the sky beam is 0.42)`)
}
{
	const fits: string[] = []
	for (const w of [360, 390, 430, 540, 720, 1080, 1600, 1920]) {
		const f = titleFit(FINALE_TITLE, w, 96)
		const longest = Math.max(...f.lines.map((l) => l.length))
		if (f.lines.length > 2) fail(`title takes ${f.lines.length} lines at ${w} px`)
		if (f.lines.join(' ') !== FINALE_TITLE) fail(`title split loses text at ${w} px`)
		if (longest * 0.7 * f.fontPx > 0.9 * w + 1e-6) fail(`title does not fit ${w} px wide (${f.lines.join(' / ')} @ ${f.fontPx.toFixed(0)} px)`)
		fits.push(`${w}px:${f.lines.length}L@${f.fontPx.toFixed(0)}`)
	}
	say(`  title "${FINALE_TITLE}" fit: ${fits.join(' ')}`)
}

const per = Math.max(1, packs)
say(
	`[${WORLD_PROFILE}] finaleCheck seeds=${SEEDS} rings=${rings} avgRing=${(ringLenSum / Math.max(1, rings)).toFixed(0)} m edges ${edgeMin.toFixed(0)}..${edgeMax.toFixed(0)} m ` +
	`volcano-disc edge hits ${volcanoHits} (${volcanoHitsUnavoidable} layouts unavoidable) | beams all together ${(beamS / Math.max(1, rings)).toFixed(1)} s, pulse ${FINALE_PULSE_S} s to ${FINALE_PULSE_RADIUS_M} m, shot ${(cineS / Math.max(1, rings)).toFixed(1)} s (start +${FINALE_START_DELAY_S}s) | end pose fits ${endFits}/${endPoses}`,
)
say(
	`  enlarged oases (${per} layouts, oasis ${OASIS_RADIUS_M} -> ${OASIS_FINALE_RADIUS_M} m, snow disc ${FINALE_SNOW_RADIUS_M} m): lowered 4 m cells avg ${(lowBefore / per).toFixed(0)} -> ${(lowAfter / per).toFixed(0)} | terrain pieces avg ${(piecesBefore / per).toFixed(0)} -> ${(piecesAfter / per).toFixed(0)} | ground change events avg ${(oasisEvents / per).toFixed(0)} max ${oasisEventsMax} ` +
	`| veg cells ${(vegCellsBefore / per).toFixed(0)} -> ${(vegCellsAfter / per).toFixed(0)}, merged grass rects ${(grassRectsBefore / per).toFixed(0)} -> ${(grassRectsAfter / per).toFixed(0)}, pines ${(treesBefore / per).toFixed(0)} -> ${(treesAfter / per).toFixed(0)}, bushes ${(bushesBefore / per).toFixed(0)} -> ${(bushesAfter / per).toFixed(0)}, rocks ${(rocksBefore / per).toFixed(0)} -> ${(rocksAfter / per).toFixed(0)} ` +
	`| vegetation entities (steady) avg ${(entBefore / per).toFixed(0)} -> ${(entAfter / per).toFixed(0)} (max ${entAfterMax}), colliders ${(collBefore / per).toFixed(0)} -> ${(collAfter / per).toFixed(0)} | new snow cells beyond the 50 m discs avg ${(snowNewSum / per).toFixed(0)} max ${snowNewMax}, <= ${snowPerTickMax} per 8 Hz server tick`,
)
say(bad === 0 ? 'finaleCheck: OK' : `finaleCheck: ${bad} FAILURES`)
if (bad) process.exitCode = 1
