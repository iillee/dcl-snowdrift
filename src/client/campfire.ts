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
import { getMainFireFlameScale, getMainFireTier, getMainFireVolume } from 'src/client/hearthFuel'


// Split GLBs (base logs + flame) so we can scale ONLY the flame on
// tier change. Scaling the whole model shrinks the log pile too,
// which reads as the fire physically shrinking rather than dimming.
const CAMPFIRE_BASE_MODEL  = 'assets/asset-packs/campfire/Fireplace_01/Fireplace_base.glb'
const CAMPFIRE_FLAME_MODEL = 'assets/asset-packs/campfire/Fireplace_01/Fireplace_flame.glb'
const CAMPFIRE_SFX         = 'assets/sounds/campfire.mp3'
// Volume at zero distance. DCL attenuates with distance automatically
// when global=false, so this is the "standing on the fire" ceiling.
// Now MULTIPLIED by hearthFuel's tier volume curve (0.3..1.0), so the
// fire's audible presence grows/shrinks with fuel.
const CAMPFIRE_VOLUME = 0.8


// MARK: setupCampfire
/**
 * Spawn the placeholder campfire at the geometric center of the scene,
 * slightly raised so the base sits above the paint plane.
 */
export function setupCampfire(): void {
	// Root entity carries the world position + audio; children carry
	// the two split GLBs so the flame can scale independently.
	const root = engine.addEntity()
	Transform.create(root, {
		position: Vector3.create(CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Y, CAMPFIRE_WORLD_Z),
	})

	const base = engine.addEntity()
	Transform.create(base, { parent: root, position: Vector3.Zero() })
	GltfContainer.create(base, { src: CAMPFIRE_BASE_MODEL })

	const flame = engine.addEntity()
	Transform.create(flame, { parent: root, position: Vector3.Zero() })
	GltfContainer.create(flame, { src: CAMPFIRE_FLAME_MODEL })

	// Spatial crackle: global=false makes the SDK attenuate by distance
	// from this entity's Transform, so the fire sound naturally fades as
	// the player wanders away from the melt ring and swells on return.
	AudioSource.create(root, {
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

	// Tier-scaled visuals + audio. Flame scale SNAPS on tier change
	// (feels punchy - a growing GLB reads as morphing). Volume lerps
	// every frame off the hearthFuel volume curve, which is already
	// smoothed by the client-side fuel lerp.
	let lastTier = -1
	engine.addSystem(() => {
		const tier = getMainFireTier()
		if (tier !== lastTier) {
			const s = getMainFireFlameScale()
			Transform.getMutable(flame).scale = Vector3.create(s, s, s)
			lastTier = tier
			console.log(`campfire: flame scale -> ${s.toFixed(2)}x (tier ${tier})`)
		}
		// Volume every frame - cheap (single float mutation) and stays
		// in sync with the smooth fuel lerp.
		AudioSource.getMutable(root).volume = CAMPFIRE_VOLUME * getMainFireVolume()
	})
}
