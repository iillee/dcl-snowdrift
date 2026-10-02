/**
 * flameBillboards.ts — five-plane campfire, now breathing.
 *
 * Rest pose is the A–E layout. Motion is per tongue. Which
 * tongues are on follows the fuel-tier flame scale: Ember is a
 * bed and one curve, Roaring is the full set. Size steps modestly
 * so a dip on an ember cannot read as a roaring fire. Lights are
 * still the existing hearth point light. Fuel, warmth, radius,
 * and drain are not decided here.
 *
 * Drop-in sheets (tip at the top of the file):
 *   assets/images/flame-base.png
 *   assets/images/flame-curve-l.png
 *   assets/images/flame-tall.png
 *   assets/images/flame-curve-r.png
 *   assets/images/flame-flicker.png
 */

import {
	engine,
	Entity,
	Material,
	MeshRenderer,
	Transform,
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'


const TEX_BASE    = 'assets/images/flame-base.png'
const TEX_CURVE_L = 'assets/images/flame-curve-l.png'
const TEX_TALL    = 'assets/images/flame-tall.png'
const TEX_CURVE_R = 'assets/images/flame-curve-r.png'
const TEX_FLICKER = 'assets/images/flame-flicker.png'

/** Local Y of every tongue root, inside the log pile. */
const BED_Y = 0.08

/**
 * A–E rest pose. Spec `y` is depth on the pile (our Z).
 * `minScale` is the fuel-tier flame scale that turns this tongue on:
 *   Ember 0.45, Low 0.70, Warm 1.00, Bright 1.50, Roaring 2.00.
 */
const TONGUES: readonly TongueSpec[] = [
	{ id: 'A', kind: 'base',    tex: TEX_BASE,    yaw: 0,   x:  0.00, z:  0.00, width: 0.65, height: 0.45, cross: true,  period: 2.40, phase: 0.00, minScale: 0.00 },
	{ id: 'B', kind: 'medium',  tex: TEX_CURVE_L, yaw: 55,  x: -0.18, z:  0.05, width: 0.28, height: 0.75, cross: false, period: 1.35, phase: 0.22, minScale: 0.45 },
	{ id: 'C', kind: 'tall',    tex: TEX_TALL,    yaw: 110, x:  0.03, z: -0.05, width: 0.24, height: 1.05, cross: true,  period: 1.75, phase: 0.61, minScale: 1.50 },
	{ id: 'D', kind: 'medium',  tex: TEX_CURVE_R, yaw: 165, x:  0.20, z:  0.02, width: 0.30, height: 0.70, cross: false, period: 1.50, phase: 0.41, minScale: 0.70 },
	{ id: 'E', kind: 'flicker', tex: TEX_FLICKER, yaw: 220, x:  0.27, z: -0.10, width: 0.18, height: 0.38, cross: false, period: 0.70, phase: 0.18, minScale: 1.00 },
]


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

interface Rig {
	tongues : Tongue[]
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


// MARK: clusterMul
/**
 * Modest size step across tiers. The roster of tongues is what
 * separates a low fire from a high one.
 */
function clusterMul(scale: number): number {
	const s = scale < 0 ? 0 : scale > 2 ? 2 : scale
	return 0.78 + 0.14 * s
}


// MARK: countLit

function countLit(scale: number): number {
	let n = 0
	for (let i = 0; i < TONGUES.length; i++) {
		if (scale > 0.01 && scale >= TONGUES[i].minScale) n++
	}
	return n
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
	const mul = clusterMul(scale)
	tr.position = Vector3.create(
		spec.x + motion.dx * Math.cos(yaw),
		BED_Y,
		spec.z + motion.dx * Math.sin(yaw),
	)
	tr.scale = Vector3.create(
		spec.width  * mul * motion.sx,
		Math.max(spec.height * mul * motion.sy, 0.02),
		1,
	)
	tr.rotation = Quaternion.fromEulerDegrees(0, spec.yaw, 0)
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
		}
	})
}


// MARK: createFlameRig
/**
 * Hang the A–E cluster on `parent`. `setScale(0)` hides it.
 * Scale is the fuel tier's flame scale: it chooses the roster
 * and a modest size, not one uniform grow.
 */
export function createFlameRig(parent: Entity): FlameRig {
	const visual = engine.addEntity()
	Transform.create(visual, {
		parent,
		position: Vector3.Zero(),
		scale   : Vector3.One(),
	})

	const tongues: Tongue[] = []
	for (let i = 0; i < TONGUES.length; i++) {
		tongues.push(spawnTongue(visual, TONGUES[i]))
	}

	const rig: Rig = {
		tongues,
		scale: 0,
	}
	rigs.push(rig)
	ensureSystem()
	console.log(`flameBillboards: createFlameRig: ${tongues.length} planes, tier roster on`)

	return {
		setScale(scale: number): void {
			const next = scale > 0 ? scale : 0
			if (next === rig.scale) return
			rig.scale = next
			for (let i = 0; i < rig.tongues.length; i++) {
				placeTongue(rig.tongues[i], timeSec, next)
			}
			console.log(
				`flameBillboards: setScale ${next.toFixed(2)} tongues ${countLit(next)}`,
			)
		},
	}
}
