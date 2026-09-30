/**
 * skybox.ts — phase-driven SkyboxTime lock.
 *
 * Writes SkyboxTime on engine.RootEntity so:
 *   1. The sun follows the server day/night clock in preview.
 *   2. The player's time-of-day slider stays locked (component present).
 *
 * Worlds currently ignores fixedTime (see
 * docs/bug-reports/worlds-skybox-time-ignored.md) but still honors the
 * lock. Writes are 10 Hz with directional transitionMode so the
 * interpolator does not reset every frame. Large jumps delete the
 * component first so we do not ease the long way around midnight.
 * We do not delete on every write — that leaks Explorer's default
 * time (reads as "just before dawn") between frames.
 */

import { engine, SkyboxTime, TransitionMode } from '@dcl/sdk/ecs'

import { SKYBOX_DAY_SEC } from 'src/shared/phase'

import { getPhaseSkyboxSeconds } from 'src/client/phase'


const WRITE_HZ         = 10
const WRITE_INTERVAL_S = 1 / WRITE_HZ
/** Sky-seconds. A dawn reset jumps hours, so we recreate instead of easing. */
const SNAP_ARC_SEC     = 1800

let installed    = false
let lastWritten  = -1
let writeClock   = 0


// MARK: shortestMode

/**
 * Pick TM_FORWARD or TM_BACKWARD for the shorter modular path around
 * the 24 h seam. A decrease written with TM_FORWARD races the long way.
 */
function shortestMode(
	from: number,
	to  : number,
): TransitionMode {
	const fwd = ((to - from) % SKYBOX_DAY_SEC + SKYBOX_DAY_SEC) % SKYBOX_DAY_SEC
	if (fwd <= SKYBOX_DAY_SEC / 2) return TransitionMode.TM_FORWARD
	return TransitionMode.TM_BACKWARD
}


// MARK: writeSkybox

function writeSkybox(seconds: number): void {
	if (lastWritten >= 0) {
		const prev = lastWritten
		const fwd  = ((seconds - prev) % SKYBOX_DAY_SEC + SKYBOX_DAY_SEC) % SKYBOX_DAY_SEC
		const arc  = Math.min(fwd, SKYBOX_DAY_SEC - fwd)
		if (arc > SNAP_ARC_SEC) {
			SkyboxTime.deleteFrom(engine.RootEntity)
			lastWritten = -1
			console.log(`skybox: writeSkybox: snap ${prev.toFixed(0)} -> ${seconds.toFixed(0)}`)
		}
	}
	const mode = lastWritten < 0
		? TransitionMode.TM_FORWARD
		: shortestMode(lastWritten, seconds)
	SkyboxTime.createOrReplace(engine.RootEntity, {
		fixedTime     : seconds,
		transitionMode: mode,
	})
	lastWritten = seconds
}


// MARK: releaseSkyboxLock

/**
 * Remove SkyboxTime from RootEntity so DCL's default time resumes.
 * Safe to call even if we never installed the lock.
 */
export function releaseSkyboxLock(): void {
	SkyboxTime.deleteFrom(engine.RootEntity)
	lastWritten = -1
	console.log('skybox: releaseSkyboxLock: SkyboxTime removed from RootEntity')
}


// MARK: setupSkybox

/**
 * Lock the sky to the phase clock. Idempotent — call once from
 * setupClient after setupPhaseClient.
 */
export function setupSkybox(): void {
	if (installed) {
		console.log('skybox: setupSkybox: already installed, skipping')
		return
	}
	installed = true

	writeSkybox(getPhaseSkyboxSeconds())

	engine.addSystem((dt: number) => {
		writeClock += dt
		if (writeClock < WRITE_INTERVAL_S) return
		writeClock = 0
		writeSkybox(getPhaseSkyboxSeconds())
	})

	console.log('skybox: setupSkybox: locked to phase clock at 10 Hz')
}


// MARK: flushSkybox
/** Write the live phase sky immediately (world reset snap). */
export function flushSkybox(): void {
	writeSkybox(getPhaseSkyboxSeconds())
}
