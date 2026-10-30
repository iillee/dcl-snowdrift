/**
 * snowfall.ts — ambient snowfall across the entire scene.
 *
 * A single Box-shaped ParticleSystem spawns small white flakes through a
 * tall column (SNOW_BOTTOM_Y .. SNOW_TOP_Y) that follows the player in XZ
 * (SNOW_COLUMN_HALF_M each way). Particles simulate in WORLD space, so
 * moving the column only moves where new flakes appear. The column top
 * sits near the scene ceiling, above every hovering obelisk, so no spawn
 * plane is visible against the mountains / volcano; spawning through the
 * whole column means density ramps in softly from the top (no edge) and
 * is uniform below SNOW_BOTTOM_Y. Fall speed is capped per level
 * (terminalSpeed, ~the old ground-level speed) and lifetime is derived so
 * a flake from the very top always reaches the lowest ground.
 *
 * Four precipitation levels are supported (see PrecipitationLevel):
 *   0 CLEAR  — emitter stopped, no flakes
 *   1 LIGHT  — sparse, gentle drift (default at boot)
 *   2 MEDIUM — denser, slightly faster and larger flakes
 *   3 HEAVY  — blizzard-density, faster fall, bigger flakes
 *
 * Level is mutated at runtime via setPrecipitation(); the single emitter
 * is reconfigured in place rather than destroyed and respawned.
 *
 * The emitter is created stopped. Particles stay off through cold-open
 * (snow tiles + cliff GLBs) so load is not fighting a prewarmed flake
 * fill. Emission arms once the splash would release.
 */

import { PBParticleSystem_BlendMode, PBParticleSystem_PlaybackState, PBParticleSystem_SimulationSpace, ParticleSystem, Transform, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'

import {
	SCENE_WORLD_SIZE_X_METERS,
	SCENE_WORLD_SIZE_Z_METERS,
	TERRAIN_LEVEL_LOW,
	TERRAIN_LEVEL_MOUNTAIN_MAX,
	groundYForLevel,
	sceneHeightLimitM,
} from 'src/shared/settings'

import { hasTerrainSpawned, isTerrainReady } from 'src/client/terrain/terrainRenderer'
import { isSnowSettled } from 'src/client/snow/snowRenderer'
import { refreshSnowfallAudio } from 'src/client/snowfallAudio'


// MARK: PrecipitationLevel
/** Four discrete weather intensities for ambient snowfall. */
export enum PrecipitationLevel {
	CLEAR  = 0,
	LIGHT  = 1,
	MEDIUM = 2,
	HEAVY  = 3,
}


// MARK: Tuning
/**
 * Column top (m): this far under the scene height limit. Hovering obelisk
 * tops are capped 24 m under the limit (stationMarkers
 * HOVER_CEILING_MARGIN_M, bob included), so flakes always start above them.
 */
const SNOW_CEILING_MARGIN_M = 6
const SNOW_TOP_Y    = sceneHeightLimitM() - SNOW_CEILING_MARGIN_M
/**
 * Column bottom (m): flakes spawn anywhere between here and the top, so
 * none pop in right next to a player on Low / Mid / High or mountain-top
 * ground. Below this the falling flakes are uniform all the way down.
 */
const SNOW_BOTTOM_Y = Math.min(SNOW_TOP_Y - 20, groundYForLevel(TERRAIN_LEVEL_MOUNTAIN_MAX) + 4)
/** Lowest ground a flake must reach (m). */
const SNOW_FLOOR_Y  = groundYForLevel(TERRAIN_LEVEL_LOW) - 2
/** Column half-width around the player (m). Wider = farther snow, more particles. */
const SNOW_COLUMN_HALF_M = 160
/** Move the column once the player is this far (XZ) from its centre (m). */
const SNOW_FOLLOW_STEP_M = 4
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
	/** Fall speed cap (m/s), about what flakes reached at the ground before. */
	terminalSpeed: number
}

const PROFILES: Record<PrecipitationLevel, LevelProfile | null> = {
	[PrecipitationLevel.CLEAR ]: null,
	// Shifted up one step: what used to be MEDIUM is now the baseline
	// LIGHT, old HEAVY becomes MEDIUM, and HEAVY is a new true-whiteout
	// tier above anything we had before.
	[PrecipitationLevel.LIGHT ]: {
		rate       : 60,
		lifetime   : 22, // derived below (flakeLifetime)
		gravityMult: 0.08,
		speedMin   : 1.0,
		speedMax   : 1.8,
		sizeMin    : 0.16,
		sizeMax    : 0.36,
		alphaBirth : 0.95,
		terminalSpeed: 11,
	},
	[PrecipitationLevel.MEDIUM]: {
		rate       : 160,
		lifetime   : 12, // derived below (flakeLifetime)
		gravityMult: 0.28,
		speedMin   : 2.4,
		speedMax   : 3.6,
		sizeMin    : 0.56,
		sizeMax    : 1.10,
		alphaBirth : 1.0,
		terminalSpeed: 20,
	},
	[PrecipitationLevel.HEAVY ]: {
		// True whiteout tier. Rate + size pushed past the old HEAVY, and
		// lifetime dropped further so more flakes churn through the
		// ~1000-particle engine cap per second — the net effect is more
		// screen coverage, not fewer visible flakes. Fall speed cranked
		// so the storm feels driven, not floaty.
		rate       : 300,
		lifetime   : 8, // derived below (flakeLifetime)
		gravityMult: 0.45,
		speedMin   : 3.6,
		speedMax   : 5.2,
		sizeMin    : 0.62,
		sizeMax    : 1.15,
		alphaBirth : 1.0,
		terminalSpeed: 26,
	},
}


// MARK: flakeLifetime
/**
 * Seconds for a flake born at SNOW_TOP_Y to fall past SNOW_FLOOR_Y, worst
 * case (launched straight up at speedMax), with gravity capped at
 * terminalSpeed, plus 10 %. Rates above are per-column (so alive count =
 * rate * lifetime stays ~1-4k, well under MAX_PARTICLES).
 */
function flakeLifetime(p: LevelProfile): number {
	const g    = Math.max(0.05, p.gravityMult * 9.81)
	const v0   = p.speedMax
	const vMax = Math.max(v0 + 0.5, p.terminalSpeed)
	const tUp  = (2 * v0) / g
	const tAcc = (vMax - v0) / g
	const dAcc = (vMax * vMax - v0 * v0) / (2 * g)
	const fall = SNOW_TOP_Y - SNOW_FLOOR_Y
	const tRun = Math.max(0, fall - dAcc) / vMax
	return Math.ceil((tUp + tAcc + tRun) * 1.1)
}


// MARK: State
let emitterEntity: number | null = null
let currentLevel : PrecipitationLevel = PrecipitationLevel.LIGHT
let emissionArmed = false


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
	ps.lifetime             = flakeLifetime(p)
	ps.limitVelocity        = { speed: p.terminalSpeed, dampen: 1 }
	ps.gravity              = p.gravityMult
	ps.initialVelocitySpeed = { start: p.speedMin, end: p.speedMax }
	ps.initialSize          = { start: p.sizeMin,  end: p.sizeMax  }
	ps.initialColor         = {
		start: Color4.create(1, 1, 1, p.alphaBirth),
		end  : Color4.create(1, 1, 1, Math.min(1, p.alphaBirth + 0.05)),
	}
	// Stay stopped until cold-open arms. CLEAR already stopped above.
	ps.playbackState = emissionArmed
		? PBParticleSystem_PlaybackState.PS_PLAYING
		: PBParticleSystem_PlaybackState.PS_STOPPED
}


// MARK: isSnowfallArmed

/** True once cold-open finished and flakes are allowed to emit. */
export function isSnowfallArmed(): boolean {
	return emissionArmed
}


// MARK: tryArmSnowfall

/** Start flakes after snow tiles and cliff GLBs have landed. */
function tryArmSnowfall(): void {
	if (emissionArmed) return
	if (!isSnowSettled()) return
	if (!hasTerrainSpawned() || !isTerrainReady()) return
	emissionArmed = true
	applyProfile(currentLevel)
	refreshSnowfallAudio()
	console.log(`snowfall: tryArmSnowfall: emission armed at ${PrecipitationLevel[currentLevel]}`)
}


// MARK: setupSnowfall
/**
 * Spawn the scene-wide snowfall emitter, stopped. Idempotent — safe
 * to call once from client bootstrap. Flakes start after cold-open
 * settles so load is not competing with a particle fill.
 */
export function setupSnowfall(): void {
	if (emitterEntity !== null) {
		console.log('snowfall: setupSnowfall: already spawned, skipping')
		return
	}

	const emitter = engine.addEntity()
	emitterEntity = emitter as unknown as number

	// Column starts at the scene centre; followSnowColumn moves it with
	// the player. Box spans SNOW_BOTTOM_Y..SNOW_TOP_Y vertically.
	Transform.create(emitter, {
		position: Vector3.create(
			SCENE_WORLD_SIZE_X_METERS / 2,
			(SNOW_TOP_Y + SNOW_BOTTOM_Y) / 2,
			SCENE_WORLD_SIZE_Z_METERS / 2,
		),
	})

	const p = PROFILES[PrecipitationLevel.LIGHT]!
	ParticleSystem.create(emitter, {
		shape                : ParticleSystem.Shape.Box({
			size: Vector3.create(SNOW_COLUMN_HALF_M * 2, SNOW_TOP_Y - SNOW_BOTTOM_Y, SNOW_COLUMN_HALF_M * 2),
		}),
		rate                 : p.rate,
		maxParticles         : MAX_PARTICLES,
		lifetime             : flakeLifetime(p),
		limitVelocity        : { speed: p.terminalSpeed, dampen: 1 },
		simulationSpace      : PBParticleSystem_SimulationSpace.PSS_WORLD,
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
		prewarm              : false,
		playbackState        : PBParticleSystem_PlaybackState.PS_STOPPED,
	})

	currentLevel = PrecipitationLevel.LIGHT
	engine.addSystem(tryArmSnowfall)
	engine.addSystem(followSnowColumn)
	console.log('snowfall: setupSnowfall: emitter spawned stopped until cold-open settles')
}


// MARK: followSnowColumn
/**
 * Keep the snow column centred on the player in XZ (inside the scene
 * footprint). Written only after a SNOW_FOLLOW_STEP_M move. World-space
 * simulation keeps live flakes where they are.
 */
function followSnowColumn(): void {
	if (emitterEntity === null) return
	const pl = Transform.getOrNull(engine.PlayerEntity)
	if (!pl) return
	const x = Math.max(0, Math.min(SCENE_WORLD_SIZE_X_METERS, pl.position.x))
	const z = Math.max(0, Math.min(SCENE_WORLD_SIZE_Z_METERS, pl.position.z))
	const cur = Transform.getOrNull(emitterEntity as any)
	if (!cur) return
	if (Math.abs(cur.position.x - x) < SNOW_FOLLOW_STEP_M && Math.abs(cur.position.z - z) < SNOW_FOLLOW_STEP_M) return
	Transform.getMutable(emitterEntity as any).position = Vector3.create(x, (SNOW_TOP_Y + SNOW_BOTTOM_Y) / 2, z)
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
