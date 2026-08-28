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

import { playSurgeSfxAt } from 'src/client/audio'
import { onCycleSeedChange } from 'src/client/cycle'
import { isTorchLit }                    from 'src/client/torchEquip'
import { CAMPFIRE_RELIGHT_RADIUS_SQ_M, CAMPFIRE_WORLD_Y } from 'src/shared/campfire'
import { hearthFlameScaleFromFuel, hearthTierFromFuel } from 'src/shared/hearthFuel'
import {
	BillboardHandle, destroyHearthBillboard, spawnHearthBillboard,
} from 'src/client/hearthBillboard'
import { getHearthPlayerCount, getHiddenFireFuel, getHiddenFireMeltRadius } from 'src/client/hearthFuel'
import {
	getHiddenCampfireSeed,
	getHiddenCampfireWorldPositions,
	getHiddenCampfireWorldPositionsForSeed,
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
// Hidden pits are now discovered by exploration alone — the locator
// beacons made the search trivial once you knew what they looked like.
// Flip back to true if we ever want to reintroduce a hint mode.
// Temporarily re-enabled while we rework waypoint placement for the
// pilgrimage pivot (docs/gameloop-vision.md §16) — the gold pillars
// give a visible reference for judging distances between the central
// hearth, hidden fires, waypoints, and the outskirts camp. Flip back
// to false before deploy.
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
const billboardHandle   : (BillboardHandle | null)[] = new Array(HIDDEN_CAMPFIRE_COUNT).fill(null)
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


// MARK: applyUnlitVisuals
/**
 * Tear down the lit visuals for pit `index` — flame model, smoke
 * plume, crackle audio — and respawn its locator beacon. Called on
 * cycle rollover so previously-lit pits return to their unlit state
 * before we relocate them to the new cycle's positions.
 */
function applyUnlitVisuals(index: number): void {
	litLocal[index]          = false
	ignitionRequested[index] = false

	// Tear the flame child down first — removing the parent pit later
	// would orphan the child on the engine's next tick.
	const flame = flameEntity[index]
	if (flame !== null) {
		engine.removeEntity(flame)
		flameEntity[index] = null
	}
	const smoke = smokeEntity[index]
	if (smoke !== null) {
		engine.removeEntity(smoke)
		smokeEntity[index] = null
	}
	// Fuel-bar billboard is spawned in applyLitVisuals; tear it down
	// symmetrically here so a snuff (or cycle roll) leaves no bar
	// lingering above a dead pit.
	destroyHearthBillboard(billboardHandle[index])
	billboardHandle[index] = null
	// Remove AudioSource from the pit entity so a re-ignition later this
	// cycle doesn't stack a second AudioSource on top. AudioSource has
	// no explicit delete API in ECS terms — the cleanest way is to
	// remove and respawn the pit entity itself, which we do below in
	// relocatePit().

	if (BEACON_ENABLED) spawnLocatorBeacon(index)

	console.log(`hiddenCampfire[${index}]: unlit visuals torn down`)
}


// MARK: relocatePit
/**
 * Move (or respawn) pit `index` to its current stored worldX/worldZ.
 * Called on cycle rollover after the new positions have been written.
 * We fully destroy + recreate the pit entity instead of mutating its
 * Transform, so any lingering components (e.g. AudioSource from the
 * previous lit state) come off clean.
 */
function relocatePit(index: number): void {
	const old = firePitEntity[index]
	if (old !== null) {
		engine.removeEntity(old)
		firePitEntity[index] = null
	}
	spawnUnlitPit(index)
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

	// Ignition surge: 3D-positional whoosh at the pit so nearby players
	// hear the fire come to life. Fires on the unlit -> lit transition
	// only (litLocal early-out above guarantees idempotency).
	playSurgeSfxAt(Vector3.create(worldX[index], CAMPFIRE_WORLD_Y, worldZ[index]))
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

	// Spawn a fuel-bar billboard above this pit. Captures `index` in
	// the closure so it reads THIS pit's live fuel; disposed in
	// applyUnlitVisuals when the fire snuffs.
	if (billboardHandle[index] === null) {
		billboardHandle[index] = spawnHearthBillboard(
			worldX[index], CAMPFIRE_WORLD_Y, worldZ[index],
			() => getHiddenFireFuel(index),
			getHearthPlayerCount,
		)
	}

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
 * World-space centres of every CURRENTLY LIT hidden bonfire, each
 * annotated with its live melt radius squared (m^2). Frost accumulation
 * iterates and treats any point within `radiusSq` of an entry as inside
 * that pit's warm ring. Radius grows/shrinks per fuel tier just like the
 * main hearth (see hearthFuel.getHiddenFireMeltRadius). Previously this
 * returned only positions and the caller compared against a static
 * CAMPFIRE_MELT_RADIUS_SQ_M, which meant maxed-out hidden pits still
 * chilled the player at the edges of their VISIBLE melt ring.
 */
export function getHiddenCampfireWarmthPositions(): { x: number; z: number; radiusSq: number }[] {
	const out: { x: number; z: number; radiusSq: number }[] = []
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
		if (!litLocal[i]) continue
		const r = getHiddenFireMeltRadius(i)
		out.push({ x: worldX[i], z: worldZ[i], radiusSq: r * r })
	}
	return out
}


// MARK: getLitHiddenFires
/**
 * World-space centre + index of every currently-lit hidden bonfire.
 * Consumed by logsInventory.pickFeedTarget to route F-key feeds to
 * the closest hidden fire when the player is standing at one.
 */
export function getLitHiddenFires(): { index: number; x: number; z: number }[] {
	const out: { index: number; x: number; z: number }[] = []
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
		if (litLocal[i]) out.push({ index: i, x: worldX[i], z: worldZ[i] })
	}
	return out
}


// MARK: onCycleRoll
/**
 * Wipe every pit's lit state, move them to the new cycle's positions,
 * and respawn beacons. Registered with the client cycle module so it
 * fires on hydration AND on every subsequent rollover.
 */
function handleCycleSeedChange(newSeed: number): void {
	const oldSeed = currentSeed
	// Hydration path: cycle.ts fires onCycleSeedChange unconditionally on
	// the FIRST cycleState arrival, even when the server's seed matches
	// the local Date.now()-derived seed we already booted with. In that
	// case setupHiddenCampfire has already spawned the pits at the right
	// positions and hiddenCampfireState broadcasts may have already lit
	// some of them. Wiping here would strip those lit visuals (flame,
	// audio, smoke) and respawn the beacons, leaving the player looking
	// at unlit pits with permanent melted-frost rings and no re-broadcast
	// coming from the server (nothing changed on its end).
	if (newSeed === oldSeed) {
		console.log(
			`hiddenCampfire: cycle hydration confirmed seed=${newSeed} — ` +
			`preserving existing lit state (${HIDDEN_CAMPFIRE_COUNT} pits)`,
		)
		return
	}
	currentSeed = newSeed
	const positions = getHiddenCampfireWorldPositionsForSeed(newSeed)
	console.log(
		`hiddenCampfire: cycle roll old=${oldSeed} → new=${newSeed} — ` +
		`resetting ${HIDDEN_CAMPFIRE_COUNT} pits`,
	)
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
		// Update positions FIRST. applyUnlitVisuals() below respawns the
		// locator beacon, and spawnLocatorBeacon reads worldX/worldZ at
		// call time — if we update after, the beacon lands at the old
		// cycle's coordinates and the pit (spawned later in relocatePit)
		// lands at the new ones, leaving orphan beacons floating over
		// empty snow.
		worldX[i] = positions[i].x
		worldZ[i] = positions[i].z
		removeLocatorBeacon(i)
		applyUnlitVisuals(i)
		relocatePit(i)
	}
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
		if (lit === 1) {
			applyLitVisuals(index)
		} else {
			// lit=0 = snuff (fuel exhausted). Tear down flame + smoke +
			// audio + billboard, then respawn the pit entity so a future
			// re-ignition this cycle starts from a clean audio-less state.
			applyUnlitVisuals(index)
			relocatePit(index)
		}
	})

	// Cycle rollover. Fires on hydration (first cycleState arrival)
	// AND on every subsequent midnight-UTC roll. Handler resets lit
	// state, moves pits, respawns beacons — the server's
	// hiddenCampfireState broadcasts that follow will re-light any
	// pits that are still supposed to be lit in the new cycle (none,
	// on a real roll).
	onCycleSeedChange(({ newSeed }) => handleCycleSeedChange(newSeed))

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

	// Flame scale per hidden pit. Mirrors the main campfire's tier-snap
	// pattern (src/client/campfire.ts): only mutate the Transform on tier
	// change so a growing GLB reads as morphing, not a continuous
	// squishing lerp. Per-pit tier cache avoids scanning fuel every frame.
	const lastFlameTier: number[] = new Array(HIDDEN_CAMPFIRE_COUNT).fill(-1)
	engine.addSystem(() => {
		for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
			const flame = flameEntity[i]
			if (flame === null) {
				if (lastFlameTier[i] !== -1) lastFlameTier[i] = -1
				continue
			}
			const fuel = getHiddenFireFuel(i)
			const tier = hearthTierFromFuel(fuel)
			if (tier === lastFlameTier[i]) continue
			lastFlameTier[i] = tier
			const s = hearthFlameScaleFromFuel(fuel)
			const t = Transform.getMutableOrNull(flame)
			if (t !== null) t.scale = Vector3.create(s, s, s)
			console.log(`hiddenCampfire[${i}]: flame scale -> ${s.toFixed(2)}x (tier ${tier})`)
		}
	})
}
