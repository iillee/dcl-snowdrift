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

import { isTopDownActive, toggleTopDownCamera } from 'src/client/topDownCamera'


// Dawn pad. Look stays on the playtest sunrise heading.
const SPAWN_X = 258.1
const SPAWN_Y = 0.5
const SPAWN_Z = 258.1
/** Compass degrees from +Z (north), clockwise. 232.5 = SW of WSW. */
const LOOK_SUNRISE_DEG = 232.5
const LOOK_DIST_M      = 80
const LOOK_UP_M        = 8
const LOOK_RAD         = (LOOK_SUNRISE_DEG * Math.PI) / 180
const LOOK_DX          = Math.sin(LOOK_RAD) * LOOK_DIST_M
const LOOK_DZ          = Math.cos(LOOK_RAD) * LOOK_DIST_M


// MARK: getHomePosition
/** Feet on the dawn spawn pad. */
export function getHomePosition(): { x: number, y: number, z: number } {
	return {
		x: SPAWN_X,
		y: SPAWN_Y,
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
	movePlayerTo({
		newRelativePosition: { x, y: SPAWN_Y, z },
		cameraTarget       : { x: lookX, y: 1.2, z: lookZ },
		avatarTarget       : { x: lookX, y: 1.2, z: lookZ },
	}).catch(() => {})
}


// MARK: initPlayerNet
/**
 * After a short load beat, run `onReady` (first-join collapse).
 * Delay lets PlayerEntity exist before movePlayerTo.
 */
export function initPlayerNet(onReady: () => void): void {
	let elapsed = 0
	let done = false
	const INIT_DELAY = 2
	engine.addSystem((dt: number) => {
		if (done) return
		elapsed += dt
		if (elapsed < INIT_DELAY) return
		done = true
		onReady()
	})
}
