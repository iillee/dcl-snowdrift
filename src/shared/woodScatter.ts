/**
 * woodScatter.ts - deterministic wood-chunk placement across the playfield.
 *
 * Pure function of (cycleSeed) -> WoodChunk[]. Runs identically on
 * server and client, so positions never need to sync over the wire -
 * only the active/inactive set does (owned server-side; see
 * src/server/wood.ts).
 *
 * Four bands, all measured from the hearth:
 *   - Close (11-18 m): a random teaching scatter just past the bare
 *     hearth melt. Not a ring. Not on the first snow tile.
 *   - Near  (15-35 m): one-torch trip. Mostly branches, a few logs.
 *   - Far   (35-80 m): gather belt, peak density at 50 m.
 *   - Outer (80-160 m): thin field toward the far trees and the
 *     second generation of hidden fires, peak density at 110 m.
 *
 * A piece whose body would cross a cliff cell is skipped. Kind is
 * stamped at placement (stable per seed). Wilderness is kindling.
 * Each scattered tree_4 holds four logs at the trunk.
 * Those are not world meshes: the player chops the tree, and each
 * chop spends one of the four.
 *
 * Index is the chunk's position in the returned array. Stable per
 * seed, so the server can broadcast just `{ idx }` and every client
 * knows which chunk to spawn/remove.
 */

import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { scatterProps } from 'src/shared/props/scatter'
import { MAZE_GRID_HEIGHT, MAZE_GRID_WIDTH, MAZE_ORIGIN_OFFSET_METERS, MAZE_TILE_WORLD_METERS } from 'src/shared/settings'
import { WOOD_KIND_BRANCH, WOOD_KIND_LOG } from 'src/shared/woodKind'


// MARK: Tuning constants
/** Close teaching scatter. Every one is live. */
export const WOOD_CLOSE_POOL = 8
/** Near-ring pool size. */
export const WOOD_NEAR_POOL = 50
/** Far-belt pool size. */
export const WOOD_FAR_POOL = 150
/** Outer-band pool size. Sparse, so the far trees stay worth the walk. */
export const WOOD_OUTER_POOL = 50
/** Full scatter list length. */
export const WOOD_POOL_SIZE = WOOD_CLOSE_POOL + WOOD_NEAR_POOL + WOOD_FAR_POOL + WOOD_OUTER_POOL

/** All of the close scatter is live. The lesson is the find, not a subset. */
export const WOOD_CLOSE_ACTIVE = WOOD_CLOSE_POOL
/**
 * Active near chunks at cycle start. One torch should be able to
 * finish a trip into this ring.
 */
export const WOOD_NEAR_ACTIVE = 12
/** Active far chunks. Leave the long walk in the field. */
export const WOOD_FAR_ACTIVE = 28
/** Active outer chunks. A staging fire, not the hearth, covers these. */
export const WOOD_OUTER_ACTIVE = 12
/** Total active buried chunks at cycle start. No in-run refill. */
export const WOOD_ACTIVE_TARGET = WOOD_CLOSE_ACTIVE + WOOD_NEAR_ACTIVE + WOOD_FAR_ACTIVE + WOOD_OUTER_ACTIVE

/**
 * Inner edge of the close scatter (m). The hearth melt is 8 m, so
 * the first few meters of snow can still be empty.
 */
export const WOOD_CLOSE_MIN_M = 11
/** Outer edge of the close scatter (m). Overlaps the near band's inner edge. */
export const WOOD_CLOSE_MAX_M = 18
/**
 * Minimum centre gap inside the close scatter (m). Stops two pieces
 * sharing one melt. It is not a radial spacing rule.
 */
export const WOOD_CLOSE_GAP_M = 3.5

/** Inner edge of the near ring (m). Outside the Warm melt ring. */
export const WOOD_NEAR_MIN_M = 15
/** Outer edge of the near ring / inner edge of the far belt (m). */
export const WOOD_NEAR_MAX_M = 35
/** Radius (m) where far-belt density peaks. */
export const WOOD_PEAK_RADIUS_M = 50
/** Outer edge of the far belt / inner edge of the outer band (m). */
export const WOOD_FAR_MAX_M = 80
/** Radius (m) where outer-band density peaks. */
export const WOOD_OUTER_PEAK_M = 110
/** Hard outer sampling radius (m). Just inside the furthest tree. */
export const WOOD_OUTER_MAX_M = 160
/**
 * How far a buried piece can stick from its centre. Half the long
 * axis of branch.glb, so a branch lying toward a cliff still misses it.
 */
const WOOD_CLIFF_REACH_M = 2.1

/**
 * Chance a placed chunk is a full log instead of a branch. About
 * 12 % of the live buried pieces.
 */
export const WOOD_LOG_CHANCE = 0.12

export const WOOD_BAND_NEAR  = 0
export const WOOD_BAND_FAR   = 1
export const WOOD_BAND_TREE  = 2
export const WOOD_BAND_OUTER = 3
export const WOOD_BAND_CLOSE = 4

/** Chops each scattered tree still holds at cycle start. */
export const WOOD_LOGS_PER_TREE = 4
/** How close the player must stand to chop, measured from the trunk. */
export const TREE_CHOP_RADIUS_M = 5
export const TREE_CHOP_RADIUS_SQ = TREE_CHOP_RADIUS_M * TREE_CHOP_RADIUS_M
/** Prop id the chops attach to. Matches PROP_CATALOG. */
const TREE_PROP_ID = 'tree_4'


// MARK: Types
export interface WoodChunk {
	/** Stable across (seed) - matches the array index of the scatter. */
	idx    : number
	worldX : number
	worldZ : number
	/** WOOD_KIND_BRANCH or WOOD_KIND_LOG. */
	kind   : number
	/** WOOD_BAND_CLOSE, WOOD_BAND_NEAR, WOOD_BAND_FAR, WOOD_BAND_OUTER, or WOOD_BAND_TREE. */
	band   : number
	/** Which scattered tree this log belongs to. */
	treeIndex?: number
}

export interface WoodTreeSite {
	treeIndex: number
	worldX   : number
	worldZ   : number
	yawDeg   : number
}


// MARK: Playfield centre (m)
const CENTRE_X = MAZE_ORIGIN_OFFSET_METERS + (MAZE_GRID_WIDTH  * MAZE_TILE_WORLD_METERS) / 2
const CENTRE_Z = MAZE_ORIGIN_OFFSET_METERS + (MAZE_GRID_HEIGHT * MAZE_TILE_WORLD_METERS) / 2


// MARK: Local RNG
// Mulberry32 with a dedicated salt so we never perturb the maze or
// prop RNG streams.
function makeRng(seed: number): () => number {
	let s = seed | 0
	return () => {
		s |= 0
		s = (s + 0x6D2B79F5) | 0
		let t = s
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}


// MARK: pickKind
function pickKind(rng: () => number): number {
	return rng() < WOOD_LOG_CHANCE ? WOOD_KIND_LOG : WOOD_KIND_BRANCH
}


// MARK: farDensityWeight
/**
 * Acceptance probability for a far-belt candidate at distance `r`.
 * Zero inside the near ring, ramps to 1.0 at WOOD_PEAK_RADIUS_M, then
 * decays toward WOOD_FAR_MAX_M.
 */
function farDensityWeight(r: number): number {
	if (r < WOOD_NEAR_MAX_M) return 0
	if (r > WOOD_FAR_MAX_M)  return 0
	if (r <= WOOD_PEAK_RADIUS_M) {
		const span = WOOD_PEAK_RADIUS_M - WOOD_NEAR_MAX_M
		return (r - WOOD_NEAR_MAX_M) / span
	}
	const span = WOOD_FAR_MAX_M - WOOD_PEAK_RADIUS_M
	const t    = (r - WOOD_PEAK_RADIUS_M) / span
	return 1 - 0.5 * t
}


// MARK: outerDensityWeight
/**
 * Acceptance probability for an outer-band candidate at distance `r`.
 * Zero inside the far belt, ramps to 1.0 at WOOD_OUTER_PEAK_M, then
 * decays toward WOOD_OUTER_MAX_M.
 */
function outerDensityWeight(r: number): number {
	if (r < WOOD_FAR_MAX_M)   return 0
	if (r > WOOD_OUTER_MAX_M) return 0
	if (r <= WOOD_OUTER_PEAK_M) {
		const span = WOOD_OUTER_PEAK_M - WOOD_FAR_MAX_M
		return (r - WOOD_FAR_MAX_M) / span
	}
	const span = WOOD_OUTER_MAX_M - WOOD_OUTER_PEAK_M
	const t    = (r - WOOD_OUTER_PEAK_M) / span
	return 1 - 0.5 * t
}


// MARK: onCliff
/**
 * True when a piece centred at (x, z) would cross a cliff cell.
 * `reserved` is keyed `tx,tz,0`, the same footprint the trees use.
 */
function onCliff(
	x       : number,
	z       : number,
	reserved: ReadonlySet<string>,
): boolean {
	const tile   = MAZE_TILE_WORLD_METERS
	const origin = MAZE_ORIGIN_OFFSET_METERS
	const tx0 = Math.floor((x - WOOD_CLIFF_REACH_M - origin) / tile)
	const tx1 = Math.floor((x + WOOD_CLIFF_REACH_M - origin) / tile)
	const tz0 = Math.floor((z - WOOD_CLIFF_REACH_M - origin) / tile)
	const tz1 = Math.floor((z + WOOD_CLIFF_REACH_M - origin) / tile)
	for (let tx = tx0; tx <= tx1; tx++) {
		for (let tz = tz0; tz <= tz1; tz++) {
			if (reserved.has(`${tx},${tz},0`)) return true
		}
	}
	return false
}


// MARK: placeCloseBand
/**
 * Random points in the close annulus. Angle and radius are both
 * draws, so a seed can clump or leave a gap. The gap test only
 * refuses a pile-up.
 */
function placeCloseBand(
	rng     : () => number,
	out     : WoodChunk[],
	reserved: ReadonlySet<string>,
): void {
	const min2 = WOOD_CLOSE_MIN_M * WOOD_CLOSE_MIN_M
	const max2 = WOOD_CLOSE_MAX_M * WOOD_CLOSE_MAX_M
	const span = max2 - min2
	const gap2 = WOOD_CLOSE_GAP_M * WOOD_CLOSE_GAP_M
	const MAX_ATTEMPTS = WOOD_CLOSE_POOL * 40
	let attempts = 0
	while (out.length < WOOD_CLOSE_POOL && attempts < MAX_ATTEMPTS) {
		attempts++
		const r     = Math.sqrt(min2 + rng() * span)
		const theta = 2 * Math.PI * rng()
		const x     = CENTRE_X + r * Math.cos(theta)
		const z     = CENTRE_Z + r * Math.sin(theta)
		if (onCliff(x, z, reserved)) continue
		let piled = false
		for (let i = 0; i < out.length; i++) {
			const dx = out[i].worldX - x
			const dz = out[i].worldZ - z
			if (dx * dx + dz * dz < gap2) {
				piled = true
				break
			}
		}
		if (piled) continue
		out.push({
			idx   : out.length,
			worldX: x,
			worldZ: z,
			kind  : pickKind(rng),
			band  : WOOD_BAND_CLOSE,
		})
	}
}


// MARK: placeNearBand
function placeNearBand(
	rng     : () => number,
	out     : WoodChunk[],
	reserved: ReadonlySet<string>,
): void {
	const min2 = WOOD_NEAR_MIN_M * WOOD_NEAR_MIN_M
	const max2 = WOOD_NEAR_MAX_M * WOOD_NEAR_MAX_M
	const span = max2 - min2
	const end  = WOOD_CLOSE_POOL + WOOD_NEAR_POOL
	const MAX_ATTEMPTS = WOOD_NEAR_POOL * 20
	let attempts = 0
	while (out.length < end && attempts < MAX_ATTEMPTS) {
		attempts++
		const r     = Math.sqrt(min2 + rng() * span)
		const theta = 2 * Math.PI * rng()
		const x     = CENTRE_X + r * Math.cos(theta)
		const z     = CENTRE_Z + r * Math.sin(theta)
		if (onCliff(x, z, reserved)) continue
		out.push({
			idx   : out.length,
			worldX: x,
			worldZ: z,
			kind  : pickKind(rng),
			band  : WOOD_BAND_NEAR,
		})
	}
}


// MARK: placeFarBand
function placeFarBand(
	rng     : () => number,
	out     : WoodChunk[],
	reserved: ReadonlySet<string>,
): void {
	const target = WOOD_CLOSE_POOL + WOOD_NEAR_POOL + WOOD_FAR_POOL
	const MAX_ATTEMPTS = WOOD_FAR_POOL * 20
	let attempts = 0
	while (out.length < target && attempts < MAX_ATTEMPTS) {
		attempts++
		const u     = rng()
		const v     = rng()
		const r     = WOOD_FAR_MAX_M * Math.sqrt(u)
		const theta = 2 * Math.PI * v
		if (rng() > farDensityWeight(r)) continue
		const x = CENTRE_X + r * Math.cos(theta)
		const z = CENTRE_Z + r * Math.sin(theta)
		if (onCliff(x, z, reserved)) continue
		out.push({
			idx   : out.length,
			worldX: x,
			worldZ: z,
			kind  : pickKind(rng),
			band  : WOOD_BAND_FAR,
		})
	}
}


// MARK: placeOuterBand
function placeOuterBand(
	rng     : () => number,
	out     : WoodChunk[],
	reserved: ReadonlySet<string>,
): void {
	const min2 = WOOD_FAR_MAX_M * WOOD_FAR_MAX_M
	const max2 = WOOD_OUTER_MAX_M * WOOD_OUTER_MAX_M
	const span = max2 - min2
	const MAX_ATTEMPTS = WOOD_OUTER_POOL * 40
	let attempts = 0
	while (out.length < WOOD_POOL_SIZE && attempts < MAX_ATTEMPTS) {
		attempts++
		const r     = Math.sqrt(min2 + rng() * span)
		const theta = 2 * Math.PI * rng()
		if (rng() > outerDensityWeight(r)) continue
		const x = CENTRE_X + r * Math.cos(theta)
		const z = CENTRE_Z + r * Math.sin(theta)
		if (onCliff(x, z, reserved)) continue
		out.push({
			idx   : out.length,
			worldX: x,
			worldZ: z,
			kind  : pickKind(rng),
			band  : WOOD_BAND_OUTER,
		})
	}
}


// MARK: treeSitesFromProps

/**
 * Feet of the seed-scattered trees. Same inputs the prop spawner uses,
 * so chops land on the models already in the world.
 */
export function treeSitesFromProps(
	mazeSeed: number,
	reserved: ReadonlySet<string>,
): WoodTreeSite[] {
	const trees = scatterProps(mazeSeed, reserved).filter(p => p.propId === TREE_PROP_ID)
	return trees.map((p, i) => ({
		treeIndex: i,
		worldX   : p.worldX,
		worldZ   : p.worldZ,
		yawDeg   : p.yawDeg,
	}))
}


// MARK: placeTreeLogs

/**
 * Four log records at each trunk. They are not placed as meshes.
 * Chopping spends one record and the tree model scales down.
 */
function placeTreeLogs(
	out  : WoodChunk[],
	sites: WoodTreeSite[],
): void {
	for (const site of sites) {
		for (let slot = 0; slot < WOOD_LOGS_PER_TREE; slot++) {
			out.push({
				idx      : out.length,
				worldX   : site.worldX,
				worldZ   : site.worldZ,
				kind     : WOOD_KIND_LOG,
				band     : WOOD_BAND_TREE,
				treeIndex: site.treeIndex,
			})
		}
	}
}


// MARK: computeWoodScatter
/**
 * Produce the full wood chunk list for a given cycle seed. Same seed
 * always produces the same list; server + client call this and get
 * identical (idx, worldX, worldZ, kind, band) tuples.
 *
 * `reserved` is the cliff cell set for cycleMazeSeed(seed). Buried
 * pieces skip those cells. Tree logs use it so they sit on the same
 * trees the prop scatter spawned.
 */
export function computeWoodScatter(
	seed    : number,
	reserved: ReadonlySet<string>,
): WoodChunk[] {
	const rng = makeRng((seed | 0) ^ 0x574F4F44) // 'WOOD' salt
	const out: WoodChunk[] = []
	placeCloseBand(rng, out, reserved)
	placeNearBand(rng, out, reserved)
	placeFarBand(rng, out, reserved)
	placeOuterBand(rng, out, reserved)

	if (out.length < WOOD_POOL_SIZE) {
		console.log(
			`woodScatter: computeWoodScatter: placed ${out.length}/${WOOD_POOL_SIZE} ` +
			`positions (seed ${seed}) - exclusion may be too tight`
		)
	}
	const sites = treeSitesFromProps(cycleMazeSeed(seed), reserved)
	placeTreeLogs(out, sites)
	console.log(`woodScatter: computeWoodScatter: ${sites.length} tree clusters`)
	return out
}
