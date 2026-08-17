/**
 * campfire.ts — placeholder campfire visual at scene center.
 *
 * Cosmetic only for now: a single GltfContainer entity, no state, no
 * fuel decay, no light. The real fire (flame scale from fuel, ember
 * drift, warmth radius) lands with system N1 per docs/PLAN.md.
 */

import { engine, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Y, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'


const CAMPFIRE_MODEL = 'assets/asset-packs/campfire/Fireplace_01/Fireplace_01.glb'


// MARK: setupCampfire
/**
 * Spawn the placeholder campfire at the geometric center of the scene,
 * slightly raised so the base sits above the paint plane.
 */
export function setupCampfire(): void {
	const entity = engine.addEntity()
	Transform.create(entity, {
		position: Vector3.create(CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Y, CAMPFIRE_WORLD_Z),
	})
	GltfContainer.create(entity, { src: CAMPFIRE_MODEL })
}
