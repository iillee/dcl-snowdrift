/**
 * hearthSeat.ts - the main hearth's current ground height. The hearth sits on the MID shelf (CAMPFIRE_WORLD_Y), but
 * an oasis of the near-spawn monument melts the terrain cap under it, lowering the floor one step
 * (shared/terrain/oasis.ts). Everything attached to the hearth (campfire root with stones / flames / light / audio /
 * collider, smoke, fuel bar, feed-arc aim) reads this each frame so it follows the floor, late joiners included.
 */

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Y, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { activeGroundYAt, activeTerrain } from 'src/shared/terrain/terrainCache'

/** World Y of the ground under the main hearth right now (CAMPFIRE_WORLD_Y until a map is active). */
export function hearthSurfaceY(): number {
	return activeTerrain() === null ? CAMPFIRE_WORLD_Y : activeGroundYAt(CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z)
}