/**
 * crystalFloat.ts - shared absolute float height for released crystals.
 *
 * Every released crystal's bottom tip sits at the SAME world Y:
 * highest monument ground on the map + CRYSTAL_FLOAT_HEIGHT_M. Client
 * (rise / idle / late join / sphere + burst centre) and server (thaw
 * front height) both use this so they stay in sync.
 */

import { CRYSTAL_FLOAT_HEIGHT_M } from 'src/shared/ruleset'
import { TerrainMap, cellCenterWorld, groundYAtWorld } from 'src/shared/terrain/terrainMap'

let cacheMap: TerrainMap | null = null
let cacheY = 0

/** Absolute world Y of every released crystal's bottom tip for this map. */
export function crystalFloatBottomY(map: TerrainMap): number {
	if (map === cacheMap) return cacheY
	let top = -Infinity
	for (const st of map.stations) {
		const c = cellCenterWorld(st.cx, st.cz)
		top = Math.max(top, groundYAtWorld(map, c.x, c.z))
	}
	cacheMap = map
	cacheY = (Number.isFinite(top) ? top : 0) + CRYSTAL_FLOAT_HEIGHT_M
	return cacheY
}

/** Bottom tip height above this ground (m), at least CRYSTAL_FLOAT_HEIGHT_M fallback when no map. */
export function crystalFloatAboveGround(map: TerrainMap | null, groundY: number): number {
	if (!map) return CRYSTAL_FLOAT_HEIGHT_M
	return Math.max(0, crystalFloatBottomY(map) - groundY)
}