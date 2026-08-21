/**
 * cycle.ts — client-side mirror of the server's authoritative 24 h
 * cycle clock.
 *
 * Receives `cycleState { seed, nextRebuildEpochMs }` from the server
 * (once on join, again on every rollover) and exposes:
 *   - msUntilNextRebuild()  : nextRebuildEpochMs - Date.now(), clamped
 *   - getCurrentCycleSeed() : the current bucket the server is in
 *
 * We deliberately do NOT compute either value from local Date.now()
 * alone. A peer with a badly-set system clock would otherwise
 * disagree about which cycle is active near a boundary — and the
 * hidden-campfire tile derives from seed, so disagreement means two
 * players hunting the pit in different places.
 *
 * Skew still exists in the countdown display (we subtract each
 * client's own Date.now() from the server's absolute end time), but
 * that's cosmetic and matches flagtag's CountdownTimer pattern.
 * Anything under a second of NTP drift is invisible in HH:MM:SS.
 *
 * Fallbacks: until the first `cycleState` arrives (should be within
 * milliseconds of join), we use the local computation so the popover
 * doesn't render 00:00:00 in the joining frame.
 */

import { HIDDEN_CYCLE_MS, getHiddenCampfireSeed, nextRebuildEpochMs } from 'src/shared/hiddenCampfire'
import { room } from 'src/shared/messages'


// MARK: State
let serverSeed              : number | null = null
let serverNextRebuildEpochMs: number | null = null


// MARK: getCurrentCycleSeed
/**
 * Authoritative cycle seed, once the server has broadcast it. Falls
 * back to the local Date.now()-derived seed pre-hydration so callers
 * that run at scene boot don't see NaN.
 */
export function getCurrentCycleSeed(): number {
	return serverSeed ?? getHiddenCampfireSeed()
}


// MARK: msUntilNextRebuild
/**
 * Milliseconds remaining until the next midnight-UTC world rebuild.
 * Clamped to zero so a briefly-negative reading at the boundary never
 * renders as `-1:59:59`.
 */
export function msUntilNextRebuild(): number {
	const endsAt = serverNextRebuildEpochMs ?? nextRebuildEpochMs()
	return Math.max(0, endsAt - Date.now())
}


// MARK: setupCycleClient
/**
 * Subscribe to `cycleState` broadcasts. Call once from setupClient
 * during scene boot, BEFORE any UI reads msUntilNextRebuild().
 */
export function setupCycleClient(): void {
	room.onMessage('cycleState', ({ seed, nextRebuildEpochMs }) => {
		const hadSeed = serverSeed !== null
		serverSeed               = seed
		serverNextRebuildEpochMs = nextRebuildEpochMs
		const remainingS = Math.max(0, Math.floor((nextRebuildEpochMs - Date.now()) / 1000))
		console.log(
			`cycle: onMessage cycleState seed=${seed} ` +
			`nextRebuild=${new Date(nextRebuildEpochMs).toISOString()} ` +
			`(remaining ${remainingS}s, ${hadSeed ? 'refresh' : 'hydration'})`,
		)
	})
	// Sanity log: local baseline before the first server message lands.
	// If this and the first cycleState disagree by more than a few
	// seconds, the host machine's clock is likely off.
	console.log(
		`cycle: setupCycleClient: local baseline seed=${getHiddenCampfireSeed()} ` +
		`nextRebuild=${new Date(nextRebuildEpochMs()).toISOString()} ` +
		`(awaiting server cycleState) [HIDDEN_CYCLE_MS=${HIDDEN_CYCLE_MS}]`,
	)
}
