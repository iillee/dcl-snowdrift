/**
 * skybox.ts — forced day/night cycle for Snow Drift.
 *
 * The scene owns the time of day. Every client independently drives its
 * skybox from a shared wall-clock anchor so all viewers see the same
 * phase without any server sync. We re-assert SkyboxTime on
 * engine.RootEntity every frame, which is the documented way to lock
 * out any player-side manual override (SDK lighting-environment skill):
 * as long as the component exists on RootEntity, it wins over global
 * or user-configured time.
 *
 * The cycle is biased toward dusk / early night to match the cozy
 * winter-evening mood — most of a session should feel like "the blue
 * hour," with brief passes through deep night and dawn.
 */

import { engine, SkyboxTime, TransitionMode } from '@dcl/sdk/ecs'


// MARK: Debug introspection

// Last fixedTime we asserted on RootEntity, or null if setupSkybox()
// has never installed or has been released. Read by the skyboxDebug
// overlay so it can show intended vs. rendered time.
let lastWrittenFixedTime: number | null = null

// Last transitionMode we asserted, null until first write.
let lastWrittenMode: TransitionMode | null = null

// Number of SkyboxTime writes since scene load. Divided by elapsed
// interval by the debug overlay to compute writes/sec.
let writeCount = 0

/**
 * Return the most recent fixedTime this module wrote to SkyboxTime on
 * RootEntity, or null if the forced-cycle system is not currently
 * running. Purely for diagnostics — do not gate gameplay on this.
 */
export function getLastWrittenFixedTime(): number | null {
	return lastWrittenFixedTime
}

/**
 * Return the last transitionMode we asserted (TM_FORWARD / TM_BACKWARD),
 * or null if setupSkybox has not yet installed. Diagnostics only.
 */
export function getLastWrittenMode(): TransitionMode | null {
	return lastWrittenMode
}

/**
 * Return the total number of SkyboxTime writes since scene load.
 * Diagnostics only — used to compute writes/sec in the overlay.
 */
export function getSkyboxWriteCount(): number {
	return writeCount
}


// MARK: releaseSkyboxLock

/**
 * Remove any SkyboxTime component previously written on RootEntity so
 * DCL's default (global time / player preference) resumes control.
 * Safe to call even if we never installed the lock.
 */
export function releaseSkyboxLock(): void {
	SkyboxTime.deleteFrom(engine.RootEntity)
	lastWrittenFixedTime = null
	lastWrittenMode      = null
	console.log('skybox: releaseSkyboxLock: SkyboxTime removed from RootEntity')
}


// MARK: Tuning
// Seconds of real time per full round trip through the dusk→night slice.
// 1800 = 30 minutes real time per full oscillation — the sky drifts
// gently enough that you notice change only if you stop and look up.
export const CYCLE_REAL_SECONDS = 480

// Fixed wall-clock anchor (ms since UNIX epoch) that defines phase 0.
// Every client computes phase = ((Date.now() - ANCHOR_MS) / cycleMs) % 1
// so two viewers in different timezones still see the exact same sky.
// The anchor value itself is arbitrary — pick any past moment.
const ANCHOR_MS = Date.UTC(2026, 0, 1, 0, 0, 0)

// Slice of the 0..86400 skybox range the cycle actually traverses.
// Full day would be [0, 86400]. Cozy dusk-to-night bias uses a narrower
// window that lingers where the sky is prettiest. Set FULL_DAY = true
// to override and use the full 0..86400 range.
export const FULL_DAY  = true
export const DUSK_START = 61200 // 17:00 — (unused when FULL_DAY)
export const DUSK_END   = 82800 // 23:00 — (unused when FULL_DAY)

// DIAGNOSTIC: single-write test mode. When true, setupSkybox writes
// ONE fixedTime at scene start and never again — used to isolate
// whether Worlds is ignoring high-frequency writes vs. all writes.
// The value 21600 (06:00, dawn) is deliberately distinct from any
// DCL default so it’s visually obvious if the write landed.
// Leave false for normal operation.
const SINGLE_WRITE_TEST      = false
const SINGLE_WRITE_TEST_VALUE = 21600

// Minimum real-time interval between actual SkyboxTime writes, in ms.
// Empirically the engine’s "smooth transition" (per SDK docs) appears
// to interpolate sky COLOURS but NOT sun/moon DIRECTION — celestial
// positions snap to the last-written fixedTime instantly. Meaning we
// can’t rely on engine interp for shadow motion; we have to write
// frequently enough that each step is visually invisible.
// 100 ms ≈ 10 writes/sec. At the 8-min cycle that’s ~18 sky-sec per
// write, roughly 0.075 deg of sun movement — well below the
// perception threshold for shadow jumps.
// Safe to write this often only because the transitionMode direction
// fix stops the racing bug that made high-frequency writes diverge
// (measured DELTA up to ±17 h in earlier builds without direction).
const WRITE_MIN_INTERVAL_MS = 100

let installed = false
let lastWriteAtMs = 0


// MARK: currentSkyboxSeconds

/**
 * Compute the current in-scene time in "seconds since midnight" for the
 * skybox, based on the wall-clock anchor. Deterministic across clients.
 */
function currentSkyboxSeconds(): number {
	const cycleMs = CYCLE_REAL_SECONDS * 1000
	const elapsed = Date.now() - ANCHOR_MS
	const phase   = ((elapsed % cycleMs) + cycleMs) % cycleMs / cycleMs  // 0..1

	if (FULL_DAY) return phase * 86400

	// Ease phase through the dusk→night slice with a smooth back-and-forth
	// so we don't jump-cut at the seam. Use a triangle wave: 0..0.5 goes
	// forward through the slice, 0.5..1 goes back. The whole real-world
	// cycle is one round trip through the slice.
	const tri = phase < 0.5 ? phase * 2 : (1 - phase) * 2
	return DUSK_START + tri * (DUSK_END - DUSK_START)
}


// MARK: setupSkybox

/**
 * Install the forced-skybox system. Idempotent — safe to call once from
 * client bootstrap.
 */
export function setupSkybox(): void {
	if (installed) {
		console.log('skybox: setupSkybox: already installed, skipping')
		return
	}
	installed = true

	// Seed once so the very first rendered frame already has the right
	// sky — otherwise the client would flash the global time for a tick.
	// Assume forward on the first write; the tick loop below picks the
	// correct mode from the second write onward.
	const seed = SINGLE_WRITE_TEST ? SINGLE_WRITE_TEST_VALUE : currentSkyboxSeconds()
	SkyboxTime.createOrReplace(engine.RootEntity, {
		fixedTime     : seed,
		transitionMode: TransitionMode.TM_FORWARD,
	})
	lastWrittenFixedTime = seed
	lastWrittenMode      = TransitionMode.TM_FORWARD
	writeCount          += 1

	if (SINGLE_WRITE_TEST) {
		console.log(
			`skybox: setupSkybox: SINGLE_WRITE_TEST active — wrote fixedTime=${seed} once, ` +
			`no tick loop installed. If RUNTIME does not converge on ${seed} on Worlds, the ` +
			`SkyboxTime component's fixedTime is non-functional there regardless of write frequency.`
		)
		return
	}

	lastWriteAtMs = Date.now()

	engine.addSystem(() => {
		const now = Date.now()
		if (now - lastWriteAtMs < WRITE_MIN_INTERVAL_MS) return

		const t    = currentSkyboxSeconds()
		const prev = lastWrittenFixedTime ?? t

		// Skip if the value hasn’t moved at all (would issue a no-op
		// write with the wrong direction assumed for zero delta).
		if (t === prev) return

		// Pick transitionMode from the SHORTEST modular path around the
		// 24 h clock. Naive t >= prev fails at midnight wrap: 86399 → 0
		// is a huge negative step but the short path is +1s forward. So
		// compute both forward and backward distances and pick the mode
		// of whichever is shorter.
		const forwardDist  = ((t - prev) % 86400 + 86400) % 86400
		const backwardDist = 86400 - forwardDist
		const mode = forwardDist <= backwardDist
			? TransitionMode.TM_FORWARD
			: TransitionMode.TM_BACKWARD

		SkyboxTime.createOrReplace(engine.RootEntity, {
			fixedTime     : t,
			transitionMode: mode,
		})
		lastWrittenFixedTime = t
		lastWrittenMode      = mode
		lastWriteAtMs        = now
		writeCount          += 1
	})

	console.log(
		`skybox: setupSkybox: cycle=${CYCLE_REAL_SECONDS}s (real) ` +
		`slice=${FULL_DAY ? 'FULL_DAY' : `${DUSK_START}..${DUSK_END}s`} ` +
		`writeInterval=${WRITE_MIN_INTERVAL_MS}ms`
	)
}
