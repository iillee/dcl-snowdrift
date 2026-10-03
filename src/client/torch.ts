/**
 * torch.ts — held torch attached to the local player's right hand.
 *
 * Uses the AvatarAttach two-layer pattern proven in flagtag:
 *
 *   Anchor (AvatarAttach on right hand)   ← engine tracks bone
 *     ├─ Model (STATIC child, offsets set once)
 *     ├─ Tip cube + world-up sparks + shadow spots
 *     ├─ Soft fill point light
 *     └─ Smoke (world-space particles)
 *
 * The anchor's Transform must not be mutated after AvatarAttach is
 * created — Bevy's attach-propagation races with per-frame Transform
 * writes on the anchor and will detach the model. Do not parent the
 * torch to CameraEntity: a Gltf + particle child on the camera kills
 * the React-ECS HUD.
 *
 * Model: Log_Large_01 from the large_log asset pack, scaled way down
 * (~7 % of its authored size) so the log reads as a torch shaft in the
 * avatar's grip. Flame is a tip cube + rising spark cubes (torchFlame).
 */

import {
	AvatarAnchorPointType, AvatarAttach, Entity, GltfContainer,
	PBParticleSystem_BlendMode, PBParticleSystem_PlaybackState,
	PBParticleSystem_SimulationSpace, ParticleSystem, Transform, VisibilityComponent, engine,
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'

import { room } from 'src/shared/messages'

import { syncPointLight, torchLightParams } from 'src/client/fireLight'
import { getLivePhaseConfig } from 'src/client/phase'
import { getTorchFuelFraction, isTorchLit } from 'src/client/torchEquip'
import { mountTorchFlame, TORCH_FLAME_LOCAL_POS, TorchFlame } from 'src/client/torchFlame'


// MARK: Tuning
const TORCH_MODEL   = 'assets/asset-packs/large_log/Log_Large_01/Log_Large_01.glb'
// Uniform scale factor applied to the log to make it torch-sized.
const TORCH_SCALE   = 0.09
// Position offset from the AAPT_RIGHT_HAND anchor, in avatar-local
// meters. Slightly outward + forward + up so the log rests along the
// palm rather than intersecting the fingers.
const TORCH_OFFSET  = Vector3.create(0.04, 0.12, 0.10)
// Rotation offset. The right-hand anchor's local axes align with the
// forearm, so a base rotation of (0, 0, 90) laid the shaft parallel
// along the arm — not what we want. Adding pitch on X rotates the
// shaft up and away from the forearm so the torch stands out of the
// palm like it is being carried aloft.
// Y rotation nudges the shaft's compass bearing from the top-down view.
// +60 = 2 hours clockwise on a clock face (looking straight down on the
// avatar), so the torch angles across the palm rather than pointing
// straight along the forearm axis.
const TORCH_ROTATION    = Quaternion.fromEulerDegrees(90, -30, 90)
const TORCH_MODEL_SCALE = Vector3.create(TORCH_SCALE, TORCH_SCALE * 2, TORCH_SCALE * 2)


// MARK: Smoke tuning
// Tiny smoke plume rising from the torch tip. Sized well below the
// campfire's plume — a wisp, not a column — and parented to the same
// right-hand anchor as the flame so it tracks the hand for free.
// Toggled on/off via ParticleSystem.playbackState in the fuel system.
const SMOKE_ABOVE_TIP_M       = 0.08
const SMOKE_CONE_ANGLE_DEG    = 16
const SMOKE_CONE_RADIUS_M     = 0.05
const SMOKE_RATE_PER_S        = 40
const SMOKE_MAX_PARTICLES     = 160
const SMOKE_LIFETIME_S        = 1.8
const SMOKE_GRAVITY_MULT      = -0.18
const SMOKE_SPEED_MIN         = 0.35
const SMOKE_SPEED_MAX         = 0.65
const SMOKE_WIND              = Vector3.create(0.08, 0, 0.03)
const SMOKE_SIZE_START_MIN    = 0.15
const SMOKE_SIZE_START_MAX    = 0.22
const SMOKE_SIZE_END_MIN      = 0.50
const SMOKE_SIZE_END_MAX      = 0.72


// MARK: State
let installed    = false
let torchAnchor: Entity = 0 as Entity
let torchTip:    Entity = 0 as Entity
let torchFlame:  TorchFlame | null = null
let smoke:       Entity = 0 as Entity
let torchLight:  Entity = 0 as Entity


// MARK: isTorchProtecting
/**
 * Whether YOUR held torch is lit. The only personal heat source.
 * A friend's torch does not warm you — chain-light their flame if
 * you want them safe. Campfire thaw is separate and always wins.
 */
export function isTorchProtecting(): boolean {
	return installed && isTorchLit()
}


// MARK: setupTorch
/**
 * Create the hand-attached torch on the local player. Idempotent —
 * safe to call once from client bootstrap after the player entity
 * exists. AvatarAttach on the local player automatically resolves to
 * the current avatar without needing an explicit avatarId.
 */
export function setupTorch(): void {
	if (installed) {
		console.log('torch: setupTorch: already installed, skipping')
		return
	}
	installed = true

	// Layer 1: Anchor — rides the right hand bone. Transform is a stub;
	// AvatarAttach overrides it every frame. Never write to it again.
	torchAnchor = engine.addEntity()
	AvatarAttach.create(torchAnchor, {
		anchorPointId: AvatarAnchorPointType.AAPT_RIGHT_HAND,
	})
	Transform.create(torchAnchor, { position: Vector3.Zero(), scale: Vector3.One() })

	// Layer 2: Model — STATIC child that carries the visual offsets. Set
	// once and never mutated so it never fights AvatarAttach propagation.
	torchTip = engine.addEntity()
	Transform.create(torchTip, {
		parent  : torchAnchor,
		position: TORCH_OFFSET,
		rotation: TORCH_ROTATION,
		scale   : TORCH_MODEL_SCALE,
	})
	GltfContainer.create(torchTip, {
		src                         : TORCH_MODEL,
		// Colliders off — a hand-held prop should not block anything.
		visibleMeshesCollisionMask  : 0,
		invisibleMeshesCollisionMask: 0,
	})
	VisibilityComponent.create(torchTip, { visible: true })

	// Layer 3: Flame — tip cube + world-up spark cubes (torchFlame).
	const flame = mountTorchFlame(torchAnchor)
	torchFlame = flame

	// Layer 3b: Soft fill point light at the tip. Spots on the flame
	// lift cast the flicker shadows (same split as the hearth).
	torchLight = engine.addEntity()
	Transform.create(torchLight, {
		parent  : torchAnchor,
		position: TORCH_FLAME_LOCAL_POS,
	})
	syncPointLight(torchLight, torchLightParams(false, 0, 1))

	// Layer 4: Smoke wisp — parented to the flame lift so the cone sits
	// just above the tip in WORLD up (not hand-local Z, which was slamming
	// the emitter into the floor). World-space particles still trail.
	smoke = engine.addEntity()
	Transform.create(smoke, {
		parent  : flame.lift,
		position: Vector3.create(0, SMOKE_ABOVE_TIP_M, 0),
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
		gravity              : SMOKE_GRAVITY_MULT,
		initialVelocitySpeed : { start: SMOKE_SPEED_MIN, end: SMOKE_SPEED_MAX },
		additionalForce      : SMOKE_WIND,
		initialSize          : { start: SMOKE_SIZE_START_MIN, end: SMOKE_SIZE_START_MAX },
		sizeOverTime         : { start: SMOKE_SIZE_END_MIN,   end: SMOKE_SIZE_END_MAX },
		initialColor         : {
			start: Color4.create(0.55, 0.54, 0.52, 0.85),
			end  : Color4.create(0.62, 0.61, 0.59, 0.80),
		},
		colorOverTime        : {
			start: Color4.create(0.75, 0.75, 0.75, 0.65),
			end  : Color4.create(0.90, 0.90, 0.92, 0.0),
		},
		blendMode            : PBParticleSystem_BlendMode.PSB_ALPHA,
		billboard            : true,
		loop                 : true,
		prewarm              : false,
		// World-space simulation: the emitter rides the hand, but each
		// spawned particle is frozen into world position at birth. So
		// when the avatar swings their arm the plume trails naturally
		// instead of the whole cloud whipping around with the wrist.
		simulationSpace      : PBParticleSystem_SimulationSpace.PSS_WORLD,
		// Start PLAYING; the per-frame system below will stop it on the
		// first tick if the torch isn't lit. Some SDK builds ignore a
		// PS_STOPPED initial state and never accept a later PS_PLAYING
		// toggle — booting into PLAYING dodges that.
		playbackState        : PBParticleSystem_PlaybackState.PS_PLAYING,
	})

	// Per-frame updater: toggle flame + smoke on lit, shrink cards with
	// fuel. Shaft stays constant. Also emits `torchLit` to the auth
	// server whenever the local lit-state edge-changes, so other
	// clients can mirror the flame on our avatar's held torch.
	let lastBroadcastLit: boolean | null = null
	let lastBroadcastFrac = -1
	const FUEL_BROADCAST_STEP = 0.05
	engine.addSystem(() => {
		const lit  = isTorchLit()
		const frac = Math.max(0, Math.min(1, getTorchFuelFraction()))

		if (
			lastBroadcastLit !== lit ||
			(lit && Math.abs(frac - lastBroadcastFrac) >= FUEL_BROADCAST_STEP)
		) {
			lastBroadcastLit  = lit
			lastBroadcastFrac = lit ? frac : 0
			room.send('torchLit', { lit: lit ? 1 : 0, fuelFrac: lastBroadcastFrac })
		}

		const ps = ParticleSystem.getMutableOrNull(smoke)
		if (ps !== null) {
			const desired = lit
				? PBParticleSystem_PlaybackState.PS_PLAYING
				: PBParticleSystem_PlaybackState.PS_STOPPED
			if (ps.playbackState !== desired) ps.playbackState = desired
		}

		const flameMul = getLivePhaseConfig().torchFlameMul
		if (torchFlame !== null) {
			torchFlame.setFuel(lit, frac, flameMul)
		}

		syncPointLight(torchLight, torchLightParams(lit, frac, flameMul))
	})

	console.log('torch: setupTorch: attached to right hand, tip cube + sparks mounted')
}


// MARK: getTorchTipEntity
/**
 * Handle to the torch's model entity, useful for parenting flame
 * particles or lights so they follow the hand automatically.
 */
export function getTorchTipEntity(): Entity {
	return torchTip
}
