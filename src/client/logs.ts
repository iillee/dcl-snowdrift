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
 *     removes the ground GLB, flips local hasLogs() true, and sends
 *     logPickupRequest. Server confirms with logPileRemoved, which
 *     no-ops if we already destroyed the entity.
 *
 * Optimism / race behaviour:
 *   - Two clients over the same pile in the same frame will both send
 *     logPickupRequest and both flip local hasLogs. Server sees the
 *     first and ignores the second; both clients end up carrying.
 *     Acceptable for the cozy tone (Vision 15: "not competitive").
 *   - If a server rejects our pickup (pile was already gone), we do
 *     nothing to roll back local carrying. See design note above.
 */

import { Transform, engine, Entity } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { activeGroundYAt, activeTerrain } from 'src/shared/terrain/terrainCache'
import { oasisDeltaY, onOasisChanged } from 'src/shared/terrain/oasis'

import { inPickupReach } from 'src/shared/logs'
import { room } from 'src/shared/messages'
import { clampWoodKind } from 'src/shared/woodKind'

import { hasLogs, pickupLogs } from 'src/client/logsInventory'
import { onServerSessionChange } from 'src/client/serverSession'
import { attachWoodModel } from 'src/client/woodVisual'


/** Proximity poll cadence (s). Matches locomotion.ts (150 ms) so we
 *  amortise cost across the frame budget. */
const POLL_INTERVAL_S = 0.15


interface PileRec {
	entity: Entity
	x     : number
	z     : number
	kind  : number
	/** False right after a drop; becomes true once the local player has
	 *  left the pickup radius at least once. Prevents instant re-grab. */
	armed : boolean
}

const piles = new Map<number, PileRec>()

// An oasis melts the terrain cap away: dropped logs inside it move down onto the new floor.
onOasisChanged((was) => {
	const map = activeTerrain()
	if (!map) return
	for (const rec of piles.values()) {
		const dy = oasisDeltaY(map, rec.x, rec.z, was)
		const tr = dy === 0 ? null : Transform.getMutableOrNull(rec.entity)
		if (tr) tr.position = Vector3.create(tr.position.x, tr.position.y + dy, tr.position.z)
	}
})


// MARK: spawnPileEntity
function spawnPileEntity(
	id   : number,
	x    : number,
	z    : number,
	kind : number,
	armed: boolean,
): void {
	if (piles.has(id)) {
		console.log(`logs: spawnPileEntity: pile #${id} already spawned, ignoring dup add`)
		return
	}
	const entity = engine.addEntity()
	attachWoodModel(entity, x, z, (id * 37) % 360, activeGroundYAt(x, z))
	piles.set(id, { entity, x, z, kind, armed })
	console.log(
		`logs: spawnPileEntity: pile #${id} kind=${kind} spawned at ` +
		`(${x.toFixed(2)}, ${z.toFixed(2)}) armed=${armed}`
	)
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

	room.onMessage('logPileAdded', ({ id, x, z, kind }) => {
		// New piles start un-armed for the local player so a just-dropped
		// pile can't be re-picked on the same frame. If this pile was
		// added by someone else, we're
		// nowhere near it, so the arming check will pass on the next
		// poll and it becomes pickup-able immediately.
		spawnPileEntity(id, x, z, clampWoodKind(kind), /* armed */ false)
	})

	room.onMessage('logPileRemoved', ({ id }) => {
		despawnPileEntity(id)
	})

	// New server run: its pile ids restart at 1, so piles from the old one
	// would collide with (and shadow) the new ones. Drop them; the server
	// re-sends the live piles on joinRoster.
	onServerSessionChange(({ restarted }) => {
		if (!restarted) return
		const n = piles.size
		for (const id of [...piles.keys()]) despawnPileEntity(id)
		console.log(`logs: server restarted - cleared ${n} stale pile(s)`)
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
	const py = player.position.y
	const pz = player.position.z

	for (const [id, rec] of piles) {
		const inRange = inPickupReach(px, py, pz, rec.x, activeGroundYAt(rec.x, rec.z), rec.z)

		if (!rec.armed) {
			if (!inRange) rec.armed = true
			continue
		}
		if (!inRange) continue

		// Remove the ground GLB before the head pop. Hiding it in place
		// left the mesh up for a frame (and again if the model finished
		// loading after the hide), so the piece showed on the snow and
		// over the head at once.
		despawnPileEntity(id)
		pickupLogs(rec.kind)
		room.send('logPickupRequest', { id, py })
		console.log(`logs: proximityPollSystem: sent logPickupRequest #${id} kind=${rec.kind}`)
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
	const py = player.position.y
	const pz = player.position.z
	for (const rec of piles.values()) {
		if (rec.armed) continue
		if (!inPickupReach(px, py, pz, rec.x, activeGroundYAt(rec.x, rec.z), rec.z)) rec.armed = true
	}
}

