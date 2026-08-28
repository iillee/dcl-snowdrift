/**
 * cycle.ts — authoritative 24 h cycle clock + rollover.
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
 * Rollover:
 *   A polling system checks each tick whether Date.now() has crossed
 *   currentNextRebuild. When it has, rollCycle() fires:
 *     1. Samples fresh currentSeed + nextRebuildEpochMs.
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

import { engine } from '@dcl/sdk/ecs'

import { getHiddenCampfireSeed, nextRebuildEpochMs } from 'src/shared/hiddenCampfire'
import { room } from 'src/shared/messages'


// MARK: State
let currentSeed         = 0
let currentNextRebuild  = 0
let rollCount           = 0
/**
 * Monotonically-increasing offset added on top of the time-based day
 * bucket. Bumped by manual/dev rollovers so a mid-day reroll produces
 * a genuinely different seed instead of re-sampling the same bucket
 * and broadcasting a no-op. Reset implicitly on process restart
 * (initial value 0) — acceptable since dev rolls are ephemeral.
 */
let devRollOffset       = 0

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


// MARK: rollCycle
/**
 * Advance the cycle: sample fresh seed + next boundary, fire every
 * subscribed handler in order, then broadcast the new cycleState.
 *
 * Exposed for tests / manual triggers (e.g. a dev-only "roll now"
 * message). Normally invoked automatically by the boundary-detection
 * system in setupCycleServer().
 */
export function rollCycle(force: boolean = false): void {
	const oldSeed = currentSeed
	if (force) {
		// Manual/dev roll: bump the offset so the derived seed is
		// guaranteed to differ from the current one, even mid-day when
		// the time bucket hasn't advanced.
		devRollOffset++
	}
	currentSeed        = (getHiddenCampfireSeed() + devRollOffset) >>> 0
	currentNextRebuild = nextRebuildEpochMs()
	rollCount++
	console.log(
		`[Server] cycle: ROLL #${rollCount} (${force ? 'forced' : 'timed'}) old=${oldSeed} \u2192 new=${currentSeed} ` +
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
 * Sample the current bucket + next boundary, broadcast, and start the
 * boundary-detection tick. Idempotent \u2014 call once during setupServer
 * bootstrap alongside the other server subsystems.
 */
export function setupCycleServer(): void {
	currentSeed        = (getHiddenCampfireSeed() + devRollOffset) >>> 0
	currentNextRebuild = nextRebuildEpochMs()
	console.log(
		`[Server] cycle: seed=${currentSeed} ` +
		`nextRebuild=${new Date(currentNextRebuild).toISOString()} ` +
		`(in ${((currentNextRebuild - Date.now()) / 1000 / 60).toFixed(1)} min)`,
	)
	broadcastCycleState()

	// Boundary detection. Runs every frame but does almost nothing \u2014 a
	// single wall-clock compare. When the boundary passes, rollCycle()
	// fires exactly once (currentNextRebuild is bumped inside rollCycle
	// so we don't re-fire on the next tick).
	engine.addSystem(() => {
		if (Date.now() < currentNextRebuild) return
		rollCycle()
	})

	// DEV: force an immediate rollover via the devRollCycle message.
	// Same code path as the timer trigger; sender is not validated because
	// the flag that exposes the emitting button is dev-only and the cost
	// of a spurious roll is just 'world regenerates'. Remove this handler
	// (or gate on a sender allowlist) before shipping a build where random
	// visitors could reach the button.
	room.onMessage('devRollCycle', (_payload, context) => {
		const from = context?.from ?? 'unknown'
		console.log(`[Server] cycle: devRollCycle received from ${from} - forcing rollover`)
		rollCycle(true)
	})
}
