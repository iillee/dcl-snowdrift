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

import { engine, Transform } from '@dcl/sdk/ecs'
import { movePlayerTo } from '~system/RestrictedActions'

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { activeGroundYAt } from 'src/shared/terrain/terrainCache'

import { isTopDownActive, toggleTopDownCamera } from 'src/client/topDownCamera'


/** Compass degrees from +Z (north), clockwise. 232.5 = SW of WSW. */
const LOOK_SUNRISE_DEG = 232.5
const LOOK_DIST_M      = 80
const LOOK_UP_M        = 8
const LOOK_RAD         = (LOOK_SUNRISE_DEG * Math.PI) / 180
const LOOK_DX          = Math.sin(LOOK_RAD) * LOOK_DIST_M
const LOOK_DZ          = Math.cos(LOOK_RAD) * LOOK_DIST_M

/**
 * Dawn pad: PAD_DIST_M back from the fire along the sunrise heading, so
 * the sunrise look runs straight over the campfire (spawn faces the fire)
 * and the pad sits clear of the fire's collider. scene.json's static
 * spawn mirrors this point.
 */
const PAD_DIST_M = 3
const SPAWN_X    = CAMPFIRE_WORLD_X - Math.sin(LOOK_RAD) * PAD_DIST_M
const SPAWN_Z    = CAMPFIRE_WORLD_Z - Math.cos(LOOK_RAD) * PAD_DIST_M
/** Feet clearance above the walkable surface on arrival. */
const FEET_LIFT_M = 0.25
/** Treat the player as buried when this far below the ground under them. */
const BURIED_TOLERANCE_M = 0.5


// MARK: standY
/**
 * Arrival height at (x, z): the active terrain's walkable surface plus a
 * small lift. Reads the per-seed map, so a Low / High fire or a future
 * hearth level change lands on the right shelf. Before any seed lands
 * activeGroundYAt falls back to the hearth surface.
 */
function standY(x: number, z: number): number {
	return activeGroundYAt(x, z) + FEET_LIFT_M
}


// MARK: getHomePosition
/** Feet on the dawn spawn pad. */
export function getHomePosition(): { x: number, y: number, z: number } {
	return {
		x: SPAWN_X,
		y: standY(SPAWN_X, SPAWN_Z),
		z: SPAWN_Z,
	}
}


// MARK: getHomeLookAt
/** Horizon point the camera and avatar face at load-in / dawn. */
export function getHomeLookAt(): { x: number, y: number, z: number } {
	const p = getHomePosition()
	return {
		x: p.x + LOOK_DX,
		y: p.y + LOOK_UP_M,
		z: p.z + LOOK_DZ,
	}
}


// MARK: teleportHome
/**
 * Teleport the local player to the spawn pad, facing the sunrise.
 * Used by first join, frost-death arrival, and world reset.
 */
export function teleportHome(): void {
	if (isTopDownActive()) {
		console.log('player: teleportHome: leaving spectator so the dawn look can land')
		toggleTopDownCamera()
	}
	const target = getHomePosition()
	const look   = getHomeLookAt()
	movePlayerTo({
		newRelativePosition: target,
		cameraTarget       : look,
		avatarTarget       : look,
	}).catch(() => {})
}


// MARK: teleportNear
/**
 * Teleport the local player to a standing spot, looking at a point.
 * Used when a freeze resolves at the nearest lit fire.
 */
export function teleportNear(
	x    : number,
	z    : number,
	lookX: number,
	lookZ: number,
): void {
	if (isTopDownActive()) {
		console.log('player: teleportNear: leaving spectator so the arrival look can land')
		toggleTopDownCamera()
	}
	const lookY = activeGroundYAt(lookX, lookZ) + 1.2
	movePlayerTo({
		newRelativePosition: { x, y: standY(x, z), z },
		cameraTarget       : { x: lookX, y: lookY, z: lookZ },
		avatarTarget       : { x: lookX, y: lookY, z: lookZ },
	}).catch(() => {})
}


// MARK: rescueIfBuried
/**
 * Called after every terrain (re)build. If the avatar is below the
 * walkable surface under it — e.g. it was teleported before the slabs
 * existed, fell to the engine floor, and the hearth slab then spawned
 * around it — send it home to stand on the real ground.
 */
export function rescueIfBuried(): void {
	const t = Transform.getOrNull(engine.PlayerEntity)
	if (!t) return
	const { x, y, z } = t.position
	const ground = activeGroundYAt(x, z)
	if (y >= ground - BURIED_TOLERANCE_M) return
	console.log(
		`player: rescueIfBuried: avatar at y=${y.toFixed(2)} under ground ${ground.toFixed(2)} ` +
		`at (${x.toFixed(1)}, ${z.toFixed(1)}) — teleporting home`,
	)
	teleportHome()
}


// MARK: initPlayerNet
/**
 * Run `onReady` (first-join collapse) as soon as PlayerEntity exists.
 * A short floor avoids racing the first frame; a cap keeps cold open
 * from hanging if Transform is slow to appear.
 */
export function initPlayerNet(onReady: () => void): void {
	let elapsed = 0
	let done    = false
	const READY_FLOOR_S = 0.15
	const READY_CAP_S   = 0.75
	engine.addSystem((dt: number) => {
		if (done) return
		elapsed += dt
		if (elapsed < READY_FLOOR_S) return
		const playerReady = Transform.getOrNull(engine.PlayerEntity) !== null
		if (!playerReady && elapsed < READY_CAP_S) return
		done = true
		onReady()
	})
}
