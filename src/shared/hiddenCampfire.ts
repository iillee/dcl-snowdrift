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


// MARK: Multi-fire count
/**
 * How many hidden bonfires per cycle. All three are picked from the
 * same 24 h seed with mutual Chebyshev separation so they don't
 * overlap each other's melt rings. The player has to find + light
 * each one; server tracks lit[] indexed by 0..HIDDEN_CAMPFIRE_COUNT-1.
 */
export const HIDDEN_CAMPFIRE_COUNT = 3

/** Minimum Chebyshev tile separation between any two hidden bonfires. */
export const HIDDEN_MIN_SEPARATION_TILES = 2


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


// MARK: nextRebuildEpochMs
/**
 * Wall-clock ms of the next cycle boundary strictly after `now`.
 * Because HIDDEN_CYCLE_MS = 24 h and the unix epoch sits on midnight
 * UTC, this always lands on the next midnight UTC. Used by the server
 * to compute the authoritative `cycleState.nextRebuildEpochMs` it
 * broadcasts to clients — clients subtract their local Date.now() to
 * render the countdown (see src/client/cycle.ts).
 */
export function nextRebuildEpochMs(now: number = Date.now()): number {
	return (Math.floor(now / HIDDEN_CYCLE_MS) + 1) * HIDDEN_CYCLE_MS
}


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


// MARK: pickHiddenCampfireTiles
/**
 * Deterministic multi-tile pick inside the Chebyshev ring
 * [HIDDEN_MIN_TILES, HIDDEN_MAX_TILES] around the central bonfire tile.
 *
 * Returns HIDDEN_CAMPFIRE_COUNT tiles with mutual Chebyshev separation
 * of at least HIDDEN_MIN_SEPARATION_TILES, so their melt rings never
 * overlap and the player can tell the fires apart from any beacon
 * sightline. Rejection samples the bounding box until each slot fits
 * (right ring, in-grid, separated); bounded iterations so a
 * pathological seed can never spin forever.
 *
 * Determinism: single mulberry32(seed) instance advances through the
 * whole draw, so every peer computes the same tuple in the same order.
 */
export function pickHiddenCampfireTiles(seed: number): { tx: number; tz: number }[] {
	const rand    = mulberry32(seed)
	const span    = HIDDEN_MAX_TILES * 2 + 1
	const picks   : { tx: number; tz: number }[] = []
	const MAX_ITERS_PER_SLOT = 128
	for (let slot = 0; slot < HIDDEN_CAMPFIRE_COUNT; slot++) {
		let placed = false
		for (let i = 0; i < MAX_ITERS_PER_SLOT; i++) {
			const tx = CENTER_TX + Math.floor(rand() * span) - HIDDEN_MAX_TILES
			const tz = CENTER_TZ + Math.floor(rand() * span) - HIDDEN_MAX_TILES
			const cheb = Math.max(Math.abs(tx - CENTER_TX), Math.abs(tz - CENTER_TZ))
			if (cheb < HIDDEN_MIN_TILES || cheb > HIDDEN_MAX_TILES) continue
			if (tx < 0 || tx >= MAZE_GRID_WIDTH)  continue
			if (tz < 0 || tz >= MAZE_GRID_HEIGHT) continue
			// Separation check against already-placed picks.
			let tooClose = false
			for (const p of picks) {
				const sep = Math.max(Math.abs(tx - p.tx), Math.abs(tz - p.tz))
				if (sep < HIDDEN_MIN_SEPARATION_TILES) { tooClose = true; break }
			}
			if (tooClose) continue
			picks.push({ tx, tz })
			placed = true
			break
		}
		if (!placed) {
			// Deterministic fallback — walk around the ring at fixed angles.
			// Should never trigger with the current ring/count/separation, but
			// logs loudly if tuning ever collides so we notice in playtests.
			console.log(`hiddenCampfire: pickHiddenCampfireTiles: WARN slot ${slot} exhausted — using deterministic fallback`)
			const fallbackAngles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]
			const a  = fallbackAngles[slot] ?? 0
			const r  = HIDDEN_MAX_TILES
			const tx = CENTER_TX + Math.round(Math.cos(a) * r)
			const tz = CENTER_TZ + Math.round(Math.sin(a) * r)
			picks.push({ tx, tz })
		}
	}
	return picks
}


// MARK: tileToWorld
/** Convert a tile index to world-space centre coordinates. */
export function tileToWorld(tx: number, tz: number): { x: number; z: number } {
	return {
		x: MAZE_ORIGIN_OFFSET_METERS + (tx + 0.5) * MAZE_TILE_WORLD_METERS,
		z: MAZE_ORIGIN_OFFSET_METERS + (tz + 0.5) * MAZE_TILE_WORLD_METERS,
	}
}


// MARK: getHiddenCampfireWorldPositions
/**
 * Convenience — full world positions for every hidden bonfire in the
 * current cycle. Y is fixed at the same base as the central campfire
 * (see CAMPFIRE_WORLD_Y). Length is always HIDDEN_CAMPFIRE_COUNT.
 */
export function getHiddenCampfireWorldPositions(): { x: number; z: number; tx: number; tz: number }[] {
	return pickHiddenCampfireTiles(getHiddenCampfireSeed()).map(({ tx, tz }) => {
		const { x, z } = tileToWorld(tx, tz)
		return { x, z, tx, tz }
	})
}
