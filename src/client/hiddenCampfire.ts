/**
 * hiddenCampfire.ts — the second, buried campfire the player has to
 * find and ignite with a lit torch.
 *
 * Network model (server-authoritative):
 *   - Position: deterministic from the current cycle seed
 *     (shared/hiddenCampfire.getHiddenCampfireWorldPos). Server and
 *     every client compute the same tile locally, so no position sync
 *     is needed.
 *   - Lit/unlit: owned by the server. This client sends
 *     hiddenCampfireIgnite when the local player brings a lit torch
 *     into the ignite radius; server validates the seed, flips lit,
 *     and broadcasts hiddenCampfireState. All clients (including the
 *     igniter) react to the broadcast — never to the local trigger —
 *     so late-joiners hydrated on joinRoster look identical to
 *     everyone else.
 *
 * The lit state also opens up two gameplay signals used elsewhere:
 *   - isHiddenCampfireLit() + getHiddenCampfireWarmthQueryPos() feed
 *     the frost accumulation system so standing near the newly-lit
 *     fire thaws the player, just like the central bonfire.
 */

import {
	AudioSource,
	Entity,
	GltfContainer,
	Material,
	MeshRenderer,
	PBParticleSystem_BlendMode,
	ParticleSystem,
	Transform,
	engine,
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'

import { isTorchLit }                    from 'src/client/torchEquip'
import { CAMPFIRE_WORLD_Y }              from 'src/shared/campfire'
import {
	getHiddenCampfireSeed,
	getHiddenCampfireWorldPos,
	HIDDEN_IGNITE_RADIUS_M,
	HIDDEN_IGNITE_RADIUS_SQ_M,
} from 'src/shared/hiddenCampfire'
import { room } from 'src/shared/messages'


// MARK: Assets
const CAMPFIRE_MODEL  = 'assets/asset-packs/campfire/Fireplace_01/Fireplace_01.glb'
const CAMPFIRE_SFX    = 'assets/sounds/campfire.mp3'
const CAMPFIRE_VOLUME = 0.8


// MARK: Smoke tuning (see campfireSmoke.ts for the source of these values)
const SMOKE_ORIGIN_Y_OFFSET = 1.4
const SMOKE_CONE_ANGLE_DEG  = 12
const SMOKE_CONE_RADIUS_M   = 0.15
const SMOKE_RATE_PER_S      = 14
const SMOKE_MAX_PARTICLES   = 120
const SMOKE_LIFETIME_S      = 4.5


// MARK: State
let firePitEntity: Entity | null = null
let smokeEntity  : Entity | null = null
// Debug-only locator beam — a tall bright pillar over the pit so it's
// findable from anywhere in the scene while testing. Removed the frame
// the fire lights. DELETE THIS BLOCK (plus spawnDebugBeam + the
// engine.removeEntity call in applyLitVisuals) once the find-the-fire
// loop is playable without a locator.
let debugBeamEntity: Entity | null = null
const DEBUG_BEAM_ENABLED  = true
const DEBUG_BEAM_HEIGHT_M = 60
const DEBUG_BEAM_WIDTH_M  = 1.2
let worldX                        = 0
let worldZ                        = 0
let currentSeed                   = 0
let litLocal                      = false
// Debounce: don't spam ignite requests every frame while the player
// stands inside the trigger waiting for the server to acknowledge.
let ignitionRequested             = false


// MARK: spawnUnlitPit
function spawnUnlitPit(): void {
	if (firePitEntity !== null) return
	firePitEntity = engine.addEntity()
	Transform.create(firePitEntity, {
		position: Vector3.create(worldX, CAMPFIRE_WORLD_Y, worldZ),
	})
	GltfContainer.create(firePitEntity, { src: CAMPFIRE_MODEL })

	if (DEBUG_BEAM_ENABLED) spawnDebugBeam()
}


// MARK: spawnDebugBeam
/**
 * Bright emissive pillar centred on the pit so the tester can spot
 * the hidden campfire from anywhere in the playfield. Warm gold to
 * match the HUD accent. See DEBUG_BEAM_ENABLED for the on/off switch.
 */
function spawnDebugBeam(): void {
	if (debugBeamEntity !== null) return
	debugBeamEntity = engine.addEntity()
	Transform.create(debugBeamEntity, {
		position: Vector3.create(worldX, CAMPFIRE_WORLD_Y + DEBUG_BEAM_HEIGHT_M / 2, worldZ),
		scale   : Vector3.create(DEBUG_BEAM_WIDTH_M, DEBUG_BEAM_HEIGHT_M, DEBUG_BEAM_WIDTH_M),
	})
	MeshRenderer.setBox(debugBeamEntity)
	Material.setPbrMaterial(debugBeamEntity, {
		albedoColor  : Color4.create(1.00, 0.80, 0.30, 0.55),
		emissiveColor: Color4.create(1.00, 0.80, 0.30, 1.00),
		emissiveIntensity: 4,
	})
}


// MARK: applyLitVisuals
/**
 * Add the crackle audio + smoke plume that flip the pit into its lit
 * appearance. Idempotent — safe to call from every broadcast.
 */
function applyLitVisuals(): void {
	if (litLocal) return
	litLocal = true
	if (firePitEntity === null) spawnUnlitPit()

	AudioSource.createOrReplace(firePitEntity!, {
		audioClipUrl: CAMPFIRE_SFX,
		loop        : true,
		playing     : true,
		global      : false,
		volume      : CAMPFIRE_VOLUME,
	})

	if (smokeEntity === null) {
		smokeEntity = engine.addEntity()
		Transform.create(smokeEntity, {
			position: Vector3.create(worldX, CAMPFIRE_WORLD_Y + SMOKE_ORIGIN_Y_OFFSET, worldZ),
			rotation: Quaternion.Identity(),
		})
		ParticleSystem.create(smokeEntity, {
			shape                : ParticleSystem.Shape.Cone({
				angle : SMOKE_CONE_ANGLE_DEG,
				radius: SMOKE_CONE_RADIUS_M,
			}),
			rate                 : SMOKE_RATE_PER_S,
			maxParticles         : SMOKE_MAX_PARTICLES,
			lifetime             : SMOKE_LIFETIME_S,
			gravity              : -0.15,
			initialVelocitySpeed : { start: 0.6, end: 1.2 },
			additionalForce      : Vector3.create(0.15, 0, 0.05),
			initialSize          : { start: 0.4, end: 0.7 },
			sizeOverTime         : { start: 1.6, end: 2.4 },
			initialColor         : {
				start: Color4.create(0.60, 0.58, 0.55, 0.70),
				end  : Color4.create(0.68, 0.66, 0.63, 0.60),
			},
			colorOverTime        : {
				start: Color4.create(0.78, 0.78, 0.78, 0.50),
				end  : Color4.create(0.90, 0.90, 0.92, 0.0),
			},
			blendMode            : PBParticleSystem_BlendMode.PSB_ALPHA,
			billboard            : true,
			loop                 : true,
			prewarm              : false,
		})
	}

	// Tear the locator beam down the moment the fire lights so a
	// tester can visually confirm the ignition triggered.
	if (debugBeamEntity !== null) {
		engine.removeEntity(debugBeamEntity)
		debugBeamEntity = null
	}

	console.log(`hiddenCampfire: lit (seed=${currentSeed}) at (${worldX.toFixed(1)}, ${worldZ.toFixed(1)})`)
}


// MARK: isHiddenCampfireLit
/** True once the server has broadcast lit=true for the current cycle. */
export function isHiddenCampfireLit(): boolean {
	return litLocal
}


// MARK: getHiddenCampfireWarmthPos
/**
 * World-space centre of the current cycle's hidden campfire. Consumers
 * (e.g. the frost accumulation system) can range-check against this
 * only when isHiddenCampfireLit() is true.
 */
export function getHiddenCampfireWarmthPos(): { x: number; z: number } {
	return { x: worldX, z: worldZ }
}


// MARK: setupHiddenCampfire
/**
 * Spawn the unlit pit at the current cycle position, subscribe to the
 * server's authoritative state, and poll for the local trigger.
 */
export function setupHiddenCampfire(): void {
	const pos    = getHiddenCampfireWorldPos()
	worldX       = pos.x
	worldZ       = pos.z
	currentSeed  = getHiddenCampfireSeed()
	console.log(
		`hiddenCampfire: setupHiddenCampfire: seed=${currentSeed} ` +
		`tile=(${pos.tx},${pos.tz}) world=(${worldX.toFixed(1)},${worldZ.toFixed(1)})`
	)
	spawnUnlitPit()

	// Authoritative state stream. The server sends this on joinRoster
	// (hydration) and again on every accepted ignite.
	room.onMessage('hiddenCampfireState', ({ seed, lit }) => {
		if (seed !== currentSeed) {
			// Cycle rolled while we were running. Not yet handled — no
			// regen logic in this pass. Ignore stale state.
			return
		}
		if (lit) applyLitVisuals()
	})

	// Poll for the local trigger. Cheap: two Transform reads + one
	// squared distance check. We stop sending once lit or once we've
	// already requested (debounced) to avoid room spam.
	engine.addSystem((_dt: number) => {
		if (litLocal) return
		if (ignitionRequested) return
		if (!isTorchLit()) return
		const t = Transform.getOrNull(engine.PlayerEntity)
		if (!t) return
		const dx = t.position.x - worldX
		const dz = t.position.z - worldZ
		if (dx * dx + dz * dz > HIDDEN_IGNITE_RADIUS_SQ_M) return

		ignitionRequested = true
		console.log(
			`hiddenCampfire: player entered ignite radius (${HIDDEN_IGNITE_RADIUS_M} m) ` +
			`with lit torch — requesting ignition from server (seed=${currentSeed})`
		)
		room.send('hiddenCampfireIgnite', { seed: currentSeed })
	})
}
