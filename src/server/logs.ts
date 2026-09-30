/**
 * logs.ts - authoritative state for wood piles in the world.
 *
 * Owns:
 *   - piles           : Map<pileId, { x, z, kind }>   active piles by id
 *   - nextPileId      : monotonic id counter (never reused, so a
 *                       delayed logPileRemoved never collides with
 *                       a later logPileAdded).
 *
 * Message contracts:
 *   Client -> Server  logPickupRequest  { id }
 *   Client -> Server  logDropRequest    { x, z, kind }
 *   Server -> Client  logPileAdded      { id, x, z, kind }
 *   Server -> Client  logPileRemoved    { id }
 *
 * No starter pile and no hearth respawn. Wood starts in the scatter
 * field. Piles here are only player drops (and later death drops).
 *
 * Persistence:
 *   - Piles live in server memory. Cleared on every cycle roll
 *     (matches the vision: the world forgets each day).
 *   - Not restored across server restart (in-memory only, v1).
 *
 * Trust model:
 *   - pickup: first request wins, subsequent ignored. Race between
 *     two clients can leave both believing they picked up; acceptable
 *     for cozy tone.
 *   - drop: unvalidated. Client claim of "I'm carrying" is trusted.
 *     A malicious client could spawn free piles; tolerated for v1.
 */

import { INITIAL_LOGS_PILE_X, INITIAL_LOGS_PILE_Z } from 'src/shared/logs'
import { room } from 'src/shared/messages'
import { clampWoodKind } from 'src/shared/woodKind'

import { onCycleRoll } from 'src/server/cycle'


/**
 * Squared-metre radius around the old hearth slot (INITIAL_LOGS_PILE_X/Z)
 * within which two drops would stack. 4 m² = 2 m radius — wide enough
 * that a drop right next to the fire does not sit on top of another.
 */
const HEARTH_SLOT_RADIUS_SQ = 4


interface PileRec {
	x   : number
	z   : number
	kind: number
}


let nextPileId = 1
const piles    = new Map<number, PileRec>()


// MARK: isAtHearthSlot
/** True if (x,z) is within HEARTH_SLOT_RADIUS_SQ of the hearth drop slot. */
function isAtHearthSlot(x: number, z: number): boolean {
	const dx = x - INITIAL_LOGS_PILE_X
	const dz = z - INITIAL_LOGS_PILE_Z
	return (dx * dx + dz * dz) < HEARTH_SLOT_RADIUS_SQ
}


// MARK: isHearthPilePresent
/** True if any pile currently sits on the hearth drop slot. */
function isHearthPilePresent(): boolean {
	for (const p of piles.values()) {
		if (isAtHearthSlot(p.x, p.z)) return true
	}
	return false
}


// MARK: addPile
/**
 * Allocate a new pile at (x, z) and broadcast to all clients. Returns
 * the new pile id.
 */
function addPile(
	x   : number,
	z   : number,
	kind: number,
): number {
	const id = nextPileId++
	piles.set(id, { x, z, kind })
	room.send('logPileAdded', { id, x, z, kind })
	console.log(
		`[Server] logs: pile #${id} kind=${kind} added at ` +
		`(${x.toFixed(2)}, ${z.toFixed(2)}) (total ${piles.size})`
	)
	return id
}


// MARK: removePile
/**
 * Delete a pile by id and broadcast the removal. No-op if the id is
 * already gone (idempotent so repeated pickup requests in a race
 * safely collapse to one removal).
 */
function removePile(id: number): boolean {
	if (!piles.has(id)) return false
	piles.delete(id)
	room.send('logPileRemoved', { id })
	console.log(`[Server] logs: pile #${id} removed (remaining ${piles.size})`)
	return true
}


// MARK: nudgeOutOfHearthSlotIfOccupied
/**
 * If (x, z) would land inside the hearth slot AND a pile is already
 * there, return a nudged position just outside the slot radius so we
 * never stack two piles at the fire. If the slot is empty, or the
 * drop is already outside the radius, returns the input unchanged.
 *
 * Nudge direction: radial vector from hearth centre through the drop
 * point, extended to (radius + 0.5 m). If the drop is exactly at the
 * hearth centre we push +X arbitrarily so we never divide by zero.
 */
function nudgeOutOfHearthSlotIfOccupied(x: number, z: number): { x: number, z: number } {
	if (!isAtHearthSlot(x, z))    return { x, z }
	if (!isHearthPilePresent())   return { x, z }

	const dx = x - INITIAL_LOGS_PILE_X
	const dz = z - INITIAL_LOGS_PILE_Z
	const len = Math.sqrt(dx * dx + dz * dz)
	const radius = Math.sqrt(HEARTH_SLOT_RADIUS_SQ) + 0.5
	if (len < 1e-4) {
		return { x: INITIAL_LOGS_PILE_X + radius, z: INITIAL_LOGS_PILE_Z }
	}
	const scale = radius / len
	return {
		x: INITIAL_LOGS_PILE_X + dx * scale,
		z: INITIAL_LOGS_PILE_Z + dz * scale,
	}
}


// MARK: resetForCycle
/**
 * Wipe every pile. Called by cycle rollover. Sends a removal for each
 * existing pile so clients that hydrated mid-cycle don't leak stale
 * GLBs. Does not spawn a replacement — wood lives in the scatter.
 */
function resetForCycle(): void {
	console.log(`[Server] logs: cycle roll - clearing ${piles.size} pile(s)`)
	const doomed = Array.from(piles.keys())
	for (const id of doomed) removePile(id)
}


// MARK: sendLogPilesTo
/**
 * Push the full pile set to a specific client. Called from the
 * joinRoster handler so latecomers immediately see every pile a
 * previous player dropped.
 */
export function sendLogPilesTo(userId: string): void {
	for (const [id, pile] of piles) {
		room.send('logPileAdded', { id, x: pile.x, z: pile.z, kind: pile.kind }, { to: [userId] })
	}
	console.log(`[Server] logs: hydrated ${piles.size} pile(s) to ${userId}`)
}


// MARK: setupLogsServer
/**
 * Register handlers. Idempotent - call once during setupServer
 * bootstrap. Register AFTER setupCycleServer so the onCycleRoll
 * subscription binds to a live cycle clock.
 */
export function setupLogsServer(): void {
	room.onMessage('logPickupRequest', ({ id }, context) => {
		const from = context?.from ?? 'unknown'
		if (!piles.has(id)) {
			console.log(`[Server] logs: pickup ${id} from ${from} - pile not found (already taken?)`)
			return
		}
		console.log(`[Server] logs: pickup ${id} by ${from}`)
		removePile(id)
	})

	room.onMessage('logDropRequest', ({ x, z, kind }, context) => {
		const from = context?.from ?? 'unknown'
		const woodKind = clampWoodKind(kind)
		const { x: dropX, z: dropZ } = nudgeOutOfHearthSlotIfOccupied(x, z)
		if (dropX !== x || dropZ !== z) {
			console.log(`[Server] logs: drop by ${from} nudged from (${x.toFixed(2)}, ${z.toFixed(2)}) → (${dropX.toFixed(2)}, ${dropZ.toFixed(2)}) (hearth slot occupied)`)
		} else {
			console.log(`[Server] logs: drop by ${from} kind=${woodKind} at (${x.toFixed(2)}, ${z.toFixed(2)})`)
		}
		addPile(dropX, dropZ, woodKind)
	})

	onCycleRoll(() => {
		resetForCycle()
	})
}
