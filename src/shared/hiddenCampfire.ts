/**
 * hiddenCampfire.ts — shared placement + tuning for the hidden campfire.
 *
 * A single "secondary" campfire is buried in the snow somewhere near
 * the central bonfire. The player has to carry a lit torch to it and
 * ignite it — the first cooperative objective of the core loop.
 *
 * Placement is deterministic per 24 h bucket so every peer that joins
 * inside the same bucket sees the same location without needing any
 * network sync yet. When we add a proper cycle system (server-driven
 * seed, world-state broadcast, multi-campfire network) the bucket
 * function below is the single seed source to replace.
 *
 * Reach math (see AGENTS handoff notes / chat with @luke):
 *   TORCH_FUEL_MAX_S             = 45 s
 *   fastest walk with torch      = 3.0 m/s (stage-1 snow; everywhere
 *                                  else is slower)
 *   straight-line theoretical    = 135 m ≈ 8.4 tiles
 *   realistic mixed-terrain avg  = ~90 m ≈ 5.6 tiles
 * We place the first hidden campfire well inside the realistic reach so
 * the trip is always comfortable, with fuel to spare on arrival.
 */

import {
	MAZE_GRID_HEIGHT,
	MAZE_GRID_WIDTH,
	MAZE_ORIGIN_OFFSET_METERS,
	MAZE_TILE_WORLD_METERS,
} from 'src/shared/settings'


// MARK: Reach tuning
/** Minimum Chebyshev tile distance from the central campfire tile. */
export const HIDDEN_MIN_TILES = 2
/**
 * Maximum Chebyshev tile distance. At 16 m tiles this is 64 m, which
 * a player at 3 m/s reaches in ~21 s (44 s buffer inside a 45 s fuel
 * budget) and at 2 m/s in ~32 s (13 s buffer). Bump this once we add
 * more hidden campfires or a longer torch.
 */
export const HIDDEN_MAX_TILES = 4


// MARK: Ignition tuning
/** Radius (m) inside which a lit torch ignites the hidden campfire. */
export const HIDDEN_IGNITE_RADIUS_M    = 3
/** Squared ignite radius for hot-loop distance checks. */
export const HIDDEN_IGNITE_RADIUS_SQ_M = HIDDEN_IGNITE_RADIUS_M * HIDDEN_IGNITE_RADIUS_M


// MARK: Cycle bucket
/**
 * Milliseconds per placement cycle. Every peer that joins inside the
 * same bucket window computes the same tile. 24 h is the initial pitch;
 * we'll shorten this (2–6 h) once the retention loop is fleshed out.
 */
export const HIDDEN_CYCLE_MS = 24 * 60 * 60 * 1000


// MARK: getHiddenCampfireSeed
/**
 * Current cycle seed. Deterministic across peers that share a wall
 * clock — good enough for MVP; will be replaced by a server-broadcast
 * seed when we add the cycle system.
 */
export function getHiddenCampfireSeed(): number {
	return Math.floor(Date.now() / HIDDEN_CYCLE_MS)
}


// MARK: mulberry32
/**
 * Tiny deterministic PRNG. Same seed → same sequence on every peer,
 * no dependency on native Math.random ordering.
 */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0
	return function () {
		a = (a + 0x6D2B79F5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}


// MARK: Central tile
const CENTER_TX = Math.floor(MAZE_GRID_WIDTH  / 2)
const CENTER_TZ = Math.floor(MAZE_GRID_HEIGHT / 2)


// MARK: pickHiddenCampfireTile
/**
 * Deterministic tile pick inside the Chebyshev ring
 * [HIDDEN_MIN_TILES, HIDDEN_MAX_TILES] around the central bonfire tile.
 *
 * Rejection samples the bounding box until a candidate has the right
 * distance and fits inside the maze grid. Bounded iterations so a
 * pathological seed can never spin forever.
 */
export function pickHiddenCampfireTile(seed: number): { tx: number; tz: number } {
	const rand = mulberry32(seed)
	const span = HIDDEN_MAX_TILES * 2 + 1
	for (let i = 0; i < 64; i++) {
		const tx = CENTER_TX + Math.floor(rand() * span) - HIDDEN_MAX_TILES
		const tz = CENTER_TZ + Math.floor(rand() * span) - HIDDEN_MAX_TILES
		const cheb = Math.max(Math.abs(tx - CENTER_TX), Math.abs(tz - CENTER_TZ))
		if (cheb < HIDDEN_MIN_TILES || cheb > HIDDEN_MAX_TILES) continue
		if (tx < 0 || tx >= MAZE_GRID_WIDTH)  continue
		if (tz < 0 || tz >= MAZE_GRID_HEIGHT) continue
		return { tx, tz }
	}
	// Fallback — should never hit unless the grid is smaller than the
	// ring. Log so we notice if tuning ever collides with grid size.
	console.log('hiddenCampfire: pickHiddenCampfireTile: WARN rejection sampling exhausted, falling back to a corner of the ring')
	return { tx: CENTER_TX + HIDDEN_MIN_TILES, tz: CENTER_TZ + HIDDEN_MIN_TILES }
}


// MARK: tileToWorld
/** Convert a tile index to world-space centre coordinates. */
export function tileToWorld(tx: number, tz: number): { x: number; z: number } {
	return {
		x: MAZE_ORIGIN_OFFSET_METERS + (tx + 0.5) * MAZE_TILE_WORLD_METERS,
		z: MAZE_ORIGIN_OFFSET_METERS + (tz + 0.5) * MAZE_TILE_WORLD_METERS,
	}
}


// MARK: getHiddenCampfireWorldPos
/**
 * Convenience — full world position for the current cycle. Y is fixed
 * at the same base as the central campfire (see CAMPFIRE_WORLD_Y).
 */
export function getHiddenCampfireWorldPos(): { x: number; z: number; tx: number; tz: number } {
	const { tx, tz } = pickHiddenCampfireTile(getHiddenCampfireSeed())
	const { x, z }   = tileToWorld(tx, tz)
	return { x, z, tx, tz }
}
