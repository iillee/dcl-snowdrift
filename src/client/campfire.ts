/**
 * campfire.ts - placeholder campfire visual at scene center.
 *
 * Cosmetic only for now: a single GltfContainer entity, no state, no
 * fuel decay, no light. The real fire (flame scale from fuel, ember
 * drift, warmth radius) lands with system N1 per docs/PLAN.md.
 */

import { AudioSource, GltfContainer, Transform, engine } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Y, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'


const CAMPFIRE_MODEL = 'assets/asset-packs/campfire/Fireplace_01/Fireplace_01.glb'
const CAMPFIRE_SFX   = 'assets/sounds/campfire.mp3'
// Volume at zero distance. DCL attenuates with distance automatically
// when global=false, so this is the "standing on the fire" ceiling.
const CAMPFIRE_VOLUME = 0.8


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

	// Spatial crackle: global=false makes the SDK attenuate by distance
	// from this entity's Transform, so the fire sound naturally fades as
	// the player wanders away from the melt ring and swells on return.
	AudioSource.create(entity, {
		audioClipUrl: CAMPFIRE_SFX,
		loop        : true,
		playing     : true,
		global      : false,
		volume      : CAMPFIRE_VOLUME,
	})

	// Relight is handled entirely by torchInput.ts: press E anywhere
	// inside the campfire heat ring. Proximity-only — no pointer/aim
	// required. The old pointerEventsSystem hook on this GLB was
	// removed because it forced the player to look at the fire.
}
