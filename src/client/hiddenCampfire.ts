/**
 * hiddenCampfire.ts — the three buried bonfires the player has to
 * find and ignite with a lit torch.
 *
 * Network model (server-authoritative):
 *   - Position: deterministic from the current cycle seed
 *     (shared/hiddenCampfire.getHiddenCampfireWorldPositions). Server
 *     and every client compute the same tuple locally, so no position
 *     sync is needed — the server only owns lit/unlit per index.
 *   - Lit/unlit: owned by the server per index. This client sends
 *     hiddenCampfireIgnite { seed, index } when the local player
 *     brings a lit torch into the ignite radius of a specific pit;
 *     server validates seed + index, flips lit[index], and broadcasts
 *     hiddenCampfireState { seed, index, lit }. All clients (including
 *     the igniter) react to the broadcast — never to the local trigger
 *     — so late-joiners hydrated on joinRoster look identical to
 *     everyone else.
 *
 * Downstream signals:
 *   - isHiddenCampfireLit() + getHiddenCampfireWarmthPositions() feed
 *     the frost accumulation system so standing near ANY lit fire
 *     thaws the player, just like the central bonfire.
 *   - isInHiddenRelightRange() feeds the torch relight prompt.
 *   - isReadyToIgniteHidden() + requestHiddenIgnite() drive the
 *     ignition prompt + the E-key ignite path.
 */

import {
	AudioSource,
	Billboard,
	BillboardMode,
	Entity,
	GltfContainer,
	Material,
	MaterialTransparencyMode,
	MeshRenderer,
	PBParticleSystem_BlendMode,
	ParticleSystem,
	Transform,
	engine,
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'

import { isTorchLit }                    from 'src/client/torchEquip'
import { CAMPFIRE_RELIGHT_RADIUS_SQ_M, CAMPFIRE_WORLD_Y } from 'src/shared/campfire'
import {
	getHiddenCampfireSeed,
	getHiddenCampfireWorldPositions,
	HIDDEN_CAMPFIRE_COUNT,
	HIDDEN_IGNITE_RADIUS_M,
	HIDDEN_IGNITE_RADIUS_SQ_M,
} from 'src/shared/hiddenCampfire'
import { room } from 'src/shared/messages'


// MARK: Assets
const CAMPFIRE_BASE_MODEL  = 'assets/asset-packs/campfire/Fireplace_01/Fireplace_base.glb'
const CAMPFIRE_FLAME_MODEL = 'assets/asset-packs/campfire/Fireplace_01/Fireplace_flame.glb'
const CAMPFIRE_SFX         = 'assets/sounds/campfire.mp3'
const CAMPFIRE_VOLUME      = 0.8


// MARK: Smoke tuning (see campfireSmoke.ts for the source of these values)
const SMOKE_ORIGIN_Y_OFFSET = 1.4
const SMOKE_CONE_ANGLE_DEG  = 12
const SMOKE_CONE_RADIUS_M   = 0.15
const SMOKE_RATE_PER_S      = 14
const SMOKE_MAX_PARTICLES   = 120
const SMOKE_LIFETIME_S      = 4.5


// MARK: Locator beacon config
// Twin-billboard gold pillar centred on each unlit pit so players can
// find the hidden bonfires from anywhere in the playfield. Same visual
// language as flagtag's flag beacon (inner + outer plane, pulsing
// scale, emissive gold), reusing the shared beacon-gradient /
// beacon-alpha textures already shipped in assets/images/.
const BEACON_ENABLED       = true
const BEACON_GRADIENT_TEX  = 'assets/images/beacon-gradient.png'
const BEACON_ALPHA_TEX     = 'assets/images/beacon-alpha.png'
const BEACON_HEIGHT_M      = 110
const BEACON_Y_OFFSET_M    = 2.0
const BEACON_INNER_WIDTH_M = 0.5
const BEACON_OUTER_WIDTH_M = 2.0
const BEACON_INNER_ALPHA   = 0.70
const BEACON_OUTER_ALPHA   = 0.35
const BEACON_EMISSIVE_IN   = 3.0
const BEACON_EMISSIVE_OUT  = 2.0
const BEACON_PULSE_SPEED   = 2.5
const BEACON_PULSE_RANGE   = 0.15
const BEACON_COLOR         = { r: 1.0, g: 0.84, b: 0.0 }


// MARK: Per-fire state (all arrays length HIDDEN_CAMPFIRE_COUNT)
const firePitEntity     : (Entity | null)[] = new Array(HIDDEN_CAMPFIRE_COUNT).fill(null)
const flameEntity       : (Entity | null)[] = new Array(HIDDEN_CAMPFIRE_COUNT).fill(null)
const smokeEntity       : (Entity | null)[] = new Array(HIDDEN_CAMPFIRE_COUNT).fill(null)
const beaconInnerEntity : (Entity | null)[] = new Array(HIDDEN_CAMPFIRE_COUNT).fill(null)
const beaconOuterEntity : (Entity | null)[] = new Array(HIDDEN_CAMPFIRE_COUNT).fill(null)
const worldX            : number[]          = new Array(HIDDEN_CAMPFIRE_COUNT).fill(0)
const worldZ            : number[]          = new Array(HIDDEN_CAMPFIRE_COUNT).fill(0)
const litLocal          : boolean[]         = new Array(HIDDEN_CAMPFIRE_COUNT).fill(false)
// Debounce: don't spam ignite requests while the player stands inside a
// pit's trigger waiting for the server's broadcast to come back.
const ignitionRequested : boolean[]         = new Array(HIDDEN_CAMPFIRE_COUNT).fill(false)
let   beaconPulseTime                       = 0
let   currentSeed                           = 0


// MARK: spawnUnlitPit
function spawnUnlitPit(index: number): void {
	if (firePitEntity[index] !== null) return
	const e = engine.addEntity()
	firePitEntity[index] = e
	Transform.create(e, {
		position: Vector3.create(worldX[index], CAMPFIRE_WORLD_Y, worldZ[index]),
	})
	GltfContainer.create(e, { src: CAMPFIRE_BASE_MODEL })

	if (BEACON_ENABLED) spawnLocatorBeacon(index)
}


// MARK: spawnLocatorBeacon
/**
 * Two Y-billboarded planes stacked over a pit — narrow bright core
 * inside a wider soft halo — using the same gradient + alpha textures
 * flagtag's flag beacon uses. A companion system pulses their scale
 * every frame until the fire lights, at which point removeLocatorBeacon
 * tears them down.
 */
function spawnLocatorBeacon(index: number): void {
	if (beaconInnerEntity[index] !== null) return

	const gradient = Material.Texture.Common({ src: BEACON_GRADIENT_TEX })
	const alpha    = Material.Texture.Common({ src: BEACON_ALPHA_TEX })
	const c        = BEACON_COLOR
	const yCentre  = CAMPFIRE_WORLD_Y + BEACON_Y_OFFSET_M + BEACON_HEIGHT_M / 2

	const inner = engine.addEntity()
	beaconInnerEntity[index] = inner
	Transform.create(inner, {
		position: Vector3.create(worldX[index], yCentre, worldZ[index]),
		scale   : Vector3.create(BEACON_INNER_WIDTH_M, BEACON_HEIGHT_M, 1),
	})
	MeshRenderer.setPlane(inner)
	Billboard.create(inner, { billboardMode: BillboardMode.BM_Y })
	Material.setPbrMaterial(inner, {
		texture          : gradient,
		alphaTexture     : alpha,
		albedoColor      : Color4.create(c.r, c.g, c.b, BEACON_INNER_ALPHA),
		emissiveColor    : Color3.create(c.r, c.g, c.b),
		emissiveIntensity: BEACON_EMISSIVE_IN,
		transparencyMode : MaterialTransparencyMode.MTM_AUTO,
		castShadows      : false,
	})

	const outer = engine.addEntity()
	beaconOuterEntity[index] = outer
	Transform.create(outer, {
		position: Vector3.create(worldX[index], yCentre, worldZ[index]),
		scale   : Vector3.create(BEACON_OUTER_WIDTH_M, BEACON_HEIGHT_M, 1),
	})
	MeshRenderer.setPlane(outer)
	Billboard.create(outer, { billboardMode: BillboardMode.BM_Y })
	Material.setPbrMaterial(outer, {
		texture          : gradient,
		alphaTexture     : alpha,
		albedoColor      : Color4.create(c.r, c.g, c.b, BEACON_OUTER_ALPHA),
		emissiveColor    : Color3.create(c.r, c.g, c.b),
		emissiveIntensity: BEACON_EMISSIVE_OUT,
		transparencyMode : MaterialTransparencyMode.MTM_AUTO,
		castShadows      : false,
	})
}


// MARK: removeLocatorBeacon
function removeLocatorBeacon(index: number): void {
	const inner = beaconInnerEntity[index]
	if (inner !== null) {
		engine.removeEntity(inner)
		beaconInnerEntity[index] = null
	}
	const outer = beaconOuterEntity[index]
	if (outer !== null) {
		engine.removeEntity(outer)
		beaconOuterEntity[index] = null
	}
}


// MARK: applyLitVisuals
/**
 * Add the flame model, crackle audio + smoke plume for `index`, and
 * tear down its locator beacon. Idempotent — safe to call from every
 * broadcast.
 */
function applyLitVisuals(index: number): void {
	if (litLocal[index]) return
	litLocal[index] = true
	if (firePitEntity[index] === null) spawnUnlitPit(index)
	const pit = firePitEntity[index]!

	// Flame is a separate GLB parented to the pit so it only appears
	// once the server has confirmed ignition. Parenting keeps it
	// colocated even if we ever move the pit.
	if (flameEntity[index] === null) {
		const flame = engine.addEntity()
		flameEntity[index] = flame
		Transform.create(flame, {
			position: Vector3.Zero(),
			parent  : pit,
		})
		GltfContainer.create(flame, { src: CAMPFIRE_FLAME_MODEL })
	}

	// Match src/client/campfire.ts's proven `create` (not `createOrReplace`)
	// shape — the central bonfire uses this exact call and consistently
	// plays. Safe here because the pit entity is spawned without an
	// AudioSource component and applyLitVisuals is idempotent-guarded
	// above (litLocal early-out).
	AudioSource.create(pit, {
		audioClipUrl: CAMPFIRE_SFX,
		loop        : true,
		playing     : true,
		global      : false,
		volume      : CAMPFIRE_VOLUME,
	})

	if (smokeEntity[index] === null) {
		const smoke = engine.addEntity()
		smokeEntity[index] = smoke
		Transform.create(smoke, {
			position: Vector3.create(worldX[index], CAMPFIRE_WORLD_Y + SMOKE_ORIGIN_Y_OFFSET, worldZ[index]),
			rotation: Quaternion.Identity(),
		})
		ParticleSystem.create(smoke, {
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

	// Tear the locator beacon down the moment the fire lights so the
	// pillar is instant visual confirmation the ignition triggered.
	removeLocatorBeacon(index)

	console.log(
		`hiddenCampfire[${index}]: lit (seed=${currentSeed}) at ` +
		`(${worldX[index].toFixed(1)}, ${worldZ[index].toFixed(1)})`,
	)
}


// MARK: getReadyIgniteIndex
/**
 * Return the index of a hidden bonfire the local player could ignite
 * right now (torch lit + inside its ignite radius + not already lit or
 * requested), or -1 if none qualify. If multiple qualify (rare — the
 * ignite radii are 3 m and pits are separated by at least 32 m), we
 * pick the closest.
 */
function getReadyIgniteIndex(): number {
	if (!isTorchLit()) return -1
	const t = Transform.getOrNull(engine.PlayerEntity)
	if (t === null) return -1
	let bestIndex = -1
	let bestD2    = HIDDEN_IGNITE_RADIUS_SQ_M
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
		if (litLocal[i]) continue
		if (ignitionRequested[i]) continue
		const dx = t.position.x - worldX[i]
		const dz = t.position.z - worldZ[i]
		const d2 = dx * dx + dz * dz
		if (d2 <= bestD2) {
			bestD2    = d2
			bestIndex = i
		}
	}
	return bestIndex
}


// MARK: isReadyToIgniteHidden
/**
 * True when a local E-press should be treated as a hidden-bonfire
 * ignition attempt on ANY of the three pits. Consumed by torchInput
 * and the ignite prompt layer.
 */
export function isReadyToIgniteHidden(): boolean {
	return getReadyIgniteIndex() !== -1
}


// MARK: requestHiddenIgnite
/**
 * Fire the ignite request at the server for whichever pit the local
 * player is currently standing next to. Debounced per-index so
 * repeated E-presses while waiting for the broadcast don't spam the
 * room. No-op if no pit qualifies.
 */
export function requestHiddenIgnite(): void {
	const index = getReadyIgniteIndex()
	if (index === -1) return
	ignitionRequested[index] = true
	console.log(
		`hiddenCampfire[${index}]: requestHiddenIgnite: player E-pressed in ignite radius ` +
		`(${HIDDEN_IGNITE_RADIUS_M} m) with lit torch — requesting ignition ` +
		`from server (seed=${currentSeed})`,
	)
	room.send('hiddenCampfireIgnite', { seed: currentSeed, index })
}


// MARK: isInHiddenRelightRange
/**
 * True when at least one lit hidden bonfire has the player inside its
 * relight radius. Same radius as the central bonfire so every fire
 * feels identical once discovered. Consumed by torchInput (E-press
 * top-off) and the relight prompt layer (affordance hint visibility).
 */
export function isInHiddenRelightRange(): boolean {
	const t = Transform.getOrNull(engine.PlayerEntity)
	if (t === null) return false
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
		if (!litLocal[i]) continue
		const dx = t.position.x - worldX[i]
		const dz = t.position.z - worldZ[i]
		if (dx * dx + dz * dz <= CAMPFIRE_RELIGHT_RADIUS_SQ_M) return true
	}
	return false
}


// MARK: isHiddenCampfireLit
/**
 * True once the server has broadcast lit=true for AT LEAST ONE hidden
 * bonfire in the current cycle. Frost accumulation uses this as an
 * "is there any additional warmth in the world" gate.
 */
export function isHiddenCampfireLit(): boolean {
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
		if (litLocal[i]) return true
	}
	return false
}


// MARK: getHiddenCampfireWarmthPositions
/**
 * World-space centres of every CURRENTLY LIT hidden bonfire. Frost
 * accumulation iterates and treats any point within CAMPFIRE_MELT_RADIUS_M
 * of any entry as inside a warm ring.
 */
export function getHiddenCampfireWarmthPositions(): { x: number; z: number }[] {
	const out: { x: number; z: number }[] = []
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
		if (litLocal[i]) out.push({ x: worldX[i], z: worldZ[i] })
	}
	return out
}


// MARK: setupHiddenCampfire
/**
 * Spawn the three unlit pits at the current cycle positions, subscribe
 * to the server's authoritative state, and start the beacon pulse.
 */
export function setupHiddenCampfire(): void {
	const positions = getHiddenCampfireWorldPositions()
	currentSeed = getHiddenCampfireSeed()
	console.log(`hiddenCampfire: setupHiddenCampfire: seed=${currentSeed} count=${HIDDEN_CAMPFIRE_COUNT}`)
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
		worldX[i] = positions[i].x
		worldZ[i] = positions[i].z
		console.log(
			`hiddenCampfire[${i}]: tile=(${positions[i].tx},${positions[i].tz}) ` +
			`world=(${worldX[i].toFixed(1)},${worldZ[i].toFixed(1)})`,
		)
		spawnUnlitPit(i)
	}

	// Authoritative state stream. The server sends one message per
	// index on joinRoster (hydration) and again on every accepted
	// ignite. lit arrives as 0/1 (see shared/messages.ts — Schemas.Boolean
	// did not marshal through room.send in practice, so this channel
	// encodes as Int).
	room.onMessage('hiddenCampfireState', ({ seed, index, lit }) => {
		console.log(
			`hiddenCampfire: onMessage hiddenCampfireState ` +
			`seed=${seed} index=${index} lit=${lit} (currentSeed=${currentSeed})`,
		)
		if (seed !== currentSeed) {
			// Cycle rolled while we were running. Not yet handled — no
			// regen logic in this pass. Ignore stale state.
			return
		}
		if (index < 0 || index >= HIDDEN_CAMPFIRE_COUNT) {
			console.log(`hiddenCampfire: dropping state with bad index ${index}`)
			return
		}
		if (lit === 1) applyLitVisuals(index)
	})

	// Locator beacon pulse. Runs every frame until every fire lights;
	// the early-outs keep the cost to a tight loop once beacons are
	// gone. Mirrors flagtag's beaconClientSystem: inner scales up as
	// outer scales down (2 - pulse) so the two halos breathe together.
	engine.addSystem((dt: number) => {
		beaconPulseTime += dt
		const pulse = 1 + BEACON_PULSE_RANGE * Math.sin(beaconPulseTime * BEACON_PULSE_SPEED)
		for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
			const inner = beaconInnerEntity[i]
			const outer = beaconOuterEntity[i]
			if (inner === null || outer === null) continue
			const innerT = Transform.getMutable(inner)
			innerT.scale = Vector3.create(BEACON_INNER_WIDTH_M * pulse, BEACON_HEIGHT_M, 1)
			const outerT = Transform.getMutable(outer)
			outerT.scale = Vector3.create(BEACON_OUTER_WIDTH_M * (2 - pulse), BEACON_HEIGHT_M, 1)
		}
	})
}
