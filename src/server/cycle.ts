/**
 * cycle.ts — authoritative world seed + rollover.
 *
 * Owns two facts:
 *   - currentSeed          : which world layout is live
 *   - nextRebuildEpochMs   : legacy midnight-UTC boundary, still sent in
 *                            `cycleState` for wire compatibility only
 *
 * The world no longer rolls on a wall-clock schedule. Only the last
 * fire dying (emberFail.ts) or the dev button ends a run, so a
 * civilization survives midnight UTC.
 *
 * Rollover:
 *   rollCycle() fires:
 *     1. Samples a fresh currentSeed, not the UTC-day bucket, plus
 *        the legacy nextRebuildEpochMs.
 *     2. Invokes every registered onCycleRoll subscriber (hidden
 *        campfire reset, paint clear + reseed, central-fire ring
 *        reseed, etc.).
 *     3. Broadcasts the new cycleState so clients update their
 *        countdown + trigger their own reset paths.
 *
 * The subscriber pattern (`onCycleRoll`) keeps this module ignorant
 * of the things it needs to reset — each subsystem registers its own
 * handler at boot. Order of registration = order of invocation, so
 * register the paint clear BEFORE ring reseeds if you add a new one.
 */

import { clampCycleSeed, cycleSeedsEqual } from 'src/shared/cycleMazeSeed'
import { nextRebuildEpochMs } from 'src/shared/hiddenCampfire'
import { room } from 'src/shared/messages'


// MARK: State
let currentSeed         = 0
let currentNextRebuild  = 0
let rollCount           = 0

type RollHandler = (info: { newSeed: number; oldSeed: number }) => void
const rollHandlers: RollHandler[] = []


// MARK: getCurrentCycleSeed
/**
 * Authoritative cycle seed. Used by other server modules if they ever
 * need to stamp a cycle-scoped value.
 */
export function getCurrentCycleSeed(): number {
	return currentSeed
}


// MARK: getCurrentNextRebuildEpochMs
/** Wall-clock ms of the next scheduled world rebuild. */
export function getCurrentNextRebuildEpochMs(): number {
	return currentNextRebuild
}


// MARK: onCycleRoll
/**
 * Register a handler to run when the cycle rolls. Handlers are invoked
 * synchronously in registration order, BEFORE the fresh cycleState
 * broadcast so subsystems can queue their own broadcasts (e.g. one
 * hiddenCampfireState per index) and everything lands as a burst.
 *
 * Handlers must not throw \u2014 the rollover must complete even if one
 * subsystem fails. Log and continue.
 */
export function onCycleRoll(handler: RollHandler): void {
	rollHandlers.push(handler)
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


// MARK: freshSeed

/**
 * A layout id that is not the UTC-day bucket. A new server start and
 * every regen each get their own value, so leaving and coming back
 * does not restore the first world of the day.
 *
 * Clamped to Schemas.Int's positive range. The full unsigned 32-bit
 * mix wrapped on the wire and the server then rejected pickup / ignite
 * as a stale seed.
 */
function freshSeed(prev: number): number {
	let s = clampCycleSeed(Date.now() ^ 0x9E3779B1 ^ Math.imul(rollCount + 1, 0x85EBCA6B))
	if (cycleSeedsEqual(s, prev)) s = clampCycleSeed(s + 1)
	return s
}


// MARK: rollCycle
/**
 * Advance the cycle: sample fresh seed + next boundary, fire every
 * subscribed handler in order, then broadcast the new cycleState.
 *
 * `newSeed` is an explicit layout id (ember fail passes one). If
 * omitted, or if it matches the world that just ended, a fresh id
 * is drawn so the rebuild cannot repeat.
 */
export function rollCycle(opts?: { newSeed?: number }): void {
	const oldSeed = currentSeed
	if (opts?.newSeed !== undefined && opts.newSeed !== 0) {
		currentSeed = clampCycleSeed(opts.newSeed)
	} else {
		currentSeed = freshSeed(oldSeed)
	}
	if (cycleSeedsEqual(currentSeed, oldSeed)) currentSeed = freshSeed(oldSeed)
	currentNextRebuild = nextRebuildEpochMs()
	rollCount++
	console.log(
		`[Server] cycle: ROLL #${rollCount} old=${oldSeed} \u2192 new=${currentSeed} ` +
		`nextRebuild=${new Date(currentNextRebuild).toISOString()}`,
	)
	// Fire subscribers in registration order. Wrap each in try/catch so
	// a single subsystem failure doesn't abort the rest of the reset.
	for (const handler of rollHandlers) {
		try {
			handler({ newSeed: currentSeed, oldSeed })
		} catch (err) {
			console.log(`[Server] cycle: rollHandler threw \u2014 continuing: ${err}`)
		}
	}
	broadcastCycleState()
}


// MARK: setupCycleServer
/**
 * Sample the boot seed, broadcast it, and register the dev roll
 * handler. Call once during setupServer bootstrap alongside the other
 * server subsystems.
 */
export function setupCycleServer(): void {
	currentSeed        = freshSeed(0)
	currentNextRebuild = nextRebuildEpochMs()
	console.log(
		`[Server] cycle: seed=${currentSeed} ` +
		`nextRebuild=${new Date(currentNextRebuild).toISOString()} ` +
		`(in ${((currentNextRebuild - Date.now()) / 1000 / 60).toFixed(1)} min)`,
	)
	broadcastCycleState()

	// DEV: force an immediate rollover via the devRollCycle message.
	// Same code path as the timer trigger; sender is not validated because
	// the flag that exposes the emitting button is dev-only and the cost
	// of a spurious roll is just 'world regenerates'. Remove this handler
	// (or gate on a sender allowlist) before shipping a build where random
	// visitors could reach the button.
	room.onMessage('devRollCycle', (_payload, context) => {
		const from = context?.from ?? 'unknown'
		console.log(`[Server] cycle: devRollCycle received from ${from} - forcing rollover`)
		rollCycle()
	})
}
