/**
 * cycle.ts - client-side mirror of the server's authoritative 24 h
 * cycle clock.
 *
 * Receives `cycleState { seed, nextRebuildEpochMs }` from the server
 * (once on join, again on every rollover) and exposes:
 *   - msUntilNextRebuild()    : nextRebuildEpochMs - Date.now(), clamped
 *   - getCurrentCycleSeed()   : the current bucket the server is in
 *   - onCycleSeedChange(cb)   : callback for subsystems that need to
 *                               reset their local state when the world
 *                               rolls (hidden campfire visuals, etc.)
 *   - forceLocalCycleRoll()   : dev-only, run the reset UX now without
 *                               waiting for the server
 *
 * We deliberately do NOT compute either value from local Date.now()
 * alone. A peer with a badly-set system clock would otherwise
 * disagree about which cycle is active near a boundary - and the
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
import { SeedHolder, seedHolder } from 'src/shared/components'
import { room } from 'src/shared/messages'
import { teleportHome } from 'src/client/player'
import { showRebuildSplash } from 'src/client/ui/layers/layer.loadingSplash'


// MARK: State
let serverSeed              : number | null = null
let serverNextRebuildEpochMs: number | null = null

type SeedChangeHandler = (info: { newSeed: number; oldSeed: number | null }) => void
const seedChangeHandlers: SeedChangeHandler[] = []


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


// MARK: onCycleSeedChange
/**
 * Register a callback that fires when the cycle seed changes. Called
 * for the FIRST cycleState arrival (hydration) too - handlers can
 * treat that identically to a rollover since the local scene may have
 * booted with a stale local-Date.now() seed.
 */
export function onCycleSeedChange(handler: SeedChangeHandler): void {
	seedChangeHandlers.push(handler)
}


// MARK: cycleMazeSeed
/**
 * Deterministic maze/prop/cliff seed derived from the cycle seed. We
 * keep the two seed systems separate (cycle = 24 h bucket integer;
 * maze/prop seed = wider integer used by SeedHolder) so consumers
 * that only care about world regeneration don't have to think about
 * time buckets. Xorshift-style mix produces enough spread that
 * consecutive cycle buckets look visually unrelated.
 */
export function cycleMazeSeed(cycleSeed: number): number {
	let s = (cycleSeed ^ 0x9E3779B1) >>> 0
	s = Math.imul(s ^ (s >>> 16), 0x85EBCA6B) >>> 0
	s = Math.imul(s ^ (s >>> 13), 0xC2B2AE35) >>> 0
	s = (s ^ (s >>> 16)) >>> 0
	// SeedHolder rejects 0 (used as "unset"), so clamp.
	return s === 0 ? 1 : s
}


// MARK: applyCycleSeedChange
/**
 * Run the full seed-change reaction (splash, teleport, SeedHolder
 * publish, subsystem notifications) for a new seed. Idempotent - if
 * newSeed equals the currently-tracked serverSeed, returns early.
 *
 * Exported so a client-side dev button can trigger the same UX
 * without waiting for a server round-trip. The regular server
 * cycleState handler also calls this, so dev and prod share one path.
 */
export function applyCycleSeedChange(newSeed: number): void {
	const oldSeed = serverSeed
	if (oldSeed === newSeed) return
	const hadSeed = oldSeed !== null
	serverSeed = newSeed
	console.log(
		`cycle: applyCycleSeedChange old=${oldSeed} new=${newSeed} ` +
		`(${hadSeed ? 'rebuild' : 'hydration'})`,
	)

	// Splash + teleport only on ROLLOVER, not first hydration - the
	// loading splash is already on-screen at boot and no regen has
	// happened yet.
	if (hadSeed) {
		// Minimum splash duration; the splash layer additionally holds
		// itself visible while isRebuilding() is true, so if the tile
		// cascade runs long we don't uncover a half-built maze. Six
		// seconds is a comfortable floor for the teardown + teleport +
		// hidden-fire relocation to settle even on a slow machine.
		showRebuildSplash(6000)
		teleportHome()
	}

	// Push the derived maze seed. The seed watcher in
	// src/client/index.ts fires on non-zero-and-different and calls
	// rebuildMaze / setupPerimeter / setupProps.
	const mazeSeed = cycleMazeSeed(newSeed)
	const current  = SeedHolder.getOrNull(seedHolder)
	if (current === null || current.seed !== mazeSeed) {
		console.log(`cycle: publishing new mazeSeed=${mazeSeed} (from cycleSeed=${newSeed})`)
		SeedHolder.createOrReplace(seedHolder, { seed: mazeSeed })
	}

	// Notify per-subsystem handlers (hidden campfire tears down its
	// per-fire state and moves the pits to the new positions).
	for (const handler of seedChangeHandlers) {
		try {
			handler({ newSeed, oldSeed })
		} catch (err) {
			console.log(`cycle: seedChangeHandler threw - continuing: ${err}`)
		}
	}
}


// MARK: forceLocalCycleRoll
/**
 * Dev affordance: run a full client-side cycle rollover NOW, without
 * waiting for the server. Advances the local seed by +1 so
 * downstream code sees a new value (positions recompute, maze
 * reshuffles, beacons move). Used by the dev button so the reset UX
 * can be smoke-tested in a preview that isn't running the auth
 * server.
 *
 * Note: this only regenerates CLIENT-visible state. Server-owned
 * state (hidden fire lit-status, paint canvas) will still reflect the
 * old cycle until a real server-side rollCycle() fires. For a full
 * end-to-end test, run `npm run auth-server` alongside the preview.
 */
export function forceLocalCycleRoll(): void {
	const nextSeed = (serverSeed ?? getHiddenCampfireSeed()) + 1
	console.log(`cycle: forceLocalCycleRoll: local-only advance to seed=${nextSeed}`)
	applyCycleSeedChange(nextSeed)
}


// MARK: setupCycleClient
/**
 * Subscribe to `cycleState` broadcasts. Call once from setupClient
 * during scene boot, BEFORE any UI reads msUntilNextRebuild().
 *
 * On seed change (including hydration), applyCycleSeedChange publishes
 * the derived maze seed into SeedHolder. The existing seed watcher in
 * src/client/index.ts picks that up and rebuilds the maze, perimeter
 * cliffs, and props. Concurrent writes from every client are fine:
 * cycleMazeSeed() is deterministic from the cycle seed, so every writer
 * produces the same value and CRDT converges without conflict.
 */
export function setupCycleClient(): void {
	room.onMessage('cycleState', ({ seed, nextRebuildEpochMs: nextMs }) => {
		// Absolute-time field always updates, even if seed is unchanged
		// (e.g. a future mid-cycle nextRebuild adjustment).
		serverNextRebuildEpochMs = nextMs
		const hadSeed    = serverSeed !== null
		const remainingS = Math.max(0, Math.floor((nextMs - Date.now()) / 1000))
		console.log(
			`cycle: onMessage cycleState seed=${seed} ` +
			`nextRebuild=${new Date(nextMs).toISOString()} ` +
			`(remaining ${remainingS}s, ${hadSeed ? 'refresh' : 'hydration'})`,
		)
		// applyCycleSeedChange is a no-op when the seed already matches
		// (e.g. server confirming a dev-forced local roll), so this is
		// safe on every cycleState arrival.
		applyCycleSeedChange(seed)
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
