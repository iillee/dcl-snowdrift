/**
 * campfire.ts — placeholder campfire visual at scene center.
 *
 * Cosmetic only for now: a single GltfContainer entity, no state, no
 * fuel decay, no light. The real fire (flame scale from fuel, ember
 * drift, warmth radius) lands with system N1 per docs/PLAN.md.
 */

import { AudioSource, GltfContainer, InputAction, Transform, engine, pointerEventsSystem } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

import { CAMPFIRE_MELT_RADIUS_M, CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Y, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { isTorchLit, relightTorch } from 'src/client/torchEquip'


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

	// "E Relight torch" hover hint. Anchored on the campfire entity so
	// the affordance is discoverable via the usual DCL interaction
	// bubble. maxDistance matches the heat radius so the hint only
	// appears when the player is actually close enough to relight;
	// hoverText updates to reflect the current torch state so a player
	// with an already-lit torch doesn't get a misleading prompt.
	//
	// Fires the same relightTorch() the E-poll handler in torchInput.ts
	// uses, so clicking the fire and pressing E anywhere in the ring
	// behave identically — relightTorch is idempotent.
	pointerEventsSystem.onPointerDown(
		{
			entity,
			opts: {
				button     : InputAction.IA_PRIMARY,
				// Static text — hoverText is captured at setup, not re-read
				// per frame. "Relight" reads sensibly whether the torch is
				// lit or not; the click is a no-op when already burning.
				hoverText  : 'Relight torch',
				maxDistance: CAMPFIRE_MELT_RADIUS_M + 2, // slight slack for cursor precision
			},
		},
		() => {
			if (isTorchLit()) return // no-op if already burning
			relightTorch()
			console.log('campfire: onPointerDown: torch relit')
		},
	)
}
