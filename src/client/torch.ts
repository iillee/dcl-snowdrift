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

import { AvatarAnchorPointType, AvatarAttach, Entity, GltfContainer, Transform, engine } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'


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


// MARK: State
let installed  = false
let torchTip: Entity = 0 as Entity


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

	console.log('torch: setupTorch: attached to right hand')
}


// MARK: getTorchTipEntity
/**
 * Handle to the torch's model entity, useful for parenting flame
 * particles or lights so they follow the hand automatically.
 */
export function getTorchTipEntity(): Entity {
	return torchTip
}
