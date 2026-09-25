/**
 * locomotion.ts — snow depth slows walk; Shift-run is always off.
 *
 * Sprint (engine runSpeed 10, Shift) is reserved for a later buff.
 * Melted ground uses the default jog (8). Frost does not change speed.
 *
 * Snow underfoot drags the walk — this is how torchless travel feels
 * heavy. A lit torch still melts a path (stage 0), so the drag is what
 * you feel when the flame is out or you step off the melt.
 *   0 = melted     → default jog
 *   1 = dusting    → 3.0 m/s
 *   2 = mid        → 1.5 m/s, no jump
 *   3 = deep       → 1.0 m/s, no jump
 *
 * Polls player position on a fixed cadence with hysteresis so cell-edge
 * jitter and single-frame airborne samples do not flip the profile.
 */

import { engine, AvatarLocomotionSettings, InputModifier, Transform } from '@dcl/sdk/ecs'

import {
	MAZE_ORIGIN_OFFSET_METERS,
	MAZE_PLAYFIELD_METERS,
} from 'src/shared/settings'

import { isFrostDying } from 'src/client/frost/death'
import { getSnowStageAtWorld } from 'src/client/snow/snowQuery'


// MARK: Playfield bounds
const PLAYFIELD_MIN_X = MAZE_ORIGIN_OFFSET_METERS
const PLAYFIELD_MIN_Z = MAZE_ORIGIN_OFFSET_METERS
const PLAYFIELD_MAX_X = MAZE_ORIGIN_OFFSET_METERS + MAZE_PLAYFIELD_METERS
const PLAYFIELD_MAX_Z = MAZE_ORIGIN_OFFSET_METERS + MAZE_PLAYFIELD_METERS


// MARK: Tuning
const POLL_INTERVAL_S = 0.15
const FLIP_HYSTERESIS = 2

const SNOW_WALK_SPEED: Record<1 | 2 | 3, number> = {
	1: 3.0,
	2: 1.5,
	3: 1.0,
}


// MARK: State
let pollAccum        = 0
let currentStage:   0 | 1 | 2 | 3 = 0
let candidateStage: 0 | 1 | 2 | 3 = 0
let candidatePolls   = 0
let installed        = false


// MARK: applyStageProfile

/**
 * Disable Shift-run. Melted ground uses engine jog; snow caps walk
 * and pins jog/run to that cap so Shift cannot sneak past.
 */
function applyStageProfile(stage: 0 | 1 | 2 | 3): void {
	InputModifier.createOrReplace(engine.PlayerEntity, {
		mode: InputModifier.Mode.Standard({
			disableRun : true,
			disableJump: stage >= 2,
		}),
	})
	if (stage === 0) {
		if (AvatarLocomotionSettings.has(engine.PlayerEntity)) {
			AvatarLocomotionSettings.deleteFrom(engine.PlayerEntity)
		}
		return
	}
	const walk = SNOW_WALK_SPEED[stage]
	AvatarLocomotionSettings.createOrReplace(engine.PlayerEntity, {
		walkSpeed: walk,
		jogSpeed : walk,
		runSpeed : walk,
	})
}


// MARK: initLocomotionGate

/**
 * Register the snow-walk gate. Idempotent — call once from client bootstrap.
 */
export function initLocomotionGate(): void {
	if (installed) {
		console.log('locomotion: initLocomotionGate: already installed, skipping')
		return
	}
	installed = true

	applyStageProfile(0)

	engine.addSystem((dt: number) => {
		pollAccum += dt
		if (pollAccum < POLL_INTERVAL_S) return
		pollAccum = 0

		if (isFrostDying()) return

		if (!InputModifier.has(engine.PlayerEntity)) {
			applyStageProfile(currentStage)
		}

		const t = Transform.getOrNull(engine.PlayerEntity)
		if (!t) return

		const { x, y, z } = t.position
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
