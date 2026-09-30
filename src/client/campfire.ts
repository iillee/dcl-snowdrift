/**
 * campfire.ts - placeholder campfire visual at scene center.
 *
 * Cosmetic: split GLBs for base + flame, crackle audio, and a point
 * light whose range tracks the melt ring.
 */

import { AudioSource, GltfContainer, Transform, engine } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Y, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'

import { hearthLightParams, syncPointLight } from 'src/client/fireLight'
import {
	getMainFireFlameScale,
	getMainFireFuel,
	getMainFireTier,
	getMainFireVolume,
} from 'src/client/hearthFuel'


// Split GLBs (base logs + flame) so we can scale ONLY the flame on
// tier change. Scaling the whole model shrinks the log pile too,
// which reads as the fire physically shrinking rather than dimming.
const CAMPFIRE_BASE_MODEL  = 'assets/asset-packs/campfire/Fireplace_01/Fireplace_base.glb'
const CAMPFIRE_FLAME_MODEL = 'assets/asset-packs/campfire/Fireplace_01/Fireplace_flame.glb'
const CAMPFIRE_SFX         = 'assets/sounds/campfire.mp3'
// Volume at zero distance. DCL attenuates with distance automatically
// when global=false, so this is the "standing on the fire" ceiling.
	// Now MULTIPLIED by the tier crackle step, so the fire's audible
	// presence changes with the tier. Writes happen on the tier change
	// only: touching AudioSource every frame restarts the loop.
const CAMPFIRE_VOLUME = 0.8
/** Local Y of the hearth point light, above the log pile. */
const HEARTH_LIGHT_Y  = 1.4


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
		volume      : CAMPFIRE_VOLUME * getMainFireVolume(),
	})

	const light = engine.addEntity()
	Transform.create(light, {
		parent  : root,
		position: Vector3.create(0, HEARTH_LIGHT_Y, 0),
	})
	syncPointLight(light, hearthLightParams(getMainFireFuel()))

	// Relight is handled entirely by torchInput.ts: press E anywhere
	// inside the campfire heat ring. Proximity-only — no pointer/aim
	// required. The old pointerEventsSystem hook on this GLB was
	// removed because it forced the player to look at the fire.

	// Tier-scaled visuals + audio. Flame, crackle, and the light step
	// together. Crackle is written only when the tier changes. A
	// per-frame AudioSource write restarts the loop.
	let lastTier = -1
	engine.addSystem(() => {
		const tier = getMainFireTier()
		if (tier !== lastTier) {
			const s = getMainFireFlameScale()
			Transform.getMutable(flame).scale = Vector3.create(s, s, s)
			const vol = CAMPFIRE_VOLUME * getMainFireVolume()
			AudioSource.getMutable(root).volume = vol
			lastTier = tier
			console.log(
				`campfire: tier ${tier} flame=${s.toFixed(2)}x crackle=${vol.toFixed(2)}`
			)
		}
		syncPointLight(light, hearthLightParams(getMainFireFuel()))
	})
}
