/**
 * hiddenCampfire.ts — the second, buried campfire that a player has to
 * find and ignite with a lit torch.
 *
 * MVP behaviour (single hidden fire per 24 h cycle, no server sync):
 *   1. Spawn the campfire GLB at the deterministic cycle position with
 *      no flame audio and no smoke plume — it reads as an unlit ring
 *      of stones in the snow. The scene's snow paint system will bury
 *      most of it visually until a torch melts nearby.
 *   2. Poll the player every frame. When they are within
 *      HIDDEN_IGNITE_RADIUS_M AND holding a lit torch, flip the fire
 *      to lit: play the campfire crackle, spawn the smoke plume, and
 *      log the moment. Idempotent — once lit, the polling system
 *      unregisters itself.
 *
 * Follow-ups (later commits):
 *   - Warmth radius so the new fire drains frost like the central one.
 *   - Server-broadcast ignition so latecomers see it already lit.
 *   - Multiple hidden fires per cycle + cycle completion broadcast.
 */

import {
	AudioSource,
	GltfContainer,
	PBParticleSystem_BlendMode,
	ParticleSystem,
	Transform,
	engine,
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'

import { isTorchLit }                    from 'src/client/torchEquip'
import { CAMPFIRE_WORLD_Y }              from 'src/shared/campfire'
import {
	getHiddenCampfireWorldPos,
	HIDDEN_IGNITE_RADIUS_M,
	HIDDEN_IGNITE_RADIUS_SQ_M,
} from 'src/shared/hiddenCampfire'


// MARK: Assets
// Reuse the central campfire's GLB + crackle so the second fire reads
// as "same thing, just hidden." When we add a distinct model for the
// buried variant, swap only these two constants.
const CAMPFIRE_MODEL  = 'assets/asset-packs/campfire/Fireplace_01/Fireplace_01.glb'
const CAMPFIRE_SFX    = 'assets/sounds/campfire.mp3'
const CAMPFIRE_VOLUME = 0.8


// MARK: Smoke tuning
// Copied from campfireSmoke.ts and trimmed to just the values we need.
// Kept inline so the hidden fire's plume can diverge from the central
// one (e.g. thinner, colder colour) without touching the main system.
const SMOKE_ORIGIN_Y_OFFSET = 1.4
const SMOKE_CONE_ANGLE_DEG  = 12
const SMOKE_CONE_RADIUS_M   = 0.15
const SMOKE_RATE_PER_S      = 14
const SMOKE_MAX_PARTICLES   = 120
const SMOKE_LIFETIME_S      = 4.5


// MARK: State
let firePitEntity: number = 0
let ignited                = false


// MARK: spawnUnlitPit
function spawnUnlitPit(x: number, z: number): void {
	firePitEntity = engine.addEntity() as unknown as number
	Transform.create(firePitEntity as any, {
		position: Vector3.create(x, CAMPFIRE_WORLD_Y, z),
	})
	GltfContainer.create(firePitEntity as any, { src: CAMPFIRE_MODEL })
	// No AudioSource and no ParticleSystem yet — the ring reads as an
	// unlit pit until ignition adds them below.
}


// MARK: ignite
function ignite(x: number, z: number): void {
	if (ignited) return
	ignited = true

	// Crackle from the pit itself, spatial so it swells on approach.
	AudioSource.createOrReplace(firePitEntity as any, {
		audioClipUrl: CAMPFIRE_SFX,
		loop        : true,
		playing     : true,
		global      : false,
		volume      : CAMPFIRE_VOLUME,
	})

	// Smoke plume above the flame tip — separate entity so its
	// transform can sit above the base without offsetting the pit.
	const smoke = engine.addEntity()
	Transform.create(smoke, {
		position: Vector3.create(x, CAMPFIRE_WORLD_Y + SMOKE_ORIGIN_Y_OFFSET, z),
		rotation: Quaternion.Identity(),
	})
	ParticleSystem.create(smoke, {
		shape                : ParticleSystem.Shape.Cone({
			angle : SMOKE_CONE_ANGLE_DEG,
			radius: SMOKE_CONE_RADIUS_M,
		}),
		rate                 : SMOKE_RATE_PER_S,
		maxParticles         : SMOKE_MAX_PARTICLES,
		lifetime             : SMOKE_LIFETIME_S,
		gravity              : -0.15,
		initialVelocitySpeed : { start: 0.6, end: 1.2 },
		additionalForce      : Vector3.create(0.15, 0, 0.05),
		initialSize          : { start: 0.4, end: 0.7 },
		sizeOverTime         : { start: 1.6, end: 2.4 },
		initialColor         : {
			start: Color4.create(0.60, 0.58, 0.55, 0.70),
			end  : Color4.create(0.68, 0.66, 0.63, 0.60),
		},
		colorOverTime        : {
			start: Color4.create(0.78, 0.78, 0.78, 0.50),
			end  : Color4.create(0.90, 0.90, 0.92, 0.0),
		},
		blendMode            : PBParticleSystem_BlendMode.PSB_ALPHA,
		billboard            : true,
		loop                 : true,
		prewarm              : false,
	})

	console.log('hiddenCampfire: ignite: second campfire lit at', { x, z })
}


// MARK: setupHiddenCampfire
/**
 * Spawn the buried second campfire for the current 24 h cycle and
 * install the proximity-polling system that ignites it when a player
 * arrives with a lit torch.
 *
 * Idempotent — the polling system unregisters itself the moment the
 * fire lights so this is O(1) after ignition.
 */
export function setupHiddenCampfire(): void {
	const { x, z, tx, tz } = getHiddenCampfireWorldPos()
	console.log(`hiddenCampfire: setupHiddenCampfire: cycle target tile=(${tx},${tz}) world=(${x.toFixed(1)},${z.toFixed(1)})`)
	spawnUnlitPit(x, z)

	// Poll every frame. Cheap — one Transform read + one squared
	// distance vs a constant, and we tear the system down on ignition.
	const pollSystem = (_dt: number): void => {
		if (ignited) {
			engine.removeSystem(pollSystem)
			return
		}
		if (!isTorchLit()) return
		const t = Transform.getOrNull(engine.PlayerEntity)
		if (!t) return
		const dx = t.position.x - x
		const dz = t.position.z - z
		if (dx * dx + dz * dz > HIDDEN_IGNITE_RADIUS_SQ_M) return
		console.log(`hiddenCampfire: player entered ignite radius (${HIDDEN_IGNITE_RADIUS_M} m) with lit torch — igniting`)
		ignite(x, z)
		engine.removeSystem(pollSystem)
	}
	engine.addSystem(pollSystem)
}
