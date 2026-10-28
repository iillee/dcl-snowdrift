/**
 * socketLava.ts (client) - the lava pool on the floor of a released monument's socket (rules and numbers: shared/socketLava.ts).
 *
 * stationMarkers feeds it each frame with the crystal's bottom-tip height; the pool fills in once the crystal has cleared it and
 * stays for the rest of the world. It paints through lavaLook (the volcano lava material), has no collider (the socket's
 * invisible plug at ground level already keeps players out) and is a torch relight source (only) via volcanoCrown.isInLavaRelightRange: it is
 * NOT a fire for the world end or a wake point for frozen players.
 */

import { engine, Entity, MeshRenderer, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

import {
	SOCKET_LAVA_EMISSIVE,
	SOCKET_LAVA_HEAT,
	SOCKET_LAVA_SIZE_M,
	socketLavaCanRelight,
	socketLavaClear,
	socketLavaFloorY,
	socketLavaHeightM,
	socketLavaPresenceStep,
} from 'src/shared/socketLava'

import { paintLava } from 'src/client/lavaLook'

type Pool = { x: number; z: number; groundY: number; p: number; e: Entity | null; lastP: number }
const pools = new Map<number, Pool>()


// MARK: updateSocketLava
/**
 * Advance monument `index`'s pool. `released` = the monument is released (server state); `bottomY` = the crystal's bottom-tip
 * world Y (the pool appears once it is clear of it).
 */
export function updateSocketLava(index: number, x: number, z: number, groundY: number, released: boolean, bottomY: number, dt: number): void {
	let pool = pools.get(index)
	if (!pool) {
		if (!released) return
		pool = { x, z, groundY, p: 0, e: null, lastP: -1 }
		pools.set(index, pool)
	}
	pool.x = x; pool.z = z; pool.groundY = groundY
	pool.p = socketLavaPresenceStep(pool.p, dt, released && socketLavaClear(bottomY, groundY))
	if (pool.p <= 0) {
		if (pool.e !== null) { engine.removeEntity(pool.e); pool.e = null; pool.lastP = -1 }
		return
	}
	if (pool.lastP === pool.p) return
	pool.lastP = pool.p
	const h     = Math.max(0.01, socketLavaHeightM(pool.p, groundY))
	const floor = socketLavaFloorY(groundY)
	if (pool.e === null) {
		pool.e = engine.addEntity()
		Transform.create(pool.e, { position: Vector3.create(x, floor + h / 2, z), scale: Vector3.create(SOCKET_LAVA_SIZE_M, h, SOCKET_LAVA_SIZE_M) })
		MeshRenderer.setBox(pool.e)
	} else {
		const tr = Transform.getMutable(pool.e)
		tr.position = Vector3.create(x, floor + h / 2, z)
		tr.scale    = Vector3.create(SOCKET_LAVA_SIZE_M, h, SOCKET_LAVA_SIZE_M)
	}
	paintLava(pool.e, SOCKET_LAVA_HEAT, SOCKET_LAVA_EMISSIVE * pool.p)
}


// MARK: clearSocketLava
/** Drop every pool (world change / terrain rebuild / new expedition). */
export function clearSocketLava(): void {
	for (const pool of pools.values()) if (pool.e !== null) engine.removeEntity(pool.e)
	pools.clear()
}


// MARK: isInSocketLavaRelightRange
/** True when the local player is close enough to a lit socket pool to light their torch. */
export function isInSocketLavaRelightRange(): boolean {
	const t = Transform.getOrNull(engine.PlayerEntity)
	if (t === null) return false
	const { x, y, z } = t.position
	for (const pool of pools.values()) if (socketLavaCanRelight(x, y, z, pool.x, pool.z, pool.groundY, pool.p)) return true
	return false
}
