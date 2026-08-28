/**
 * logs.ts - authoritative state for wood-log piles in the world.
 *
 * Owns:
 *   - piles           : Map<pileId, { x, z }>   active piles by id
 *   - nextPileId      : monotonic id counter (never reused, so a
 *                       delayed logPileRemoved never collides with
 *                       a later logPileAdded).
 *
 * Message contracts:
 *   Client -> Server  logPickupRequest  { id }
 *   Client -> Server  logDropRequest    { x, z }
 *   Server -> Client  logPileAdded      { id, x, z }
 *   Server -> Client  logPileRemoved    { id }
 *
 * Persistence:
 *   - Piles live in server memory. Cleared + re-seeded on every cycle
 *     roll (matches the vision: the world forgets each day).
 *   - Not restored across server restart (in-memory only, v1).
 *
 * Trust model:
 *   - pickup: first request wins, subsequent ignored. Race between
 *     two clients can leave both believing they picked up; acceptable
 *     for cozy tone.
 *   - drop: unvalidated. Client claim of "I'm carrying" is trusted.
 *     A malicious client could spawn free piles; tolerated for v1.
 */

import { engine } from '@dcl/sdk/ecs'

import { room } from 'src/shared/messages'
import { INITIAL_LOGS_PILE_X, INITIAL_LOGS_PILE_Z } from 'src/shared/logs'
import { onCycleRoll } from 'src/server/cycle'


/**
 * Delay (s) before the hearth pile respawns after the world empties.
 * Short enough that a solo tester never sits wood-less for long, long
 * enough that the respawn reads as "someone brought more from the shed"
 * rather than an instant re-materialisation.
 */
const HEARTH_RESPAWN_DELAY_S = 4

/**
 * Squared-metre radius around the hearth slot (INITIAL_LOGS_PILE_X/Z)
 * within which an existing pile is considered to be "the hearth pile".
 * 4 m² = 2 m radius — wide enough that a player dropping right next to
 * the shed suppresses a duplicate respawn, tight enough that a pile a
 * few paces away still counts as "world has piles, but not at the fire"
 * so the hearth timer arms.
 */
const HEARTH_SLOT_RADIUS_SQ = 4


interface PileRec {
	x: number
	z: number
}


let nextPileId       = 1
const piles          = new Map<number, PileRec>()
/** Seconds remaining until the hearth pile respawns. -1 = not scheduled. */
let hearthRespawnClock = -1


// MARK: isAtHearthSlot
/** True if (x,z) is within HEARTH_SLOT_RADIUS_SQ of the hearth spawn point. */
function isAtHearthSlot(x: number, z: number): boolean {
	const dx = x - INITIAL_LOGS_PILE_X
	const dz = z - INITIAL_LOGS_PILE_Z
	return (dx * dx + dz * dz) < HEARTH_SLOT_RADIUS_SQ
}


// MARK: isHearthPilePresent
/**
 * True if any pile currently sits on the hearth slot. Used to decide
 * whether the hearth respawn timer should arm / fire, instead of the
 * old "is the whole world empty" check that broke as soon as any
 * player-dropped pile existed elsewhere on the map.
 */
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
function addPile(x: number, z: number): number {
	const id = nextPileId++
	piles.set(id, { x, z })
	room.send('logPileAdded', { id, x, z })
	console.log(`[Server] logs: pile #${id} added at (${x.toFixed(2)}, ${z.toFixed(2)}) (total ${piles.size})`)
	// Only cancel a pending hearth respawn if this pile actually landed on
	// the hearth slot. A far-away drop must NOT disarm the timer — that
	// was the original bug where a single stray drop anywhere on the map
	// permanently starved the fire of respawning wood.
	if (hearthRespawnClock >= 0 && isAtHearthSlot(x, z)) {
		console.log('[Server] logs: hearth respawn cancelled (drop landed on hearth slot)')
		hearthRespawnClock = -1
	}
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
	// Arm the hearth respawn if the hearth slot is now empty, regardless
	// of how many piles exist elsewhere on the map. Piles far from the
	// fire don't help players who want to feed it, so the shed must
	// restock whenever its own slot goes empty.
	if (!isHearthPilePresent() && hearthRespawnClock < 0) {
		hearthRespawnClock = HEARTH_RESPAWN_DELAY_S
		console.log(`[Server] logs: hearth respawn armed (${HEARTH_RESPAWN_DELAY_S}s)`)
	}
	return true
}


// MARK: nudgeOutOfHearthSlotIfOccupied
/**
 * If (x, z) would land inside the hearth slot AND a hearth pile is
 * already present, return a nudged position just outside the slot
 * radius so we never stack two piles at the shed. If the slot is
 * empty, or the drop is already outside the radius, returns the
 * input unchanged.
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
		// Drop right on the hearth centre — pick an arbitrary direction.
		return { x: INITIAL_LOGS_PILE_X + radius, z: INITIAL_LOGS_PILE_Z }
	}
	const scale = radius / len
	return {
		x: INITIAL_LOGS_PILE_X + dx * scale,
		z: INITIAL_LOGS_PILE_Z + dz * scale,
	}
}


// MARK: seedInitialPile
/**
 * Spawn the one "hearth wood stack" pile that must exist at boot and
 * after every cycle roll. Position lives in shared/logs.ts so client
 * and server never disagree about where the starter pile is.
 */
function seedInitialPile(): void {
	addPile(INITIAL_LOGS_PILE_X, INITIAL_LOGS_PILE_Z)
}


// MARK: resetForCycle
/**
 * Wipe every pile and re-seed the starter. Called by cycle rollover.
 * Sends a removal for each existing pile so clients that hydrated
 * mid-cycle don't leak stale GLBs.
 */
function resetForCycle(): void {
	console.log(`[Server] logs: cycle roll - clearing ${piles.size} pile(s) and re-seeding starter`)
	const doomed = Array.from(piles.keys())
	for (const id of doomed) removePile(id)
	seedInitialPile()
}


// MARK: sendLogPilesTo
/**
 * Push the full pile set to a specific client. Called from the
 * joinRoster handler so latecomers immediately see every pile a
 * previous player dropped.
 */
export function sendLogPilesTo(userId: string): void {
	for (const [id, pile] of piles) {
		room.send('logPileAdded', { id, x: pile.x, z: pile.z }, { to: [userId] })
	}
	console.log(`[Server] logs: hydrated ${piles.size} pile(s) to ${userId}`)
}


// MARK: setupLogsServer
/**
 * Register handlers and spawn the initial pile. Idempotent - call
 * once during setupServer bootstrap. Register AFTER setupCycleServer
 * so the onCycleRoll subscription binds to a live cycle clock.
 */
export function setupLogsServer(): void {
	seedInitialPile()

	room.onMessage('logPickupRequest', ({ id }, context) => {
		const from = context?.from ?? 'unknown'
		if (!piles.has(id)) {
			console.log(`[Server] logs: pickup ${id} from ${from} - pile not found (already taken?)`)
			return
		}
		console.log(`[Server] logs: pickup ${id} by ${from}`)
		removePile(id)
	})

	room.onMessage('logDropRequest', ({ x, z }, context) => {
		const from = context?.from ?? 'unknown'
		const { x: dropX, z: dropZ } = nudgeOutOfHearthSlotIfOccupied(x, z)
		if (dropX !== x || dropZ !== z) {
			console.log(`[Server] logs: drop by ${from} nudged from (${x.toFixed(2)}, ${z.toFixed(2)}) → (${dropX.toFixed(2)}, ${dropZ.toFixed(2)}) (hearth slot occupied)`)
		} else {
			console.log(`[Server] logs: drop by ${from} at (${x.toFixed(2)}, ${z.toFixed(2)})`)
		}
		addPile(dropX, dropZ)
	})

	onCycleRoll(() => {
		resetForCycle()
	})

	// Hearth respawn tick. Cheap: single number decrement, no work while
	// the timer is idle (< 0).
	engine.addSystem((dt: number) => {
		if (hearthRespawnClock < 0) return
		hearthRespawnClock -= dt
		if (hearthRespawnClock > 0) return
		hearthRespawnClock = -1
		// Belt-and-braces: a drop could have landed on the hearth slot in
		// the same frame the timer expired. Re-check before seeding so we
		// never stack two piles on top of each other at the shed.
		if (isHearthPilePresent()) {
			console.log('[Server] logs: hearth respawn skipped (slot already occupied)')
			return
		}
		console.log('[Server] logs: hearth respawn firing')
		seedInitialPile()
	})
}
