/**
 * woodVisual.ts — GLB + pose for a branch or log in the world.
 *
 * branch.glb native size 0.66 × 4.19 × 0.30 m (Y is the long axis),
 * no colliders, no clips. Scale 0.40 → ~1.68 m stick. Pitch 90° so
 * it lies on the snow. The mesh hangs 0.173 m below the origin once
 * pitched (scale 1), so world Y lifts that hang onto the slab top.
 *
 * logs_pickup.glb is 0.70 × 0.33 × 0.69 m with colliders we disable.
 */

import { Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import { LOGS_PILE_WORLD_Y } from 'src/shared/logs'
import { SNOW_GROUND_TOP_Y } from 'src/shared/snowGrid'
import { WOOD_KIND_BRANCH } from 'src/shared/woodKind'


const BRANCH_MODEL = 'assets/models/branch.glb'
const LOG_MODEL    = 'assets/models/logs_pickup.glb'

/** Uniform scale. Native length 4.19 m × 0.40 ≈ 1.68 m. */
const BRANCH_SCALE = 0.40
/** Lay the long axis along the ground. */
const BRANCH_PITCH_X_DEG = 90
/** Metres the pitched mesh extends below the origin, before scale. */
const BRANCH_HANG_BELOW_M = 0.173
/** Clearance above the slab so the stick does not z-fight the ground. */
const BRANCH_PAD_M = 0.02
const BRANCH_WORLD_Y = SNOW_GROUND_TOP_Y + BRANCH_HANG_BELOW_M * BRANCH_SCALE + BRANCH_PAD_M


// MARK: attachWoodModel
/**
 * Put the matching pickup GLB on `entity` at world (x, z). Colliders
 * off so players walk through to pick up.
 */
export function attachWoodModel(
	entity: Entity,
	kind  : number,
	x     : number,
	z     : number,
	yawDeg: number,
): void {
	const isBranch = kind === WOOD_KIND_BRANCH
	const scale    = isBranch ? BRANCH_SCALE : 1
	const y        = isBranch ? BRANCH_WORLD_Y : LOGS_PILE_WORLD_Y
	const pitch    = isBranch ? BRANCH_PITCH_X_DEG : 0
	Transform.createOrReplace(entity, {
		position: Vector3.create(x, y, z),
		rotation: Quaternion.fromEulerDegrees(pitch, yawDeg, 0),
		scale   : Vector3.create(scale, scale, scale),
	})
	GltfContainer.createOrReplace(entity, {
		src                          : isBranch ? BRANCH_MODEL : LOG_MODEL,
		visibleMeshesCollisionMask   : 0,
		invisibleMeshesCollisionMask : 0,
	})
}
