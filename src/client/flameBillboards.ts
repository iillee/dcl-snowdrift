/**
 * flameBillboards.ts — five-plane campfire, now breathing.
 *
 * Rest pose is the A–E layout. Motion is per tongue. Extra
 * rising copies of the vertical tongues climb above the bed,
 * shrink, and fade out. Which tongues are on follows the
 * fuel-tier flame scale: Ember is a bed and one curve, Roaring
 * is the full set. The whole cluster also uniform-scales with
 * that tier (Warm = 1). The cluster Y-billboards as one piece
 * so the hero face (A's bed plus B's curve) stays toward the
 * camera. Three outward spots jitter on Bence's clock and cast
 * the flicker shadows. Fuel, warmth, radius, and drain are not
 * decided here.
 *
 * Drop-in sheets (tip at the top of the file):
 *   assets/images/flame-base.png
 *   assets/images/flame-curve-l.png
 *   assets/images/flame-tall.png
 *   assets/images/flame-curve-r.png
 *   assets/images/flame-flicker.png
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


const TEX_BASE    = 'assets/images/flame-base.png'
const TEX_CURVE_L = 'assets/images/flame-curve-l.png'
const TEX_TALL    = 'assets/images/flame-tall.png'
const TEX_CURVE_R = 'assets/images/flame-curve-r.png'
const TEX_FLICKER = 'assets/images/flame-flicker.png'

/** Local Y of every tongue root, inside the log pile. */
const BED_Y = 0.08
/**
 * Hero face of the cluster. 30° sits between A (0°) and B (55°)
 * so the wide bed and the left curve read together. The visual
 * parent Y-billboards; this offset is on the child so the
 * Billboard can own the parent's yaw.
 */
const FACE_YAW = 30

/**
 * A–E rest pose. Spec `y` is depth on the pile (our Z).
 * `minScale` is the fuel-tier flame scale that turns this tongue on:
 *   Ember 0.45, Low 0.70, Warm 1.00, Bright 1.50, Roaring 2.00.
 */
const TONGUES: readonly TongueSpec[] = [
	{ id: 'A', kind: 'base',    tex: TEX_BASE,    yaw: 0,   x:  0.00, z:  0.00, width: 0.82, height: 0.55, cross: true,  period: 2.40, phase: 0.00, minScale: 0.00 },
	{ id: 'B', kind: 'medium',  tex: TEX_CURVE_L, yaw: 55,  x: -0.18, z:  0.05, width: 0.32, height: 0.85, cross: false, period: 1.35, phase: 0.22, minScale: 0.45 },
	{ id: 'C', kind: 'tall',    tex: TEX_TALL,    yaw: 110, x:  0.03, z: -0.05, width: 0.24, height: 1.05, cross: true,  period: 1.75, phase: 0.61, minScale: 1.50 },
	{ id: 'D', kind: 'medium',  tex: TEX_CURVE_R, yaw: 165, x:  0.20, z:  0.02, width: 0.34, height: 0.80, cross: false, period: 1.50, phase: 0.41, minScale: 0.70 },
	{ id: 'E', kind: 'flicker', tex: TEX_FLICKER, yaw: 220, x:  0.27, z: -0.10, width: 0.18, height: 0.38, cross: false, period: 0.70, phase: 0.18, minScale: 1.00 },
]

/**
 * Extra rising copies of the vertical tongues. They climb above
 * the bed and shrink out — separate from the planted cluster.
 */
const RISERS: readonly RiserSpec[] = [
	{ id: 'R1', tex: TEX_CURVE_L, yaw: 55,  x: -0.12, z:  0.04, width: 0.22, height: 0.70, period: 1.40, phase: 0.00, minScale: 0.45 },
	{ id: 'R2', tex: TEX_CURVE_R, yaw: 165, x:  0.14, z:  0.02, width: 0.24, height: 0.65, period: 1.65, phase: 0.48, minScale: 0.70 },
	{ id: 'R3', tex: TEX_TALL,    yaw: 110, x:  0.02, z: -0.04, width: 0.18, height: 0.90, period: 1.90, phase: 0.22, minScale: 1.00 },
	{ id: 'R4', tex: TEX_FLICKER, yaw: 220, x:  0.18, z: -0.08, width: 0.14, height: 0.42, period: 0.95, phase: 0.70, minScale: 1.00 },
]

/** How high a rising tongue climbs above BED_Y at full rise. */
const RISE_Y_M = 0.95

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
	id     : string
	kind   : TongueKind
	tex    : string
	yaw    : number
	x      : number
	z      : number
	width  : number
	height : number
	cross    : boolean
	period   : number
	phase    : number
	minScale : number
}

interface Tongue {
	spec : TongueSpec
	root : Entity
}

interface RiserSpec {
	id       : string
	tex      : string
	yaw      : number
	x        : number
	z        : number
	width    : number
	height   : number
	period   : number
	phase    : number
	minScale : number
}

interface Riser {
	spec : RiserSpec
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
	risers  : Riser[]
	spots   : Spot[]
	facing  : Entity
	scale   : number
}

export interface FlameRig {
	setScale(scale: number): void
}


const texCache = new Map<string, ReturnType<typeof Material.Texture.Common>>()
const rigs    : Rig[] = []
let ticking = false
let timeSec = 0


// MARK: textureOf

function textureOf(src: string): ReturnType<typeof Material.Texture.Common> {
	let tex = texCache.get(src)
	if (tex === undefined) {
		tex = Material.Texture.Common({ src })
		texCache.set(src, tex)
	}
	return tex
}


// MARK: applyTongueMaterial

function applyTongueMaterial(
	entity: Entity,
	src   : string,
): void {
	const tex = textureOf(src)
	Material.setBasicMaterial(entity, {
		texture     : tex,
		alphaTexture: tex,
		diffuseColor: Color4.create(1, 1, 1, 1),
		alphaTest   : 0.04,
		castShadows : false,
	})
}


// MARK: writeRiserMaterial
/**
 * Same hard cutout as the planted tongues. Soft diffuse alpha
 * on these sheets draws as grey cards in Explorer, so height
 * fade is scale-only.
 */
function writeRiserMaterial(
	entity: Entity,
	src   : string,
): void {
	const tex = textureOf(src)
	Material.setBasicMaterial(entity, {
		texture     : tex,
		alphaTexture: tex,
		diffuseColor: Color4.create(1, 1, 1, 1),
		alphaTest   : 0.04,
		castShadows : false,
	})
}


// MARK: spawnTongue

function spawnTongue(
	visual: Entity,
	spec  : TongueSpec,
): Tongue {
	const root = engine.addEntity()
	Transform.create(root, {
		parent  : visual,
		position: Vector3.create(spec.x, BED_Y, spec.z),
		rotation: Quaternion.fromEulerDegrees(0, spec.yaw, 0),
		scale   : Vector3.create(0.001, 0.001, 1),
	})

	// Cross only the symmetric sheets. A second copy of a lean
	// reads as an S from the side.
	const faces = spec.cross ? 2 : 1
	for (let i = 0; i < faces; i++) {
		const face = engine.addEntity()
		Transform.create(face, {
			parent  : root,
			position: Vector3.create(0, 0.5, 0),
			rotation: Quaternion.fromEulerDegrees(0, i * 80, 0),
		})
		MeshRenderer.setPlane(face)
		applyTongueMaterial(face, spec.tex)
	}

	return { spec, root }
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
	// Height is biased tall so the tip rises and occasionally drops.
	// The root stays on the bed — no Y translation, that reads as a bounce.
	if (kind === 'base') {
		return {
			sx  : 0.98 + 0.03 * a + 0.02 * flick,
			sy  : 0.96 + 0.05 * Math.pow(b, 0.55) + 0.03 * flick,
			dx  : 0.006 * (a - 0.5),
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
 * Uniform grow/shrink for the whole planted + rising cluster.
 * Warm is 1. Ember is small, Roaring is large. Spots stay on
 * the campfire root so their world reach is not doubled.
 */
function writeClusterScale(
	facing: Entity,
	scale : number,
): void {
	const s = scale > 0.01 ? scale : 0.001
	Transform.getMutable(facing).scale = Vector3.create(s, s, s)
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


// MARK: spawnRiser

function spawnRiser(
	visual: Entity,
	spec  : RiserSpec,
): Riser {
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
	writeRiserMaterial(face, spec.tex)
	return { spec, root, face }
}


// MARK: placeRiser
/**
 * Climb above the bed, then shrink out. Y translation is only
 * for these risers — the planted tongues stay on the pile.
 */
function placeRiser(
	riser: Riser,
	time : number,
	scale: number,
): void {
	const spec = riser.spec
	const tr   = Transform.getMutable(riser.root)
	if (scale < spec.minScale || scale <= 0.01) {
		tr.scale = Vector3.create(0.001, 0.001, 1)
		return
	}
	const u = (time / spec.period + spec.phase) % 1
	// Rise through the first 55%, then fade. Soft in, soft out.
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
		spec.x + 0.012 * lean,
		BED_Y + RISE_Y_M * rise,
		spec.z,
	)
	// Shrink harder as it climbs so the tip dissolves without soft alpha.
	const shrink = fade * (1 - 0.55 * rise)
	tr.scale = Vector3.create(
		spec.width  * (0.85 + 0.15 * fade) * shrink,
		Math.max(spec.height * (0.70 + 0.45 * (1 - rise)) * shrink, 0.02),
		1,
	)
	tr.rotation = Quaternion.fromEulerDegrees(0, spec.yaw + lean * 8, 0)
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
			for (let t = 0; t < rig.tongues.length; t++) {
				placeTongue(rig.tongues[t], timeSec, rig.scale)
			}
			if (rig.risers !== undefined) {
				for (let r = 0; r < rig.risers.length; r++) {
					placeRiser(rig.risers[r], timeSec, rig.scale)
				}
			}
			if (rig.spots !== undefined) {
				for (let s = 0; s < rig.spots.length; s++) {
					tickSpot(rig.spots[s], dt)
				}
			}
		}
	})
}


// MARK: createFlameRig
/**
 * Hang the A–E cluster on `parent`. The cluster Y-billboards
 * so the hero face stays toward the camera. `setScale(0)` hides
 * it. Scale is the fuel tier's flame scale: it chooses the
 * roster and uniform-scales the whole cluster (Warm = 1).
 */
export function createFlameRig(parent: Entity): FlameRig {
	const visual = engine.addEntity()
	Transform.create(visual, {
		parent,
		position: Vector3.Zero(),
		scale   : Vector3.One(),
	})
	Billboard.create(visual, { billboardMode: BillboardMode.BM_Y })

	const facing = engine.addEntity()
	Transform.create(facing, {
		parent  : visual,
		rotation: Quaternion.fromEulerDegrees(0, FACE_YAW, 0),
		scale   : Vector3.create(0.001, 0.001, 0.001),
	})

	const tongues: Tongue[] = []
	for (let i = 0; i < TONGUES.length; i++) {
		tongues.push(spawnTongue(facing, TONGUES[i]))
	}

	const risers: Riser[] = []
	for (let i = 0; i < RISERS.length; i++) {
		risers.push(spawnRiser(facing, RISERS[i]))
	}

	const spots: Spot[] = []
	for (let i = 0; i < SPOT_COUNT; i++) {
		spots.push(spawnSpot(parent, i))
	}

	const rig: Rig = {
		tongues,
		risers,
		spots,
		facing,
		scale: 0,
	}
	rigs.push(rig)
	ensureSystem()
	console.log(
		`flameBillboards: createFlameRig: ${tongues.length} planes, ${risers.length} risers, ${spots.length} spots`,
	)

	return {
		setScale(scale: number): void {
			const next = scale > 0 ? scale : 0
			if (next === rig.scale) return
			rig.scale = next
			const lit = next > 0.01
			writeClusterScale(rig.facing, next)
			for (let i = 0; i < rig.tongues.length; i++) {
				placeTongue(rig.tongues[i], timeSec, next)
			}
			for (let i = 0; i < rig.risers.length; i++) {
				placeRiser(rig.risers[i], timeSec, next)
			}
			for (let i = 0; i < rig.spots.length; i++) {
				writeSpotLight(rig.spots[i].entity, lit, next)
			}
			console.log(
				`flameBillboards: setScale ${next.toFixed(2)} tongues ${countLit(next)}`,
			)
		},
	}
}
