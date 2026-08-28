/**
 * camp.ts — client-side spawn of the distant pilgrimage camp.
 *
 * Reuses the central-hearth visual (base + flame GLB + audio) plus a
 * standalone smoke plume. Always lit, always at max visual intensity —
 * this is a fixture of the world during its 24 h cycle, not a fuelable
 * fire. Later polish work (tents, lanterns, sign, warm-wind teleport)
 * lands on top of this baseline; see docs/gameloop-vision.md §16.
 *
 * Lifecycle:
 *   - setupCamp() called once from client bootstrap.
 *   - Camp position is derived deterministically from the current
 *     cycle seed via src/shared/camp.getCampWorldPosition(seed).
 *   - On onCycleSeedChange() the camp entities are torn down and
 *     respawned at the new position so a midnight-UTC rollover moves
 *     the camp to a fresh bearing without a client restart.
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

import { getCurrentCycleSeed, onCycleSeedChange } from 'src/client/cycle'
import { CAMP_MELT_RADIUS_SQ_M, getCampWorldPosition } from 'src/shared/camp'


// MARK: Assets (mirror src/client/campfire.ts)
const CAMP_BASE_MODEL  = 'assets/asset-packs/campfire/Fireplace_01/Fireplace_base.glb'
const CAMP_FLAME_MODEL = 'assets/asset-packs/campfire/Fireplace_01/Fireplace_flame.glb'
const CAMP_SFX         = 'assets/sounds/campfire.mp3'
const CAMP_VOLUME      = 0.8


// MARK: Smoke tuning (see src/client/campfireSmoke.ts for the source of these values)
// Camp is always at max visual intensity — no fuel scaling, so the
// smoke plume is a static "roaring hearth" preset rather than the
// tier-driven version the central fire uses.
const SMOKE_ORIGIN_Y      = 1.4
const SMOKE_CONE_ANGLE    = 12
const SMOKE_CONE_RADIUS   = 0.15
const SMOKE_RATE_PER_S    = 14
const SMOKE_MAX_PARTICLES = 120
const SMOKE_LIFETIME_S    = 4.5
const SMOKE_GRAVITY_MULT  = -0.15
const SMOKE_SPEED_MIN     = 0.6
const SMOKE_SPEED_MAX     = 1.2
const SMOKE_WIND          = Vector3.create(0.15, 0, 0.05)
const SMOKE_SIZE_START_MIN = 0.4
const SMOKE_SIZE_START_MAX = 0.7
const SMOKE_SIZE_END_MIN   = 1.6
const SMOKE_SIZE_END_MAX   = 2.4


// MARK: Locator beacon config
// Twin-billboard red pillar centred on the camp so pilgrims can pick
// the destination out of the fog from anywhere in the playfield. Same
// visual language as the hidden-fire gold beacons (inner bright core +
// outer soft halo, pulsing scale, emissive), retinted red to read as
// "destination" rather than "secret to find". Reuses the shared
// beacon-gradient / beacon-alpha textures already shipped for flagtag /
// hidden fires.
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
const BEACON_COLOR         = { r: 1.0, g: 0.15, b: 0.1 }


// MARK: Entities (rebuilt on every cycle roll)
let rootEntity        : Entity | null = null
let baseEntity        : Entity | null = null
let flameEntity       : Entity | null = null
let smokeEntity       : Entity | null = null
let beaconInnerEntity : Entity | null = null
let beaconOuterEntity : Entity | null = null
let beaconPulseTime                   = 0
let beaconSystemRegistered            = false


// MARK: Warmth position
// Live world XZ of the camp, kept in sync with the spawned entities so
// frost/accumulation can treat the camp as a warm-ring source without
// re-deriving the seed → position hash every sample tick. `null` until
// the first spawnCampAtSeed call in setupCamp.
let warmthX: number | null = null
let warmthZ: number | null = null


// MARK: getCampWarmth
/**
 * World-space centre of the currently-spawned camp + its squared warm
 * radius (m^2). Returns `null` before setupCamp has run. Consumed by
 * frost/accumulation.ts to thaw players standing inside the ring —
 * same treatment as the central hearth, since the camp is always lit.
 */
export function getCampWarmth(): { x: number; z: number; radiusSq: number } | null {
	if (warmthX === null || warmthZ === null) return null
	return { x: warmthX, z: warmthZ, radiusSq: CAMP_MELT_RADIUS_SQ_M }
}


// MARK: setupCamp
/**
 * Spawn the pilgrimage camp at the deterministic position derived from
 * the current cycle seed. Idempotent — safe to call once from client
 * bootstrap. Subscribes to onCycleSeedChange so the camp relocates on
 * midnight-UTC rollover without a client restart.
 */
export function setupCamp(): void {
	spawnCampAtSeed(getCurrentCycleSeed())

	onCycleSeedChange((info) => {
		console.log(`camp: onCycleSeedChange: seed=${info.newSeed} relocating camp`)
		despawnCamp()
		spawnCampAtSeed(info.newSeed)
	})

	// Beacon pulse. Registered once and left running — unlike the hidden
	// fires (which extinguish their beacons on ignite), the camp beacon
	// is permanent for the cycle. Early-outs when entities are null keep
	// the tick trivial between spawn / despawn windows.
	if (beaconSystemRegistered) return
	beaconSystemRegistered = true
	engine.addSystem((dt: number) => {
		if (beaconInnerEntity === null || beaconOuterEntity === null) return
		beaconPulseTime += dt
		const pulse = 1 + BEACON_PULSE_RANGE * Math.sin(beaconPulseTime * BEACON_PULSE_SPEED)
		const innerT = Transform.getMutable(beaconInnerEntity)
		innerT.scale = Vector3.create(BEACON_INNER_WIDTH_M * pulse, BEACON_HEIGHT_M, 1)
		const outerT = Transform.getMutable(beaconOuterEntity)
		outerT.scale = Vector3.create(BEACON_OUTER_WIDTH_M * (2 - pulse), BEACON_HEIGHT_M, 1)
	})
}


// MARK: spawnBeacon
function spawnBeacon(x: number, z: number, groundY: number): void {
	if (!BEACON_ENABLED) return
	if (beaconInnerEntity !== null) return

	const gradient = Material.Texture.Common({ src: BEACON_GRADIENT_TEX })
	const alpha    = Material.Texture.Common({ src: BEACON_ALPHA_TEX })
	const c        = BEACON_COLOR
	const yCentre  = groundY + BEACON_Y_OFFSET_M + BEACON_HEIGHT_M / 2

	const inner = engine.addEntity()
	beaconInnerEntity = inner
	Transform.create(inner, {
		position: Vector3.create(x, yCentre, z),
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
	beaconOuterEntity = outer
	Transform.create(outer, {
		position: Vector3.create(x, yCentre, z),
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


// MARK: spawnCampAtSeed
function spawnCampAtSeed(seed: number): void {
	const pos = getCampWorldPosition(seed)
	warmthX = pos.x
	warmthZ = pos.z
	console.log(`camp: spawnCampAtSeed: seed=${seed} pos=(${pos.x.toFixed(1)}, ${pos.z.toFixed(1)})`)

	// Root carries world position + audio. Split children so future
	// polish (e.g. flame flicker) can mutate one without disturbing
	// the base logs.
	rootEntity = engine.addEntity()
	Transform.create(rootEntity, {
		position: Vector3.create(pos.x, pos.y, pos.z),
	})

	baseEntity = engine.addEntity()
	Transform.create(baseEntity, { parent: rootEntity, position: Vector3.Zero() })
	GltfContainer.create(baseEntity, { src: CAMP_BASE_MODEL })

	flameEntity = engine.addEntity()
	Transform.create(flameEntity, { parent: rootEntity, position: Vector3.Zero() })
	GltfContainer.create(flameEntity, { src: CAMP_FLAME_MODEL })

	AudioSource.create(rootEntity, {
		audioClipUrl: CAMP_SFX,
		loop        : true,
		playing     : true,
		global      : false,
		volume      : CAMP_VOLUME,
	})

	// Standalone smoke emitter positioned above the flame. Not parented
	// to root because ParticleSystem in local-space with a moving parent
	// drags particles; sibling emitter in world space reads correctly.
	smokeEntity = engine.addEntity()
	Transform.create(smokeEntity, {
		position: Vector3.create(pos.x, SMOKE_ORIGIN_Y, pos.z),
		rotation: Quaternion.Identity(),
	})
	ParticleSystem.create(smokeEntity, {
		shape                : ParticleSystem.Shape.Cone({
			angle : SMOKE_CONE_ANGLE,
			radius: SMOKE_CONE_RADIUS,
		}),
		rate                 : SMOKE_RATE_PER_S,
		maxParticles         : SMOKE_MAX_PARTICLES,
		lifetime             : SMOKE_LIFETIME_S,
		gravity              : SMOKE_GRAVITY_MULT,
		initialVelocitySpeed : { start: SMOKE_SPEED_MIN, end: SMOKE_SPEED_MAX },
		additionalForce      : SMOKE_WIND,
		initialSize          : { start: SMOKE_SIZE_START_MIN, end: SMOKE_SIZE_START_MAX },
		sizeOverTime         : { start: SMOKE_SIZE_END_MIN,   end: SMOKE_SIZE_END_MAX },
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
		prewarm              : true,
	})

	spawnBeacon(pos.x, pos.z, pos.y)
}


// MARK: despawnCamp
function despawnCamp(): void {
	if (smokeEntity        !== null) { engine.removeEntity(smokeEntity);        smokeEntity        = null }
	if (flameEntity        !== null) { engine.removeEntity(flameEntity);        flameEntity        = null }
	if (baseEntity         !== null) { engine.removeEntity(baseEntity);         baseEntity         = null }
	if (beaconInnerEntity  !== null) { engine.removeEntity(beaconInnerEntity);  beaconInnerEntity  = null }
	if (beaconOuterEntity  !== null) { engine.removeEntity(beaconOuterEntity);  beaconOuterEntity  = null }
	if (rootEntity         !== null) { engine.removeEntity(rootEntity);         rootEntity         = null }
}
