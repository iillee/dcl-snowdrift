/**
 * cycle.ts — authoritative 24 h cycle clock.
 *
 * Owns two facts:
 *   - currentSeed          : which 24 h bucket the world is in
 *   - nextRebuildEpochMs   : wall-clock ms of the next midnight-UTC roll
 *
 * Both are computed from the server's own Date.now() and broadcast to
 * clients via the `cycleState` message. Clients render the countdown
 * as `nextRebuildEpochMs - Date.now()` (local), so as long as the
 * host machine's NTP is sane every peer sees the same timer to within
 * a second or two.
 *
 * The actual world-rebuild behaviour (reset lit=false, pick new hidden
 * campfire tile, clear paint, etc.) is NOT implemented here yet —
 * that lands next. This module is the shared clock those systems will
 * read from.
 */

import { getHiddenCampfireSeed, nextRebuildEpochMs } from 'src/shared/hiddenCampfire'
import { room } from 'src/shared/messages'


// MARK: State
let currentSeed         = 0
let currentNextRebuild  = 0


// MARK: getCurrentCycleSeed
/** Authoritative cycle seed. Used by other server modules if they ever\n * need to stamp a cycle-scoped value. */
export function getCurrentCycleSeed(): number {
	return currentSeed
}


// MARK: getCurrentNextRebuildEpochMs
/** Wall-clock ms of the next scheduled world rebuild. */
export function getCurrentNextRebuildEpochMs(): number {
	return currentNextRebuild
}


// MARK: broadcastCycleState
function broadcastCycleState(): void {
	room.send('cycleState', {
		seed              : currentSeed,
		nextRebuildEpochMs: currentNextRebuild,
	})
}


// MARK: sendCycleStateTo
/**
 * Push current cycle state to a specific client. Called from the
 * joinRoster hydration path in server.ts so a joiner's HUD countdown
 * is correct on the first frame.
 */
export function sendCycleStateTo(userId: string): void {
	room.send(
		'cycleState',
		{ seed: currentSeed, nextRebuildEpochMs: currentNextRebuild },
		{ to: [userId] },
	)
}


// MARK: setupCycleServer
/**
 * Sample the current bucket + next boundary and broadcast. Idempotent —
 * call once during setupServer bootstrap alongside the other server
 * subsystems.
 */
export function setupCycleServer(): void {
	currentSeed        = getHiddenCampfireSeed()
	currentNextRebuild = nextRebuildEpochMs()
	console.log(
		`[Server] cycle: seed=${currentSeed} ` +
		`nextRebuild=${new Date(currentNextRebuild).toISOString()} ` +
		`(in ${((currentNextRebuild - Date.now()) / 1000 / 60).toFixed(1)} min)`,
	)
	broadcastCycleState()
}
