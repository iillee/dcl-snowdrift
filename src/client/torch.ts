/**
 * torch.ts — held torch attached to the local player's right hand.
 *
 * Uses the AvatarAttach two-layer pattern proven in flagtag:
 *
 *   Anchor (AvatarAttach on right hand)   \u2190 engine tracks bone
 *     \u2514\u2500 Model (STATIC child, offsets set once)
 *
 * The anchor's Transform must not be mutated after AvatarAttach is
 * created \u2014 Bevy's attach-propagation races with per-frame Transform
 * writes on direct children and will detach the model. All positional
 * tuning lives on the child Model layer, which is safe.
 *
 * Model: Log_Large_01 from the large_log asset pack, scaled way down
 * (~7 % of its authored size) so the log reads as a torch shaft in the
 * avatar's grip. Future fire / smoke FX should parent to `torchTip` so
 * they inherit the hand transform automatically.
 */

import {
	AvatarAnchorPointType, AvatarAttach, Entity, GltfContainer,
	Material, MeshRenderer, PBParticleSystem_BlendMode, PBParticleSystem_PlaybackState,
	PBParticleSystem_SimulationSpace, ParticleSystem, Transform, VisibilityComponent, engine,
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'

import { room } from 'src/shared/messages'

import { getTorchFuelFraction, isTorchLit } from 'src/client/torchEquip'
import {
	TORCH_WARMTH_TIER_EMISSIVE_MULT,
	TORCH_WARMTH_TIER_FLAME_SCALE,
	getLocalTorchWarmthTier,
} from 'src/client/torchWarmth'


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
const TORCH_ROTATION = Quaternion.fromEulerDegrees(90, -30, 90)


// MARK: Flame + fuel-bar tuning
// Both entities are parented to the AvatarAttach ANCHOR (the right
// hand) — clean, un-rotated local axes so nudging positions is
// intuitive: +X = out from the palm, +Y = up along the arm, +Z = forward
// past the fingers. The torch base sits at TORCH_OFFSET; the visible
// tip is somewhere above/forward of it after the shaft rotation.
// Adjust FLAME_LOCAL_POS by watching the preview and reporting where
// the sphere lands relative to the visible torch tip.
const FLAME_LOCAL_POS  = Vector3.create(-0.11, 0.10, 0.28)
// Flame-shrink tuning. The flame orb starts at FLAME_SIZE_MAX (full
// fuel) and lerps down to FLAME_SIZE_MIN (empty). The shaft itself
// stays a constant size — only the flame reads fuel remaining.
const FLAME_SIZE_MAX   = 0.20
const FLAME_SIZE_MIN   = 0.06
// Base scale — replaced per-frame by the fuel-driven interpolation.
const FLAME_SIZE       = Vector3.create(FLAME_SIZE_MAX, FLAME_SIZE_MAX, FLAME_SIZE_MAX)
// Matches the frost bar's warm (heat) fill colour so the world flame
// and the HUD's heat readout speak the same visual language.
// See COL_WARM in src/client/ui/layers/layer.frostBar.tsx.
const FLAME_COLOR_HOT  = Color4.create(1.00, 0.80, 0.30, 1)
// Kept moderate so the flame reads AS its colour, not as a white
// blowout. At intensities >~2.5 the tone-mapper crushes any hue and
// the sphere renders near-white regardless of emissiveColor.
const FLAME_EMISSIVE   = 1.6

// MARK: Smoke tuning
// Tiny smoke plume rising from the torch tip. Sized well below the
// campfire's plume — a wisp, not a column — and parented to the same
// right-hand anchor as the flame so it tracks the hand for free.
// Toggled on/off via ParticleSystem.playbackState in the fuel system.
const SMOKE_LOCAL_POS         = Vector3.create(-0.11, 0.20, 0.28)
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
let installed  = false
let torchTip:  Entity = 0 as Entity
let flame:     Entity = 0 as Entity
let smoke:     Entity = 0 as Entity

// MARK: isTorchProtecting
/**
 * Whether the held torch is actively halting the baseline frost drop.
 * Read by src/client/frost/accumulation.ts each poll. Torch protection
 * requires the entity to be installed AND the flame lit — an
 * unlit / burnt-out torch offers no warmth. Independent of campfire
 * proximity: the fire always trumps and thaws regardless.
 */
export function isTorchProtecting(): boolean {
	return installed && isTorchLit()
}


// MARK: setupTorch
/**
 * Create the hand-attached torch on the local player. Idempotent \u2014
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

	// Layer 1: Anchor \u2014 rides the right hand bone. Transform is a stub;
	// AvatarAttach overrides it every frame. Never write to it again.
	const anchor = engine.addEntity()
	AvatarAttach.create(anchor, {
		anchorPointId: AvatarAnchorPointType.AAPT_RIGHT_HAND,
	})
	Transform.create(anchor, { position: Vector3.Zero(), scale: Vector3.One() })

	// Layer 2: Model \u2014 STATIC child that carries the visual offsets. Set
	// once and never mutated so it never fights AvatarAttach propagation.
	torchTip = engine.addEntity()
	Transform.create(torchTip, {
		parent  : anchor,
		position: TORCH_OFFSET,
		rotation: TORCH_ROTATION,
		// Stretched 2× on Y and Z so the log reads as a longer, slimmer
		// torch shaft rather than the stubby proportions of the source
		// mesh. X is left at base scale to keep the grip thickness.
		scale   : Vector3.create(TORCH_SCALE, TORCH_SCALE * 2, TORCH_SCALE * 2),
	})
	GltfContainer.create(torchTip, {
		src                         : TORCH_MODEL,
		// Colliders off \u2014 a hand-held prop should not block anything.
		visibleMeshesCollisionMask  : 0,
		invisibleMeshesCollisionMask: 0,
	})

	// Layer 3: Flame — small emissive sphere at the torch tip. Parented
	// to the ANCHOR (right hand) so its local axes are un-rotated and
	// nudging offsets is straightforward.
	flame = engine.addEntity()
	Transform.create(flame, {
		parent  : anchor,
		position: FLAME_LOCAL_POS,
		scale   : FLAME_SIZE,
	})
	MeshRenderer.setSphere(flame)
	Material.setPbrMaterial(flame, {
		albedoColor       : FLAME_COLOR_HOT,
		emissiveColor     : FLAME_COLOR_HOT,
		emissiveIntensity : FLAME_EMISSIVE,
		roughness         : 1.0,
	})
	// Hidden until the fuel-tracker system flips it on next frame.
	VisibilityComponent.create(flame, { visible: false })

	// Layer 4: Smoke wisp — tiny upward cone parented to the ANCHOR so
	// it tracks the right hand automatically. Starts stopped; the
	// fuel-tracker system below toggles playbackState with lit state.
	smoke = engine.addEntity()
	Transform.create(smoke, {
		parent  : anchor,
		position: SMOKE_LOCAL_POS,
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

	// Per-frame updater: toggle flame visibility + smoke playback on
	// lit, shrink the flame orb in proportion to remaining fuel. Shaft
	// stays constant. Also emits `torchLit` to the auth server whenever
	// the local lit-state edge-changes, so other clients can mirror the
	// flame on our avatar's held torch (see src/client/remoteTorches.ts).
	let lastBroadcastLit: boolean | null = null
	engine.addSystem(() => {
		const lit  = isTorchLit()
		const frac = Math.max(0, Math.min(1, getTorchFuelFraction()))

		if (lastBroadcastLit !== lit) {
			lastBroadcastLit = lit
			room.send('torchLit', { lit: lit ? 1 : 0 })
		}

		const vis = VisibilityComponent.getMutableOrNull(flame)
		if (vis !== null && vis.visible !== lit) vis.visible = lit

		const ps = ParticleSystem.getMutableOrNull(smoke)
		if (ps !== null) {
			const desired = lit
				? PBParticleSystem_PlaybackState.PS_PLAYING
				: PBParticleSystem_PlaybackState.PS_STOPPED
			if (ps.playbackState !== desired) ps.playbackState = desired
		}

		// "Torches burn brighter together" — cluster tier stacks a size
		// AND emissive multiplier on top of the fuel-driven base. Fuel
		// shrinks the flame as it burns; cluster tier swells + brightens
		// it when friends are close. Two players meeting = an unmissable
		// flame-swell moment both visually AND in ambient light.
		const tier = lit ? getLocalTorchWarmthTier() : 0

		const flameT = Transform.getMutableOrNull(flame)
		if (flameT !== null) {
			const base = FLAME_SIZE_MIN + (FLAME_SIZE_MAX - FLAME_SIZE_MIN) * frac
			const s    = base * TORCH_WARMTH_TIER_FLAME_SCALE[tier]
			flameT.scale.x = s
			flameT.scale.y = s
			flameT.scale.z = s
		}

		// Emissive brightness — mutate in place so we don't churn the
		// full PBR material record every frame. Only writes on tier change
		// to keep the CRDT diff quiet.
		const mat = Material.getMutableOrNull(flame)
		if (mat !== null && mat.material?.$case === 'pbr') {
			const want = FLAME_EMISSIVE * TORCH_WARMTH_TIER_EMISSIVE_MULT[tier]
			if (mat.material.pbr.emissiveIntensity !== want) {
				mat.material.pbr.emissiveIntensity = want
			}
		}
	})

	console.log('torch: setupTorch: attached to right hand, shrinking flame mounted')
}


// MARK: getTorchTipEntity
/**
 * Handle to the torch's model entity, useful for parenting flame
 * particles or lights so they follow the hand automatically.
 */
export function getTorchTipEntity(): Entity {
	return torchTip
}
