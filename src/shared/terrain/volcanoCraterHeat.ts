/**
 * volcanoCraterHeat.ts — persistent Warm-tier heat over the caldera.
 *
 * Locked V1: crater floor always radiates heat / melts snow like a
 * medium (Warm) campfire, even at 0/3 stations. Lava meshes stay
 * thaw-gated; this module only names the heat centre + radius.
 *
 * Pure; safe for client and server.
 */

import { CAMPFIRE_MELT_RADIUS_M } from 'src/shared/campfire'
import { FUEL_MAIN_INITIAL } from 'src/shared/hearthFuel'
import { cellCenterWorld, TerrainMap } from 'src/shared/terrain/terrainMap'
import { volcanoLavaCentroid } from 'src/shared/terrain/volcanoCrown'


/** Warm-tier melt / warmth radius (same as opening hearth ring). */
export const CRATER_HEAT_RADIUS_M = CAMPFIRE_MELT_RADIUS_M

/** Squared radius for hot-loop distance checks. */
export const CRATER_HEAT_RADIUS_SQ_M = CRATER_HEAT_RADIUS_M * CRATER_HEAT_RADIUS_M

/**
 * Fuel seconds treated as Warm for frost warmth rate. Matches the
 * spawn hearth's opening tank so crater heat feels identical.
 */
export const CRATER_HEAT_FUEL = FUEL_MAIN_INITIAL


// MARK: volcanoCraterHeatCenter
/**
 * World XZ of the lava-lake centroid (heat source centre), or null
 * when the layout has no caldera.
 */
export function volcanoCraterHeatCenter(
	map: TerrainMap,
): { x: number; z: number } | null {
	const c = volcanoLavaCentroid(map)
	if (!c) return null
	const { x, z } = cellCenterWorld(Math.floor(c.fx), Math.floor(c.fz))
	return { x, z }
}
