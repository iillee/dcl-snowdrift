/**
 * campfireSmoke.ts — rising grey smoke plume above the campfire.
 *
 * A narrow upward Cone emitter positioned just above the flame. Particles
 * spawn small + opaque, drift upward under negative gravity, grow with
 * age, and fade to transparent by end-of-life so the plume dissolves
 * naturally into the sky rather than clipping off.
 *
 * Uses alpha blend (not additive) because grey smoke reads correctly
 * against both the winter sky and darker terrain only with straight
 * transparency. Additive would tint everything behind it lighter.
 *
 * Single small emitter, low rate, short lifetime — negligible impact
 * on the scene particle budget shared with snowfall.
 */

import { PBParticleSystem_BlendMode, ParticleSystem, Transform, engine } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { getMainFireSmokeHeight } from 'src/client/hearthFuel'


// MARK: Tuning
// Emit from just above the flame tip so smoke reads as rising from the
// fire, not from the log pile.
const SMOKE_ORIGIN_Y  = 1.4
// Cone tuning: narrow half-angle → tight column that widens with age
// as sizeOverTime + wind spread the particles.
const CONE_ANGLE_DEG  = 12
const CONE_RADIUS_M   = 0.15
// Sparse plume; smoke is expensive perceptually (large sprites), cheap
// to fake with few particles at long lifetime.
const RATE_PER_S      = 14
const MAX_PARTICLES   = 120
const LIFETIME_S      = 4.5
// Buoyant rise: negative gravity multiplier pushes the plume upward.
const GRAVITY_MULT    = -0.15
// Modest launch speed out of the fire.
const INITIAL_SPEED_MIN = 0.6
const INITIAL_SPEED_MAX = 1.2
// Light lateral wind — matches the snowfall wind so the world feels
// like one weather system.
const WIND_FORCE      = Vector3.create(0.15, 0, 0.05)
// Puffs start small, grow into billows.
const SIZE_START_MIN  = 0.4
const SIZE_START_MAX  = 0.7
const SIZE_END_MIN    = 1.6
const SIZE_END_MAX    = 2.4


// MARK: setupCampfireSmoke
/**
 * Spawn the smoke plume emitter above the campfire. Idempotent — call
 * once from client bootstrap after setupCampfire so the visual layers
 * up correctly.
 */
export function setupCampfireSmoke(): void {
	const emitter = engine.addEntity()

	// Position the cone at the flame tip, pointed straight up. The
	// entity's rotation orients the cone; default (identity) points
	// along +Y, which is what we want.
	Transform.create(emitter, {
		position: Vector3.create(CAMPFIRE_WORLD_X, SMOKE_ORIGIN_Y, CAMPFIRE_WORLD_Z),
		rotation: Quaternion.Identity(),
	})

	ParticleSystem.create(emitter, {
		shape                : ParticleSystem.Shape.Cone({
			angle : CONE_ANGLE_DEG,
			radius: CONE_RADIUS_M,
		}),
		rate                 : RATE_PER_S,
		maxParticles         : MAX_PARTICLES,
		lifetime             : LIFETIME_S,
		gravity              : GRAVITY_MULT,
		initialVelocitySpeed : { start: INITIAL_SPEED_MIN, end: INITIAL_SPEED_MAX },
		additionalForce      : WIND_FORCE,
		initialSize          : { start: SIZE_START_MIN, end: SIZE_START_MAX },
		sizeOverTime         : { start: SIZE_END_MIN,   end: SIZE_END_MAX },
		initialColor         : {
			// Light warm grey close to the fire — reads as sooty smoke
			// without going near-black against the winter sky.
			start: Color4.create(0.60, 0.58, 0.55, 0.70),
			end  : Color4.create(0.68, 0.66, 0.63, 0.60),
		},
		colorOverTime        : {
			// Cool + fade as smoke thins into the sky.
			start: Color4.create(0.78, 0.78, 0.78, 0.50),
			end  : Color4.create(0.90, 0.90, 0.92, 0.0),
		},
		blendMode            : PBParticleSystem_BlendMode.PSB_ALPHA,
		billboard            : true,
		loop                 : true,
		prewarm              : true,
	})

	console.log('campfireSmoke: setupCampfireSmoke: plume spawned above campfire')

	// Tier-scaled plume. Tuning constants above are the tier-3 "Warm"
	// baseline (multiplier == 1.0). Bigger fires push the column HIGHER
	// and let particles LAST LONGER - explicitly NOT scaling rate or
	// particle size, so a Roaring hearth doesn't turn into a soot cloud.
	// Column height comes from launch velocity * lifetime, so scaling
	// both compounds nicely into a taller plume.
	//
	// Throttled to only rewrite when the multiplier drifts by > 0.05 -
	// ParticleSystem mutations aren't as cheap as Transform mutations
	// and per-frame writes here would be wasteful.
	let lastMult = -1
	engine.addSystem(() => {
		const mult = getMainFireSmokeHeight()
		if (Math.abs(mult - lastMult) < 0.05) return
		lastMult   = mult
		const ps   = ParticleSystem.getMutable(emitter)
		ps.initialVelocitySpeed = { start: INITIAL_SPEED_MIN * mult, end: INITIAL_SPEED_MAX * mult }
		ps.lifetime             = LIFETIME_S * mult
	})
}
