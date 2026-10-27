/**
 * woodVisual.ts - GLB + pose for a log in the world.
 *
 * logs_pickup.glb is 0.70 x 0.33 x 0.69 m with colliders we disable.
 */

import { Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'


const LOG_MODEL = 'assets/models/logs_pickup.glb'


// MARK: attachWoodModel
/**
 * Put the log pickup GLB on `entity` at world (x, z), resting on
 * the terrain surface `groundY` (the shelf under the piece). Colliders
 * off so players walk through to pick up.
 */
export function attachWoodModel(
	entity: Entity,
	x     : number,
	z     : number,
	yawDeg: number,
	groundY: number,
): void {
	Transform.createOrReplace(entity, {
		position: Vector3.create(x, groundY, z),
		rotation: Quaternion.fromEulerDegrees(0, yawDeg, 0),
		scale   : Vector3.One(),
	})
	GltfContainer.createOrReplace(entity, {
		src                          : LOG_MODEL,
		visibleMeshesCollisionMask   : 0,
		invisibleMeshesCollisionMask : 0,
	})
}