/**
 * player.ts — player-avatar side effects driven by game events.
 *
 * Currently owns just the round-boundary respawn: teleport every player
 * to the scene's center pad when the round resets. Requires the
 * ALLOW_TO_MOVE_PLAYER_INSIDE_SCENE permission (declared in scene.json).
 *
 * Future homes here: locomotion tweaks (squid-swim on own paint),
 * respawn-on-death (Phase 6), team-color indicator attachments, etc.
 */

import { engine } from '@dcl/sdk/ecs'
import { movePlayerTo } from '~system/RestrictedActions'

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'

// Player spawn is bound to the campfire so it always lands players on
// the rally point regardless of scene size. Stand a couple of meters SW
// of the fire and look at it — that way you always see the fire on
// first frame instead of your back to it.
const SPAWN_OFFSET  = 2   // meters SW of campfire centre
const PLAYER_STAND_Y = 2  // avatar feet clearance above the walkable slab

function teleportHome(): void {
	const target = {
		x: CAMPFIRE_WORLD_X - SPAWN_OFFSET,
		y: PLAYER_STAND_Y,
		z: CAMPFIRE_WORLD_Z - SPAWN_OFFSET,
	}
	// Fire-and-forget: movePlayerTo can reject if the player has moved
	// to another scene, and there's nothing useful to do about it.
	movePlayerTo({
		newRelativePosition: target,
		cameraTarget:        { x: CAMPFIRE_WORLD_X, y: PLAYER_STAND_Y, z: CAMPFIRE_WORLD_Z },
	}).catch(() => {})
}

export function initPlayerNet(): void {
  // Initial spawn-in: give the maze ~2s to grow in, then plant the player
  // on the center cross. Without this, players land wherever scene.json's
  // spawn range dropped them, which may or may not be on solid ground
  // depending on maze layout.
  let elapsed = 0
  let done = false
  const INIT_DELAY = 2
  engine.addSystem((dt: number) => {
    if (done) return
    elapsed += dt
    if (elapsed < INIT_DELAY) return
    done = true
    teleportHome()
  })
}
