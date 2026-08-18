/**
 * snowFootsteps.ts — one-shot step SFX fired on a distance cadence.
 *
 * Instead of looping a footstep track, this module retriggers the
 * single-step clip (snowstepsingle.mp3) every STEP_DISTANCE_M of
 * horizontal movement, but only while the player is on snow. The
 * cadence therefore naturally slows in deep drifts (locomotion caps
 * walk speed) and speeds up on shallow snow — no explicit
 * speed-to-pitch mapping required.
 *
 * A tiny per-step pitch randomisation keeps successive steps from
 * feeling identical without pushing the clip out of tune.
 */

import { AudioSource, Entity, Transform, engine } from '@dcl/sdk/ecs'

import { getSnowStageAtWorld } from 'src/client/paint'


// MARK: Tuning
const STEP_SRC          = 'assets/sounds/snowstepsingle.mp3'
// Distance in meters between successive step triggers. ~0.9 m matches
// a natural walking stride at default DCL walk speed (~2 m/s ≈ 2 steps/s).
// Per-stage stride length (meters between step triggers). Shallow snow
// (stage 1) uses a longer stride to counteract the fast walk speed the
// locomotion gate allows there (~3.0 m/s), which was previously firing
// the crunch far too rapidly. Deeper stages tighten the stride so the
// crunch stays audible even at their slower cap speeds.
const STEP_DISTANCE_BY_STAGE: Record<1 | 2 | 3, number> = {
	1: 1.6,
	2: 1.2,
	3: 1.0,
}
// Volume at the source. Slightly quieter than snowfall since it fires
// in bursts and stacks with the ambient bed.
const STEP_VOL          = 0.6
// Random pitch jitter per step, ± this fraction of 1.0.
const PITCH_JITTER      = 0.08
// Speed floor below which we treat the player as idle and reset the
// step-distance accumulator (so idling does not queue a step).
const IDLE_SPEED_MPS    = 0.15
// Poll cadence. 60 ms is responsive enough for foot-strike granularity
// without spamming AudioSource writes.
const POLL_INTERVAL_S   = 0.06


// MARK: State
let stepEnt: Entity = 0 as Entity
let lastPos: { x: number; z: number } | null = null
let distAccumM        = 0
let pollAccum         = 0
let installed         = false


// MARK: playStep
/** Fire the single-step clip with a light random pitch jitter. */
function playStep(): void {
	const pitch = 1 + (Math.random() * 2 - 1) * PITCH_JITTER
	AudioSource.createOrReplace(stepEnt, {
		audioClipUrl: STEP_SRC,
		loop        : false,
		global      : true,
		playing     : true,
		volume      : STEP_VOL,
		pitch,
	})
}


// MARK: setupSnowFootsteps
/**
 * Spawn the step AudioSource and install the polling system that fires
 * playStep() every STEP_DISTANCE_M of horizontal travel on snow.
 * Idempotent — safe to call once from client bootstrap.
 */
export function setupSnowFootsteps(): void {
	if (installed) {
		console.log('snowFootsteps: setupSnowFootsteps: already installed, skipping')
		return
	}
	installed = true

	stepEnt = engine.addEntity()
	Transform.create(stepEnt, { parent: engine.CameraEntity })
	// Prime the AudioSource so the first playStep() write is a simple
	// createOrReplace on an existing component rather than a first-time
	// create with potential setup latency.
	AudioSource.create(stepEnt, {
		audioClipUrl: STEP_SRC,
		loop        : false,
		global      : true,
		playing     : false,
		volume      : STEP_VOL,
	})

	engine.addSystem((dt: number) => {
		pollAccum += dt
		if (pollAccum < POLL_INTERVAL_S) return
		const intervalS = pollAccum
		pollAccum = 0

		const t = Transform.getOrNull(engine.PlayerEntity)
		if (!t) return

		const { x, y, z } = t.position

		if (!lastPos) {
			lastPos = { x, z }
			return
		}

		const dx      = x - lastPos.x
		const dz      = z - lastPos.z
		const stepMs  = Math.hypot(dx, dz)
		const speed   = stepMs / intervalS
		lastPos = { x, z }

		// Idle: reset accumulator so a stationary player does not have a
		// pent-up step waiting to fire the moment they nudge again.
		if (speed < IDLE_SPEED_MPS) {
			distAccumM = 0
			return
		}

		// Only accumulate distance when on snow. Melted cells (stage 0)
		// intentionally produce no crunch — the ground reads as flat and
		// wet, not powdery.
		const stage = getSnowStageAtWorld(x, y, z)
		if (stage < 1) {
			distAccumM = 0
			return
		}

		const stride = STEP_DISTANCE_BY_STAGE[stage as 1 | 2 | 3]
		distAccumM += stepMs
		if (distAccumM >= stride) {
			distAccumM -= stride
			playStep()
		}
	})

	console.log('snowFootsteps: setupSnowFootsteps: installed (single-step cadence)')
}
