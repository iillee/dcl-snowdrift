/**
 * campfire.ts — campfire visual at scene center.
 *
 * The log pile is a GLB. The flame is a five-plane cluster
 * (flameBillboards). Crackle audio, and a point light whose range
 * tracks the fuel tier.
 *
 * Late joiners were losing the GLB/flame under asset contention: this
 * module claims the model early, retries failed loads, and re-applies
 * flame scale whenever fuel changes (not only on tier crossings).
 */

import {
	AudioSource,
	Entity,
	GltfContainer,
	GltfContainerLoadingState,
	LoadingState,
	Transform,
	engine,
} from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Y, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'

import { createFlameRig } from 'src/client/flameBillboards'
import { hearthLightParams, nearestLitFireIndex, syncPointLight } from 'src/client/fireLight'
import {
	getMainFireFlameScale,
	getMainFireFuel,
	getMainFireTier,
	getMainFireVolume,
} from 'src/client/hearthFuel'
import { collectLitCampfirePositions } from 'src/client/hiddenCampfire'


// Base logs only. The flame scales on its own rig, so a tier change
// does not shrink the pile.
const CAMPFIRE_BASE_MODEL = 'assets/asset-packs/campfire/Fireplace_01/Fireplace_base.glb'
const CAMPFIRE_SFX        = 'assets/sounds/campfire.mp3'
// Volume at zero distance. DCL attenuates with distance automatically
// when global=false, so this is the "standing on the fire" ceiling.
// Multiplied by the tier crackle step. Writes happen on volume change
// only: touching AudioSource every frame restarts the loop.
const CAMPFIRE_VOLUME = 0.8
/** Local Y of the hearth point light, above the log pile. */
const HEARTH_LIGHT_Y  = 1.4
/** How long the base GLB may sit in LOADING before we recreate it. */
const GLB_STUCK_MS    = 8000
/** Minimum gap between GLB recreate attempts. */
const GLB_RETRY_MS    = 2000


// MARK: setupCampfire
/**
 * Spawn the campfire at the geometric center of the scene,
 * slightly raised so the base sits above the paint plane.
 */
export function setupCampfire(): void {
	// Root entity carries the world position + audio; children carry
	// the log pile. The flame cluster is a sibling of the logs.
	const root = engine.addEntity()
	Transform.create(root, {
		position: Vector3.create(CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Y, CAMPFIRE_WORLD_Z),
	})

	const base = engine.addEntity()
	Transform.create(base, { parent: root, position: Vector3.Zero() })
	GltfContainer.create(base, { src: CAMPFIRE_BASE_MODEL })

	const flame = createFlameRig(root)
	flame.setScale(getMainFireFlameScale())

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

	let lastTier       = -1
	let lastScale      = -1
	let lastVolume     = -1
	let spawnedAtMs    = Date.now()
	let nextRetryAtMs  = 0
	let glbReadyLogged = false

	engine.addSystem(() => {
		const tier  = getMainFireTier()
		const scale = getMainFireFlameScale()
		if (tier !== lastTier || scale !== lastScale) {
			flame.setScale(scale)
			lastTier  = tier
			lastScale = scale
			console.log(`campfire: tier ${tier} flame=${scale.toFixed(2)}x`)
		}

		const vol = CAMPFIRE_VOLUME * getMainFireVolume()
		if (vol !== lastVolume) {
			AudioSource.getMutable(root).volume = vol
			lastVolume = vol
			console.log(`campfire: crackle=${vol.toFixed(2)}`)
		}

		// Closest lit fire uses three shadow spots; other lit fires keep
		// one radial fill so they stay visible at a distance.
		const fuel    = getMainFireFuel()
		const nearest = nearestLitFireIndex(collectLitCampfirePositions())
		const radial  = fuel > 0 && nearest !== 0
		syncPointLight(light, hearthLightParams(radial ? fuel : 0))

		const ready = ensureBaseGlb(base, spawnedAtMs, nextRetryAtMs)
		if (ready.respawnedAtMs !== null) spawnedAtMs = ready.respawnedAtMs
		if (ready.nextRetryAtMs !== null) nextRetryAtMs = ready.nextRetryAtMs
		if (ready.finished && !glbReadyLogged) {
			glbReadyLogged = true
			console.log('campfire: setupCampfire: base GLB finished loading')
		}
	})

	console.log(
		`campfire: setupCampfire: spawned at ` +
		`(${CAMPFIRE_WORLD_X.toFixed(1)}, ${CAMPFIRE_WORLD_Y.toFixed(1)}, ${CAMPFIRE_WORLD_Z.toFixed(1)})`
	)
}


// MARK: ensureBaseGlb
/**
 * Recreate the fireplace GLB when the Explorer fails or stalls the
 * first load — common for the second joiner under asset contention.
 */
function ensureBaseGlb(
	base         : Entity,
	spawnedAtMs  : number,
	nextRetryAtMs: number,
): { finished: boolean; respawnedAtMs: number | null; nextRetryAtMs: number | null } {
	const st = GltfContainerLoadingState.getOrNull(base)
	if (st === null) {
		return { finished: false, respawnedAtMs: null, nextRetryAtMs: null }
	}
	if (st.currentState === LoadingState.FINISHED) {
		return { finished: true, respawnedAtMs: null, nextRetryAtMs: null }
	}

	const now = Date.now()
	const stuckLoading =
		(st.currentState === LoadingState.LOADING || st.currentState === LoadingState.UNKNOWN) &&
		now - spawnedAtMs >= GLB_STUCK_MS
	const failed =
		st.currentState === LoadingState.FINISHED_WITH_ERROR ||
		st.currentState === LoadingState.NOT_FOUND

	if (!stuckLoading && !failed) {
		return { finished: false, respawnedAtMs: null, nextRetryAtMs: null }
	}
	if (now < nextRetryAtMs) {
		return { finished: false, respawnedAtMs: null, nextRetryAtMs: null }
	}

	console.log(
		`campfire: ensureBaseGlb: recreating Fireplace_base.glb (state=${st.currentState})`
	)
	GltfContainer.createOrReplace(base, { src: CAMPFIRE_BASE_MODEL })
	return { finished: false, respawnedAtMs: now, nextRetryAtMs: now + GLB_RETRY_MS }
}
