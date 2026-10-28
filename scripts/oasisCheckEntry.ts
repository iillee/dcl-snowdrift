/**
 * oasisCheckEntry.ts - oasis (released monument) terrain + regrowth: circle, level, pit, hearth melts like any cell, timed melt
 * (instant middle, then outward rings with an irregular edge), late-join determinism, union, step height, re-seat
 * deltas, regrowth plan determinism / caps / keep-outs / timing order, entity estimates. Bundled by oasisCheck.mjs.
 */
import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Y, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { TERRAIN_LEVEL_LOW, groundYForLevel, isMountainLevel } from 'src/shared/settings'
import { oasisExcludedLevel, oasisRectHasCap } from 'src/shared/terrain/oasis'
import { CRYSTAL_HEAT_RADIUS_M } from 'src/shared/ruleset'
import {
	OASIS_BAND_M, OASIS_CELL_M, OASIS_DROP_M, OASIS_INNER_M, OASIS_JITTER_M, OASIS_MELT_DELAY_MS, OASIS_MELT_S, OASIS_RADIUS_M, OASIS_REACH_M, oasisCellIndex, oasisHash01,
	oasisCellExposeMs, oasisClear, oasisDeltaY, oasisEntries, oasisLoweredAt, oasisNoteRelease, oasisQuantReveal,
	oasisRelease, oasisSetBurstReveal, oasisTick, onOasisChanged, walkableYAtWorld,
} from 'src/shared/terrain/oasis'
import {
	VEG_BUSH, VEG_GRASS_MIN_S, VEG_GRASS_SPREAD_S, VEG_MAX_BUSHES, VEG_MAX_ROCKS, VEG_MAX_TREES, VEG_ROCK, VEG_TREE, VEG_TREE_GROW_MIN_S,
	VEG_TREE_GROW_SPREAD_S, VEG_TREE_SPREAD_S, VEG_TREE_START_S, VEG_HEARTH_CLEAR_M, VEG_TREE_MAX_H_M, VEG_TREE_MIN_H_M, VEG_TREE_SPACING_K, VEG_TREE_TALL_H_M, VEG_TREE_TALL_SPACING_M, VEG_TREE_TIER_H_M, vegTreeRadiusM, VegCell, VegItem, vegOwnerKey, buildVegCells, greedyRects, mergeGrassRects, vegPosOk, vegCanopyClear, vegTreeHeightM,
} from 'src/shared/terrain/oasisVeg'
import { generateTerrain, mergeLevelRects } from 'src/shared/terrain/terrainGen'
import {
	DCL_MAX_AUTO_STEP_M, MONUMENT_PIT_SIZE_M, TERRAIN_ORIGIN_M, TerrainMap, cellCenterWorld, groundYAtWorld, isLavaAtWorld, levelAtWorld,
} from 'src/shared/terrain/terrainMap'

const realLog = console.log
console.log = (): void => {}
let bad = 0
let failsShown = 0
const fail = (m: string): void => { bad++; if (failsShown++ < 40) realLog('FAIL ' + m) }

if (!(OASIS_DROP_M < DCL_MAX_AUTO_STEP_M)) fail(`drop ${OASIS_DROP_M} is not under the auto-step ${DCL_MAX_AUTO_STEP_M}`)
{ const lowFloor = groundYForLevel(TERRAIN_LEVEL_LOW) - OASIS_DROP_M; if (lowFloor < 0.05) fail(`lowest terrace oasis floor y=${lowFloor.toFixed(3)} is under the DCL ground plane (need >= 0.05)`) }
if (16 % OASIS_CELL_M !== 0) fail('OASIS_CELL_M must divide the 16 m terrain cell')
if (OASIS_REACH_M + OASIS_CELL_M * Math.SQRT1_2 > CRYSTAL_HEAT_RADIUS_M + 1e-9) fail('oasis cells reach past the heat radius')
if (!(OASIS_INNER_M >= 12 && OASIS_INNER_M <= 15)) fail(`inner radius ${OASIS_INNER_M} not in 12-15 m`)
if (!(OASIS_MELT_S >= 60 && OASIS_MELT_S <= 120)) fail(`melt ${OASIS_MELT_S} s not in 60-120 s`)

const T0 = 1_000_000_000_000 // fake local epoch ms of the release

function snap(v: number): number { return TERRAIN_ORIGIN_M + Math.floor((v - TERRAIN_ORIGIN_M) / OASIS_CELL_M) * OASIS_CELL_M + OASIS_CELL_M / 2 }

/** Lowered 4 m cell centres of the current registry inside a box around (cx, cz). */
function loweredCells(map: TerrainMap, cx: number, cz: number): Set<string> {
	const out = new Set<string>()
	for (let z = cz - 70; z <= cz + 70; z += OASIS_CELL_M) for (let x = cx - 70; x <= cx + 70; x += OASIS_CELL_M) {
		const px = snap(x), pz = snap(z)
		if (oasisLoweredAt(map, px, pz)) out.add(px + ',' + pz)
	}
	return out
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
	if (a.size !== b.size) return false
	for (const k of a) if (!b.has(k)) return false
	return true
}

/** Same greedy merge as terrainRenderer.rebuildOasisRect, counting boxes only (rects within reach of (cx, cz)). */
function pieceCount(map: TerrainMap, rects: ReturnType<typeof mergeLevelRects>, level: number, cx: number, cz: number): number {
	let n = 0
	for (const r of rects) {
		const x0 = TERRAIN_ORIGIN_M + r.cx * 16, x1 = x0 + r.w * 16, z0 = TERRAIN_ORIGIN_M + r.cz * 16, z1 = z0 + r.h * 16
		if (oasisExcludedLevel(levelAtWorld(map, x0 + 1, z0 + 1))) continue
		const dx = Math.max(x0 - cx, 0, cx - x1), dz = Math.max(z0 - cz, 0, cz - z1)
		if (Math.hypot(dx, dz) > OASIS_REACH_M + OASIS_CELL_M) continue
		const nx = Math.round((x1 - x0) / OASIS_CELL_M), nz = Math.round((z1 - z0) / OASIS_CELL_M)
		const mask = new Uint8Array(nx * nz)
		let any = false
		for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
			const low = oasisLoweredAt(map, x0 + (ix + 0.5) * OASIS_CELL_M, z0 + (iz + 0.5) * OASIS_CELL_M)
			mask[iz * nx + ix] = low ? 2 : 1
			if (low) any = true
		}
		if (!any) continue
		n += greedyRects(mask, nx, nz).length
	}
	return n
}

/**
 * Expected set: non-crown, non-lava cells (mountain wall blocks melt too) of ANY terrace, never on the pit square. r <= OASIS_INNER_M: centre within r (the burst). Final (r = OASIS_RADIUS_M):
 * inner cells plus every cell with d - jitter <= OASIS_RADIUS_M, the jitter being +/- OASIS_JITTER_M per cell (ragged 28..36 m edge).
 * The hearth is not special: it is in only when its own cell is.
 */
function wantFinal(map: TerrainMap, c: { x: number; z: number }, level: number, px: number, pz: number, r: number = OASIS_RADIUS_M): boolean {
	const d = Math.hypot(px - c.x, pz - c.z)
	if (!(!oasisExcludedLevel(levelAtWorld(map, px, pz)) && !isLavaAtWorld(map, px, pz)
		&& !(Math.abs(px - c.x) < MONUMENT_PIT_SIZE_M / 2 && Math.abs(pz - c.z) < MONUMENT_PIT_SIZE_M / 2))) return false // the 4 cells over the pit are sampled at their centre, which is inside it
	if (d <= OASIS_INNER_M) return d <= r
	if (r <= OASIS_INNER_M) return false
	const jit = (oasisHash01(oasisCellIndex(px), oasisCellIndex(pz), Math.round(c.x * 4), Math.round(c.z * 4)) - 0.5) * 2 * OASIS_JITTER_M
	return d - jit <= r
}

const SEEDS = 40
let mtnCells = 0, mtnOases = 0, mergedMtnCells = 0, mergedMultiLevel = 0, lvlFracMin = 1, lvlGroups = 0
let oases = 0, cellsSum = 0, cellsMax = 0, boxSum = 0, boxMax = 0, otherLevelCells = 0, crossCells = 0, crossOases = 0, hearthMelts = 0, hearthSteps = 0, hearthInside = 0, hearthOutside = 0, hearthSynth = 0, changeEventsMax = 0
let irregularAhead = 0, irregularBehind = 0
// regrowth stats
let vCells = 0, vGrass = 0, vBare = 0, vTrees = 0, vBushes = 0, vRocks = 0, vTreeParts = 0, vMergedRects = 0, vPeakEntities = 0, vMaxEntities = 0
let vCovered90Max = 0, vLastTreeMax = 0, vCellsMax = 0, vMaxTreesInOasis = 0, vMaxBushes = 0, vMaxRocks = 0
const shadeCount = [0, 0, 0, 0]
const treeHs: number[] = []
const radial = [0, 0, 0, 0]

for (let s = 0; s < SEEDS; s++) {
	const map = generateTerrain(cycleMazeSeed(1000 + s * 7919))
	const rects = mergeLevelRects(map)
	const cs = map.stations.map((st) => cellCenterWorld(st.cx, st.cz))
	// No uncapped (bare rock) rect may hold a lowered cell: a capless mountain block inside the circle would stay blue.
	{
		oasisClear()
		for (const c of cs) oasisRelease(map, c.x, c.z, Number.POSITIVE_INFINITY, T0)
		for (const r of rects) {
			const x0 = TERRAIN_ORIGIN_M + r.cx * 16, z0 = TERRAIN_ORIGIN_M + r.cz * 16, w = r.w * 16, h = r.h * 16
			if (oasisRectHasCap(map, r.level, x0 + w / 2, z0 + h / 2, w, h)) continue
			for (let z = z0 + 2; z < z0 + h; z += 4) for (let x = x0 + 2; x < x0 + w; x += 4) if (oasisLoweredAt(map, x, z)) { fail(`seed ${s}: uncapped rect level ${r.level} holds a lowered cell ${x},${z}`); z = z0 + h; break }
		}
		oasisClear()
	}
	// The hearth is NOT special: the near-spawn monument (index 0, ~41 m away: normally outside the patch) melts its cell and the spawn point's cell like any
	// other. Hearth objects follow activeGroundYAt (client/hearthSeat.ts), so the floor there must be exactly one drop lower once
	// open, unchanged before, and one walkable step from the neighbouring cells; the spawn y=17 from scene.json stays above it.
	{
		const near = cs[0]
		const hx = CAMPFIRE_WORLD_X, hz = CAMPFIRE_WORLD_Z
		const spots: Array<[number, number]> = [[hx, hz], [418.38, 417.83]]
		oasisClear()
		for (const [px, pz] of spots) if (walkableYAtWorld(map, px, pz) !== groundYAtWorld(map, px, pz)) fail(`seed ${s}: floor moved before any release at ${px},${pz}`)
		const before = groundYAtWorld(map, hx, hz)
		if (Math.abs(before - CAMPFIRE_WORLD_Y) > 1e-6) fail(`seed ${s}: hearth ground ${before} != CAMPFIRE_WORLD_Y ${CAMPFIRE_WORLD_Y}`)
		oasisNoteRelease(near.x, near.z, T0 - 1e9)
		oasisRelease(map, near.x, near.z, Number.POSITIVE_INFINITY, T0)
		for (const [px, pz] of spots) {
			hearthMelts++
			// Near monument is ~41 m away: the hearth is outside the 28..36 m patch (stays at base height), unless this seed's cell says otherwise.
			const wantLow = wantFinal(map, near, levelAtWorld(map, near.x, near.z), snap(px), snap(pz))
			if (wantLow) hearthInside++; else hearthOutside++
			if (oasisLoweredAt(map, px, pz) !== wantLow) { fail(`seed ${s}: hearth/spawn ${px},${pz} lowered=${oasisLoweredAt(map, px, pz)} want ${wantLow}`); continue }
			const drop = groundYAtWorld(map, px, pz) - walkableYAtWorld(map, px, pz)
			if (Math.abs(drop - (wantLow ? OASIS_DROP_M : 0)) > 1e-9) fail(`seed ${s}: floor drop at ${px},${pz} is ${drop}`)
			if (walkableYAtWorld(map, px, pz) > 17 - 0.5) fail(`seed ${s}: spawn y=17 not above the lowered floor at ${px},${pz}`)
			// player teleports stand at activeGroundYAt + lift: never below the walkable floor, steps to neighbours <= 0.3 m
			for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) {
				hearthSteps++
				const step = Math.abs(walkableYAtWorld(map, px + dx, pz + dz) - walkableYAtWorld(map, px, pz))
				if (step > 0.3 + 1e-9 && levelAtWorld(map, px + dx, pz + dz) === levelAtWorld(map, px, pz)) fail(`seed ${s}: floor step ${step.toFixed(3)} next to ${px},${pz}`)
			}
		}
		// expose time of the hearth cell is finite and after the release (late joiners hydrate to the same floor)
		const ex = oasisCellExposeMs(map, hx, hz)
		const hearthIn = wantFinal(map, near, levelAtWorld(map, near.x, near.z), snap(hx), snap(hz))
		if (hearthIn !== (ex > -Infinity && ex < Infinity)) fail(`seed ${s}: hearth cell expose time ${ex} but inside=${hearthIn}`)
		// Synthetic oasis centred 20 m from the hearth (same level): the hearth cell is surely inside (20 < 28), so the re-seat path
		// (floor one drop lower, objects follow activeGroundYAt) is exercised on every seed whatever the real monument does.
		const sx = hx + 20, sz = hz
		if (levelAtWorld(map, sx, sz) === levelAtWorld(map, hx, hz) && !isLavaAtWorld(map, sx, sz)) {
			oasisClear()
			oasisNoteRelease(sx, sz, T0 - 1e9)
			oasisRelease(map, sx, sz, Number.POSITIVE_INFINITY, T0)
			const dropIn = groundYAtWorld(map, hx, hz) - walkableYAtWorld(map, hx, hz)
			if (!oasisLoweredAt(map, hx, hz) || Math.abs(dropIn - OASIS_DROP_M) > 1e-9) fail(`seed ${s}: hearth inside a synthetic oasis not lowered one drop (drop ${dropIn})`)
			else hearthSynth++
		}
		oasisClear()
	}
	for (let i = 0; i < cs.length; i++) {
		const c = cs[i]
		const level = levelAtWorld(map, c.x, c.z)
		const meltStart = T0 + OASIS_MELT_DELAY_MS

		// ---- live run: burst (instant middle) then the timed outward melt
		oasisClear()
		oasisNoteRelease(c.x, c.z, T0)
		oasisRelease(map, c.x, c.z, 0, T0)
		if (loweredCells(map, c.x, c.z).size !== 0) fail(`seed ${s} st ${i}: cells lowered at reveal 0`)
		let events = 0
		onOasisChanged(() => { events++ })
		let prev = new Set<string>()
		for (let r = 0; r <= CRYSTAL_HEAT_RADIUS_M + 3; r += 2) {
			oasisSetBurstReveal(c.x, c.z, r)
			const now = loweredCells(map, c.x, c.z)
			for (const k of prev) if (!now.has(k)) fail(`seed ${s} st ${i}: cell ${k} un-lowered at burst r=${r}`)
			for (const k of now) { const [px, pz] = k.split(',').map(Number); if (Math.hypot(px - c.x, pz - c.z) > oasisQuantReveal(r) + 1e-6) fail(`seed ${s} st ${i}: cell ${k} lowered past burst ring (r=${r})`) }
			prev = now
		}
		oasisSetBurstReveal(c.x, c.z, Number.POSITIVE_INFINITY)
		const afterBurst = loweredCells(map, c.x, c.z)
		for (let z = c.z - 70; z <= c.z + 70; z += OASIS_CELL_M) for (let x = c.x - 70; x <= c.x + 70; x += OASIS_CELL_M) {
			const px = snap(x), pz = snap(z)
			const want = wantFinal(map, c, level, px, pz, OASIS_INNER_M)
			if (want !== afterBurst.has(px + ',' + pz)) fail(`seed ${s} st ${i}: after the burst cell ${px},${pz} want ${want}`)
		}
		// timed melt: monotone, never ahead of the clock by more than the jitter + a ring, complete at OASIS_MELT_S
		prev = afterBurst
		let sawAhead = false, sawBehind = false
		const sets: Array<{ t: number; set: Set<string> }> = []
		for (let t = 0; t <= OASIS_MELT_S + 5; t += 1) {
			oasisTick(meltStart + t * 1000)
			if (t % 5 !== 0 && t < OASIS_MELT_S) continue
			const now = loweredCells(map, c.x, c.z)
			sets.push({ t, set: now })
			for (const k of prev) if (!now.has(k)) fail(`seed ${s} st ${i}: cell ${k} un-lowered at t=${t}`)
			const rq = t >= OASIS_MELT_S ? OASIS_RADIUS_M : oasisQuantReveal(OASIS_INNER_M + (OASIS_RADIUS_M - OASIS_INNER_M) * (t / OASIS_MELT_S))
			for (const k of now) {
				const [px, pz] = k.split(',').map(Number)
				const d = Math.hypot(px - c.x, pz - c.z)
				if (d > rq + OASIS_JITTER_M + 1e-6 && d > OASIS_INNER_M) fail(`seed ${s} st ${i}: cell ${k} d=${d.toFixed(1)} lowered ahead of ring ${rq} at t=${t}`)
				if (d > rq + 1e-6) sawAhead = true
			}
			if (t > 0 && t < OASIS_MELT_S) for (let z = c.z - 60; z <= c.z + 60; z += OASIS_CELL_M) for (let x = c.x - 60; x <= c.x + 60; x += OASIS_CELL_M) {
				const px = snap(x), pz = snap(z), d = Math.hypot(px - c.x, pz - c.z)
				if (d > OASIS_INNER_M + 4 && d < rq - 1e-6 && wantFinal(map, c, level, px, pz) && !now.has(px + ',' + pz)) sawBehind = true
			}
			prev = now
		}
		if (sawAhead) irregularAhead++
		if (sawBehind) irregularBehind++
		const fin = loweredCells(map, c.x, c.z)
		if ([...fin].some((k) => { const [px, pz] = k.split(',').map(Number); return levelAtWorld(map, px, pz) !== level })) crossOases++
		for (let z = c.z - 70; z <= c.z + 70; z += OASIS_CELL_M) for (let x = c.x - 70; x <= c.x + 70; x += OASIS_CELL_M) {
			const px = snap(x), pz = snap(z)
			const want = wantFinal(map, c, level, px, pz)
			if (want !== fin.has(px + ',' + pz)) fail(`seed ${s} st ${i}: final cell ${px},${pz} ${want ? 'should be lowered' : 'lowered wrongly'}`)
			if (want && isMountainLevel(levelAtWorld(map, px, pz))) mtnCells++
			if (!want && Math.hypot(px - c.x, pz - c.z) <= OASIS_RADIUS_M) otherLevelCells++
			if (want && levelAtWorld(map, px, pz) !== level) { crossCells++; if (Math.abs(groundYAtWorld(map, px, pz) - walkableYAtWorld(map, px, pz) - OASIS_DROP_M) > 1e-9) fail(`seed ${s} st ${i}: cross-terrace cell ${px},${pz} wrong drop`) }
		}
		if (events > Math.ceil(OASIS_RADIUS_M / OASIS_BAND_M) + 3 + OASIS_INNER_M / OASIS_BAND_M) fail(`seed ${s} st ${i}: ${events} change events`)
		changeEventsMax = Math.max(changeEventsMax, events)
		for (const k of fin) {
			const [px, pz] = k.split(',').map(Number)
			for (const [ox, oz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) if (Math.hypot(px + ox - c.x, pz + oz - c.z) > CRYSTAL_HEAT_RADIUS_M + 1e-6) fail(`seed ${s} st ${i}: cell ${k} corner outside the melt disc`)
		}
		if (oasisLoweredAt(map, c.x, c.z) || oasisLoweredAt(map, c.x + 2.9, c.z - 2.9)) fail(`seed ${s} st ${i}: pit square lowered`)
		for (const k of fin) {
			const [px, pz] = k.split(',').map(Number)
			const d = groundYAtWorld(map, px, pz) - walkableYAtWorld(map, px, pz)
			if (Math.abs(d - OASIS_DROP_M) > 1e-9) fail(`seed ${s} st ${i}: drop ${d} at ${k}`)
		}
		oases++
		cellsSum += fin.size
		cellsMax = Math.max(cellsMax, fin.size)
		let boxes = 0
		for (const m of sets) if (m.t % 10 === 0 || m.t >= OASIS_MELT_S) {
			// estimate pieces for the mid-melt states too (irregular edge = more boxes): re-run the registry to that time
			oasisClear(); oasisNoteRelease(c.x, c.z, T0); oasisRelease(map, c.x, c.z, Number.POSITIVE_INFINITY, meltStart + m.t * 1000)
			boxes = Math.max(boxes, pieceCount(map, rects, level, c.x, c.z))
		}
		boxSum += boxes
		boxMax = Math.max(boxMax, boxes)

		// ---- late joiner: hydrated at any time = exactly the live state at that time
		for (const m of sets) if (m.t % 15 === 0 || m.t >= OASIS_MELT_S) {
			oasisClear()
			oasisNoteRelease(c.x, c.z, T0)
			oasisRelease(map, c.x, c.z, Number.POSITIVE_INFINITY, meltStart + m.t * 1000)
			if (!sameSet(loweredCells(map, c.x, c.z), m.set)) fail(`seed ${s} st ${i}: late joiner at t=${m.t} differs from the live state`)
		}

		// ---- exposure time agrees with the lowered state as the clock passes it (re-seat / grass start per cell)
		oasisClear()
		oasisNoteRelease(c.x, c.z, T0)
		oasisRelease(map, c.x, c.z, Number.POSITIVE_INFINITY, T0)
		const probes: Array<{ px: number; pz: number; e: number }> = []
		let ix = 0
		for (const k of fin) {
			if (ix++ % 9 !== 0) continue
			const [px, pz] = k.split(',').map(Number)
			if (Math.hypot(px - c.x, pz - c.z) <= OASIS_INNER_M + 0.01) continue
			probes.push({ px, pz, e: oasisCellExposeMs(map, px, pz) })
		}
		probes.sort((a, b) => a.e - b.e)
		let lastE = -Infinity
		for (const p of probes) {
			if (p.e - lastE < 50) continue // same ring: ticking past the first one opens the rest
			lastE = p.e
			if (!(p.e > meltStart && p.e <= meltStart + OASIS_MELT_S * 1000 + 1)) { fail(`seed ${s} st ${i}: expose ${p.e - meltStart} ms out of the melt window`); continue }
			oasisTick(p.e - 5)
			if (oasisLoweredAt(map, p.px, p.pz)) fail(`seed ${s} st ${i}: cell ${p.px},${p.pz} lowered before its expose time`)
			oasisTick(p.e + 5)
			if (!oasisLoweredAt(map, p.px, p.pz)) fail(`seed ${s} st ${i}: cell ${p.px},${p.pz} not lowered at its expose time`)
		}

		// ---- regrowth plan: deterministic, caps, keep-outs, timing order
		oasisClear()
		oasisNoteRelease(c.x, c.z, T0)
		oasisRelease(map, c.x, c.z, 0, T0)
		const entries = oasisEntries()
		const plan = buildVegCells(map, entries, new Set<number>())
		const plan2 = buildVegCells(map, entries, new Set<number>())
		if (JSON.stringify(plan) !== JSON.stringify(plan2)) fail(`seed ${s} st ${i}: regrowth plan is not deterministic`)
		// the plan covers exactly the cells the oasis ends up lowering
		const planKeys = new Set(plan.map((p) => p.x + ',' + p.z))
		if (!sameSet(planKeys, fin)) fail(`seed ${s} st ${i}: plan cells (${planKeys.size}) != final lowered cells (${fin.size})`)
		let nTree = 0, nBush = 0, nRock = 0, parts = 0, lastTree = 0, grassN = 0
		const grassTimes: number[] = []
		const shades = [0, 0, 0, 0]
		for (const p of plan as VegCell[]) {
			shades[p.shade]++
			if (Math.abs(p.y - (groundYAtWorld(map, p.x, p.z) - OASIS_DROP_M)) > 1e-9) fail(`seed ${s} st ${i}: plan floor y at ${p.x},${p.z}`)
			if (p.shade > 0) {
				grassN++
				const lag = (p.grassMs - p.exposeMs) / 1000
				if (lag < VEG_GRASS_MIN_S - 1e-6 || lag > VEG_GRASS_MIN_S + VEG_GRASS_SPREAD_S + 1e-6) fail(`seed ${s} st ${i}: grass lag ${lag}`)
				grassTimes.push((p.grassMs - T0) / 1000)
			} else if (p.grassMs !== Number.POSITIVE_INFINITY) fail(`seed ${s} st ${i}: bare cell has a grass time`)
			for (const it of p.items) {
				const half = OASIS_CELL_M / 2 + 1e-6
				if (Math.abs(it.x - p.x) > half || Math.abs(it.z - p.z) > half) fail(`seed ${s} st ${i}: item outside its cell`)
				if (!vegPosOk(map, entries[0], it.x, it.z)) fail(`seed ${s} st ${i}: item at ${it.x.toFixed(1)},${it.z.toFixed(1)} breaks a keep-out`)
				if (Math.abs(it.x - c.x) < MONUMENT_PIT_SIZE_M / 2 + 3 && Math.abs(it.z - c.z) < MONUMENT_PIT_SIZE_M / 2 + 3) fail(`seed ${s} st ${i}: item on the monument plinth`)
				if (Math.abs(it.x - CAMPFIRE_WORLD_X) < VEG_HEARTH_CLEAR_M && Math.abs(it.z - CAMPFIRE_WORLD_Z) < VEG_HEARTH_CLEAR_M) fail(`seed ${s} st ${i}: item on the hearth`)
				if (it.startMs < p.exposeMs + 1000 * (it.kind === VEG_TREE ? VEG_TREE_START_S : 1) - 1e-6) fail(`seed ${s} st ${i}: item starts before its cell melted`)
				if (it.kind === VEG_TREE) {
					nTree++
					const th = vegTreeHeightM(it)
					if (th < VEG_TREE_MIN_H_M - 1e-9 || th > VEG_TREE_MAX_H_M + 1e-9) fail(`seed ${s} st ${i}: pine height ${th}`)
					treeHs.push(th)
					parts += th >= VEG_TREE_TIER_H_M ? 3 : 2
					const mature = (it.startMs + it.durMs - p.exposeMs) / 1000
					if (mature > VEG_TREE_START_S + VEG_TREE_SPREAD_S + VEG_TREE_GROW_MIN_S + VEG_TREE_GROW_SPREAD_S + 1e-6) fail(`seed ${s} st ${i}: tree matures ${mature} s after melt`)
					lastTree = Math.max(lastTree, (it.startMs + it.durMs - T0) / 1000)
				} else if (it.kind === VEG_BUSH) { nBush++; parts++ } else if (it.kind === VEG_ROCK) { nRock++; parts++ }
			}
		}
		{ const ts: VegItem[] = []; for (const p of plan) if (p.ownerKey === vegOwnerKey(entries[0])) for (const it of p.items) if (it.kind === VEG_TREE) ts.push(it)
			for (const it of ts) if (!vegCanopyClear(map, it.x, it.z, vegTreeRadiusM(it))) fail(`seed ${s} st ${i}: pine canopy overhangs a cliff at ${it.x.toFixed(1)},${it.z.toFixed(1)}`)
			for (let a = 0; a < ts.length; a++) for (let b = a + 1; b < ts.length; b++) { const d = Math.hypot(ts[a].x - ts[b].x, ts[a].z - ts[b].z); const need = VEG_TREE_SPACING_K * (vegTreeRadiusM(ts[a]) + vegTreeRadiusM(ts[b])); if (d < need - 1e-6) fail(`seed ${s} st ${i}: pines ${d.toFixed(1)} m apart, need ${need.toFixed(1)}`); if (d < VEG_TREE_TALL_SPACING_M - 1e-6 && vegTreeHeightM(ts[a]) >= VEG_TREE_TALL_H_M && vegTreeHeightM(ts[b]) >= VEG_TREE_TALL_H_M) fail(`seed ${s} st ${i}: two tall pines ${d.toFixed(1)} m apart`) }
			const cx = entries[0].x, cz = entries[0].z; for (const it of ts) { const dd = Math.hypot(it.x - cx, it.z - cz); radial[Math.min(3, Math.floor(dd / (OASIS_RADIUS_M / 4)))]++ } }
		if (nTree > VEG_MAX_TREES || nBush > VEG_MAX_BUSHES || nRock > VEG_MAX_ROCKS) fail(`seed ${s} st ${i}: caps exceeded ${nTree}/${nBush}/${nRock}`)
		// union / incremental: planning oasis B after A (known = A's cells) adds only new cells; together = planning both at once
		if (i + 1 < cs.length) {
			const d = cs[i + 1]
			oasisNoteRelease(d.x, d.z, T0 + 20000)
			oasisRelease(map, d.x, d.z, 0, T0 + 20000)
			const both = buildVegCells(map, oasisEntries(), new Set<number>())
			const bOnly = buildVegCells(map, oasisEntries(), new Set(plan.map((p) => p.key)))
			const seen = new Set<number>()
			for (const p of plan) seen.add(p.key)
			for (const p of bOnly) { if (seen.has(p.key)) fail(`seed ${s}: duplicate cell ${p.key} across oases`); seen.add(p.key) }
			if (seen.size !== both.length) fail(`seed ${s}: union of plans ${seen.size} != joint plan ${both.length}`)
		}
		oasisClear()
		vCells += plan.length; vGrass += grassN; vBare += plan.length - grassN
		vTrees += nTree; vBushes += nBush; vRocks += nRock; vTreeParts += parts - nBush - nRock
		for (let k = 0; k < 4; k++) shadeCount[k] += shades[k]
		// merged grass rectangles of the finished oasis (what stays alive), peak = unmerged cells + items
		// (merged per floor Y: a rectangle never spans terraces / wall blocks, and sits at the exact floor of every cell it covers)
		const grassRects = mergeGrassRects(plan)
		const merged = grassRects.length
		{
			const byPos = new Map<string, VegCell>()
			for (const p of plan) byPos.set(p.ix + ',' + p.iz, p)
			const covered = new Set<string>()
			let area = 0
			for (const r of grassRects) {
				const nxr = Math.round(r.sx / OASIS_CELL_M), nzr = Math.round(r.sz / OASIS_CELL_M)
				for (let a = 0; a < nxr; a++) for (let b = 0; b < nzr; b++) {
					const cx = r.x - r.sx / 2 + (a + 0.5) * OASIS_CELL_M, cz = r.z - r.sz / 2 + (b + 0.5) * OASIS_CELL_M
					const cell = byPos.get(oasisCellIndex(cx) + ',' + oasisCellIndex(cz))
					area++
					if (!cell || cell.shade !== r.shade) { fail(`seed ${s} st ${i}: merged grass rect covers a cell that is not grass of its shade`); continue }
					const floor = groundYAtWorld(map, cell.x, cell.z) - OASIS_DROP_M
					if (Math.abs(r.y - floor) > 1e-6 || Math.abs(r.y - cell.y) > 1e-6) fail(`seed ${s} st ${i}: merged grass rect at y ${r.y.toFixed(3)} covers a cell whose floor is ${floor.toFixed(3)} (level ${levelAtWorld(map, cell.x, cell.z)})`)
					if (covered.has(cell.key + '')) fail(`seed ${s} st ${i}: grass cell covered twice`)
					covered.add(cell.key + '')
					if (isMountainLevel(levelAtWorld(map, cell.x, cell.z))) mergedMtnCells++
				}
			}
			// Grass (and the earth it sits on) must exist on EVERY melted floor height, not just the monument's: per-level grass fraction.
			{
				const lv = new Map<number, { n: number; g: number }>()
				for (const p of plan) {
					const k = Math.round(p.y * 1000)
					const o = lv.get(k) ?? { n: 0, g: 0 }
					o.n++; if (p.shade > 0) o.g++
					lv.set(k, o)
					const want = groundYForLevel(levelAtWorld(map, p.x, p.z)) - OASIS_DROP_M
					if (Math.abs(p.y - want) > 1e-6) fail(`seed ${s} st ${i}: veg cell y ${p.y.toFixed(3)} != rendered earth top ${want.toFixed(3)} (level ${levelAtWorld(map, p.x, p.z)})`)
				}
				const overall = grassN / Math.max(1, plan.length)
				for (const [k, o] of lv) {
					if (o.n >= 8 && (o.g === 0 || o.g / o.n < overall * 0.5)) fail(`seed ${s} st ${i}: floor y ${(k / 1000).toFixed(2)} has ${o.g}/${o.n} grass cells (oasis overall ${(overall * 100).toFixed(0)}%)`)
					if (o.n >= 8) { lvlFracMin = Math.min(lvlFracMin, o.g / o.n); lvlGroups++ }
				}
			}
			if (area !== grassN) fail(`seed ${s} st ${i}: merged grass covers ${area} cells, plan has ${grassN}`)
			if (new Set(plan.filter((p) => p.shade > 0).map((p) => Math.round(p.y * 1000))).size > 1) mergedMultiLevel++
			for (const p of plan) for (const it of p.items) {
				const floor = groundYAtWorld(map, it.x, it.z) - OASIS_DROP_M
				if (Math.abs(it.y - floor) > 1e-6) fail(`seed ${s} st ${i}: vegetation item kind ${it.kind} at y ${it.y.toFixed(3)} but its floor is ${floor.toFixed(3)}`)
			}
		}
		vMergedRects += merged
		const steady = merged + parts
		const peak = grassN + parts
		vPeakEntities += peak
		vMaxEntities = Math.max(vMaxEntities, peak)
		vCellsMax = Math.max(vCellsMax, plan.length)
		vMaxTreesInOasis = Math.max(vMaxTreesInOasis, nTree); vMaxBushes = Math.max(vMaxBushes, nBush); vMaxRocks = Math.max(vMaxRocks, nRock)
		grassTimes.sort((a, b) => a - b)
		if (grassTimes.length > 0) vCovered90Max = Math.max(vCovered90Max, grassTimes[Math.floor(grassTimes.length * 0.9)] - OASIS_MELT_DELAY_MS / 1000)
		vLastTreeMax = Math.max(vLastTreeMax, lastTree - OASIS_MELT_DELAY_MS / 1000)
		if (steady > 400) fail(`seed ${s} st ${i}: ${steady} steady vegetation entities`)

		// ---- union of two oases = OR of each, and the drop does not stack
		if (i + 1 < cs.length) {
			const d = cs[i + 1]
			oasisClear(); oasisRelease(map, c.x, c.z, Number.POSITIVE_INFINITY)
			const a = loweredCells(map, c.x, c.z)
			oasisClear(); oasisRelease(map, d.x, d.z, Number.POSITIVE_INFINITY)
			const bSet = loweredCells(map, c.x, c.z)
			oasisRelease(map, c.x, c.z, Number.POSITIVE_INFINITY)
			const both = loweredCells(map, c.x, c.z)
			for (const k of new Set([...a, ...bSet, ...both])) if (both.has(k) !== (a.has(k) || bSet.has(k))) fail(`seed ${s} st ${i}: union mismatch at ${k}`)
			for (const k of both) { const [px, pz] = k.split(',').map(Number); if (Math.abs(groundYAtWorld(map, px, pz) - walkableYAtWorld(map, px, pz) - OASIS_DROP_M) > 1e-9) fail(`seed ${s}: stacked drop at ${k}`) }
		}
	}
}

// re-seat delta (fires, logs, cubes ...): an object inside the circle moves down exactly one step, when its own cell melts, and not again
{
	const map = generateTerrain(cycleMazeSeed(1000))
	const c = cellCenterWorld(map.stations[0].cx, map.stations[0].cz)
	const level = levelAtWorld(map, c.x, c.z)
	for (const [label, dist] of [['inner', 8], ['outer', 27]] as const) {
		oasisClear()
		oasisNoteRelease(c.x, c.z, T0)
		oasisRelease(map, c.x, c.z, 0, T0)
		let probe: { x: number; z: number } | null = null
		for (let a = 0; a < 90 && !probe; a++) {
			const x = c.x + dist * Math.cos(a), z = c.z + dist * Math.sin(a)
			if (wantFinal(map, c, level, snap(x), snap(z))) probe = { x, z }
		}
		if (!probe) { fail(`no ${label} probe spot`); continue }
		const dys: number[] = []
		onOasisChanged((was) => dys.push(oasisDeltaY(map, probe!.x, probe!.z, was)))
		for (let r = 0; r <= 56; r += 1) oasisSetBurstReveal(c.x, c.z, r)
		oasisSetBurstReveal(c.x, c.z, Number.POSITIVE_INFINITY)
		for (let t = 0; t <= OASIS_MELT_S + 5; t += 1) oasisTick(T0 + OASIS_MELT_DELAY_MS + t * 1000)
		const moved = dys.filter((d) => Math.abs(d) > 1e-9)
		if (moved.length !== 1 || Math.abs(moved[0] + OASIS_DROP_M) > 1e-9) fail(`${label} probe moved ${JSON.stringify(moved)} (want exactly one -${OASIS_DROP_M})`)
		const e = oasisCellExposeMs(map, probe.x, probe.z)
		if (label === 'outer' && !(e > T0 + OASIS_MELT_DELAY_MS + 20000)) fail(`outer probe melts too early (${(e - T0 - OASIS_MELT_DELAY_MS) / 1000} s after the burst)`)
		if (label === 'inner' && !(e <= T0 + OASIS_MELT_DELAY_MS)) fail('inner probe does not melt with the burst')
	}
}
oasisClear()
console.log = realLog
const pct = (n: number, d: number): string => (d > 0 ? (100 * n / d).toFixed(0) : '0') + '%'
console.log(`oasisCheck: grass per floor height: ${lvlGroups} (oasis, height) groups with >= 8 cells, lowest grass fraction ${(lvlFracMin * 100).toFixed(0)}%`)
console.log(`oasisCheck: merged grass rects verified at their cells' exact floor Y (and every item at its floor): ${mergedMultiLevel} oases span several floor heights, ${mergedMtnCells} merged cells are mountain blocks`)
console.log(`oasisCheck: mountain wall-block cells melted (now capped + earth like terraces; crown/lava/pit stay): ${mtnCells}`)
console.log(`oasisCheck: ${oases} oases over ${SEEDS} seeds | cell ${OASIS_CELL_M} m, band ${OASIS_BAND_M} m, drop ${OASIS_DROP_M} m, radius ${OASIS_RADIUS_M.toFixed(1)} m, instant middle ${OASIS_INNER_M} m, melt ${OASIS_MELT_S} s | lowered cells avg ${(cellsSum / oases).toFixed(0)} max ${cellsMax} | est. terrain pieces per oasis (worst mid-melt, cap + earth boxes) avg ${(boxSum / oases).toFixed(0)} max ${boxMax} | in-radius cells skipped (mountain/lava/pit) ${otherLevelCells} | cells on other terraces melted ${crossCells} (${crossOases} of ${oases} oases) | max change events per oasis ${changeEventsMax} | oases with a ragged edge ahead of / behind the ring: ${pct(irregularAhead, oases)} / ${pct(irregularBehind, oases)} | hearth/spawn melts checked ${hearthMelts}, hearth floor steps ${hearthSteps} | near-monument hearth/spawn points inside / outside the patch ${hearthInside} / ${hearthOutside}, synthetic inside-hearth re-seat checks ${hearthSynth}`)
console.log(`oasisCheck: regrowth per oasis avg: cells ${(vCells / oases).toFixed(0)} (max ${vCellsMax}), grass ${(vGrass / oases).toFixed(0)} (${pct(vGrass, vCells)}; shades ${shadeCount.slice(1).map((n) => pct(n, vCells)).join('/')}, bare ${pct(vBare, vCells)}), pines ${(vTrees / oases).toFixed(0)} (max ${vMaxTreesInOasis}), bushes ${(vBushes / oases).toFixed(0)} (max ${vMaxBushes}), rocks ${(vRocks / oases).toFixed(0)} (max ${vMaxRocks}) | entities: merged grass ${(vMergedRects / oases).toFixed(0)} + decorations ${((vTreeParts + vBushes + vRocks) / oases).toFixed(0)} = steady ${((vMergedRects + vTreeParts + vBushes + vRocks) / oases).toFixed(0)}, peak while growing avg ${(vPeakEntities / oases).toFixed(0)} max ${vMaxEntities} | after the burst: 90% of grass up by ${vCovered90Max.toFixed(0)} s worst case, last pine mature ${vLastTreeMax.toFixed(0)} s`)
{ const hs = treeHs.slice().sort((a, b) => a - b); const q = (p: number): string => hs.length ? hs[Math.min(hs.length - 1, Math.floor(p * hs.length))].toFixed(1) : '-'
	console.log(`oasisCheck: pine heights (m) min ${q(0)} p25 ${q(0.25)} median ${q(0.5)} p75 ${q(0.75)} max ${q(0.999)} | ${pct(hs.filter((h) => h >= 19).length, hs.length)} at 19 m+ (choppable trees 19-38 m) | avatar 1.8 m | pines per radial quarter (centre->rim) ${radial.join('/')}`) }
console.log(bad === 0 ? 'oasisCheck: OK' : `oasisCheck: ${bad} FAILURES`)
if (bad) process.exitCode = 1