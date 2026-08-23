/**
 * woodScatter.ts - deterministic wood-chunk placement across the playfield.
 *
 * Pure function of (cycleSeed) -> WoodChunk[]. Runs identically on
 * server and client, so positions never need to sync over the wire -
 * only the active/inactive set does (owned server-side; see
 * src/server/wood.ts).
 *
 * Placement rules (vision doc sections 6 + 12.1):
 *   - NEVER near the central fire (hard exclusion inside CENTER_EXCLUSION_M)
 *   - Weighted map-wide with rising density up to PEAK_RADIUS_M, gentle
 *     falloff past that. Vision target: solo session walks 40-80 m
 *     from centre, so peak density lands at ~50 m.
 *   - Total count = TARGET_COUNT (~40 on a 128x128 playfield)
 *   - Positions use rejection sampling. If the map is small or the
 *     exclusion is aggressive we may fall short; scatter logs the
 *     shortfall but never blocks.
 *
 * Index is the chunk's position in the returned array. Stable per
 * seed, so the server can broadcast just `{ idx }` and every client
 * knows which chunk to spawn/remove.
 *
 * NOT yet gated on snow visibility - that lands as a follow-up client
 * pass so we can tune counts + positions against a visible baseline.
 */

import {
	MAZE_GRID_HEIGHT,
	MAZE_GRID_WIDTH,
	MAZE_ORIGIN_OFFSET_METERS,
	MAZE_TILE_WORLD_METERS,
} from 'src/shared/settings'


// MARK: Tuning constants
/**
 * Target number of chunks the scatter tries to place per seed. Actual
 * count may be lower if rejection sampling exhausts attempts, but
 * that would signal the map + exclusions are too tight.
 */
export const WOOD_TARGET_COUNT = 40

/**
 * Hard exclusion (m) around the central fire. Must exceed the melt
 * ring (CAMPFIRE_MELT_RADIUS_M = 8) with a comfortable buffer so
 * players never see a chunk from the warm zone - the whole point of
 * the loop is that wood is out in the cold.
 */
export const WOOD_CENTER_EXCLUSION_M = 12

/**
 * Radius (m) where placement density peaks. Vision target 40-80 m
 * average solo walk; 50 m lands mid-range.
 */
export const WOOD_PEAK_RADIUS_M = 50

/**
 * Sampling radius (m) - hard outer boundary. Set slightly below the
 * playfield half-diagonal so chunks never spawn against the cliff
 * perimeter. Playfield is 128x128, half-diagonal ~90 m.
 */
export const WOOD_MAX_RADIUS_M = 80


// MARK: Types
export interface WoodChunk {
	/** Stable across (seed) - matches the array index of the scatter. */
	idx    : number
	worldX : number
	worldZ : number
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


// MARK: densityWeight
/**
 * Acceptance probability for a candidate at distance `r` from the
 * central fire. Zero inside the exclusion, ramps up to 1.0 at
 * PEAK_RADIUS_M, then decays past it. Simple piecewise so the
 * behaviour is easy to reason about + tune.
 */
function densityWeight(r: number): number {
	if (r < WOOD_CENTER_EXCLUSION_M) return 0
	if (r > WOOD_MAX_RADIUS_M)       return 0
	if (r <= WOOD_PEAK_RADIUS_M) {
		// Linear ramp from exclusion boundary to peak.
		const span = WOOD_PEAK_RADIUS_M - WOOD_CENTER_EXCLUSION_M
		return (r - WOOD_CENTER_EXCLUSION_M) / span
	}
	// Gentle falloff from peak to max radius (halves at midpoint).
	const span = WOOD_MAX_RADIUS_M - WOOD_PEAK_RADIUS_M
	const t    = (r - WOOD_PEAK_RADIUS_M) / span
	return 1 - 0.5 * t
}


// MARK: computeWoodScatter
/**
 * Produce the full wood chunk list for a given cycle seed. Same seed
 * always produces the same list; server + client call this and get
 * identical (idx, worldX, worldZ) tuples.
 */
export function computeWoodScatter(seed: number): WoodChunk[] {
	const rng = makeRng((seed | 0) ^ 0x574F4F44) // 'WOOD' salt
	const out: WoodChunk[] = []
	const MAX_ATTEMPTS = WOOD_TARGET_COUNT * 20
	let attempts = 0

	while (out.length < WOOD_TARGET_COUNT && attempts < MAX_ATTEMPTS) {
		attempts++
		// Uniform disc sample around centre: r = R * sqrt(u), theta = 2*pi*v
		const u = rng()
		const v = rng()
		const r = WOOD_MAX_RADIUS_M * Math.sqrt(u)
		const theta = 2 * Math.PI * v

		// Accept/reject on density weight.
		if (rng() > densityWeight(r)) continue

		const worldX = CENTRE_X + r * Math.cos(theta)
		const worldZ = CENTRE_Z + r * Math.sin(theta)
		out.push({ idx: out.length, worldX, worldZ })
	}

	if (out.length < WOOD_TARGET_COUNT) {
		console.log(
			`woodScatter: computeWoodScatter: placed ${out.length}/${WOOD_TARGET_COUNT} ` +
			`chunks after ${attempts} attempts (seed ${seed}) - exclusion may be too tight`
		)
	}
	return out
}
