/**
 * hiddenCampfire.ts — shared placement + tuning for the hidden campfires.
 *
 * Six pits per cycle, grown as generations. The first three branch
 * off the hearth. Each later generation branches off the pits of the
 * generation before it, so a larger world keeps walking outward.
 * Every peer computes the same points from the cycle seed. A pit
 * never lands on a cliff cell or on a tree trunk from that layout.
 *
 * A step is 48–80 m. That is far enough that the heat rings stay
 * apart, and close enough that one 30 s torch can jog the gap.
 */

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { trunkDiscs } from 'src/shared/props/scatter'
import {
	MAZE_GRID_HEIGHT,
	MAZE_GRID_WIDTH,
	MAZE_ORIGIN_OFFSET_METERS,
	MAZE_TILE_WORLD_METERS,
} from 'src/shared/settings'


// MARK: Multi-fire count
/**
 * How many hidden bonfires per cycle. Server tracks lit[] indexed
 * by 0..HIDDEN_CAMPFIRE_COUNT-1.
 */
export const HIDDEN_CAMPFIRE_COUNT = 6

/**
 * How many pits grow straight off the hearth. Later pits grow off
 * the generation before them, never back off the hearth.
 */
export const HIDDEN_HEARTH_BRANCHES = 3


// MARK: Reach tuning
/**
 * Shortest step from the hearth or from another pit. Keeps two heat
 * rings from merging.
 */
export const HIDDEN_LINK_MIN_M = 48
/**
 * Longest step. One 30 s torch at the melted jog (8 m/s) covers 80 m
 * with time left for a detour.
 */
export const HIDDEN_LINK_MAX_M = 80

/**
 * Log-pile radius. A pit is rejected when this disc touches a cliff
 * cell or a tree trunk.
 */
const HIDDEN_PIT_RADIUS_M = 1.5


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


// MARK: pickHiddenCampfires
/**
 * Grow HIDDEN_CAMPFIRE_COUNT pits in generations of
 * HIDDEN_HEARTH_BRANCHES. Generation 0 steps off the hearth. Each
 * later generation steps off the pits placed in the generation
 * before it. A step is HIDDEN_LINK_MIN_M..HIDDEN_LINK_MAX_M, and a
 * pit stays at least HIDDEN_LINK_MIN_M from every node already placed.
 *
 * `cliffCells` is the measured cliff footprint for this cycle, keyed
 * `tx,tz,0`. Tree trunks come from the same layout seed. Determinism:
 * one mulberry32(seed) walks the whole draw.
 */
export function pickHiddenCampfires(
	seed      : number,
	cliffCells: ReadonlySet<string>,
): { x: number; z: number; tx: number; tz: number }[] {
	const rand  = mulberry32(seed)
	const trees = trunkDiscs(cycleMazeSeed(seed), cliffCells)
	const hearth = { x: CAMPFIRE_WORLD_X, z: CAMPFIRE_WORLD_Z }
	const nodes : { x: number; z: number }[] = [hearth]
	const picks : { x: number; z: number; tx: number; tz: number }[] = []
	const generations: { x: number; z: number }[][] = []
	const children = new Map<{ x: number; z: number }, number>()
	const TRIES = 96
	for (let slot = 0; slot < HIDDEN_CAMPFIRE_COUNT; slot++) {
		const gen     = Math.floor(slot / HIDDEN_HEARTH_BRANCHES)
		const parents = gen === 0 ? [hearth] : (generations[gen - 1] ?? [])
		if (parents.length === 0) {
			console.log(
				`hiddenCampfire: pickHiddenCampfires: slot ${slot} ` +
				`has no parent in the generation before it`,
			)
			continue
		}
		let placed = false
		for (let i = 0; i < TRIES; i++) {
			const parent = pickParent(rand, parents, children)
			const spot   = stepFrom(rand, parent, i >= TRIES / 2)
			if (spot === null) continue
			if (!spotClear(spot.x, spot.z, nodes, cliffCells, trees)) continue
			nodes.push(spot)
			picks.push(spot)
			if (!generations[gen]) generations[gen] = []
			generations[gen].push(spot)
			children.set(parent, (children.get(parent) ?? 0) + 1)
			placed = true
			break
		}
		if (!placed) {
			console.log(
				`hiddenCampfire: pickHiddenCampfires: slot ${slot} ` +
				`has no point within ${HIDDEN_LINK_MAX_M}m of its parents`,
			)
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
 * current cycle (as computed from local Date.now()). `cliffCells` is
 * the cliff footprint for that same layout. Y is fixed at the same
 * base as the central campfire (see CAMPFIRE_WORLD_Y).
 *
 * For a specific server-supplied seed, use
 * getHiddenCampfireWorldPositionsForSeed(seed, cliffCells) instead.
 */
export function getHiddenCampfireWorldPositions(
	cliffCells: ReadonlySet<string>,
): { x: number; z: number; tx: number; tz: number }[] {
	return getHiddenCampfireWorldPositionsForSeed(getHiddenCampfireSeed(), cliffCells)
}


// MARK: getHiddenCampfireWorldPositionsForSeed
/**
 * Same as getHiddenCampfireWorldPositions() but takes an explicit
 * seed. Used by the cycle rollover path so client + server agree on
 * the new positions regardless of local clock skew.
 */
export function getHiddenCampfireWorldPositionsForSeed(
	seed      : number,
	cliffCells: ReadonlySet<string>,
): { x: number; z: number; tx: number; tz: number }[] {
	return pickHiddenCampfires(seed, cliffCells)
}


// MARK: pickParent
/**
 * A parent in this generation. A pit that already has children is
 * less likely, so the branches spread across the generation.
 */
function pickParent(
	rand    : () => number,
	parents : ReadonlyArray<{ x: number; z: number }>,
	children: ReadonlyMap<{ x: number; z: number }, number>,
): { x: number; z: number } {
	let sum = 0
	const weights: number[] = []
	for (const parent of parents) {
		const w = 1 / (1 + (children.get(parent) ?? 0))
		weights.push(w)
		sum += w
	}
	let roll = rand() * sum
	for (let i = 0; i < parents.length; i++) {
		roll -= weights[i]
		if (roll <= 0) return parents[i]
	}
	return parents[parents.length - 1]
}


// MARK: stepFrom
/**
 * A candidate point one link out from `parent`. The first half of the
 * tries prefer the direction away from the hearth. The second half
 * may step any way, so a cliff does not trap the branch.
 */
function stepFrom(
	rand    : () => number,
	parent  : { x: number; z: number },
	anyAngle: boolean,
): { x: number; z: number; tx: number; tz: number } | null {
	const awayX = parent.x - CAMPFIRE_WORLD_X
	const awayZ = parent.z - CAMPFIRE_WORLD_Z
	const away  = Math.hypot(awayX, awayZ)
	const base  = away < 1 ? rand() * Math.PI * 2 : Math.atan2(awayX, awayZ)
	const spread = anyAngle || away < 1 ? Math.PI * 2 : Math.PI * 1.15
	const ang  = base + (rand() - 0.5) * spread
	const dist = HIDDEN_LINK_MIN_M + rand() * (HIDDEN_LINK_MAX_M - HIDDEN_LINK_MIN_M)
	const x    = parent.x + Math.sin(ang) * dist
	const z    = parent.z + Math.cos(ang) * dist
	const cell = cellAt(x, z)
	if (cell === null) return null
	return { x, z, tx: cell.tx, tz: cell.tz }
}


// MARK: spotClear
function spotClear(
	x         : number,
	z         : number,
	nodes     : ReadonlyArray<{ x: number; z: number }>,
	cliffCells: ReadonlySet<string>,
	trees     : ReadonlyArray<{ x: number; z: number; radius: number }>,
): boolean {
	const minSq = HIDDEN_LINK_MIN_M * HIDDEN_LINK_MIN_M
	for (const n of nodes) {
		const dx = x - n.x
		const dz = z - n.z
		if (dx * dx + dz * dz < minSq) return false
	}
	return !pitOverlaps(x, z, cliffCells, trees)
}


// MARK: cellAt
function cellAt(x: number, z: number): { tx: number; tz: number } | null {
	const tx = Math.floor((x - MAZE_ORIGIN_OFFSET_METERS) / MAZE_TILE_WORLD_METERS)
	const tz = Math.floor((z - MAZE_ORIGIN_OFFSET_METERS) / MAZE_TILE_WORLD_METERS)
	if (tx < 0 || tz < 0 || tx >= MAZE_GRID_WIDTH || tz >= MAZE_GRID_HEIGHT) return null
	return { tx, tz }
}


// MARK: pitOverlaps
/** True when the log pile at (x, z) touches a cliff cell or a trunk. */
function pitOverlaps(
	x         : number,
	z         : number,
	cliffCells: ReadonlySet<string>,
	trees     : ReadonlyArray<{ x: number; z: number; radius: number }>,
): boolean {
	const cell = cellAt(x, z)
	if (cell === null) return true
	if (cliffCells.has(`${cell.tx},${cell.tz},0`)) return true
	const C = MAZE_TILE_WORLD_METERS
	const O = MAZE_ORIGIN_OFFSET_METERS
	const pitSq = HIDDEN_PIT_RADIUS_M * HIDDEN_PIT_RADIUS_M
	for (const key of cliffCells) {
		const [cx, cz] = key.split(',').map(Number)
		const x0 = O + cx * C
		const z0 = O + cz * C
		const dx = Math.max(x0 - x, 0, x - (x0 + C))
		const dz = Math.max(z0 - z, 0, z - (z0 + C))
		if (dx * dx + dz * dz < pitSq) return true
	}
	for (const tree of trees) {
		const reach = HIDDEN_PIT_RADIUS_M + tree.radius
		const dx = x - tree.x
		const dz = z - tree.z
		if (dx * dx + dz * dz < reach * reach) return true
	}
	return false
}
