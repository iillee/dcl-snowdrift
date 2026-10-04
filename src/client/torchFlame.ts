/**
 * torchFlame.ts — tip cube + world-up sparks + hearth-style spot lights.
 *
 * Shared by the local torch and every remote avatar torch. Tip cube
 * matches hearth heat colors. Sparks climb on a Y-billboarded lift
 * (world-up). Three outward spots (same strategy as flameBillboards)
 * jitter and cast flicker shadows; the soft fill point light stays
 * in torch.ts / remoteTorches.ts.
 */

import {
	Billboard,
	BillboardMode,
	engine,
	Entity,
	LightSource,
	MeshRenderer,
	Transform,
	VisibilityComponent,
} from '@dcl/sdk/ecs'
import { Color3, Quaternion, Vector3 } from '@dcl/sdk/math'

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

/** Torch-sized copy of the hearth's three outward spots. */
const SPOT_COUNT       = 3
const SPOT_Y           = 0.10
const SPOT_OUT_M       = 0.035
const SPOT_INNER_DEG   = 80
const SPOT_OUTER_DEG   = 110
const SPOT_RANGE_M     = 5.5
const SPOT_INTENSITY   = 3200
const SPOT_COLOR       = Color3.create(1.00, 0.80, 0.30)
const SPOT_JITTER_M    = 0.025

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

interface Spot {
	entity  : Entity
	yaw     : number
	freq    : number
	elapsed : number
	jitter  : { x: number, y: number, z: number }
	target  : { x: number, y: number, z: number }
}

interface TorchFlameRig {
	tip     : Entity
	core    : Entity
	lift    : Entity
	sparks  : Spark[]
	spots   : Spot[]
	alive   : boolean
	lit     : boolean
	fuelFrac: number
	flameMul: number
}

const rigs: TorchFlameRig[] = []
let ticking = false
let timeSec = 0


export interface TorchFlame {
	/** Tip marker under the hand — light can share this pos. */
	tip: Entity
	/**
	 * Y-billboarded lift on the tip. Local +Y is world-up — parent
	 * smoke / sparks / spots here so they rise off the wood, not into
	 * the floor.
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
			const spotScale = rig.lit
				? clamp01(rig.fuelFrac) * rig.flameMul
				: 0
			for (let s = 0; s < rig.spots.length; s++) {
				writeSpotLight(rig.spots[s].entity, rig.lit, spotScale)
				tickSpot(rig.spots[s], dt)
			}
		}
	})
}


// MARK: placeCore
/** Shrink / hide / pulse the tip cube from fuel + lit. */
function placeCore(
	rig : TorchFlameRig,
	time: number,
): void {
	const vis = VisibilityComponent.getMutableOrNull(rig.core)
	if (vis !== null && vis.visible !== rig.lit) vis.visible = rig.lit

	const tr = Transform.getMutableOrNull(rig.core)
	if (tr === null) return
	if (!rig.lit) {
		tr.scale.x = 0.001
		tr.scale.y = 0.001
		tr.scale.z = 0.001
		return
	}
	const t = clamp01(rig.fuelFrac)
	const base =
		(CORE_SIZE_MIN + (CORE_SIZE_MAX - CORE_SIZE_MIN) * t) * rig.flameMul
	const pulse = 1 + CORE_PULSE_AMT * (wave(time, CORE_PULSE_PERIOD, 0) * 2 - 1)
	const s = Math.round((base * pulse) / SCALE_STEP) * SCALE_STEP
	tr.scale.x = s
	tr.scale.y = s
	tr.scale.z = s
	writeFlameHeatMaterial(rig.core, CORE_HEAT, rig.flameMul)
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
	const intensity = lit && scale > 0.01 ? SPOT_INTENSITY * scale : 0
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
			active   : lit && intensity > 0,
		})
		return
	}
	const light = LightSource.getMutable(entity)
	const on    = lit && intensity > 0
	if (light.active !== on) light.active = on
	if (!on) return
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


// MARK: clamp01
function clamp01(v: number): number {
	return v < 0 ? 0 : v > 1 ? 1 : v
}



// MARK: mountTorchFlame
/**
 * Tip cube + sparks + shadow spots on `handAnchor`. Used by both the
 * local torch and every remote avatar torch. Call `setFuel` each frame.
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
		scale : Vector3.create(CORE_SIZE_MAX, CORE_SIZE_MAX, CORE_SIZE_MAX),
	})
	MeshRenderer.setBox(core)
	writeFlameHeatMaterial(core, CORE_HEAT, 1)
	VisibilityComponent.create(core, { visible: false })

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

	const spots: Spot[] = []
	for (let i = 0; i < SPOT_COUNT; i++) {
		spots.push(spawnSpot(lift, i))
	}

	const rig: TorchFlameRig = {
		tip,
		core,
		lift,
		sparks,
		spots,
		alive   : true,
		lit     : false,
		fuelFrac: 0,
		flameMul: 1,
	}
	rigs.push(rig)
	ensureSystem()

	console.log(
		`torchFlame: mountTorchFlame: core + ${sparks.length} sparks + ${spots.length} spots`,
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
			rig.lit      = lit
			rig.fuelFrac = frac
			rig.flameMul = flameMul > 0 ? flameMul : 0
		},

		dispose(): void {
			if (!rig.alive) return
			rig.alive = false
			rig.lit   = false
			for (let i = 0; i < rig.sparks.length; i++) {
				engine.removeEntity(rig.sparks[i].entity)
			}
			for (let i = 0; i < rig.spots.length; i++) {
				engine.removeEntity(rig.spots[i].entity)
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
