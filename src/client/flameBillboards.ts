/**
 * flameBillboards.ts — low-poly orange fire cards.
 *
 * Solid emissive planes instead of flame sprites: a planted bed of
 * cards (the flame silhouette), then a copy of that bed rotated 90°
 * as a whole with slight height and bob-timing variants so plan view
 * reads as a living X. A glow cube sits in the bed and scales with
 * fuel. Smaller ember cards climb and shrink out. Roster and scale
 * follow fuel-tier flame scale (Warm = 1). Above Warm, the cluster
 * grows taller faster than it grows wide. The cluster Y-billboards
 * so the hero face stays toward the camera. Three outward spots
 * jitter on Bence's clock and cast the flicker shadows. Fuel,
 * warmth, radius, and drain are not decided here.
 */

import {
	Billboard,
	BillboardMode,
	engine,
	Entity,
	LightSource,
	Material,
	MeshRenderer,
	Transform,
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'


/** Local Y of every planted card root, inside the log pile. */
const BED_Y = 0.08

/** Base glow cube at the bed. Size at Warm (scale 1). */
const CORE_SIZE_AT_WARM = 0.42
/** Warm yellow-orange, matches the lower silhouette cards. */
const CORE_HEAT         = 0.15
/** Soft breath on the bed cube (± fraction of size). */
const CORE_PULSE_AMT    = 0.08
const CORE_PULSE_PERIOD = 1.35

/** Yellow (heat 0) toward a deeper orange (heat 1). Wider span than before. */
const COL_YELLOW_ALBEDO = Color4.create(1.00, 0.78, 0.22, 1)
const COL_YELLOW_EMIT   = Color3.create(1.00, 0.62, 0.12)
const COL_ORANGE_ALBEDO = Color4.create(1.00, 0.42, 0.06, 1)
const COL_ORANGE_EMIT   = Color3.create(1.00, 0.30, 0.04)
const EMIT_BASE         = 1.75

/**
 * Planted cards — one silhouette arm. A second arm is the same
 * specs parented under a 90° root (see createFlameRig). Split wide
 * bed, taller peaks. `heat` 0 = yellow, 1 = deep orange. `minScale`
 * is the fuel-tier flame scale that turns this card on.
 */
const TONGUES: readonly TongueSpec[] = [
	{ id: 'A1', kind: 'base',    heat: 0.00, yaw: -8,  x: -0.20, z:  0.00, width: 0.52, height: 0.38, period: 2.15, phase: 0.00, minScale: 0.00 },
	{ id: 'A2', kind: 'base',    heat: 0.18, yaw:  10, x:  0.20, z:  0.01, width: 0.50, height: 0.34, period: 2.85, phase: 0.48, minScale: 0.00 },
	{ id: 'B',  kind: 'medium',  heat: 0.35, yaw:  8,  x: -0.06, z: -0.02, width: 0.28, height: 0.95, period: 1.35, phase: 0.22, minScale: 0.45 },
	{ id: 'D',  kind: 'medium',  heat: 0.55, yaw: -10, x:  0.08, z: -0.03, width: 0.24, height: 0.82, period: 1.50, phase: 0.41, minScale: 0.70 },
	{ id: 'E',  kind: 'flicker', heat: 0.28, yaw:  4,  x:  0.02, z: -0.05, width: 0.14, height: 1.15, period: 0.90, phase: 0.18, minScale: 1.00 },
	{ id: 'C',  kind: 'tall',    heat: 0.70, yaw: -4,  x: -0.02, z: -0.06, width: 0.16, height: 1.40, period: 1.75, phase: 0.61, minScale: 1.50 },
]

/**
 * Small rising ember cards. Climb above the bed and shrink out.
 */
const EMBERS: readonly EmberSpec[] = [
	{ id: 'E1',  yaw: 40,  x: -0.10, z:  0.04, width: 0.12, height: 0.20, period: 1.80, phase: 0.00, riseY: 2.80, heat: 0.10, minScale: 0.45 },
	{ id: 'E2',  yaw: 120, x:  0.08, z: -0.02, width: 0.06, height: 0.10, period: 0.70, phase: 0.35, riseY: 1.40, heat: 0.50, minScale: 0.70 },
	{ id: 'E3',  yaw: 200, x:  0.12, z:  0.06, width: 0.09, height: 0.16, period: 1.25, phase: 0.62, riseY: 2.20, heat: 0.30, minScale: 1.00 },
	{ id: 'E4',  yaw: 280, x: -0.04, z: -0.08, width: 0.05, height: 0.08, period: 0.55, phase: 0.18, riseY: 1.10, heat: 0.65, minScale: 1.00 },
	{ id: 'E5',  yaw: 330, x:  0.02, z:  0.10, width: 0.14, height: 0.22, period: 2.10, phase: 0.80, riseY: 3.20, heat: 0.05, minScale: 1.50 },
	{ id: 'E6',  yaw: 80,  x: -0.14, z: -0.04, width: 0.07, height: 0.13, period: 0.95, phase: 0.50, riseY: 1.80, heat: 0.40, minScale: 1.50 },
	{ id: 'E7',  yaw: 160, x:  0.06, z:  0.08, width: 0.04, height: 0.07, period: 0.48, phase: 0.12, riseY: 0.90, heat: 0.75, minScale: 0.45 },
	{ id: 'E8',  yaw: 240, x: -0.08, z:  0.02, width: 0.11, height: 0.18, period: 1.55, phase: 0.42, riseY: 2.50, heat: 0.20, minScale: 0.70 },
	{ id: 'E9',  yaw: 300, x:  0.14, z: -0.06, width: 0.06, height: 0.11, period: 0.82, phase: 0.70, riseY: 1.60, heat: 0.55, minScale: 1.00 },
	{ id: 'E10', yaw: 20,  x: -0.02, z: -0.10, width: 0.08, height: 0.14, period: 1.35, phase: 0.28, riseY: 2.00, heat: 0.15, minScale: 1.00 },
	{ id: 'E11', yaw: 100, x:  0.10, z:  0.00, width: 0.15, height: 0.24, period: 2.40, phase: 0.55, riseY: 3.40, heat: 0.00, minScale: 1.50 },
	{ id: 'E12', yaw: 220, x: -0.12, z:  0.06, width: 0.05, height: 0.09, period: 0.60, phase: 0.88, riseY: 1.20, heat: 0.60, minScale: 1.50 },
]

/** Bence's three outward spots. Jitter is on the lights, not the cards. */
const SPOT_Y         = 1.50
const SPOT_OUT_M     = 0.10
const SPOT_COUNT     = 3
const SPOT_INNER_DEG = 80
const SPOT_OUTER_DEG = 110
const SPOT_RANGE_M   = 16
const SPOT_INTENSITY = 8000
const SPOT_COLOR     = Color3.create(1.00, 0.60, 0.00)
const SPOT_JITTER_M  = 0.10


type TongueKind = 'base' | 'medium' | 'tall' | 'flicker'

interface TongueSpec {
	id       : string
	kind     : TongueKind
	heat     : number
	yaw      : number
	x        : number
	z        : number
	width    : number
	height   : number
	period   : number
	phase    : number
	minScale : number
}

interface Tongue {
	spec : TongueSpec
	root : Entity
	face : Entity
}

interface EmberSpec {
	id       : string
	yaw      : number
	x        : number
	z        : number
	width    : number
	height   : number
	period   : number
	phase    : number
	riseY    : number
	heat     : number
	minScale : number
}

interface Ember {
	spec : EmberSpec
	root : Entity
	face : Entity
}

interface Spot {
	entity  : Entity
	yaw     : number
	freq    : number
	elapsed : number
	jitter  : { x: number, y: number, z: number }
	target  : { x: number, y: number, z: number }
}

interface Rig {
	tongues : Tongue[]
	embers  : Ember[]
	spots   : Spot[]
	arms    : Entity[]
	facing  : Entity
	visual  : Entity
	core    : Entity
	scale   : number
	alive   : boolean
}

export interface FlameRigOptions {
	/** Hearth flicker spots. Off for tiny handheld flames. Default true. */
	spots?: boolean
}

export interface FlameRig {
	setScale(scale: number): void
	dispose(): void
}


const rigs: Rig[] = []
let ticking = false
let timeSec = 0


// MARK: mixHeat
/** Lerp yellow → deep orange. `heat` 0..1. */
function mixHeat(heat: number): { albedo: Color4, emit: Color3 } {
	const t = heat < 0 ? 0 : heat > 1 ? 1 : heat
	const u = 1 - t
	return {
		albedo: Color4.create(
			COL_YELLOW_ALBEDO.r * u + COL_ORANGE_ALBEDO.r * t,
			COL_YELLOW_ALBEDO.g * u + COL_ORANGE_ALBEDO.g * t,
			COL_YELLOW_ALBEDO.b * u + COL_ORANGE_ALBEDO.b * t,
			1,
		),
		emit: Color3.create(
			COL_YELLOW_EMIT.r * u + COL_ORANGE_EMIT.r * t,
			COL_YELLOW_EMIT.g * u + COL_ORANGE_EMIT.g * t,
			COL_YELLOW_EMIT.b * u + COL_ORANGE_EMIT.b * t,
		),
	}
}


// MARK: writeFlameHeatMaterial
/**
 * Solid fire material shared by hearth cards and torch cubes. `heat`
 * tints yellow toward orange; `emitMul` dims the glow as sparks fade.
 */
export function writeFlameHeatMaterial(
	entity : Entity,
	heat   : number,
	emitMul: number = 1,
): void {
	const colors = mixHeat(heat)
	const k      = emitMul < 0 ? 0 : emitMul > 1 ? 1 : emitMul
	Material.setPbrMaterial(entity, {
		albedoColor      : Color4.create(
			colors.albedo.r,
			colors.albedo.g,
			colors.albedo.b,
			colors.albedo.a * (0.35 + 0.65 * k),
		),
		emissiveColor    : colors.emit,
		emissiveIntensity: EMIT_BASE * k,
		metallic         : 0,
		roughness        : 1,
		castShadows      : false,
	})
}


// MARK: spawnTongue
/**
 * One card of the silhouette, parented under an arm root. Arm yaw
 * (0° or 90°) is on the parent — this card only keeps its own lean.
 */
function spawnTongue(
	arm : Entity,
	spec: TongueSpec,
): Tongue {
	const root = engine.addEntity()
	Transform.create(root, {
		parent  : arm,
		position: Vector3.create(spec.x, BED_Y, spec.z),
		rotation: Quaternion.fromEulerDegrees(0, spec.yaw, 0),
		scale   : Vector3.create(0.001, 0.001, 1),
	})
	const face = engine.addEntity()
	Transform.create(face, {
		parent  : root,
		position: Vector3.create(0, 0.5, 0),
	})
	MeshRenderer.setPlane(face)
	writeFlameHeatMaterial(face, spec.heat, 1)
	return { spec, root, face }
}


// MARK: variantForCrossArm
/**
 * Slight height + bob timing offset for the 90° arm so it is not a
 * perfect mirror of the original silhouette. `index` picks a stable
 * per-card nudge (no RNG — both clients stay in sync).
 */
function variantForCrossArm(
	spec : TongueSpec,
	index: number,
): TongueSpec {
	// Alternate a little shorter / a little taller, and push the phase
	// about a quarter-cycle so peaks land between the originals.
	const heightMul = index % 2 === 0 ? 0.88 : 1.12
	const periodMul = index % 2 === 0 ? 1.08 : 0.92
	const phasePush = 0.28 + index * 0.07
	return {
		...spec,
		id    : `${spec.id}_x`,
		height: spec.height * heightMul,
		period: spec.period * periodMul,
		phase : (spec.phase + phasePush) % 1,
	}
}


// MARK: wave
/** 0..1 cosine. Slow at the peaks. */
function wave(
	time  : number,
	period: number,
	phase : number,
): number {
	const u = (time / period + phase) % 1
	return 0.5 - 0.5 * Math.cos(u * Math.PI * 2)
}


// MARK: motionFor

function motionFor(
	kind  : TongueKind,
	time  : number,
	period: number,
	phase : number,
): { sx: number, sy: number, dx: number, show: boolean } {
	const a     = wave(time, period, phase)
	const b     = wave(time, period * 1.41, phase + 0.33)
	const flick = wave(time, period * 0.28, phase + 0.17)
	if (kind === 'base') {
		return {
			sx  : 0.94 + 0.08 * a + 0.02 * flick,
			sy  : 0.42 + 0.62 * Math.pow(a, 0.40) + 0.04 * flick,
			dx  : 0.010 * (a - 0.5),
			show: true,
		}
	}
	if (kind === 'medium') {
		return {
			sx  : 0.92 + 0.08 * b + 0.04 * flick,
			sy  : 0.78 + 0.24 * Math.pow(a, 0.38) + 0.06 * flick,
			dx  : 0.016 * (b - 0.5),
			show: true,
		}
	}
	if (kind === 'tall') {
		return {
			sx  : 0.90 + 0.08 * b + 0.05 * flick,
			sy  : 0.50 + 0.50 * Math.pow(a, 0.32) + 0.08 * flick,
			dx  : 0.010 * (b - 0.5),
			show: true,
		}
	}
	const show = a > 0.40
	const k    = show ? Math.pow((a - 0.40) / 0.60, 0.65) : 0
	return {
		sx  : (0.82 + 0.18 * flick) * k,
		sy  : (0.72 + 0.30 * b) * k,
		dx  : 0.010 * (b - 0.5),
		show,
	}
}


// MARK: countLit

function countLit(scale: number): number {
	let n = 0
	for (let i = 0; i < TONGUES.length; i++) {
		if (scale > 0.01 && scale >= TONGUES[i].minScale) n++
	}
	return n
}


// MARK: writeClusterScale
/**
 * Grow/shrink the planted + ember cluster. Warm is 1. Above Warm,
 * height keeps the tier scale while width grows slower so a roaring
 * fire rises instead of becoming a flat yellow wall. Spots stay on
 * the campfire root.
 */
function writeClusterScale(
	facing: Entity,
	scale : number,
): void {
	if (scale <= 0.01) {
		Transform.getMutable(facing).scale = Vector3.create(0.001, 0.001, 0.001)
		return
	}
	const sy = scale
	const sx = scale <= 1 ? scale : Math.pow(scale, 0.70)
	Transform.getMutable(facing).scale = Vector3.create(sx, sy, sx)
}


// MARK: writeCoreScale
/**
 * Uniform bed cube. Tracks flame scale; above Warm it follows the
 * width curve. A soft cosine pulse keeps it breathing while lit.
 */
function writeCoreScale(
	core : Entity,
	scale: number,
	time : number,
): void {
	const tr = Transform.getMutable(core)
	if (scale <= 0.01) {
		tr.scale = Vector3.create(0.001, 0.001, 0.001)
		return
	}
	const mul   = scale <= 1 ? scale : Math.pow(scale, 0.70)
	const pulse = 1 + CORE_PULSE_AMT * (wave(time, CORE_PULSE_PERIOD, 0) * 2 - 1)
	const s     = CORE_SIZE_AT_WARM * mul * pulse
	tr.scale = Vector3.create(s, s, s)
}


// MARK: placeTongue

function placeTongue(
	tongue: Tongue,
	time  : number,
	scale : number,
): void {
	const spec = tongue.spec
	const tr   = Transform.getMutable(tongue.root)
	if (scale < spec.minScale || scale <= 0.01) {
		tr.scale = Vector3.create(0.001, 0.001, 1)
		return
	}
	const motion = motionFor(spec.kind, time, spec.period, spec.phase)
	if (!motion.show || motion.sy < 0.02) {
		tr.scale = Vector3.create(0.001, 0.001, 1)
		return
	}
	const yaw = spec.yaw * Math.PI / 180
	tr.position = Vector3.create(
		spec.x + motion.dx * Math.cos(yaw),
		BED_Y,
		spec.z + motion.dx * Math.sin(yaw),
	)
	tr.scale = Vector3.create(
		spec.width  * motion.sx,
		Math.max(spec.height * motion.sy, 0.02),
		1,
	)
	tr.rotation = Quaternion.fromEulerDegrees(0, spec.yaw, 0)
}


// MARK: spawnEmber

function spawnEmber(
	visual: Entity,
	spec  : EmberSpec,
): Ember {
	const root = engine.addEntity()
	Transform.create(root, {
		parent  : visual,
		position: Vector3.create(spec.x, BED_Y, spec.z),
		rotation: Quaternion.fromEulerDegrees(0, spec.yaw, 0),
		scale   : Vector3.create(0.001, 0.001, 1),
	})
	const face = engine.addEntity()
	Transform.create(face, {
		parent  : root,
		position: Vector3.create(0, 0.5, 0),
	})
	MeshRenderer.setPlane(face)
	writeFlameHeatMaterial(face, spec.heat, 1)
	return { spec, root, face }
}


// MARK: placeEmber
/**
 * Climb above the bed as a small ember card, then shrink and
 * dim out. Only these cards translate on Y.
 */
function placeEmber(
	ember: Ember,
	time : number,
	scale: number,
): void {
	const spec = ember.spec
	const tr   = Transform.getMutable(ember.root)
	if (scale < spec.minScale || scale <= 0.01) {
		tr.scale = Vector3.create(0.001, 0.001, 1)
		return
	}
	const u = (time / spec.period + spec.phase) % 1
	const rise = u < 0.55 ? u / 0.55 : 1
	const fade = u < 0.55
		? Math.pow(rise, 0.55)
		: 1 - Math.pow((u - 0.55) / 0.45, 0.85)
	if (fade < 0.04) {
		tr.scale = Vector3.create(0.001, 0.001, 1)
		return
	}
	const lean = Math.sin((time / (spec.period * 0.7) + spec.phase) * Math.PI * 2)
	tr.position = Vector3.create(
		spec.x + 0.020 * lean,
		BED_Y + spec.riseY * rise,
		spec.z + 0.010 * lean,
	)
	const shrink = fade * (1 - 0.40 * rise)
	tr.scale = Vector3.create(
		spec.width  * shrink,
		Math.max(spec.height * shrink, 0.02),
		1,
	)
	tr.rotation = Quaternion.fromEulerDegrees(0, spec.yaw + lean * 12, 0)
	writeFlameHeatMaterial(ember.face, spec.heat, fade * (1 - 0.70 * rise))
}


// MARK: randomJitter

function randomJitter(): { x: number, y: number, z: number } {
	return {
		x: Math.random() * SPOT_JITTER_M * 2 - SPOT_JITTER_M,
		y: Math.random() * SPOT_JITTER_M * 2 - SPOT_JITTER_M,
		z: Math.random() * SPOT_JITTER_M * 2 - SPOT_JITTER_M,
	}
}


// MARK: writeSpotLight

function writeSpotLight(
	entity: Entity,
	lit   : boolean,
	scale : number,
): void {
	const intensity = lit ? SPOT_INTENSITY * scale : 0
	if (!LightSource.has(entity)) {
		LightSource.create(entity, {
			type     : LightSource.Type.Spot({
				innerAngle: SPOT_INNER_DEG,
				outerAngle: SPOT_OUTER_DEG,
			}),
			color    : SPOT_COLOR,
			intensity: intensity,
			range    : SPOT_RANGE_M,
			shadow   : true,
			active   : lit,
		})
		return
	}
	const light = LightSource.getMutable(entity)
	if (light.active !== lit) light.active = lit
	if (!lit) return
	light.intensity = intensity
	light.range     = SPOT_RANGE_M
}


// MARK: spawnSpot

function spawnSpot(
	parent: Entity,
	index : number,
): Spot {
	const yaw    = index * (360 / SPOT_COUNT)
	const entity = engine.addEntity()
	Transform.create(entity, {
		parent,
		rotation: Quaternion.fromEulerDegrees(45, yaw, 0),
		position: Vector3.create(0, SPOT_Y, 0),
	})
	writeSpotLight(entity, false, 0)
	return {
		entity,
		yaw,
		freq   : 0.10 + Math.random() * 0.20,
		elapsed: Math.random() * 0.2,
		jitter : { x: 0, y: 0, z: 0 },
		target : randomJitter(),
	}
}


// MARK: tickSpot

function tickSpot(
	spot: Spot,
	dt  : number,
): void {
	spot.elapsed += dt
	if (spot.elapsed >= spot.freq) {
		spot.elapsed = 0
		spot.freq    = 0.10 + Math.random() * 0.20
		spot.target  = randomJitter()
	}
	const k = Math.min(1, dt * 8)
	spot.jitter.x += (spot.target.x - spot.jitter.x) * k
	spot.jitter.y += (spot.target.y - spot.jitter.y) * k
	spot.jitter.z += (spot.target.z - spot.jitter.z) * k

	const rest = Vector3.rotate(
		Vector3.create(0, SPOT_Y, SPOT_OUT_M),
		Quaternion.fromEulerDegrees(0, spot.yaw, 0),
	)
	Transform.getMutable(spot.entity).position = Vector3.create(
		rest.x + spot.jitter.x,
		rest.y + spot.jitter.y,
		rest.z + spot.jitter.z,
	)
}


// MARK: ensureSystem

function ensureSystem(): void {
	if (ticking) return
	ticking = true
	engine.addSystem((dt: number) => {
		timeSec += dt
		for (let i = 0; i < rigs.length; i++) {
			const rig = rigs[i]
			if (!rig.alive) continue
			writeCoreScale(rig.core, rig.scale, timeSec)
			for (let t = 0; t < rig.tongues.length; t++) {
				placeTongue(rig.tongues[t], timeSec, rig.scale)
			}
			for (let e = 0; e < rig.embers.length; e++) {
				placeEmber(rig.embers[e], timeSec, rig.scale)
			}
			for (let s = 0; s < rig.spots.length; s++) {
				tickSpot(rig.spots[s], dt)
			}
		}
	})
}


// MARK: createFlameRig
/**
 * Hang the orange card cluster on `parent`. Builds the silhouette,
 * then parents a height/timing-variant copy under a 90° arm so plan
 * view is an X. `setScale(0)` hides it. Scale chooses the roster and
 * grows the cluster (Warm = 1; above Warm, taller than wide).
 *
 * The visual root Y-billboards, so cards stay world-upright even when
 * `parent` rides a tilted hand bone (held torch). Pass `{ spots: false }`
 * for handheld flames — hearth spots are sized for a planted fire.
 */
export function createFlameRig(
	parent : Entity,
	options: FlameRigOptions = {},
): FlameRig {
	const withSpots = options.spots !== false

	const visual = engine.addEntity()
	Transform.create(visual, {
		parent,
		position: Vector3.Zero(),
		scale   : Vector3.One(),
	})
	// BM_Y owns world rotation: local Y stays world-up while yaw follows
	// the camera. Position still inherits from `parent` (hand tip).
	Billboard.create(visual, { billboardMode: BillboardMode.BM_Y })

	const facing = engine.addEntity()
	Transform.create(facing, {
		parent: visual,
		scale : Vector3.create(0.001, 0.001, 0.001),
	})

	// Bed cube under the silhouette — scales with fuel like the cards.
	const core = engine.addEntity()
	Transform.create(core, {
		parent  : visual,
		position: Vector3.create(0, BED_Y + CORE_SIZE_AT_WARM * 0.35, 0),
		scale   : Vector3.create(0.001, 0.001, 0.001),
	})
	MeshRenderer.setBox(core)
	writeFlameHeatMaterial(core, CORE_HEAT, 1)

	// Arm 0° = original silhouette. Arm 90° = same layout, rotated as a
	// whole, with slight height + timing variants so the X is alive.
	const arm0 = engine.addEntity()
	Transform.create(arm0, {
		parent  : facing,
		rotation: Quaternion.Identity(),
	})
	const arm90 = engine.addEntity()
	Transform.create(arm90, {
		parent  : facing,
		rotation: Quaternion.fromEulerDegrees(0, 90, 0),
	})
	const arms = [arm0, arm90]

	const tongues: Tongue[] = []
	for (let i = 0; i < TONGUES.length; i++) {
		tongues.push(spawnTongue(arm0, TONGUES[i]))
	}
	for (let i = 0; i < TONGUES.length; i++) {
		tongues.push(spawnTongue(arm90, variantForCrossArm(TONGUES[i], i)))
	}

	const embers: Ember[] = []
	for (let i = 0; i < EMBERS.length; i++) {
		embers.push(spawnEmber(facing, EMBERS[i]))
	}

	const spots: Spot[] = []
	if (withSpots) {
		for (let i = 0; i < SPOT_COUNT; i++) {
			spots.push(spawnSpot(parent, i))
		}
	}

	const rig: Rig = {
		tongues,
		embers,
		spots,
		arms,
		facing,
		visual,
		core,
		scale: 0,
		alive: true,
	}
	rigs.push(rig)
	ensureSystem()
	console.log(
		`flameBillboards: createFlameRig: ${TONGUES.length} cards x2 arms, ` +
		`${embers.length} embers, ${spots.length} spots, bed cube`,
	)

	return {
		setScale(scale: number): void {
			if (!rig.alive) return
			const next = scale > 0 ? scale : 0
			if (next === rig.scale) return
			rig.scale = next
			const lit = next > 0.01
			writeClusterScale(rig.facing, next)
			writeCoreScale(rig.core, next, timeSec)
			for (let i = 0; i < rig.tongues.length; i++) {
				placeTongue(rig.tongues[i], timeSec, next)
			}
			for (let i = 0; i < rig.embers.length; i++) {
				placeEmber(rig.embers[i], timeSec, next)
			}
			for (let i = 0; i < rig.spots.length; i++) {
				writeSpotLight(rig.spots[i].entity, lit, next)
			}
			console.log(
				`flameBillboards: setScale ${next.toFixed(2)} cards ${countLit(next)}`,
			)
		},
		dispose(): void {
			if (!rig.alive) return
			rig.alive = false
			rig.scale = 0
			for (let i = 0; i < rig.tongues.length; i++) {
				engine.removeEntity(rig.tongues[i].face)
				engine.removeEntity(rig.tongues[i].root)
			}
			for (let i = 0; i < rig.embers.length; i++) {
				engine.removeEntity(rig.embers[i].face)
				engine.removeEntity(rig.embers[i].root)
			}
			for (let i = 0; i < rig.spots.length; i++) {
				engine.removeEntity(rig.spots[i].entity)
			}
			for (let i = 0; i < rig.arms.length; i++) {
				engine.removeEntity(rig.arms[i])
			}
			engine.removeEntity(rig.core)
			engine.removeEntity(rig.facing)
			engine.removeEntity(rig.visual)
			const idx = rigs.indexOf(rig)
			if (idx >= 0) rigs.splice(idx, 1)
			console.log('flameBillboards: dispose: rig removed')
		},
	}
}
