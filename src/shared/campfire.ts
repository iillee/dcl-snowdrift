/**
 * campfire.ts — shared placement + heat-radius constants for the campfire.
 *
 * Consumed by src/client/campfire.ts (visual placement + decay opt-out),
 * src/server/server.ts (persistent melt ring in paint state), and
 * anything else that needs "am I standing in the fire's warmth?".
 *
 * Metaphor: the fire's heat melts the snow inside this radius, so paint
 * cells within it must never regrow into snow cubes (client) and must
 * never lose their melted (blue) color (server).
 */

import { MAZE_GRID_HEIGHT, MAZE_GRID_WIDTH, MAZE_ORIGIN_OFFSET_METERS, MAZE_TILE_WORLD_METERS } from 'src/shared/settings'


// MARK: Placement
/** Campfire world position (X). Geometric centre of the playfield (offset + half-playfield). */
export const CAMPFIRE_WORLD_X = MAZE_ORIGIN_OFFSET_METERS + (MAZE_GRID_WIDTH  * MAZE_TILE_WORLD_METERS) / 2
/** Campfire world position (Z). Geometric centre of the playfield. */
export const CAMPFIRE_WORLD_Z = MAZE_ORIGIN_OFFSET_METERS + (MAZE_GRID_HEIGHT * MAZE_TILE_WORLD_METERS) / 2
/** Campfire visual base height. */
export const CAMPFIRE_WORLD_Y = 0.25


// MARK: Heat radius
/** Diameter of the always-melted ring around the campfire (meters). */
export const CAMPFIRE_MELT_DIAMETER_M = 16
/** Radius of the always-melted ring around the campfire (meters). */
export const CAMPFIRE_MELT_RADIUS_M   = CAMPFIRE_MELT_DIAMETER_M / 2
/** Squared radius — hot loops should compare dx*dx + dz*dz to this. */
export const CAMPFIRE_MELT_RADIUS_SQ_M = CAMPFIRE_MELT_RADIUS_M * CAMPFIRE_MELT_RADIUS_M


// MARK: isInsideMeltRadius
/**
 * Cheap point-in-circle test for arbitrary world coordinates.
 */
export function isInsideMeltRadius(worldX: number, worldZ: number): boolean {
	const dx = worldX - CAMPFIRE_WORLD_X
	const dz = worldZ - CAMPFIRE_WORLD_Z
	return dx * dx + dz * dz <= CAMPFIRE_MELT_RADIUS_SQ_M
}
