/**
 * terrainCache.ts — memoised terrain maps and the cell sets other
 * systems need from them.
 *
 * generateTerrain() costs a few milliseconds, and wood, hidden fires,
 * props, the snow mask and the renderer all want the same map for the
 * same seed. This keeps the last few maps so a reroll pays for one
 * generation instead of six. Safe for client and server; each process
 * keeps its own cache and both agree because the generator is pure.
 */

import { TERRAIN_HEARTH_SURFACE_Y, TERRAIN_LEVEL_MID } from 'src/shared/settings'
import { generateTerrain } from 'src/shared/terrain/terrainGen'
import { groundYAtWorld, levelAtWorld, TerrainMap } from 'src/shared/terrain/terrainMap'


/** Maps kept before the oldest is dropped. */
const CACHE_LIMIT = 3

const cache = new Map<number, TerrainMap>()

let activeSeed = 0


// MARK: getTerrain
/**
 * Terrain map for a layout seed (the value from cycleMazeSeed). Repeat
 * calls with the same seed return the same object.
 */
export function getTerrain(mazeSeed: number): TerrainMap {
	const key = mazeSeed >>> 0
	const hit = cache.get(key)
	if (hit) return hit
	const map = generateTerrain(key)
	cache.set(key, map)
	if (cache.size > CACHE_LIMIT) {
		const oldest = cache.keys().next().value
		if (oldest !== undefined) cache.delete(oldest)
	}
	return map
}


// MARK: setActiveTerrain
/**
 * Declare which layout the world is currently showing, so systems that
 * only know a world position (the melt brush, footsteps, snow height
 * queries) can ask what the ground is under them without threading the
 * seed through every call. Set it alongside the renderer's seed.
 */
export function setActiveTerrain(mazeSeed: number): void {
	activeSeed = mazeSeed >>> 0
	getTerrain(activeSeed)
}


// MARK: activeTerrain
/** The map setActiveTerrain named, or null before the first seed lands. */
export function activeTerrain(): TerrainMap | null {
	if (activeSeed === 0) return null
	return getTerrain(activeSeed)
}


// MARK: activeGroundYAt
/**
 * Walkable surface height under a world position. Falls back to the
 * hearth surface before a seed arrives, which is where the campfire and
 * the spawn pad sit, so early frames land on solid ground rather than
 * at y=0.
 */
export function activeGroundYAt(x: number, z: number): number {
	const map = activeTerrain()
	if (map === null) return TERRAIN_HEARTH_SURFACE_Y
	return groundYAtWorld(map, x, z)
}


// MARK: activeLevelAt
/** Terrain level under a world position, or the hearth level if unseeded. */
export function activeLevelAt(x: number, z: number): number {
	const map = activeTerrain()
	if (map === null) return TERRAIN_LEVEL_MID
	return levelAtWorld(map, x, z)
}


// MARK: offHearthCellsForMazeSeed
/**
 * Cells where ground-level content must not spawn, keyed `tx,tz,0`.
 *
 * Snow and ground heights understand elevation now, but trees, wood and
 * hidden fires are still placed and balanced around a single level, so
 * this keeps them on the hearth. Spreading them across levels belongs
 * with the destination work, which decides what is worth the climb.
 */
export function offHearthCellsForMazeSeed(mazeSeed: number): Set<string> {
	const map = getTerrain(mazeSeed)
	const out = new Set<string>()
	for (let cz = 0; cz < map.h; cz++) {
		for (let cx = 0; cx < map.w; cx++) {
			if (map.levels[cz * map.w + cx] !== TERRAIN_LEVEL_MID) out.add(`${cx},${cz},0`)
		}
	}
	return out
}

