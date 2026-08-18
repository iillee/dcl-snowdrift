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

import { engine, SkyboxTime } from '@dcl/sdk/ecs'


// MARK: Tuning
// Seconds of real time per full round trip through the dusk→night slice.
// 1800 = 30 minutes real time per full oscillation — the sky drifts
// gently enough that you notice change only if you stop and look up.
const CYCLE_REAL_SECONDS = 1800

// Fixed wall-clock anchor (ms since UNIX epoch) that defines phase 0.
// Every client computes phase = ((Date.now() - ANCHOR_MS) / cycleMs) % 1
// so two viewers in different timezones still see the exact same sky.
// The anchor value itself is arbitrary — pick any past moment.
const ANCHOR_MS = Date.UTC(2026, 0, 1, 0, 0, 0)

// Slice of the 0..86400 skybox range the cycle actually traverses.
// Full day would be [0, 86400]. Cozy dusk-to-night bias uses a narrower
// window that lingers where the sky is prettiest. Set FULL_DAY = true
// to override and use the full 0..86400 range.
const FULL_DAY  = false
const DUSK_START = 61200 // 17:00 — late-afternoon golden hour
const DUSK_END   = 82800 // 23:00 — deep night, before it starts brightening

// Skybox time is asserted on every frame. That's cheap (one component
// write per tick) and is what actually locks out any client-side manual
// override — a player toggling their own preferred sky would find it
// snapping back within a frame.
let installed = false


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
	SkyboxTime.createOrReplace(engine.RootEntity, {
		fixedTime: currentSkyboxSeconds(),
	})

	engine.addSystem(() => {
		SkyboxTime.createOrReplace(engine.RootEntity, {
			fixedTime: currentSkyboxSeconds(),
		})
	})

	console.log(
		`skybox: setupSkybox: cycle=${CYCLE_REAL_SECONDS}s (real) ` +
		`slice=${FULL_DAY ? 'FULL_DAY' : `${DUSK_START}..${DUSK_END}s`}`
	)
}
