/**
 * hiddenCampfire.ts — shared placement + tuning for the hidden campfires.
 *
 * Placement layers (additive):
 *   1. Home teaching network — HIDDEN_HOME_COUNT pits grown in
 *      generations off the true hearth (dimple language for beginners).
 *   2. Per major grove — one centralish hub + satellites off that hub
 *      at each Low / Mid / High destination.
 *   3. Sparse world finds — extra pits across walkable shelves so the
 *      map has random discoveries beyond the authored territories.
 *
 * Every pit starts buried with a snow dimple; the composite hearth
 * remains the only lit start fire.
 *
 * A teaching/grove step is 48–80 m. World finds use a wider min sep so
 * they stay sparse against the denser networks.
 */

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { trunkDiscs } from 'src/shared/props/scatter'
import {
	MAZE_GRID_HEIGHT,
	MAZE_GRID_WIDTH,
	MAZE_ORIGIN_OFFSET_METERS,
	MAZE_TILE_WORLD_METERS,
	TERRAIN_LEVEL_HIGH,
	TERRAIN_LEVEL_LOW,
	TERRAIN_LEVEL_MID,
	groundYForLevel,
	isMountainLevel,
} from 'src/shared/settings'
import { getTerrain, offHearthCellsForMazeSeed } from 'src/shared/terrain/terrainCache'
import {
	LANDFORM_BASIN,
	LANDFORM_CANYON,
	LANDFORM_PLATEAU,
	LANDFORM_RIDGE,
	cellCenterWorld,
	cellIndex,
	TerrainDestination,
	TerrainMap,
} from 'src/shared/terrain/terrainMap'


// MARK: Multi-fire count
/**
 * Home satellite pits (generational off the true hearth). Teaching
 * ring — do not thin this for world scatter budget.
 */
export const HIDDEN_HOME_COUNT = 6
/**
 * Per major grove: total hidden pits (hub + satellites), inclusive
 * range. Hub is always one; the rest grow off it.
 */
export const HIDDEN_DEST_PIT_MIN = 4
export const HIDDEN_DEST_PIT_MAX = 6
/**
 * Extra sparse pits scattered across the walkable world.
 */
export const HIDDEN_WORLD_COUNT = 8
/**
 * How many hidden bonfire slots per cycle (max budget). Server tracks
 * lit[] indexed by 0..HIDDEN_CAMPFIRE_COUNT-1. Grove budget assumes up
 * to three major destinations at HIDDEN_DEST_PIT_MAX each.
 */
export const HIDDEN_CAMPFIRE_COUNT =
	HIDDEN_HOME_COUNT +
	3 * HIDDEN_DEST_PIT_MAX +
	HIDDEN_WORLD_COUNT

/**
 * How many pits grow straight off the hearth (or off a destination
 * hub for that grove's satellite generation). Later home pits grow
 * off the generation before them, never back off the hearth.
 */
export const HIDDEN_HEARTH_BRANCHES = 3


// MARK: Reach tuning
/**
 * Shortest step from the hearth or from another teaching/grove pit.
 * Keeps two heat rings from merging.
 */
export const HIDDEN_LINK_MIN_M = 48
/**
 * Longest step. One 30 s torch at the melted jog (8 m/s) covers 80 m
 * with time left for a detour.
 */
export const HIDDEN_LINK_MAX_M = 80

/**
 * Min spacing for sparse world finds against every already-placed pit.
 * Wider than a teaching link so wilderness pits stay rare discoveries.
 */
export const HIDDEN_WORLD_MIN_SEP_M = 160

/** Keep world-scatter pits off the home melt pad. */
const HIDDEN_HEARTH_KEEP_M = 40

/**
 * Soft cap per walkable elevation for the world-scatter pass only.
 */
const HIDDEN_WORLD_MAX_PER_LEVEL = 4

/**
 * Log-pile radius. A pit is rejected when this disc touches a mountain
 * cell, an unreachable cell, a ladder cell, or a tree trunk.
 */
const HIDDEN_PIT_RADIUS_M = 1.5

/** Prefer world candidates within this range of a ladder foot/top. */
const HIDDEN_LADDER_BIAS_M = 48


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


// MARK: HiddenCampfireSpot
/** One placed pit: world centre + tile indices. */
export interface HiddenCampfireSpot {
	x  : number
	y  : number
	z  : number
	tx : number
	tz : number
}


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
 * Home teaching network, then a hub+satellite cluster at each major
 * destination grove, then sparse world finds for the remaining budget.
 *
 * Determinism: one mulberry32(seed) walks the whole draw. Layout seed
 * is cycleMazeSeed(seed) so placement agrees with trees and terrain.
 */
export function pickHiddenCampfires(
	seed: number,
): HiddenCampfireSpot[] {
	const rand     = mulberry32(seed)
	const mazeSeed = cycleMazeSeed(seed)
	const map      = getTerrain(mazeSeed)
	const blocked  = blockedCellsForPits(map)
	const trees    = trunkDiscs(mazeSeed, offHearthCellsForMazeSeed(mazeSeed))
	const hearth   = {
		x    : CAMPFIRE_WORLD_X,
		z    : CAMPFIRE_WORLD_Z,
		level: levelAt(map, CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z),
	}
	const nodes : { x: number; z: number }[] = [{ x: hearth.x, z: hearth.z }]
	const picks : HiddenCampfireSpot[] = []
	const TRIES = 160

	const homeN = placeHomeNetwork(rand, map, nodes, blocked, trees, picks, hearth, TRIES)
	const groveN = placeGroveClusters(rand, map, nodes, blocked, trees, picks, TRIES)
	const worldN = placeWorldScatter(rand, map, nodes, blocked, trees, picks)

	console.log(
		`hiddenCampfire: pickHiddenCampfires: placed ${picks.length}/` +
		`${HIDDEN_CAMPFIRE_COUNT} pits (home=${homeN} grove=${groveN} world=${worldN})`,
	)
	return picks
}


// MARK: placeHomeNetwork
/**
 * Generational teaching ring off the true hearth. Gen 0 steps from
 * the hearth; later gens step from the previous generation.
 */
function placeHomeNetwork(
	rand   : () => number,
	map    : TerrainMap,
	nodes  : { x: number; z: number }[],
	blocked: ReadonlySet<string>,
	trees  : ReadonlyArray<{ x: number; z: number; radius: number }>,
	picks  : HiddenCampfireSpot[],
	hearth : { x: number; z: number; level: number },
	TRIES  : number,
): number {
	const generations: { x: number; z: number; level: number }[][] = []
	const children = new Map<{ x: number; z: number; level: number }, number>()
	let placedN = 0
	for (let slot = 0; slot < HIDDEN_HOME_COUNT; slot++) {
		const gen     = Math.floor(slot / HIDDEN_HEARTH_BRANCHES)
		const parents = gen === 0 ? [hearth] : (generations[gen - 1] ?? [])
		if (parents.length === 0) {
			console.log(
				`hiddenCampfire: placeHomeNetwork: slot ${slot} ` +
				`has no parent in the generation before it`,
			)
			continue
		}
		let placed = false
		for (let i = 0; i < TRIES; i++) {
			const parent      = pickParent(rand, parents, children)
			const preferLevel = i < TRIES / 2 ? parent.level : null
			const spot        = stepFrom(rand, parent, i >= TRIES / 2)
			if (spot === null) continue
			if (!spotClear(spot.x, spot.z, nodes, blocked, trees, map, preferLevel, HIDDEN_LINK_MIN_M)) continue
			const level = levelAt(map, spot.x, spot.z)
			const y     = groundYForLevel(level)
			nodes.push({ x: spot.x, z: spot.z })
			picks.push({ x: spot.x, y, z: spot.z, tx: spot.tx, tz: spot.tz })
			const node = { x: spot.x, z: spot.z, level }
			if (!generations[gen]) generations[gen] = []
			generations[gen].push(node)
			children.set(parent, (children.get(parent) ?? 0) + 1)
			placedN++
			placed = true
			break
		}
		if (!placed) {
			console.log(
				`hiddenCampfire: placeHomeNetwork: slot ${slot} ` +
				`has no walkable point within ${HIDDEN_LINK_MAX_M}m of its parents`,
			)
		}
	}
	return placedN
}


// MARK: placeGroveClusters
/**
 * 4–6 hidden pits at each major destination (Low / Mid / High): one
 * centralish hub plus satellites grown off that hub.
 */
function placeGroveClusters(
	rand   : () => number,
	map    : TerrainMap,
	nodes  : { x: number; z: number }[],
	blocked: ReadonlySet<string>,
	trees  : ReadonlyArray<{ x: number; z: number; radius: number }>,
	picks  : HiddenCampfireSpot[],
	TRIES  : number,
): number {
	let placedN = 0
	const pitSpan = HIDDEN_DEST_PIT_MAX - HIDDEN_DEST_PIT_MIN + 1
	for (const dest of map.destinations) {
		const totalPits = HIDDEN_DEST_PIT_MIN + Math.floor(rand() * pitSpan)
		const satCount  = totalPits - 1
		const hub = placeDestinationHub(rand, map, dest, nodes, blocked, trees)
		if (hub === null) {
			console.log(
				`hiddenCampfire: placeGroveClusters: hub failed lv=${dest.level} ` +
				`at (${dest.cx},${dest.cz})`,
			)
			continue
		}
		nodes.push({ x: hub.x, z: hub.z })
		picks.push(hub)
		placedN++
		const hubNode = { x: hub.x, z: hub.z, level: levelAt(map, hub.x, hub.z) }
		let satsPlaced = 0
		for (let s = 0; s < satCount; s++) {
			let placed = false
			for (let i = 0; i < TRIES; i++) {
				const preferLevel = i < TRIES / 2 ? hubNode.level : null
				const spot        = stepFrom(rand, hubNode, i >= TRIES / 2)
				if (spot === null) continue
				if (!spotClear(spot.x, spot.z, nodes, blocked, trees, map, preferLevel, HIDDEN_LINK_MIN_M)) continue
				const level = levelAt(map, spot.x, spot.z)
				const y     = groundYForLevel(level)
				nodes.push({ x: spot.x, z: spot.z })
				picks.push({ x: spot.x, y, z: spot.z, tx: spot.tx, tz: spot.tz })
				placedN++
				satsPlaced++
				placed = true
				break
			}
			if (!placed) {
				console.log(
					`hiddenCampfire: placeGroveClusters: sat ${s}/${satCount} failed ` +
					`lv=${dest.level} within ${HIDDEN_LINK_MAX_M}m of hub`,
				)
			}
		}
		console.log(
			`hiddenCampfire: placeGroveClusters: lv=${dest.level} ` +
			`want=${totalPits} got=${1 + satsPlaced}`,
		)
	}
	return placedN
}


// MARK: placeDestinationHub
/**
 * Centralish hidden pit near a destination centroid, inside the
 * destination region when possible.
 */
function placeDestinationHub(
	rand   : () => number,
	map    : TerrainMap,
	dest   : TerrainDestination,
	nodes  : ReadonlyArray<{ x: number; z: number }>,
	blocked: ReadonlySet<string>,
	trees  : ReadonlyArray<{ x: number; z: number; radius: number }>,
): HiddenCampfireSpot | null {
	const centre = cellCenterWorld(dest.cx, dest.cz)
	const TRIES  = 220
	for (let i = 0; i < TRIES; i++) {
		const radius = 4 + (i / TRIES) * 40 + rand() * 6
		const ang    = rand() * Math.PI * 2
		const x      = centre.x + Math.sin(ang) * radius
		const z      = centre.z + Math.cos(ang) * radius
		const cell   = cellAt(x, z)
		if (cell === null) continue
		if (i < TRIES * 0.7 && map.regions[cellIndex(cell.tx, cell.tz)] !== dest.region) continue
		if (!spotClear(x, z, nodes, blocked, trees, map, dest.level, HIDDEN_LINK_MIN_M)) continue
		const level = levelAt(map, x, z)
		return {
			x,
			y : groundYForLevel(level),
			z,
			tx: cell.tx,
			tz: cell.tz,
		}
	}
	const cell = cellAt(centre.x, centre.z)
	if (cell === null) return null
	if (!spotClear(centre.x, centre.z, nodes, blocked, trees, map, null, HIDDEN_LINK_MIN_M)) {
		console.log(
			`hiddenCampfire: placeDestinationHub: centroid blocked ` +
			`lv=${dest.level} at (${dest.cx},${dest.cz})`,
		)
		return null
	}
	return {
		x : centre.x,
		y : groundYForLevel(dest.level),
		z : centre.z,
		tx: cell.tx,
		tz: cell.tz,
	}
}


// MARK: placeWorldScatter
/**
 * Sparse additive finds across walkable shelves. Soft geographic /
 * ladder bias; hard rejects for hearth pad, trunks, and world min sep.
 */
function placeWorldScatter(
	rand   : () => number,
	map    : TerrainMap,
	nodes  : { x: number; z: number }[],
	blocked: ReadonlySet<string>,
	trees  : ReadonlyArray<{ x: number; z: number; radius: number }>,
	picks  : HiddenCampfireSpot[],
): number {
	const candidates = buildWorldCandidates(map)
	if (candidates.length === 0) {
		console.log('hiddenCampfire: placeWorldScatter: no walkable candidates')
		return 0
	}
	const levelCount = new Map<number, number>([
		[TERRAIN_LEVEL_LOW,  0],
		[TERRAIN_LEVEL_MID,  0],
		[TERRAIN_LEVEL_HIGH, 0],
	])
	const TRIES_PER_SLOT = 280
	let placedN = 0
	for (let slot = 0; slot < HIDDEN_WORLD_COUNT; slot++) {
		let placed = false
		for (let i = 0; i < TRIES_PER_SLOT; i++) {
			const preferGeo   = i < TRIES_PER_SLOT * 0.65
			const preferLevel = underfilledWorldLevel(levelCount, rand)
			const idx         = Math.floor(rand() * candidates.length)
			const c           = candidates[idx]
			const world       = tileToWorld(c.tx, c.tz)
			const level       = map.levels[cellIndex(c.tx, c.tz)]
			if ((levelCount.get(level) ?? 0) >= HIDDEN_WORLD_MAX_PER_LEVEL) continue
			if (preferLevel !== null && level !== preferLevel && i < TRIES_PER_SLOT * 0.5) continue
			if (preferGeo && c.weight <= 1 && rand() > 0.25) continue
			if (!spotClear(world.x, world.z, nodes, blocked, trees, map, null, HIDDEN_WORLD_MIN_SEP_M)) continue
			const y = groundYForLevel(level)
			nodes.push({ x: world.x, z: world.z })
			picks.push({ x: world.x, y, z: world.z, tx: c.tx, tz: c.tz })
			levelCount.set(level, (levelCount.get(level) ?? 0) + 1)
			placedN++
			placed = true
			break
		}
		if (!placed) {
			console.log(
				`hiddenCampfire: placeWorldScatter: slot ${slot} ` +
				`could not place within ${TRIES_PER_SLOT} tries`,
			)
		}
	}
	return placedN
}


// MARK: buildWorldCandidates
/**
 * Walkable cells with soft weight for useful geography. Grove cells
 * are not excluded — world finds may still land near territories —
 * but hubs/sats already occupy the dense teaching spots.
 */
function buildWorldCandidates(
	map: TerrainMap,
): Array<{ tx: number; tz: number; weight: number }> {
	const ladderPts: Array<{ x: number; z: number }> = []
	for (const ladder of map.ladders) {
		ladderPts.push(tileToWorld(ladder.lowCx, ladder.lowCz))
		ladderPts.push(tileToWorld(ladder.highCx, ladder.highCz))
	}
	const ladderBiasSq = HIDDEN_LADDER_BIAS_M * HIDDEN_LADDER_BIAS_M
	const hearthKeepSq = HIDDEN_HEARTH_KEEP_M * HIDDEN_HEARTH_KEEP_M
	const out: Array<{ tx: number; tz: number; weight: number }> = []
	for (let cz = 0; cz < map.h; cz++) {
		for (let cx = 0; cx < map.w; cx++) {
			const i = cellIndex(cx, cz)
			const level = map.levels[i]
			if (isMountainLevel(level) || map.routeDist[i] < 0) continue
			const world = tileToWorld(cx, cz)
			const hdx = world.x - CAMPFIRE_WORLD_X
			const hdz = world.z - CAMPFIRE_WORLD_Z
			if (hdx * hdx + hdz * hdz < hearthKeepSq) continue
			let weight = 1
			const lf = map.landforms[i]
			if (
				lf === LANDFORM_CANYON ||
				lf === LANDFORM_RIDGE ||
				lf === LANDFORM_BASIN ||
				lf === LANDFORM_PLATEAU
			) {
				weight += 2
			}
			for (const lp of ladderPts) {
				const dx = world.x - lp.x
				const dz = world.z - lp.z
				if (dx * dx + dz * dz < ladderBiasSq) {
					weight += 3
					break
				}
			}
			out.push({ tx: cx, tz: cz, weight })
		}
	}
	return out
}


// MARK: underfilledWorldLevel
/**
 * A walkable level that still has fewer than HIDDEN_WORLD_MAX_PER_LEVEL
 * world pits, preferring the least-filled.
 */
function underfilledWorldLevel(
	levelCount: ReadonlyMap<number, number>,
	rand      : () => number,
): number | null {
	const levels = [TERRAIN_LEVEL_LOW, TERRAIN_LEVEL_MID, TERRAIN_LEVEL_HIGH]
	let best = Infinity
	const open: number[] = []
	for (const lv of levels) {
		const n = levelCount.get(lv) ?? 0
		if (n >= HIDDEN_WORLD_MAX_PER_LEVEL) continue
		if (n < best) {
			best = n
			open.length = 0
			open.push(lv)
		} else if (n === best) {
			open.push(lv)
		}
	}
	if (open.length === 0) return null
	return open[Math.floor(rand() * open.length)]
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
 * current cycle (as computed from local Date.now()). Y is the walkable
 * ground height of each pit's terrain level.
 *
 * For a specific server-supplied seed, use
 * getHiddenCampfireWorldPositionsForSeed(seed) instead.
 */
export function getHiddenCampfireWorldPositions(): HiddenCampfireSpot[] {
	return getHiddenCampfireWorldPositionsForSeed(getHiddenCampfireSeed())
}


// MARK: getHiddenCampfireWorldPositionsForSeed
/**
 * Same as getHiddenCampfireWorldPositions() but takes an explicit
 * seed. Used by the cycle rollover path so client + server agree on
 * the new positions regardless of local clock skew.
 */
export function getHiddenCampfireWorldPositionsForSeed(
	seed: number,
): HiddenCampfireSpot[] {
	return pickHiddenCampfires(seed)
}


// MARK: pickParent
/**
 * A parent in this generation. A pit that already has children is
 * less likely, so the branches spread across the generation.
 */
function pickParent(
	rand    : () => number,
	parents : ReadonlyArray<{ x: number; z: number; level: number }>,
	children: ReadonlyMap<{ x: number; z: number; level: number }, number>,
): { x: number; z: number; level: number } {
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
	x          : number,
	z          : number,
	nodes      : ReadonlyArray<{ x: number; z: number }>,
	blocked    : ReadonlySet<string>,
	trees      : ReadonlyArray<{ x: number; z: number; radius: number }>,
	map        : TerrainMap,
	preferLevel: number | null,
	minSepM    : number,
): boolean {
	const minSq = minSepM * minSepM
	for (const n of nodes) {
		const dx = x - n.x
		const dz = z - n.z
		if (dx * dx + dz * dz < minSq) return false
	}
	if (preferLevel !== null && levelAt(map, x, z) !== preferLevel) return false
	return !pitOverlaps(x, z, blocked, trees)
}


// MARK: cellAt
function cellAt(x: number, z: number): { tx: number; tz: number } | null {
	const tx = Math.floor((x - MAZE_ORIGIN_OFFSET_METERS) / MAZE_TILE_WORLD_METERS)
	const tz = Math.floor((z - MAZE_ORIGIN_OFFSET_METERS) / MAZE_TILE_WORLD_METERS)
	if (tx < 0 || tz < 0 || tx >= MAZE_GRID_WIDTH || tz >= MAZE_GRID_HEIGHT) return null
	return { tx, tz }
}


// MARK: levelAt
function levelAt(
	map: TerrainMap,
	x  : number,
	z  : number,
): number {
	const cell = cellAt(x, z)
	if (cell === null) return -1
	return map.levels[cellIndex(cell.tx, cell.tz)]
}


// MARK: blockedCellsForPits
/**
 * Cells a log pile must not touch: mountain, hearth-unreachable, and
 * ladder feet/tops (so a pit never blocks a climb).
 */
function blockedCellsForPits(map: TerrainMap): Set<string> {
	const out = new Set<string>()
	for (let cz = 0; cz < map.h; cz++) {
		for (let cx = 0; cx < map.w; cx++) {
			const i = cellIndex(cx, cz)
			const level = map.levels[i]
			if (isMountainLevel(level) || map.routeDist[i] < 0) {
				out.add(`${cx},${cz},0`)
			}
		}
	}
	for (const ladder of map.ladders) {
		out.add(`${ladder.lowCx},${ladder.lowCz},0`)
		out.add(`${ladder.highCx},${ladder.highCz},0`)
	}
	return out
}


// MARK: pitOverlaps
/** True when the log pile at (x, z) touches a blocked cell or a trunk. */
function pitOverlaps(
	x       : number,
	z       : number,
	blocked : ReadonlySet<string>,
	trees   : ReadonlyArray<{ x: number; z: number; radius: number }>,
): boolean {
	const cell = cellAt(x, z)
	if (cell === null) return true
	if (blocked.has(`${cell.tx},${cell.tz},0`)) return true
	const C = MAZE_TILE_WORLD_METERS
	const O = MAZE_ORIGIN_OFFSET_METERS
	const pitSq = HIDDEN_PIT_RADIUS_M * HIDDEN_PIT_RADIUS_M
	for (const key of blocked) {
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
