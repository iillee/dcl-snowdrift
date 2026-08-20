/**
 * locomotion.ts \u2014 gates player run/walk speed to snow depth underfoot.
 *
 * The snow field has four states per cell (see paint.ts snow-fill stages):
 *   0 = melted (flat, painted)               \u2192 run allowed, normal speed
 *   1 = ~0.5 m regrowth                      \u2192 no run, normal walk
 *   2 = ~1.0 m regrowth                      \u2192 no run, slow walk
 *   3 = full 1.5 m snow (pristine / regrown) \u2192 no run, very slow walk
 *
 * Higher stages compound: taller snow drags on the legs, so both run is
 * disabled AND walk speed drops. Around the campfire the persistent melt
 * ring keeps ground at stage 0, so movement always feels free near the
 * fire and gets progressively heavier as players venture into the field.
 *
 * Polls player position on a fixed cadence with hysteresis so cell-edge
 * jitter and single-frame airborne samples do not flip the profile.
 */

import { engine, AvatarLocomotionSettings, InputModifier, Transform } from '@dcl/sdk/ecs'

import { getSnowStageAtWorld } from 'src/client/paint'
import {
	MAZE_ORIGIN_OFFSET_METERS,
	MAZE_PLAYFIELD_METERS,
} from 'src/shared/settings'


// MARK: Playfield bounds
// Interior playfield in scene world coords. Outside these bounds the
// perimeter (cliffs) ring sits — movement there should never be
// snow-gated, otherwise players get stuck at stage-3 trudge speed on
// terrain that has no snow field at all.
const PLAYFIELD_MIN_X = MAZE_ORIGIN_OFFSET_METERS
const PLAYFIELD_MIN_Z = MAZE_ORIGIN_OFFSET_METERS
const PLAYFIELD_MAX_X = MAZE_ORIGIN_OFFSET_METERS + MAZE_PLAYFIELD_METERS
const PLAYFIELD_MAX_Z = MAZE_ORIGIN_OFFSET_METERS + MAZE_PLAYFIELD_METERS


// MARK: Tuning
const POLL_INTERVAL_S    = 0.15
// Consecutive polls of a different stage required before we flip. Prevents
// flicker on cell boundaries or single-frame airborne samples.
const FLIP_HYSTERESIS    = 2

// Default DCL locomotion speeds (m/s). Used to restore stage 0 without
// pinning to explicit numbers that might diverge from client defaults in
// the future \u2014 undefined tells the runtime "use the default."
const DEFAULT_WALK_SPEED = 2.0
// Progressive snow drag. Stage 1 keeps the normal walk pace so the first
// bite of snow only steals the run; stages 2 and 3 slow the walk itself.
const SNOW_WALK_SPEED: Record<1 | 2 | 3, number> = {
	1: 3.0,  // low snow: brisk — faster than default walk, still no full run
	2: 1.5,  // mid snow: noticeably heavy
	3: 1.0,  // full snow: slow trudge, not molasses
}


// MARK: State
let pollAccum       = 0
let currentStage:  0 | 1 | 2 | 3 = 0
let candidateStage: 0 | 1 | 2 | 3 = 0
let candidatePolls = 0
let installed       = false


// MARK: applyStageProfile
/**
 * Push the locomotion profile for `stage` to the player.
 */
function applyStageProfile(stage: 0 | 1 | 2 | 3): void {
	if (stage === 0) {
		// Melted ground: default walk speeds, but run is STILL disabled.
		// This is a snow world — even melted paths are wet/icy underfoot,
		// so sprinting is never available regardless of stage.
		InputModifier.createOrReplace(engine.PlayerEntity, {
			mode: InputModifier.Mode.Standard({ disableRun: true, disableJump: false }),
		})
		AvatarLocomotionSettings.createOrReplace(engine.PlayerEntity, {
			walkSpeed: undefined,
			jogSpeed:  undefined,
			runSpeed:  undefined,
		})
		return
	}

	// Any snow: disable run, cap jog to walk (so the SDK's jog-on-hold
	// behavior does not sneak past the walk cap), and set walk to the
	// stage's dragged speed. Stages 2 and 3 (mid + full snow) also
	// disable jump — you cannot hop out of deep drifts.
	const walk        = SNOW_WALK_SPEED[stage]
	const disableJump = stage >= 2
	InputModifier.createOrReplace(engine.PlayerEntity, {
		mode: InputModifier.Mode.Standard({ disableRun: true, disableJump }),
	})
	AvatarLocomotionSettings.createOrReplace(engine.PlayerEntity, {
		walkSpeed: walk,
		jogSpeed:  walk,
		runSpeed:  walk,
	})
}


// MARK: initLocomotionGate
/**
 * Register the polling system that adjusts the player's run/walk profile
 * based on the snow-fill stage under their feet. Idempotent \u2014 safe to
 * call once from client bootstrap.
 */
export function initLocomotionGate(): void {
	if (installed) {
		console.log('locomotion: initLocomotionGate: already installed, skipping')
		return
	}
	installed = true

	// Start assuming melted ground; the first poll corrects us within ~150 ms.
	applyStageProfile(0)

	engine.addSystem((dt: number) => {
		pollAccum += dt
		if (pollAccum < POLL_INTERVAL_S) return
		pollAccum = 0

		const t = Transform.getOrNull(engine.PlayerEntity)
		if (!t) return

		const { x, y, z } = t.position
		// Outside the interior playfield (i.e. on the perimeter cliff
		// ring) there is no snow field — force stage 0 so movement stays
		// free. Only sample the paint grid when we're inside.
		const insidePlayfield =
			x >= PLAYFIELD_MIN_X && x < PLAYFIELD_MAX_X &&
			z >= PLAYFIELD_MIN_Z && z < PLAYFIELD_MAX_Z
		const observed = insidePlayfield ? getSnowStageAtWorld(x, y, z) : 0

		if (observed === currentStage) {
			candidatePolls = 0
			return
		}

		if (observed !== candidateStage) {
			candidateStage = observed
			candidatePolls = 1
			return
		}

		candidatePolls++
		if (candidatePolls < FLIP_HYSTERESIS) return

		currentStage   = observed
		candidatePolls = 0
		applyStageProfile(currentStage)
	})
}
