/**
 * torchFlame.ts — tip cube + world-up sparks for held torches.
 *
 * Shared by the local torch and every remote avatar torch. Tip cube
 * matches hearth heat colors. Sparks climb on a Y-billboarded lift
 * (world-up). Lighting is a single flickering radial point light in
 * torch.ts / remoteTorches.ts — no torch spot lights, so campfires
 * can keep Explorer's shadow budget.
 */

import {
	Billboard,
	BillboardMode,
	engine,
	Entity,
	MeshRenderer,
	Transform,
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import { writeFlameHeatMaterial } from 'src/client/flameBillboards'


// MARK: Tuning
/** Tip hotspot on the AvatarAttach right-hand anchor (old sphere seat). */
export const TORCH_FLAME_LOCAL_POS = Vector3.create(-0.11, 0.10, 0.28)

/** Core cube size at empty / full fuel. */
const CORE_SIZE_MIN = 0.045
const CORE_SIZE_MAX = 0.14
/** Core heat — slightly warm yellow, same ramp as hearth base cards. */
const CORE_HEAT     = 0.18
/** Soft breath on the tip cube (± fraction of size). */
const CORE_PULSE_AMT    = 0.08
const CORE_PULSE_PERIOD = 1.15

const SCALE_STEP = 0.01

interface SparkSpec {
	id    : string
	phase : number
	period: number
	riseY : number
	size  : number
	x     : number
	z     : number
	heat  : number
}

/**
 * Tiny rising sparks. Periods/phases stay fixed so local + remote
 * torches stay in sync without RNG.
 */
const SPARKS: readonly SparkSpec[] = [
	{ id: 'S1', phase: 0.00, period: 0.85, riseY: 0.42, size: 0.095, x: -0.02,  z:  0.01, heat: 0.10 },
	{ id: 'S2', phase: 0.18, period: 0.62, riseY: 0.30, size: 0.070, x:  0.02,  z: -0.01, heat: 0.45 },
	{ id: 'S3', phase: 0.41, period: 1.05, riseY: 0.55, size: 0.110, x:  0.01,  z:  0.02, heat: 0.25 },
	{ id: 'S4', phase: 0.55, period: 0.70, riseY: 0.28, size: 0.055, x: -0.01,  z: -0.02, heat: 0.60 },
	{ id: 'S5', phase: 0.72, period: 0.95, riseY: 0.48, size: 0.085, x:  0.00,  z:  0.00, heat: 0.15 },
	{ id: 'S6', phase: 0.88, period: 0.55, riseY: 0.22, size: 0.048, x:  0.015, z:  0.01, heat: 0.70 },
]


interface Spark {
	spec  : SparkSpec
	entity: Entity
}

interface TorchFlameRig {
	tip     : Entity
	core    : Entity
	lift    : Entity
	sparks  : Spark[]
	alive   : boolean
	lit     : boolean
	fuelFrac: number
	flameMul: number
	/** Last emit mul written to the tip cube — skip redundant Material sets. */
	coreEmit: number
}

const rigs: TorchFlameRig[] = []
let ticking = false
let timeSec = 0


export interface TorchFlame {
	/** Tip marker under the hand — light can share this pos. */
	tip: Entity
	/**
	 * Y-billboarded lift on the tip. Local +Y is world-up — parent
	 * smoke / sparks here so they rise off the wood, not into the floor.
	 */
	lift: Entity
	setFuel(
		lit     : boolean,
		frac    : number,
		flameMul: number,
	): void
	dispose(): void
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


// MARK: ensureSystem

function ensureSystem(): void {
	if (ticking) return
	ticking = true
	engine.addSystem((dt: number) => {
		timeSec += dt
		for (let i = 0; i < rigs.length; i++) {
			const rig = rigs[i]
			if (!rig.alive) continue
			placeCore(rig, timeSec)
			for (let s = 0; s < rig.sparks.length; s++) {
				placeSpark(rig, rig.sparks[s], timeSec)
			}
		}
	})
}




// MARK: placeCore
/**
 * Shrink / pulse the tip cube from fuel + lit. Hide by scale only —
 * VisibilityComponent toggles were intermittently leaving the cube
 * invisible after a relight (sparks already use scale-only hide).
 *
 * Always assign a fresh Vector3 for scale. Mutating tr.scale.x/y/z
 * in place often fails to dirty the Transform in Explorer, so after
 * an extinguish (scale → 0.001) a relight / torch-to-torch light
 * could leave the tip stuck invisible.
 */
function placeCore(
	rig : TorchFlameRig,
	time: number,
): void {
	const tr = Transform.getMutableOrNull(rig.core)
	if (tr === null) return
	if (!rig.lit) {
		tr.scale = Vector3.create(0.001, 0.001, 0.001)
		rig.coreEmit = -1
		return
	}
	const t = clamp01(rig.fuelFrac)
	// Floor the night pinch so dusk/night never rounds the tip to zero
	// after SCALE_STEP quantize — that read as "relit but no cube".
	const mul = Math.max(0.55, Number.isFinite(rig.flameMul) ? rig.flameMul : 1)
	const base =
		(CORE_SIZE_MIN + (CORE_SIZE_MAX - CORE_SIZE_MIN) * t) * mul
	const pulse = 1 + CORE_PULSE_AMT * (wave(time, CORE_PULSE_PERIOD, 0) * 2 - 1)
	const s = Math.max(
		CORE_SIZE_MIN * 0.55,
		Math.round((base * pulse) / SCALE_STEP) * SCALE_STEP,
	)
	tr.scale = Vector3.create(s, s, s)
	if (Math.abs(rig.coreEmit - mul) > 0.01) {
		writeFlameHeatMaterial(rig.core, CORE_HEAT, mul)
		rig.coreEmit = mul
	}
}


// MARK: showCoreOnRelight
/**
 * Hard refresh on the unlit → lit edge. Re-asserts the box mesh and
 * material, then sizes the cube immediately so a same-frame system
 * order (flame tick before setFuel) cannot leave a stuck 0.001 scale.
 */
function showCoreOnRelight(
	rig: TorchFlameRig,
): void {
	if (!MeshRenderer.has(rig.core)) {
		MeshRenderer.setBox(rig.core)
	}
	rig.coreEmit = -1
	placeCore(rig, timeSec)
}


// MARK: placeSpark
/**
 * Climb world-up (local Y under the BM_Y lift). Start full-size at the
 * tip, shrink while rising, then dim out at the peak.
 */
function placeSpark(
	rig  : TorchFlameRig,
	spark: Spark,
	time : number,
): void {
	const spec = spark.spec
	const tr   = Transform.getMutable(spark.entity)
	if (!rig.lit) {
		tr.scale = Vector3.create(0.001, 0.001, 0.001)
		return
	}
	const u    = (time / spec.period + spec.phase) % 1
	const rise = u < 0.55 ? u / 0.55 : 1
	const life = u < 0.55
		? 1
		: 1 - Math.pow((u - 0.55) / 0.45, 0.85)
	if (life < 0.04) {
		tr.scale = Vector3.create(0.001, 0.001, 0.001)
		return
	}
	const lean = Math.sin((time / (spec.period * 0.7) + spec.phase) * Math.PI * 2)
	const fuel = 0.55 + 0.45 * clamp01(rig.fuelFrac)
	const size = spec.size * (1 - 0.82 * rise) * life * fuel * rig.flameMul
	tr.position = Vector3.create(
		spec.x + 0.008 * lean,
		spec.riseY * rise,
		spec.z + 0.006 * lean,
	)
	tr.scale = Vector3.create(size, size, size)
	writeFlameHeatMaterial(
		spark.entity,
		spec.heat,
		life * (1 - 0.55 * rise) * rig.flameMul,
	)
}


// MARK: clamp01
function clamp01(v: number): number {
	return v < 0 ? 0 : v > 1 ? 1 : v
}


// MARK: mountTorchFlame
/**
 * Tip cube + sparks on `handAnchor`. Used by both the local torch and
 * every remote avatar torch. Call `setFuel` each frame. Light comes
 * from the flickering radial in torch.ts / remoteTorches.ts.
 */
export function mountTorchFlame(handAnchor: Entity): TorchFlame {
	const tip = engine.addEntity()
	Transform.create(tip, {
		parent  : handAnchor,
		position: TORCH_FLAME_LOCAL_POS,
		rotation: Quaternion.Identity(),
		scale   : Vector3.One(),
	})

	// Core glow — rides the tip like the old sphere (tilts with hand).
	const core = engine.addEntity()
	Transform.create(core, {
		parent: tip,
		scale : Vector3.create(0.001, 0.001, 0.001),
	})
	MeshRenderer.setBox(core)
	writeFlameHeatMaterial(core, CORE_HEAT, 1)
	// Start tiny — placeCore grows it when lit. Do not use
	// VisibilityComponent; hide/show via scale only.
	// Y-billboard lift: local +Y is world-up even while the shaft tilts.
	const lift = engine.addEntity()
	Transform.create(lift, {
		parent  : tip,
		position: Vector3.Zero(),
		rotation: Quaternion.Identity(),
		scale   : Vector3.One(),
	})
	Billboard.create(lift, { billboardMode: BillboardMode.BM_Y })

	const sparks: Spark[] = []
	for (let i = 0; i < SPARKS.length; i++) {
		const spec   = SPARKS[i]
		const entity = engine.addEntity()
		Transform.create(entity, {
			parent  : lift,
			position: Vector3.create(spec.x, 0, spec.z),
			scale   : Vector3.create(0.001, 0.001, 0.001),
		})
		MeshRenderer.setBox(entity)
		writeFlameHeatMaterial(entity, spec.heat, 1)
		sparks.push({ spec, entity })
	}

	const rig: TorchFlameRig = {
		tip,
		core,
		lift,
		sparks,
		alive   : true,
		lit     : false,
		fuelFrac: 0,
		flameMul: 1,
		coreEmit: 1,
	}
	rigs.push(rig)
	ensureSystem()

	console.log(
		`torchFlame: mountTorchFlame: core + ${sparks.length} sparks`,
	)

	return {
		tip,
		lift,

		setFuel(
			lit     : boolean,
			frac    : number,
			flameMul: number,
		): void {
			if (!rig.alive) return
			const wasLit = rig.lit
			rig.lit      = lit
			rig.fuelFrac = frac < 0 ? 0 : frac > 1 ? 1 : frac
			rig.flameMul = flameMul > 0 && Number.isFinite(flameMul) ? flameMul : 0
			// Same-frame show on the unlit → lit edge so a relight or
			// torch-to-torch light is not waiting on system order.
			if (lit && !wasLit) {
				showCoreOnRelight(rig)
			}
		},

		dispose(): void {
			if (!rig.alive) return
			rig.alive = false
			rig.lit   = false
			for (let i = 0; i < rig.sparks.length; i++) {
				engine.removeEntity(rig.sparks[i].entity)
			}
			engine.removeEntity(rig.core)
			engine.removeEntity(rig.lift)
			engine.removeEntity(rig.tip)
			const idx = rigs.indexOf(rig)
			if (idx >= 0) rigs.splice(idx, 1)
			console.log('torchFlame: dispose: tip flame removed')
		},
	}
}
