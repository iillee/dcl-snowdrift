/**
 * woodScatter.ts - deterministic wood-chunk placement across the playfield.
 *
 * Pure function of (cycleSeed) -> WoodChunk[]. Runs identically on
 * server and client, so positions never need to sync over the wire -
 * only the active/inactive set does (owned server-side; see
 * src/server/wood.ts).
 *
 * Two bands:
 *   - Near (15-35 m): one-torch trip. Mostly branches, a few logs.
 *   - Far  (35-80 m): keep the old gather belt, peak density at 50 m.
 *
 * Kind is stamped at placement (stable per seed). Wilderness is
 * kindling. Each scattered tree_4 holds four logs about a metre
 * out from the trunk, so the base mesh does not cover them.
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
/** Near-ring pool size. */
export const WOOD_NEAR_POOL = 50
/** Far-belt pool size. */
export const WOOD_FAR_POOL = 150
/** Full scatter list length. */
export const WOOD_POOL_SIZE = WOOD_NEAR_POOL + WOOD_FAR_POOL

/**
 * Active near chunks at cycle start. One torch should be able to
 * finish a trip into this ring.
 */
export const WOOD_NEAR_ACTIVE = 12
/** Active far chunks. Leave the long walk in the field. */
export const WOOD_FAR_ACTIVE = 28
/** Total active at cycle start. No in-run refill. */
export const WOOD_ACTIVE_TARGET = WOOD_NEAR_ACTIVE + WOOD_FAR_ACTIVE

/** Inner edge of the near ring (m). Outside the Warm melt ring. */
export const WOOD_NEAR_MIN_M = 15
/** Outer edge of the near ring / inner edge of the far belt (m). */
export const WOOD_NEAR_MAX_M = 35
/** Radius (m) where far-belt density peaks. */
export const WOOD_PEAK_RADIUS_M = 50
/** Hard outer sampling radius (m). */
export const WOOD_MAX_RADIUS_M = 80

/**
 * Chance a placed chunk is a full log instead of a branch. ~12 % of
 * 40 active pieces is about five logs in the snow.
 */
export const WOOD_LOG_CHANCE = 0.12

export const WOOD_BAND_NEAR = 0
export const WOOD_BAND_FAR  = 1
export const WOOD_BAND_TREE = 2

/** Logs at each scattered tree, sitting just outside the trunk. */
export const WOOD_LOGS_PER_TREE = 4
/** Prop id whose feet get the log cluster. Matches PROP_CATALOG. */
const TREE_PROP_ID = 'tree_4'
/** Distance from the tree origin to each log (m). */
const TREE_LOG_RADIUS_M = 1
/** Per-log wobble so the four are not a perfect ring. */
const TREE_LOG_RADIUS_JITTER_M = 0.15
const TREE_LOG_ANGLE_JITTER_RAD = 0.35


// MARK: Types
export interface WoodChunk {
	/** Stable across (seed) - matches the array index of the scatter. */
	idx    : number
	worldX : number
	worldZ : number
	/** WOOD_KIND_BRANCH or WOOD_KIND_LOG. */
	kind   : number
	/** WOOD_BAND_NEAR, WOOD_BAND_FAR, or WOOD_BAND_TREE. */
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
 * Zero inside the near ring, ramps to 1.0 at PEAK_RADIUS_M, then
 * decays toward MAX_RADIUS_M.
 */
function farDensityWeight(r: number): number {
	if (r < WOOD_NEAR_MAX_M)   return 0
	if (r > WOOD_MAX_RADIUS_M) return 0
	if (r <= WOOD_PEAK_RADIUS_M) {
		const span = WOOD_PEAK_RADIUS_M - WOOD_NEAR_MAX_M
		return (r - WOOD_NEAR_MAX_M) / span
	}
	const span = WOOD_MAX_RADIUS_M - WOOD_PEAK_RADIUS_M
	const t    = (r - WOOD_PEAK_RADIUS_M) / span
	return 1 - 0.5 * t
}


// MARK: placeNearBand
function placeNearBand(
	rng: () => number,
	out: WoodChunk[],
): void {
	const min2 = WOOD_NEAR_MIN_M * WOOD_NEAR_MIN_M
	const max2 = WOOD_NEAR_MAX_M * WOOD_NEAR_MAX_M
	const span = max2 - min2
	const MAX_ATTEMPTS = WOOD_NEAR_POOL * 20
	let attempts = 0
	while (out.length < WOOD_NEAR_POOL && attempts < MAX_ATTEMPTS) {
		attempts++
		const r     = Math.sqrt(min2 + rng() * span)
		const theta = 2 * Math.PI * rng()
		out.push({
			idx   : out.length,
			worldX: CENTRE_X + r * Math.cos(theta),
			worldZ: CENTRE_Z + r * Math.sin(theta),
			kind  : pickKind(rng),
			band  : WOOD_BAND_NEAR,
		})
	}
}


// MARK: placeFarBand
function placeFarBand(
	rng: () => number,
	out: WoodChunk[],
): void {
	const target = WOOD_POOL_SIZE
	const MAX_ATTEMPTS = WOOD_FAR_POOL * 20
	let attempts = 0
	while (out.length < target && attempts < MAX_ATTEMPTS) {
		attempts++
		const u     = rng()
		const v     = rng()
		const r     = WOOD_MAX_RADIUS_M * Math.sqrt(u)
		const theta = 2 * Math.PI * v
		if (rng() > farDensityWeight(r)) continue
		out.push({
			idx   : out.length,
			worldX: CENTRE_X + r * Math.cos(theta),
			worldZ: CENTRE_Z + r * Math.sin(theta),
			kind  : pickKind(rng),
			band  : WOOD_BAND_FAR,
		})
	}
}


// MARK: treeSitesFromProps

/**
 * Feet of the seed-scattered trees. Same inputs the prop spawner uses,
 * so the log clusters land on the models already in the world.
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


// MARK: treeLogWorld

function treeLogWorld(
	site: WoodTreeSite,
	slot: number,
	base: number,
	rng : () => number,
): { x: number, z: number } {
	const turn = (rng() * 2 - 1) * TREE_LOG_ANGLE_JITTER_RAD
	const ang  = base + slot * (Math.PI / 2) + turn
	const r    = TREE_LOG_RADIUS_M + (rng() * 2 - 1) * TREE_LOG_RADIUS_JITTER_M
	return {
		x: site.worldX + Math.sin(ang) * r,
		z: site.worldZ + Math.cos(ang) * r,
	}
}


// MARK: placeTreeLogs

/**
 * Append four logs around each trunk, about a metre out from the
 * origin. The seed turns the set so they are not always on the same
 * sides, and a quarter-turn keeps them from stacking.
 */
function placeTreeLogs(
	out  : WoodChunk[],
	sites: WoodTreeSite[],
	rng  : () => number,
): void {
	for (const site of sites) {
		const base = rng() * Math.PI * 2
		for (let slot = 0; slot < WOOD_LOGS_PER_TREE; slot++) {
			const p = treeLogWorld(site, slot, base, rng)
			out.push({
				idx      : out.length,
				worldX   : p.x,
				worldZ   : p.z,
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
 * `reserved` is the cliff cell set for cycleMazeSeed(seed). Tree logs
 * use it so they sit on the same trees the prop scatter spawned.
 */
export function computeWoodScatter(
	seed    : number,
	reserved: ReadonlySet<string>,
): WoodChunk[] {
	const rng = makeRng((seed | 0) ^ 0x574F4F44) // 'WOOD' salt
	const out: WoodChunk[] = []
	placeNearBand(rng, out)
	placeFarBand(rng, out)

	if (out.length < WOOD_POOL_SIZE) {
		console.log(
			`woodScatter: computeWoodScatter: placed ${out.length}/${WOOD_POOL_SIZE} ` +
			`positions (seed ${seed}) - exclusion may be too tight`
		)
	}
	const sites = treeSitesFromProps(cycleMazeSeed(seed), reserved)
	placeTreeLogs(out, sites, rng)
	console.log(`woodScatter: computeWoodScatter: ${sites.length} tree clusters`)
	return out
}
