/**
 * grove.ts — per-destination grove archetype parameters.
 *
 * Terrain picks where sockets exist (Low / Mid / High greens). This
 * module decides what is there this run: tree count, spacing personality,
 * buried-wood richness, and a future specialDiscovery hook.
 *
 * Starting hearth territory is NOT a grove socket — only the three
 * major green destinations. The volcano landmark (map.volcano) is not
 * a grove. specialDiscovery stays 'none' until later hooks.
 */

import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { getTerrain } from 'src/shared/terrain/terrainCache'
import { TerrainDestination } from 'src/shared/terrain/terrainMap'


// MARK: GroveSpecialDiscovery
/** Future roguelike hook. V1 always none. */
export type GroveSpecialDiscovery = 'none'


// MARK: GroveParams
/**
 * Controllable ranges for one major grove. Emergent personalities
 * (dense / scattered / rich / harsh) come from these knobs, not named
 * hard-coded classes.
 */
export interface GroveParams {
	destIndex         : number
	/** Living trees to place (4–8). */
	treeCount         : number
	/**
	 * Scales the default hearth-like radii. <1 = compact/dense,
	 * >1 = broader/scattered.
	 */
	radiusScale       : number
	/** Min trunk separation inside the grove (m). */
	minSepM           : number
	/** Buried-wood pool size for this grove. */
	woodPool          : number
	/** How many of that pool start active. */
	woodActive        : number
	/** Chance a buried piece is a log (rest branches). */
	logChance         : number
	/** Future discovery socket. */
	specialDiscovery  : GroveSpecialDiscovery
}


// MARK: GroveSite
/** Destination socket plus this-run contents parameters. */
export interface GroveSite {
	dest   : TerrainDestination
	params : GroveParams
}


// MARK: Local RNG
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


// MARK: groveParamsForDest
/**
 * Deterministic archetype knobs for destination index `destIndex`
 * under layout maze seed. Same seed → same grove personality.
 */
export function groveParamsForDest(
	mazeSeed : number,
	destIndex: number,
): GroveParams {
	const rng = makeRng((mazeSeed | 0) ^ 0x47524F56 ^ (destIndex * 0x9E3779B9))
	const treeCount   = 5 + Math.floor(rng() * 5) // 5..9
	const radiusScale = 0.7 + rng() * 0.7         // 0.7..1.4
	const compact     = radiusScale < 0.95
	const minSepM     = compact ? 32 + rng() * 14 : 42 + rng() * 20
	const woodPool    = 32 + Math.floor(rng() * 24) // 32..55
	const woodActive  = Math.min(
		woodPool,
		14 + Math.floor(rng() * 12), // 14..25
	)
	const logChance = 0.10 + rng() * 0.16 // 0.10..0.26
	return {
		destIndex,
		treeCount,
		radiusScale,
		minSepM,
		woodPool,
		woodActive,
		logChance,
		specialDiscovery: 'none',
	}
}


// MARK: listGroveSites
/**
 * All major grove sockets for a cycle seed (layout via cycleMazeSeed).
 * Order matches map.destinations (Low / Mid / High when present).
 * Volcano is stored on map.volcano and is never listed here.
 */
export function listGroveSites(cycleSeed: number): GroveSite[] {
	const mazeSeed = cycleMazeSeed(cycleSeed)
	const map      = getTerrain(mazeSeed)
	return map.destinations.map((dest, destIndex) => ({
		dest,
		params: groveParamsForDest(mazeSeed, destIndex),
	}))
}


// MARK: listGroveSitesForMazeSeed
/** Same as listGroveSites but when the caller already has a layout seed. */
export function listGroveSitesForMazeSeed(mazeSeed: number): GroveSite[] {
	const map = getTerrain(mazeSeed)
	return map.destinations.map((dest, destIndex) => ({
		dest,
		params: groveParamsForDest(mazeSeed, destIndex),
	}))
}
