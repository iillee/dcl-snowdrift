/**
 * logs.ts - client rendering + proximity poll for server-owned wood piles.
 *
 * Owns:
 *   - pileEntities  : Map<pileId, Entity>   one GLB per server-broadcast pile
 *   - pickupArmed   : Set<pileId>           piles the local player must
 *                     leave the radius of before picking up again
 *                     (prevents instant re-grab after a drop)
 *
 * Wire:
 *   - Server broadcasts logPileAdded / logPileRemoved.
 *   - Client spawns / despawns entities in reaction.
 *   - Local proximity poll walks the map and, on close-enough distance,
 *     optimistically hides the entity, flips local hasLogs() true, and
 *     sends logPickupRequest to the server. Server confirms with
 *     logPileRemoved, at which point we destroy the entity for real.
 *
 * Optimism / race behaviour:
 *   - Two clients over the same pile in the same frame will both send
 *     logPickupRequest and both flip local hasLogs. Server sees the
 *     first and ignores the second; both clients end up carrying.
 *     Acceptable for the cozy tone (Vision 15: "not competitive").
 *   - If a server rejects our pickup (pile was already gone), we do
 *     nothing to roll back local carrying. See design note above.
 */

import { GltfContainer, Transform, VisibilityComponent, engine, Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import { LOGS_PICKUP_RADIUS_SQ, LOGS_PILE_WORLD_Y } from 'src/shared/logs'
import { hasLogs, pickupLogs }                     from 'src/client/logsInventory'
import { room }                                    from 'src/shared/messages'


const LOGS_PILE_MODEL = 'assets/models/logs_pickup.glb'

/** Proximity poll cadence (s). Matches locomotion.ts (150 ms) so we
 *  amortise cost across the frame budget. */
const POLL_INTERVAL_S = 0.15


interface PileRec {
	entity: Entity
	x     : number
	z     : number
	/** False right after a drop; becomes true once the local player has
	 *  left the pickup radius at least once. Prevents instant re-grab. */
	armed : boolean
}

const piles = new Map<number, PileRec>()


// MARK: spawnPileEntity
function spawnPileEntity(id: number, x: number, z: number, armed: boolean): void {
	if (piles.has(id)) {
		console.log(`logs: spawnPileEntity: pile #${id} already spawned, ignoring dup add`)
		return
	}
	const entity = engine.addEntity()
	Transform.create(entity, {
		position: Vector3.create(x, LOGS_PILE_WORLD_Y, z),
		rotation: Quaternion.fromEulerDegrees(0, 0, 0),
	})
	GltfContainer.create(entity, { src: LOGS_PILE_MODEL })
	piles.set(id, { entity, x, z, armed })
	console.log(`logs: spawnPileEntity: pile #${id} spawned at (${x.toFixed(2)}, ${z.toFixed(2)}) armed=${armed}`)
}


// MARK: despawnPileEntity
function despawnPileEntity(id: number): void {
	const rec = piles.get(id)
	if (!rec) return
	engine.removeEntity(rec.entity)
	piles.delete(id)
	console.log(`logs: despawnPileEntity: pile #${id} removed`)
}


// MARK: setupLogsClient
/**
 * Register the network handlers + start the proximity poll. Idempotent
 * via a module-level installed flag - safe to call once from the client
 * bootstrap.
 */
let installed = false
export function setupLogsClient(): void {
	if (installed) {
		console.log('logs: setupLogsClient: already installed, skipping')
		return
	}
	installed = true

	room.onMessage('logPileAdded', ({ id, x, z }) => {
		// New piles start un-armed for the local player so a just-dropped
		// pile can't be re-picked on the same frame. If this pile was
		// added by someone else (or is the boot-time initial pile), we're
		// nowhere near it, so the arming check will pass on the next
		// poll and it becomes pickup-able immediately.
		spawnPileEntity(id, x, z, /* armed */ false)
	})

	room.onMessage('logPileRemoved', ({ id }) => {
		despawnPileEntity(id)
	})

	engine.addSystem(proximityPollSystem)
	console.log('logs: setupLogsClient: handlers + proximity poll installed')
}


// MARK: proximityPollSystem
let accum = 0
function proximityPollSystem(dt: number): void {
	accum += dt
	if (accum < POLL_INTERVAL_S) return
	accum = 0

	// Cheap early-out: if we're already carrying, nothing to check.
	if (hasLogs()) {
		// But still walk the map to arm any pile the player has stepped
		// out of the radius of, so the moment they drop + walk back
		// they can pick up again cleanly.
		armPilesOutOfRange()
		return
	}
	if (piles.size === 0) return

	const player = Transform.getOrNull(engine.PlayerEntity)
	if (!player) return
	const px = player.position.x
	const pz = player.position.z

	for (const [id, rec] of piles) {
		const dx = px - rec.x
		const dz = pz - rec.z
		const inRange = dx * dx + dz * dz <= LOGS_PICKUP_RADIUS_SQ

		if (!rec.armed) {
			if (!inRange) rec.armed = true
			continue
		}
		if (!inRange) continue

		// Pickup! Optimistically hide the GLB + flip local carry state,
		// then ask the server to make it authoritative. On confirmation
		// we get a logPileRemoved and the entity is destroyed.
		VisibilityComponent.createOrReplace(rec.entity, { visible: false })
		pickupLogs()
		room.send('logPickupRequest', { id })
		console.log(`logs: proximityPollSystem: sent logPickupRequest #${id}`)
		// Only one pickup per poll - break so we don't try to grab
		// multiple piles on the same tick.
		break
	}
}


// MARK: armPilesOutOfRange
/**
 * Walk every pile and mark any that the player is currently outside
 * the pickup radius of as `armed`. Called from the proximity poll
 * even while carrying, so that a subsequent drop-then-return cycle
 * always finds the pile in a pickup-able state.
 */
function armPilesOutOfRange(): void {
	const player = Transform.getOrNull(engine.PlayerEntity)
	if (!player) return
	const px = player.position.x
	const pz = player.position.z
	for (const rec of piles.values()) {
		if (rec.armed) continue
		const dx = px - rec.x
		const dz = pz - rec.z
		if (dx * dx + dz * dz > LOGS_PICKUP_RADIUS_SQ) rec.armed = true
	}
}
