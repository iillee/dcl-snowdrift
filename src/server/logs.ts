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


interface PileRec {
	x: number
	z: number
}


let nextPileId       = 1
const piles          = new Map<number, PileRec>()
/** Seconds remaining until the hearth pile respawns. -1 = not scheduled. */
let hearthRespawnClock = -1


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
	// Any new pile means the world is no longer empty - cancel a pending
	// hearth respawn so a player-dropped pile doesn't cause a stacked
	// double-spawn at the hearth 4 s later.
	if (hearthRespawnClock >= 0) {
		console.log('[Server] logs: hearth respawn cancelled (world no longer empty)')
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
	// Arm the hearth respawn if the world just went wood-less. If a drop
	// happens before the timer fires, the drop clears the timer (see
	// addPile) so we don't double up.
	if (piles.size === 0 && hearthRespawnClock < 0) {
		hearthRespawnClock = HEARTH_RESPAWN_DELAY_S
		console.log(`[Server] logs: hearth respawn armed (${HEARTH_RESPAWN_DELAY_S}s)`)
	}
	return true
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
		console.log(`[Server] logs: drop by ${from} at (${x.toFixed(2)}, ${z.toFixed(2)})`)
		addPile(x, z)
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
		console.log('[Server] logs: hearth respawn firing')
		seedInitialPile()
	})
}
