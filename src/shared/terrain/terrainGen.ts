/**
 * terrainGen.ts — seeded elevation generator.
 *
 * Regions first, boundaries second. Pipeline (design/terrain-plan.md):
 *   1. Mountain band around the edge, jittered thickness.
 *   2. Low / Middle / High from fractal noise, cut by quantile.
 *   3. Hearth disc forced Middle, noise blended toward Middle around it.
 *   4. Landform stamps in separate directions: canyon, ridge, plateau, basin.
 *   5. Cleanup: smoothing, tiny-region merge, diagonal-contact removal.
 *   6. Regions + ladders: spanning tree from the hearth region over
 *      one-step boundaries, one ladder per edge on a straight cliff run.
 *      Regions with no ladder site are flattened into a neighbour.
 *   7. Route distance from the hearth and far destinations.
 *   8. Validate; a failing seed retries deterministically.
 *
 * Pure and deterministic; client and server get the same map.
 */

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import {
	TERRAIN_CELL_M,
	TERRAIN_GRID_H,
	TERRAIN_GRID_W,
	TERRAIN_LEVEL_HIGH,
	TERRAIN_LEVEL_LOW,
	TERRAIN_LEVEL_MID,
	TERRAIN_LEVEL_MOUNTAIN,
} from 'src/shared/settings'
import {
	DIR_DX,
	DIR_DZ,
	LADDER_FOOT_M,
	LADDER_LAND_M,
	LANDFORM_BASIN,
	LANDFORM_CANYON,
	LANDFORM_HEARTH,
	LANDFORM_NONE,
	LANDFORM_PLATEAU,
	LANDFORM_RIDGE,
	TERRAIN_ORIGIN_M,
	TerrainDestination,
	TerrainLadder,
	TerrainMap,
	cellCenterWorld,
	groundYForLevel,
} from 'src/shared/terrain/terrainMap'
import {
	Rng,
	fractalNoise2,
	mulberry32,
	randInt,
	shuffleInPlace,
	valueNoise2,
} from 'src/shared/utils/random'


// MARK: Tuning

const W = TERRAIN_GRID_W
const H = TERRAIN_GRID_H
const N = W * H

const LOW      = TERRAIN_LEVEL_LOW
const MID      = TERRAIN_LEVEL_MID
const HIGH     = TERRAIN_LEVEL_HIGH
const MOUNTAIN = TERRAIN_LEVEL_MOUNTAIN

// Mountain band thickness in cells: MIN plus 0..JITTER from noise.
const MOUNTAIN_BAND_MIN    = 3
const MOUNTAIN_BAND_JITTER = 2
const MOUNTAIN_JITTER_SCALE = 6

// One noise feature spans this many cells (14 cells = 224 m).
const FIELD_SCALE_CELLS = 14
const FIELD_OCTAVES     = 3
const FIELD_GAIN        = 0.4

// Share of interior cells cut to Low and High; the rest is Middle.
const LOW_FRACTION  = 0.27
const HIGH_FRACTION = 0.27

// Hearth disc (cells): forced Middle inside FORCE, blended out to BLEND.
const HEARTH_FORCE_R = 4.5
const HEARTH_BLEND_R = 9

// Regions smaller than this merge into a neighbour.
const MIN_REGION_CELLS = 8

// Ladder placement.
const SECOND_LADDER_MIN_SITES = 24
const SECOND_LADDER_MIN_SEP   = 10

// Destinations.
const DEST_MIN_AREA      = 40
const DEST_MAX           = 2
const DEST_MIN_ANGLE_RAD = Math.PI / 2

// Validation.
const MIN_HEARTH_REGION_CELLS = 40
const MIN_LADDERS             = 2
const MAX_ATTEMPTS            = 8
const MAX_REPAIR_PASSES       = 6

// Hearth in fractional cell coords (cell corner units).
const HEARTH_FX = (CAMPFIRE_WORLD_X - TERRAIN_ORIGIN_M) / TERRAIN_CELL_M
const HEARTH_FZ = (CAMPFIRE_WORLD_Z - TERRAIN_ORIGIN_M) / TERRAIN_CELL_M
const HEARTH_CX = Math.floor(HEARTH_FX)
const HEARTH_CZ = Math.floor(HEARTH_FZ)


// MARK: Working state

interface Work {
	rng       : Rng
	seed      : number
	levels    : Uint8Array
	landforms : Uint8Array
	/** 1 = generator must not change this cell's level. */
	locked    : Uint8Array
}

interface LadderSite {
	low  : number
	high : number
	dir  : number
}


// MARK: generateTerrain
/**
 * Build the terrain map for a layout seed. Always returns a map: when a
 * seed fails validation it retries with derived seeds, and after
 * MAX_ATTEMPTS keeps the last candidate and logs why.
 */
export function generateTerrain(seed: number): TerrainMap {
	let last: TerrainMap | null = null
	let lastFailure = ''
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		const usedSeed = attempt === 0 ? seed >>> 0 : (Math.imul(seed ^ attempt, 0x9E3779B1) + attempt) >>> 0
		const map      = buildOnce(seed, usedSeed, attempt + 1)
		const failure  = validate(map)
		if (failure === '') return map
		last        = map
		lastFailure = failure
	}
	console.log(`terrainGen: generateTerrain: seed ${seed} failed ${MAX_ATTEMPTS} attempts (${lastFailure}), keeping last`)
	return last!
}


// MARK: buildOnce
function buildOnce(
	seed     : number,
	usedSeed : number,
	attempts : number,
): TerrainMap {
	const work: Work = {
		rng       : mulberry32(usedSeed),
		seed      : usedSeed,
		levels    : new Uint8Array(N),
		landforms : new Uint8Array(N),
		locked    : new Uint8Array(N),
	}

	paintMountainBand(work)
	paintLevelField(work)
	stampLandforms(work)
	smooth(work, 2)

	let regions     : Int16Array = new Int16Array(N)
	let regionLevel : number[] = []
	let regionArea  : number[] = []
	let ladders     : TerrainLadder[] = []

	for (let pass = 0; pass < MAX_REPAIR_PASSES; pass++) {
		mergeTinyRegions(work)
		removeDiagonals(work)
		mergeTinyRegions(work)
		removeDiagonals(work)

		const labelled = labelRegions(work.levels)
		regions        = labelled.regions
		regionLevel    = labelled.regionLevel
		regionArea     = labelled.regionArea

		const placed = placeLadders(work, regions, regionLevel)
		ladders      = placed.ladders
		if (placed.unreached.length === 0) break
		flattenRegions(work, regions, placed.unreached)
	}

	const hearthRegion = regions[HEARTH_CZ * W + HEARTH_CX]
	const routeDist    = computeRouteDist(work.levels, ladders)
	const destinations = pickDestinations(regions, regionLevel, regionArea, routeDist)

	return {
		seed,
		usedSeed,
		attempts,
		w            : W,
		h            : H,
		levels       : work.levels,
		regions,
		landforms    : work.landforms,
		regionLevel,
		regionArea,
		hearthCx     : HEARTH_CX,
		hearthCz     : HEARTH_CZ,
		hearthRegion,
		ladders,
		destinations,
		routeDist,
	}
}


// MARK: hearthDist
/** Distance in cells from a cell centre to the hearth point. */
function hearthDist(
	cx: number,
	cz: number,
): number {
	const dx = cx + 0.5 - HEARTH_FX
	const dz = cz + 0.5 - HEARTH_FZ
	return Math.sqrt(dx * dx + dz * dz)
}


// MARK: paintMountainBand
function paintMountainBand(work: Work): void {
	for (let cz = 0; cz < H; cz++) {
		for (let cx = 0; cx < W; cx++) {
			const edge   = Math.min(cx, cz, W - 1 - cx, H - 1 - cz)
			const jitter = Math.floor(valueNoise2(cx / MOUNTAIN_JITTER_SCALE, cz / MOUNTAIN_JITTER_SCALE, work.seed + 77) * (MOUNTAIN_BAND_JITTER + 1))
			if (edge < MOUNTAIN_BAND_MIN + jitter) {
				const i = cz * W + cx
				work.levels[i] = MOUNTAIN
				work.locked[i] = 1
			}
		}
	}
}


// MARK: paintLevelField
function paintLevelField(work: Work): void {
	const field    = new Float32Array(N)
	const interior : number[] = []
	for (let cz = 0; cz < H; cz++) {
		for (let cx = 0; cx < W; cx++) {
			const i = cz * W + cx
			field[i] = fractalNoise2(cx / FIELD_SCALE_CELLS, cz / FIELD_SCALE_CELLS, work.seed, FIELD_OCTAVES, FIELD_GAIN)
			if (work.levels[i] !== MOUNTAIN) interior.push(i)
		}
	}

	const median = quantile(interior.map(i => field[i]), 0.5)

	// Pull the field toward Middle around the hearth so the forced disc
	// does not read as a perfect circle.
	for (const i of interior) {
		const d = hearthDist(i % W, Math.floor(i / W))
		if (d >= HEARTH_BLEND_R) continue
		const t = Math.max(0, (d - HEARTH_FORCE_R) / (HEARTH_BLEND_R - HEARTH_FORCE_R))
		field[i] = median + (field[i] - median) * t
	}

	const values = interior.map(i => field[i])
	const tLow   = quantile(values, LOW_FRACTION)
	const tHigh  = quantile(values, 1 - HIGH_FRACTION)

	for (const i of interior) {
		const v = field[i]
		work.levels[i] = v < tLow ? LOW : v > tHigh ? HIGH : MID
		if (hearthDist(i % W, Math.floor(i / W)) < HEARTH_FORCE_R) {
			work.levels[i]    = MID
			work.locked[i]    = 1
			work.landforms[i] = LANDFORM_HEARTH
		}
	}
}


// MARK: quantile
function quantile(
	values: number[],
	q:      number,
): number {
	const sorted = values.slice().sort((a, b) => a - b)
	const idx    = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))
	return sorted[idx]
}


// MARK: stampLandforms
/**
 * One canyon, ridge, plateau, and basin, each in its own quarter of the
 * compass around the hearth so every direction has a different read.
 */
function stampLandforms(work: Work): void {
	const rng   = work.rng
	const base  = rng() * Math.PI * 2
	const kinds = shuffleInPlace(rng, [LANDFORM_CANYON, LANDFORM_RIDGE, LANDFORM_PLATEAU, LANDFORM_BASIN])
	for (let k = 0; k < kinds.length; k++) {
		const angle = base + k * (Math.PI / 2) + (rng() - 0.5) * 0.6
		switch (kinds[k]) {
			case LANDFORM_CANYON:  stampCanyon(work, angle);  break
			case LANDFORM_RIDGE:   stampRidge(work, angle);   break
			case LANDFORM_PLATEAU: stampPlateau(work, angle); break
			case LANDFORM_BASIN:   stampBasin(work, angle);   break
		}
	}
}


// MARK: stampCell
/** Set one cell's level and tag unless it is locked or off-grid. */
function stampCell(
	work:     Work,
	cx:       number,
	cz:       number,
	level:    number,
	landform: number,
): void {
	if (cx < 0 || cz < 0 || cx >= W || cz >= H) return
	const i = cz * W + cx
	if (work.locked[i]) return
	work.levels[i]    = level
	work.landforms[i] = landform
}


// MARK: stampDisc
function stampDisc(
	work:     Work,
	fx:       number,
	fz:       number,
	radius:   number,
	level:    number,
	landform: number,
): void {
	const r = Math.ceil(radius)
	for (let dz = -r; dz <= r; dz++) {
		for (let dx = -r; dx <= r; dx++) {
			const cx = Math.floor(fx) + dx
			const cz = Math.floor(fz) + dz
			const ex = cx + 0.5 - fx
			const ez = cz + 0.5 - fz
			if (ex * ex + ez * ez <= radius * radius) stampCell(work, cx, cz, level, landform)
		}
	}
}


// MARK: stampPath
/**
 * Walk from (fx, fz) along `angle` with a gentle wander, stamping a disc
 * of `radius` every half cell. Stops at the mountain band.
 */
function stampPath(
	work:     Work,
	fx:       number,
	fz:       number,
	angle:    number,
	length:   number,
	radius:   number,
	level:    number,
	landform: number,
): void {
	let a = angle
	let x = fx
	let z = fz
	for (let s = 0; s < length * 2; s++) {
		const cx = Math.floor(x)
		const cz = Math.floor(z)
		if (cx < 0 || cz < 0 || cx >= W || cz >= H) return
		if (work.levels[cz * W + cx] === MOUNTAIN) return
		stampDisc(work, x, z, radius, level, landform)
		a += (work.rng() - 0.5) * 0.25
		x += Math.cos(a) * 0.5
		z += Math.sin(a) * 0.5
	}
}


// MARK: stampCanyon
/** Low corridor, two cells wide, from just outside the hearth outward. */
function stampCanyon(
	work:  Work,
	angle: number,
): void {
	const start = HEARTH_FORCE_R + 2
	const len   = randInt(work.rng, 14, 22)
	stampPath(work, HEARTH_FX + Math.cos(angle) * start, HEARTH_FZ + Math.sin(angle) * start, angle, len, 1.05, LOW, LANDFORM_CANYON)
}


// MARK: stampRidge
/** High line, two to three cells wide, running across the bearing. */
function stampRidge(
	work:  Work,
	angle: number,
): void {
	const dist   = randInt(work.rng, 9, 13)
	const len    = randInt(work.rng, 12, 20)
	const across = angle + Math.PI / 2 + (work.rng() - 0.5) * 0.8
	const cx     = HEARTH_FX + Math.cos(angle) * dist
	const cz     = HEARTH_FZ + Math.sin(angle) * dist
	const sx     = cx - Math.cos(across) * len / 2
	const sz     = cz - Math.sin(across) * len / 2
	const radius = work.rng() < 0.5 ? 1.05 : 1.5
	stampPath(work, sx, sz, across, len, radius, HIGH, LANDFORM_RIDGE)
}


// MARK: stampPlateau
/** Broad High blob far out: the obvious "up there" destination. */
function stampPlateau(
	work:  Work,
	angle: number,
): void {
	const dist   = randInt(work.rng, 15, 21)
	const radius = 3.5 + work.rng() * 2.5
	stampBlob(work, HEARTH_FX + Math.cos(angle) * dist, HEARTH_FZ + Math.sin(angle) * dist, radius, HIGH, LANDFORM_PLATEAU)
}


// MARK: stampBasin
/** Low blob ringed by at least Middle ground, so it reads as a bowl. */
function stampBasin(
	work:  Work,
	angle: number,
): void {
	const dist   = randInt(work.rng, 12, 18)
	const radius = 3 + work.rng() * 2
	const fx     = HEARTH_FX + Math.cos(angle) * dist
	const fz     = HEARTH_FZ + Math.sin(angle) * dist
	const ring   = Math.ceil(radius + 2)
	for (let dz = -ring; dz <= ring; dz++) {
		for (let dx = -ring; dx <= ring; dx++) {
			const cx = Math.floor(fx) + dx
			const cz = Math.floor(fz) + dz
			if (cx < 0 || cz < 0 || cx >= W || cz >= H) continue
			const d = Math.hypot(cx + 0.5 - fx, cz + 0.5 - fz)
			const i = cz * W + cx
			if (d > radius + 0.5 && d <= radius + 2 && work.levels[i] === LOW) stampCell(work, cx, cz, MID, LANDFORM_NONE)
		}
	}
	stampBlob(work, fx, fz, radius, LOW, LANDFORM_BASIN)
}


// MARK: stampBlob
/** Disc with a noisy rim so blobs do not read as circles. */
function stampBlob(
	work:     Work,
	fx:       number,
	fz:       number,
	radius:   number,
	level:    number,
	landform: number,
): void {
	const r = Math.ceil(radius + 2)
	for (let dz = -r; dz <= r; dz++) {
		for (let dx = -r; dx <= r; dx++) {
			const cx = Math.floor(fx) + dx
			const cz = Math.floor(fz) + dz
			const d  = Math.hypot(cx + 0.5 - fx, cz + 0.5 - fz)
			const rim = radius + (valueNoise2(cx / 2.5, cz / 2.5, work.seed + landform * 31) - 0.5) * 3
			if (d <= rim) stampCell(work, cx, cz, level, landform)
		}
	}
}


// MARK: smooth
/**
 * Majority filter: an untagged cell adopts a level held by 6+ of its 8
 * neighbours. Stamped landforms are left alone so thin ridges survive.
 */
function smooth(
	work:   Work,
	passes: number,
): void {
	const counts = new Int32Array(4)
	for (let p = 0; p < passes; p++) {
		const next = work.levels.slice()
		for (let cz = 1; cz < H - 1; cz++) {
			for (let cx = 1; cx < W - 1; cx++) {
				const i = cz * W + cx
				if (work.locked[i] || work.landforms[i] !== LANDFORM_NONE) continue
				counts.fill(0)
				for (let dz = -1; dz <= 1; dz++) {
					for (let dx = -1; dx <= 1; dx++) {
						if (dx === 0 && dz === 0) continue
						const lv = work.levels[(cz + dz) * W + cx + dx]
						if (lv !== MOUNTAIN) counts[lv]++
					}
				}
				for (let lv = LOW; lv <= HIGH; lv++) {
					if (counts[lv] >= 6 && lv !== work.levels[i]) next[i] = lv
				}
			}
		}
		work.levels = next
	}
}


// MARK: labelRegions
/** 4-connected same-level components. Mountain cells get -1. */
function labelRegions(levels: Uint8Array): {
	regions     : Int16Array
	regionLevel : number[]
	regionArea  : number[]
} {
	const regions     = new Int16Array(N).fill(-1)
	const regionLevel : number[] = []
	const regionArea  : number[] = []
	const stack       : number[] = []
	for (let start = 0; start < N; start++) {
		if (regions[start] !== -1 || levels[start] === MOUNTAIN) continue
		const id = regionLevel.length
		const lv = levels[start]
		let area = 0
		regions[start] = id
		stack.push(start)
		while (stack.length > 0) {
			const i  = stack.pop()!
			const cx = i % W
			const cz = (i - cx) / W
			area++
			for (let d = 0; d < 4; d++) {
				const nx = cx + DIR_DX[d]
				const nz = cz + DIR_DZ[d]
				if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue
				const j = nz * W + nx
				if (regions[j] !== -1 || levels[j] !== lv) continue
				regions[j] = id
				stack.push(j)
			}
		}
		regionLevel.push(lv)
		regionArea.push(area)
	}
	return { regions, regionLevel, regionArea }
}


// MARK: mergeTinyRegions
/** Fold regions under MIN_REGION_CELLS into their most common neighbour level. */
function mergeTinyRegions(work: Work): void {
	const { regions, regionArea } = labelRegions(work.levels)
	const counts = new Int32Array(4)
	const members = new Map<number, number[]>()
	for (let i = 0; i < N; i++) {
		const r = regions[i]
		if (r < 0 || regionArea[r] >= MIN_REGION_CELLS) continue
		let list = members.get(r)
		if (!list) {
			list = []
			members.set(r, list)
		}
		list.push(i)
	}
	for (const cells of members.values()) {
		if (cells.some(i => work.locked[i])) continue
		const own = work.levels[cells[0]]
		counts.fill(0)
		for (const i of cells) {
			const cx = i % W
			const cz = (i - cx) / W
			for (let d = 0; d < 4; d++) {
				const nx = cx + DIR_DX[d]
				const nz = cz + DIR_DZ[d]
				if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue
				const lv = work.levels[nz * W + nx]
				if (lv !== own && lv !== MOUNTAIN) counts[lv]++
			}
		}
		let best = MID
		let bestCount = -1
		for (let lv = LOW; lv <= HIGH; lv++) {
			if (counts[lv] > bestCount) {
				best      = lv
				bestCount = counts[lv]
			}
		}
		for (const i of cells) work.levels[i] = best
	}
}


// MARK: removeDiagonals
/**
 * For every step threshold, remove 2×2 blocks where the two high cells
 * touch only at a corner. The cliff kit has no piece for that case.
 * Raises one of the low cells; if both are locked, lowers a high one.
 */
function removeDiagonals(work: Work): void {
	const lv = work.levels
	for (let iter = 0; iter < 8; iter++) {
		let changed = false
		for (let t = MID; t <= MOUNTAIN; t++) {
			for (let cz = 0; cz < H - 1; cz++) {
				for (let cx = 0; cx < W - 1; cx++) {
					const a = cz * W + cx
					const b = a + 1
					const c = a + W
					const d = c + 1
					const ha = lv[a] >= t
					const hb = lv[b] >= t
					const hc = lv[c] >= t
					const hd = lv[d] >= t
					let lowPair: number[] | null  = null
					let highPair: number[] | null = null
					if (ha && hd && !hb && !hc) {
						lowPair  = [b, c]
						highPair = [a, d]
					} else if (hb && hc && !ha && !hd) {
						lowPair  = [a, d]
						highPair = [b, c]
					}
					if (lowPair === null || highPair === null) continue
					const raise = lowPair.find(i => !work.locked[i])
					if (raise !== undefined) {
						lv[raise] = t
					} else {
						const lower = highPair.find(i => !work.locked[i])
						if (lower === undefined) continue
						lv[lower] = t - 1
					}
					changed = true
				}
			}
		}
		if (!changed) return
	}
}


// MARK: findLadderSites
/**
 * Every (low, high) cell pair one level apart where the cliff runs
 * straight for three cells and both sides have standing room.
 */
function findLadderSites(levels: Uint8Array): LadderSite[] {
	const sites: LadderSite[] = []
	const at = (cx: number, cz: number): number =>
		cx < 0 || cz < 0 || cx >= W || cz >= H ? MOUNTAIN : levels[cz * W + cx]
	for (let cz = 0; cz < H; cz++) {
		for (let cx = 0; cx < W; cx++) {
			const lowLv = levels[cz * W + cx]
			if (lowLv === MOUNTAIN) continue
			for (let d = 0; d < 4; d++) {
				const hx = cx + DIR_DX[d]
				const hz = cz + DIR_DZ[d]
				const highLv = at(hx, hz)
				if (highLv !== lowLv + 1 || highLv === MOUNTAIN) continue
				if (at(cx - DIR_DX[d], cz - DIR_DZ[d]) !== lowLv) continue
				if (at(hx + DIR_DX[d], hz + DIR_DZ[d]) !== highLv) continue
				let straight = true
				for (const p of [(d + 1) % 4, (d + 3) % 4]) {
					if (at(cx + DIR_DX[p], cz + DIR_DZ[p]) !== lowLv)  straight = false
					if (at(hx + DIR_DX[p], hz + DIR_DZ[p]) !== highLv) straight = false
				}
				if (!straight) continue
				sites.push({ low: cz * W + cx, high: hz * W + hx, dir: d })
			}
		}
	}
	return sites
}


// MARK: placeLadders
/**
 * Spanning tree from the hearth region: each newly reached region gets
 * one ladder to the region that reached it. Long shared cliffs get a
 * second ladder far from the first. Returns regions no ladder reaches.
 */
function placeLadders(
	work:        Work,
	regions:     Int16Array,
	regionLevel: number[],
): { ladders: TerrainLadder[]; unreached: number[] } {
	const pairSites = new Map<string, LadderSite[]>()
	const adjacency = new Map<number, Set<number>>()
	for (const site of findLadderSites(work.levels)) {
		const ra  = regions[site.low]
		const rb  = regions[site.high]
		const key = ra < rb ? `${ra},${rb}` : `${rb},${ra}`
		let list = pairSites.get(key)
		if (!list) {
			list = []
			pairSites.set(key, list)
		}
		list.push(site)
		if (!adjacency.has(ra)) adjacency.set(ra, new Set())
		if (!adjacency.has(rb)) adjacency.set(rb, new Set())
		adjacency.get(ra)!.add(rb)
		adjacency.get(rb)!.add(ra)
	}

	const chosen  : LadderSite[] = []
	const visited = new Set<number>()
	const hearth  = regions[HEARTH_CZ * W + HEARTH_CX]
	const queue   = [hearth]
	visited.add(hearth)
	while (queue.length > 0) {
		const r = queue.shift()!
		const next = Array.from(adjacency.get(r) ?? []).sort((a, b) => a - b)
		for (const n of next) {
			if (visited.has(n)) continue
			visited.add(n)
			queue.push(n)
			const key   = r < n ? `${r},${n}` : `${n},${r}`
			const sites = pairSites.get(key)!
			chosen.push(sites[Math.floor(work.rng() * sites.length)])
		}
	}

	// Second ladder on long shared cliffs, tree edge or not.
	for (const sites of pairSites.values()) {
		if (sites.length < SECOND_LADDER_MIN_SITES) continue
		const existing = chosen.filter(c => sites.includes(c))
		if (existing.length >= 2) continue
		let best: LadderSite | null = null
		let bestSep = -1
		for (const s of sites) {
			let sep = Infinity
			for (const e of existing) sep = Math.min(sep, cellSep(s.low, e.low))
			if (existing.length === 0) sep = 0
			if (sep > bestSep) {
				best    = s
				bestSep = sep
			}
		}
		if (best === null) continue
		if (existing.length > 0 && bestSep < SECOND_LADDER_MIN_SEP) continue
		chosen.push(best)
	}

	const unreached: number[] = []
	for (let r = 0; r < regionLevel.length; r++) {
		if (!visited.has(r)) unreached.push(r)
	}
	return { ladders: chosen.map(s => toLadder(s, work.levels)), unreached }
}


// MARK: cellSep
/** Chebyshev distance in cells between two flat indices. */
function cellSep(
	a: number,
	b: number,
): number {
	return Math.max(Math.abs((a % W) - (b % W)), Math.abs(Math.floor(a / W) - Math.floor(b / W)))
}


// MARK: toLadder
function toLadder(
	site:   LadderSite,
	levels: Uint8Array,
): TerrainLadder {
	const lowCx  = site.low % W
	const lowCz  = (site.low - lowCx) / W
	const highCx = site.high % W
	const highCz = (site.high - highCx) / W
	const lowLv  = levels[site.low]
	const c      = cellCenterWorld(lowCx, lowCz)
	const dx     = DIR_DX[site.dir]
	const dz     = DIR_DZ[site.dir]
	const edgeX  = c.x + dx * TERRAIN_CELL_M / 2
	const edgeZ  = c.z + dz * TERRAIN_CELL_M / 2
	return {
		lowCx,
		lowCz,
		highCx,
		highCz,
		dir      : site.dir,
		lowLevel : lowLv,
		bottom   : { x: edgeX - dx * LADDER_FOOT_M, y: groundYForLevel(lowLv),     z: edgeZ - dz * LADDER_FOOT_M },
		top      : { x: edgeX + dx * LADDER_LAND_M, y: groundYForLevel(lowLv + 1), z: edgeZ + dz * LADDER_LAND_M },
	}
}


// MARK: flattenRegions
/** Fold unreachable regions into their most common neighbour level. */
function flattenRegions(
	work:      Work,
	regions:   Int16Array,
	unreached: number[],
): void {
	const set    = new Set(unreached)
	const counts = new Int32Array(4)
	const cellsOf = new Map<number, number[]>()
	for (let i = 0; i < N; i++) {
		const r = regions[i]
		if (!set.has(r)) continue
		let list = cellsOf.get(r)
		if (!list) {
			list = []
			cellsOf.set(r, list)
		}
		list.push(i)
	}
	for (const cells of cellsOf.values()) {
		const own = work.levels[cells[0]]
		counts.fill(0)
		for (const i of cells) {
			const cx = i % W
			const cz = (i - cx) / W
			for (let d = 0; d < 4; d++) {
				const nx = cx + DIR_DX[d]
				const nz = cz + DIR_DZ[d]
				if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue
				const lv = work.levels[nz * W + nx]
				if (lv !== own && lv !== MOUNTAIN) counts[lv]++
			}
		}
		// Prefer a level one step away so the merged region gets ladder sites.
		let best = MID
		let bestCount = -1
		for (let lv = LOW; lv <= HIGH; lv++) {
			const weight = counts[lv] * (Math.abs(lv - own) === 1 ? 2 : 1)
			if (weight > bestCount) {
				best      = lv
				bestCount = weight
			}
		}
		for (const i of cells) {
			if (!work.locked[i]) work.levels[i] = best
		}
	}
}


// MARK: computeRouteDist
/**
 * BFS steps from the hearth cell. Walk between same-level neighbours,
 * drop to any lower neighbour, and climb only at ladders.
 */
function computeRouteDist(
	levels:  Uint8Array,
	ladders: TerrainLadder[],
): Int32Array {
	const dist  = new Int32Array(N).fill(-1)
	const climb = new Map<number, number[]>()
	for (const l of ladders) {
		const lo = l.lowCz * W + l.lowCx
		const hi = l.highCz * W + l.highCx
		if (!climb.has(lo)) climb.set(lo, [])
		if (!climb.has(hi)) climb.set(hi, [])
		climb.get(lo)!.push(hi)
		climb.get(hi)!.push(lo)
	}
	const start = HEARTH_CZ * W + HEARTH_CX
	const queue = new Int32Array(N)
	let head = 0
	let tail = 0
	dist[start]   = 0
	queue[tail++] = start
	while (head < tail) {
		const i  = queue[head++]
		const cx = i % W
		const cz = (i - cx) / W
		const lv = levels[i]
		const visit = (j: number): void => {
			if (dist[j] !== -1) return
			dist[j]       = dist[i] + 1
			queue[tail++] = j
		}
		for (let d = 0; d < 4; d++) {
			const nx = cx + DIR_DX[d]
			const nz = cz + DIR_DZ[d]
			if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue
			const j  = nz * W + nx
			const nl = levels[j]
			if (nl === MOUNTAIN || nl > lv) continue
			visit(j)
		}
		for (const j of climb.get(i) ?? []) visit(j)
	}
	return dist
}


// MARK: pickDestinations
/**
 * Up to DEST_MAX large Low or High regions, farthest route first, at
 * least DEST_MIN_ANGLE_RAD apart as seen from the hearth.
 */
function pickDestinations(
	regions:     Int16Array,
	regionLevel: number[],
	regionArea:  number[],
	routeDist:   Int32Array,
): TerrainDestination[] {
	const sumX  = new Float64Array(regionLevel.length)
	const sumZ  = new Float64Array(regionLevel.length)
	const sumD  = new Float64Array(regionLevel.length)
	for (let i = 0; i < N; i++) {
		const r = regions[i]
		if (r < 0) continue
		sumX[r] += i % W
		sumZ[r] += Math.floor(i / W)
		sumD[r] += Math.max(0, routeDist[i])
	}

	const candidates: TerrainDestination[] = []
	for (let r = 0; r < regionLevel.length; r++) {
		const lv = regionLevel[r]
		if (lv === MID || regionArea[r] < DEST_MIN_AREA) continue
		const mx = sumX[r] / regionArea[r]
		const mz = sumZ[r] / regionArea[r]
		// Region cell nearest the centroid that is surrounded by its own region.
		let best = -1
		let bestD = Infinity
		for (let i = 0; i < N; i++) {
			if (regions[i] !== r || routeDist[i] < 0) continue
			const cx = i % W
			const cz = (i - cx) / W
			let interior = true
			for (let d = 0; d < 4; d++) {
				const nx = cx + DIR_DX[d]
				const nz = cz + DIR_DZ[d]
				if (nx < 0 || nz < 0 || nx >= W || nz >= H || regions[nz * W + nx] !== r) interior = false
			}
			const dd = (cx - mx) * (cx - mx) + (cz - mz) * (cz - mz) + (interior ? 0 : 1000)
			if (dd < bestD) {
				best  = i
				bestD = dd
			}
		}
		if (best < 0) continue
		candidates.push({
			region : r,
			level  : lv,
			area   : regionArea[r],
			cx     : best % W,
			cz     : Math.floor(best / W),
			route  : Math.round(sumD[r] / regionArea[r]),
		})
	}
	// Far and big both matter: a long trip to a pocket is not a destination.
	const score = (d: TerrainDestination): number => d.route * Math.sqrt(d.area)
	candidates.sort((a, b) => score(b) - score(a) || a.region - b.region)

	const out: TerrainDestination[] = []
	for (const c of candidates) {
		if (out.length >= DEST_MAX) break
		const ang = Math.atan2(c.cz + 0.5 - HEARTH_FZ, c.cx + 0.5 - HEARTH_FX)
		const clash = out.some(o => {
			const oa   = Math.atan2(o.cz + 0.5 - HEARTH_FZ, o.cx + 0.5 - HEARTH_FX)
			let diff   = Math.abs(ang - oa) % (Math.PI * 2)
			if (diff > Math.PI) diff = Math.PI * 2 - diff
			return diff < DEST_MIN_ANGLE_RAD
		})
		if (!clash) out.push(c)
	}
	return out
}


// MARK: validate
/** Empty string when the map is playable, else the first failure. */
function validate(map: TerrainMap): string {
	if (map.hearthRegion < 0) return 'hearth on mountain'
	if (map.regionArea[map.hearthRegion] < MIN_HEARTH_REGION_CELLS) return `hearth region ${map.regionArea[map.hearthRegion]} cells`
	if (map.ladders.length < MIN_LADDERS) return `${map.ladders.length} ladders`
	let hasLow  = false
	let hasHigh = false
	for (let r = 0; r < map.regionLevel.length; r++) {
		if (map.regionLevel[r] === LOW)  hasLow  = true
		if (map.regionLevel[r] === HIGH) hasHigh = true
	}
	if (!hasLow)  return 'no low region'
	if (!hasHigh) return 'no high region'
	for (let i = 0; i < N; i++) {
		if (map.regions[i] >= 0 && map.routeDist[i] < 0) return 'unreachable cell'
	}
	if (map.destinations.length === 0) return 'no destination'
	return ''
}


// MARK: LevelRect

/** A run of same-level cells merged into one box. */
export interface LevelRect {
	cx    : number
	cz    : number
	w     : number
	h     : number
	level : number
}


// MARK: mergeLevelRects
/**
 * Greedy rectangle decomposition of the level grid: scan in row order,
 * grow each unclaimed cell as wide as the same level allows, then as
 * deep as full matching rows allow. Turns ~3800 cells into a few
 * hundred boxes for the greybox renderer.
 */
export function mergeLevelRects(map: TerrainMap): LevelRect[] {
	const used = new Uint8Array(map.w * map.h)
	const out: LevelRect[] = []
	for (let cz = 0; cz < map.h; cz++) {
		for (let cx = 0; cx < map.w; cx++) {
			const i = cz * map.w + cx
			if (used[i]) continue
			const level = map.levels[i]

			let w = 1
			while (cx + w < map.w) {
				const j = cz * map.w + cx + w
				if (used[j] || map.levels[j] !== level) break
				w++
			}

			let h = 1
			while (cz + h < map.h) {
				let rowMatches = true
				for (let k = 0; k < w; k++) {
					const j = (cz + h) * map.w + cx + k
					if (used[j] || map.levels[j] !== level) {
						rowMatches = false
						break
					}
				}
				if (!rowMatches) break
				h++
			}

			for (let dz = 0; dz < h; dz++) {
				for (let dx = 0; dx < w; dx++) used[(cz + dz) * map.w + cx + dx] = 1
			}
			out.push({ cx, cz, w, h, level })
		}
	}
	return out
}


// MARK: Cliff piece classification

/**
 * Dual-grid piece at one grid corner for one step threshold. 'diag' is
 * two high cells touching only at the corner; the generator removes
 * these, so seeing one means a cleanup bug.
 */
export type CornerPiece = 'none' | 'outer' | 'edge' | 'inner' | 'top' | 'diag'


// MARK: classifyCorner
/**
 * Piece for the grid corner at (vx, vz) and threshold `t`: looks at the
 * four cells touching that corner and counts those at or above `t`.
 * Off-grid cells count as mountain. Also returns the rotation in
 * quarter turns so the renderer and the stats agree.
 */
export function classifyCorner(
	levels: Uint8Array,
	vx:     number,
	vz:     number,
	t:      number,
): { piece: CornerPiece; rot: number } {
	const at = (cx: number, cz: number): boolean =>
		cx < 0 || cz < 0 || cx >= W || cz >= H ? MOUNTAIN >= t : levels[cz * W + cx] >= t
	// Bits: SW, SE, NE, NW (counter-clockwise from SW).
	const sw = at(vx - 1, vz - 1)
	const se = at(vx,     vz - 1)
	const ne = at(vx,     vz)
	const nw = at(vx - 1, vz)
	const bits  = [sw, se, ne, nw]
	const count = bits.filter(b => b).length
	if (count === 0) return { piece: 'none', rot: 0 }
	if (count === 4) return { piece: 'top',  rot: 0 }
	if (count === 1) return { piece: 'outer', rot: bits.indexOf(true) }
	if (count === 3) return { piece: 'inner', rot: bits.indexOf(false) }
	for (let k = 0; k < 4; k++) {
		if (bits[k] && bits[(k + 1) % 4]) return { piece: 'edge', rot: k }
	}
	return { piece: 'diag', rot: sw ? 0 : 1 }
}


// MARK: terrainPieceStats
/**
 * Cliff pieces the renderer will need for this map, per type, across
 * every step threshold. Used by the preview tool and load logging.
 */
export function terrainPieceStats(map: TerrainMap): {
	outer   : number
	edge    : number
	inner   : number
	diag    : number
	ladders : number
	total   : number
} {
	let outer = 0
	let edge  = 0
	let inner = 0
	let diag  = 0
	for (let t = MID; t <= MOUNTAIN; t++) {
		for (let vz = 0; vz <= H; vz++) {
			for (let vx = 0; vx <= W; vx++) {
				const { piece } = classifyCorner(map.levels, vx, vz, t)
				if (piece === 'outer')      outer++
				else if (piece === 'edge')  edge++
				else if (piece === 'inner') inner++
				else if (piece === 'diag')  diag++
			}
		}
	}
	return { outer, edge, inner, diag, ladders: map.ladders.length, total: outer + edge + inner + map.ladders.length }
}
