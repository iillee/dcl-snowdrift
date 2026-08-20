/**
 * snowfall.ts — ambient snowfall across the entire scene.
 *
 * A single Box-shaped ParticleSystem, anchored high above the scene
 * center, spawns small white flakes that drift downward under gentle
 * gravity. Lifetime is tuned so particles die at roughly ground level,
 * so the effect is continuous but no flake ever "pops out" of view.
 *
 * Four precipitation levels are supported (see PrecipitationLevel):
 *   0 CLEAR  — emitter stopped, no flakes
 *   1 LIGHT  — sparse, gentle drift (default at boot)
 *   2 MEDIUM — denser, slightly faster and larger flakes
 *   3 HEAVY  — blizzard-density, faster fall, bigger flakes
 *
 * Level is mutated at runtime via setPrecipitation(); the single emitter
 * is reconfigured in place rather than destroyed and respawned, so
 * prewarmed particles are preserved on adjustment.
 */

import { PBParticleSystem_BlendMode, PBParticleSystem_PlaybackState, ParticleSystem, Transform, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'

import { refreshSnowfallAudio } from 'src/client/snowfallAudio'
import { SCENE_WORLD_SIZE_X_METERS, SCENE_WORLD_SIZE_Z_METERS } from 'src/shared/settings'


// MARK: PrecipitationLevel
/** Four discrete weather intensities for ambient snowfall. */
export enum PrecipitationLevel {
	CLEAR  = 0,
	LIGHT  = 1,
	MEDIUM = 2,
	HEAVY  = 3,
}


// MARK: Tuning
// Spawn box height above the scene ground. Particles fall from here.
// Raised for the larger scene footprint so snow reads as coming from
// far overhead instead of just clearing the cliff line. If flakes
// disappear mid-air, bump the per-level `lifetime` in PROFILES so
// particles survive long enough to reach the ground from this height.
const SPAWN_Y       = 60
// Downward drift accelerated by mild gravity. See per-level tables for
// the level-specific overrides that make heavier snow feel weightier.
const WIND_FORCE    = Vector3.create(0.05, 0, 0.02)
// Hard render ceiling — even HEAVY should stay under the engine's
// per-scene budget with plenty of headroom for smoke and future FX.
const MAX_PARTICLES = 6000

/**
 * Per-level tunables. Each successive level increases density (rate),
 * fall speed (gravity + initial speed), and flake size, so heavier
 * precipitation reads as heavier snow — not just more of the same.
 */
type LevelProfile = {
	rate         : number
	lifetime     : number
	gravityMult  : number
	speedMin     : number
	speedMax     : number
	sizeMin      : number
	sizeMax      : number
	alphaBirth   : number
}

const PROFILES: Record<PrecipitationLevel, LevelProfile | null> = {
	[PrecipitationLevel.CLEAR ]: null,
	// Shifted up one step: what used to be MEDIUM is now the baseline
	// LIGHT, old HEAVY becomes MEDIUM, and HEAVY is a new true-whiteout
	// tier above anything we had before.
	[PrecipitationLevel.LIGHT ]: {
		rate       : 280,
		lifetime   : 22,
		gravityMult: 0.08,
		speedMin   : 1.0,
		speedMax   : 1.8,
		sizeMin    : 0.08,
		sizeMax    : 0.18,
		alphaBirth : 0.95,
	},
	[PrecipitationLevel.MEDIUM]: {
		rate       : 1200,
		lifetime   : 12,
		gravityMult: 0.28,
		speedMin   : 2.4,
		speedMax   : 3.6,
		sizeMin    : 0.28,
		sizeMax    : 0.55,
		alphaBirth : 1.0,
	},
	[PrecipitationLevel.HEAVY ]: {
		// True whiteout tier. Rate + size pushed past the old HEAVY, and
		// lifetime dropped further so more flakes churn through the
		// ~1000-particle engine cap per second — the net effect is more
		// screen coverage, not fewer visible flakes. Fall speed cranked
		// so the storm feels driven, not floaty.
		rate       : 2200,
		lifetime   : 8,
		gravityMult: 0.45,
		speedMin   : 3.6,
		speedMax   : 5.2,
		sizeMin    : 0.42,
		sizeMax    : 0.80,
		alphaBirth : 1.0,
	},
}


// MARK: State
let emitterEntity: number | null = null
let currentLevel : PrecipitationLevel = PrecipitationLevel.LIGHT


// MARK: applyProfile
/** Reconfigure the singleton emitter for the given precipitation level. */
function applyProfile(level: PrecipitationLevel): void {
	if (emitterEntity === null) {
		console.log('snowfall: applyProfile: emitter not spawned yet, skipping')
		return
	}

	const ps = ParticleSystem.getMutable(emitterEntity as any)

	if (level === PrecipitationLevel.CLEAR) {
		// Stop cleanly — clears live particles too, so weather visibly
		// snaps to clear rather than fading out over the last lifetime.
		ps.playbackState = PBParticleSystem_PlaybackState.PS_STOPPED
		return
	}

	const p = PROFILES[level]!

	ps.rate                 = p.rate
	ps.lifetime             = p.lifetime
	ps.gravity              = p.gravityMult
	ps.initialVelocitySpeed = { start: p.speedMin, end: p.speedMax }
	ps.initialSize          = { start: p.sizeMin,  end: p.sizeMax  }
	ps.initialColor         = {
		start: Color4.create(1, 1, 1, p.alphaBirth),
		end  : Color4.create(1, 1, 1, Math.min(1, p.alphaBirth + 0.05)),
	}
	// Ensure emission resumes if we were previously CLEAR.
	ps.playbackState = PBParticleSystem_PlaybackState.PS_PLAYING
}


// MARK: setupSnowfall
/**
 * Spawn the scene-wide snowfall emitter at LIGHT intensity. Idempotent —
 * safe to call once from client bootstrap. No update loop; the emitter
 * runs on the renderer side.
 */
export function setupSnowfall(): void {
	if (emitterEntity !== null) {
		console.log('snowfall: setupSnowfall: already spawned, skipping')
		return
	}

	const emitter = engine.addEntity()
	emitterEntity = emitter as unknown as number

	// Emitter sits at the geometric center of the scene, high overhead.
	// Box shape spans the full scene footprint so flakes cover every
	// parcel uniformly rather than clustering at center.
	Transform.create(emitter, {
		position: Vector3.create(
			SCENE_WORLD_SIZE_X_METERS / 2,
			SPAWN_Y,
			SCENE_WORLD_SIZE_Z_METERS / 2,
		),
	})

	const p = PROFILES[PrecipitationLevel.LIGHT]!
	ParticleSystem.create(emitter, {
		shape                : ParticleSystem.Shape.Box({
			size: Vector3.create(SCENE_WORLD_SIZE_X_METERS, 0.5, SCENE_WORLD_SIZE_Z_METERS),
		}),
		rate                 : p.rate,
		maxParticles         : MAX_PARTICLES,
		lifetime             : p.lifetime,
		gravity              : p.gravityMult,
		initialVelocitySpeed : { start: p.speedMin, end: p.speedMax },
		additionalForce      : WIND_FORCE,
		initialSize          : { start: p.sizeMin,  end: p.sizeMax  },
		initialColor         : {
			start: Color4.create(1, 1, 1, p.alphaBirth),
			end  : Color4.create(1, 1, 1, 1.0),
		},
		colorOverTime        : {
			// Fade slightly toward transparent as flakes near the ground,
			// so the "landing" moment is soft rather than a hard pop.
			start: Color4.create(1, 1, 1, p.alphaBirth),
			end  : Color4.create(1, 1, 1, 0.0),
		},
		blendMode            : PBParticleSystem_BlendMode.PSB_ALPHA,
		billboard            : true,
		loop                 : true,
		prewarm              : true,
	})

	currentLevel = PrecipitationLevel.LIGHT
	console.log('snowfall: setupSnowfall: emitter spawned at LIGHT')
}


// MARK: setPrecipitation
/**
 * Change ambient snowfall intensity at runtime. Reconfigures the shared
 * emitter in place. No-op if the requested level matches the current.
 */
export function setPrecipitation(level: PrecipitationLevel): void {
	if (level === currentLevel) return
	currentLevel = level
	applyProfile(level)
	refreshSnowfallAudio()
	console.log(`snowfall: setPrecipitation: level → ${PrecipitationLevel[level]}`)
}


// MARK: getPrecipitation
/** Read the current precipitation level. */
export function getPrecipitation(): PrecipitationLevel {
	return currentLevel
}
