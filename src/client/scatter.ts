/**
 * scatter.ts — deterministic random-placement system for scene props.
 *
 * Places N entities within a rectangular ground region, each picked
 * randomly from a weighted model list and given a random uniform scale
 * and Y rotation. Because every client seeds the PRNG identically, all
 * players see the exact same layout without needing to broadcast
 * positions over the network.
 *
 * Kinds (future-proofing):
 *   - 'static' : just a visual GltfContainer, no interactivity (implemented)
 *   - 'pickup' : the scattered entity can be collected by proximity or
 *                click. Stub for now — hook is defined but no pickup
 *                behaviour is wired. Will piggyback on the existing
 *                interactivity layer once a first use-case lands
 *                (wood logs, warmth stones, etc.).
 *   - 'powerup': timed buff item, e.g. "warm cocoa" that boosts speed
 *                for 30 s. Also stubbed; will share the pickup channel
 *                with a different consume handler.
 *
 * Callers pass a scatter spec via scatterProps(). Positions inside an
 * optional exclusion predicate (e.g. campfire melt ring, spawn plaza)
 * are rejected and re-sampled up to MAX_REJECTIONS times per slot
 * before we give up on that slot — this prevents an infinite loop if
 * the caller accidentally excludes the whole scatter region.
 */

import { Entity, GltfContainer, Transform, engine } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import { SCENE_WORLD_SIZE_X_METERS, SCENE_WORLD_SIZE_Z_METERS } from 'src/shared/settings'


// MARK: Types
/** A single model choice for the scatter, with an optional draw weight. */
export type ScatterModel = {
	src   : string
	/** Relative probability (default 1). Higher = more common. */
	weight?: number
}

export type ScatterKind = 'static' | 'pickup' | 'powerup'

export type ScatterSpec = {
	/** Weighted pool the scatter draws from. At least one required. */
	models: ScatterModel[]
	/** Number of instances to attempt to place. */
	count : number
	/** Deterministic seed so every client sees the same layout. */
	seed  : number
	/** Placement kind — see file header. Default 'static'. */
	kind? : ScatterKind
	/**
	 * Rectangular ground bounds in world meters. Defaults to the full
	 * scene footprint. Y coordinate is set separately via `y`.
	 */
	bounds?: { minX: number; maxX: number; minZ: number; maxZ: number }
	/** Ground height for placed items. Default 0. */
	y?     : number
	/**
	 * Horizontal (X/Z) scale range. Applied uniformly to X and Z so the
	 * footprint stays round unless the caller wants a stretched look via
	 * horizontalStretch below. Default [0.8, 1.2].
	 */
	scale? : { min: number; max: number }
	/**
	 * Optional independent Y-scale range. When omitted, Y matches the
	 * horizontal scale (uniform). Setting Y smaller than horizontal
	 * squashes items — useful for rocks and debris that should lie flat.
	 */
	scaleY?: { min: number; max: number }
	/**
	 * Optional additional X vs Z stretch factor range. When set, X and Z
	 * scales diverge randomly within [1/f, f] so the footprint elongates
	 * on a random axis. 1 = round, 1.5 = up to 50 % elongation on one axis.
	 */
	horizontalStretch?: number
	/**
	 * Y-axis rotation range in degrees. Default [0, 360].
	 */
	rotationYRange?: [number, number]
	/**
	 * Optional base rotation (Euler degrees) applied BEFORE the random
	 * Y-rotation and tilt jitter. Useful when the model's authored
	 * orientation does not match how it should sit in the world — e.g.
	 * rotating a mesh 90° on X to lay it on its side.
	 */
	baseRotationDeg?: { x: number; y: number; z: number }
	/**
	 * Max random tilt (degrees) applied to X and Z rotations. Positive
	 * means the axis can rotate ±this amount. 0 = perfectly upright.
	 * Small values (5–15°) sell a natural "resting on uneven ground"
	 * feel; larger values (30–60°) look tumbled / knocked over.
	 */
	tiltRangeDeg?: number
	/**
	 * Random Y-offset added to `y` per instance. Negative ranges sink
	 * items into the ground; positive floats them. Default { min: 0, max: 0 }.
	 */
	yJitter?: { min: number; max: number }
	/**
	 * Optional filter — return true to REJECT a sampled (x, z) position.
	 * Useful for keeping items out of the campfire ring, spawn area,
	 * or maze corridors.
	 */
	exclude?: (x: number, z: number) => boolean
	/**
	 * Probability [0..1] that a new sample is placed near an already-
	 * placed instance instead of at a fresh uniform-random point. 0 =
	 * pure random, 1 = every new sample clusters onto an existing one.
	 * Values around 0.6–0.8 produce natural boulder fields with clumps.
	 * The first sample is always fully random.
	 */
	clusterBias?: number
	/**
	 * When clustering, offset the parent position by a random 2D vector
	 * of magnitude ≤ this many meters. Small = tight clumps, large =
	 * loose groups. Default 4 m.
	 */
	clusterRadius?: number
	/**
	 * Debug label used in console diagnostics. Recommended so failed
	 * scatter attempts are easy to trace ("scatter[rocks]: ...").
	 */
	label?: string
}

/**
 * Metadata attached to every scattered entity. Callers can walk the
 * returned array to inspect kind/model or hook interactivity.
 */
export type ScatterInstance = {
	entity: Entity
	kind  : ScatterKind
	src   : string
	x     : number
	z     : number
}


// MARK: Constants
const MAX_REJECTIONS_PER_SLOT = 12


// MARK: mulberry32
/**
 * Small, fast, deterministic PRNG. Returns a function that yields a
 * float in [0, 1) on each call. Same seed → same sequence on every
 * client, which is why our scatters are network-safe without sync.
 */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0
	return function () {
		a = (a + 0x6D2B79F5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}


// MARK: pickWeighted
/**
 * Draw one model index from `pool` using the provided [0,1) sample and
 * the models' weights (default 1). Total weight is precomputed by the
 * caller for efficiency across many draws.
 */
function pickWeighted(pool: ScatterModel[], totalWeight: number, r: number): ScatterModel {
	let target = r * totalWeight
	for (const m of pool) {
		const w = m.weight ?? 1
		if (target < w) return m
		target -= w
	}
	return pool[pool.length - 1]
}


// MARK: scatterProps
/**
 * Place `spec.count` entities according to `spec`. Returns a list of
 * ScatterInstance records for every successfully placed entity (may be
 * shorter than count if too many slots hit rejection cap).
 *
 * Static kind is implemented now; pickup/powerup log a warning and
 * fall back to static so nothing breaks visually.
 */
export function scatterProps(spec: ScatterSpec): ScatterInstance[] {
	if (spec.models.length === 0 || spec.count <= 0) return []

	const kind    = spec.kind ?? 'static'
	const label   = spec.label ?? 'scatter'
	const bounds  = spec.bounds ?? {
		minX: 0, maxX: SCENE_WORLD_SIZE_X_METERS,
		minZ: 0, maxZ: SCENE_WORLD_SIZE_Z_METERS,
	}
	const y            = spec.y ?? 0
	const scale        = spec.scale ?? { min: 0.8, max: 1.2 }
	const scaleY       = spec.scaleY  // undefined = match horizontal
	const stretch      = spec.horizontalStretch ?? 1
	const rotRange     = spec.rotationYRange ?? [0, 360]
	const tilt         = spec.tiltRangeDeg ?? 0
	const yJit         = spec.yJitter ?? { min: 0, max: 0 }
	const baseRot      = spec.baseRotationDeg
	const baseRotQ     = baseRot
		? Quaternion.fromEulerDegrees(baseRot.x, baseRot.y, baseRot.z)
		: null
	const clusterBias  = Math.max(0, Math.min(1, spec.clusterBias ?? 0))
	const clusterRad   = spec.clusterRadius ?? 4

	const rand   = mulberry32(spec.seed)
	const totalW = spec.models.reduce((s, m) => s + (m.weight ?? 1), 0)

	const placed: ScatterInstance[] = []
	let skipped = 0

	for (let i = 0; i < spec.count; i++) {
		// Sample a position, retry up to MAX_REJECTIONS_PER_SLOT times if
		// the exclusion predicate rejects it. Each retry also advances
		// the PRNG so the seed stays deterministic across all clients.
		//
		// Clustering: with probability clusterBias, pick an already-placed
		// instance and offset by a random 2D vector ≤ clusterRad meters,
		// producing natural clumps. The first sample is always uniform.
		let x = 0, z = 0
		let accepted = false
		for (let attempt = 0; attempt < MAX_REJECTIONS_PER_SLOT; attempt++) {
			const doCluster = placed.length > 0 && rand() < clusterBias
			if (doCluster) {
				const parent = placed[Math.floor(rand() * placed.length)]
				// Uniform sample inside a disc of radius clusterRad.
				const r     = clusterRad * Math.sqrt(rand())
				const theta = rand() * Math.PI * 2
				x = parent.x + Math.cos(theta) * r
				z = parent.z + Math.sin(theta) * r
			} else {
				x = bounds.minX + rand() * (bounds.maxX - bounds.minX)
				z = bounds.minZ + rand() * (bounds.maxZ - bounds.minZ)
			}
			const inBounds = x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ
			if (!inBounds) continue
			if (!spec.exclude || !spec.exclude(x, z)) { accepted = true; break }
		}
		if (!accepted) { skipped++; continue }

		const model      = pickWeighted(spec.models, totalW, rand())
		const sBase      = scale.min + rand() * (scale.max - scale.min)
		// Horizontal stretch: pick a factor in [1/stretch, stretch] and
		// apply it to X, the reciprocal to Z, so overall footprint area
		// stays proportional to sBase.
		const stretchF   = stretch === 1 ? 1 : (1 / stretch) + rand() * (stretch - 1 / stretch)
		const sx         = sBase * stretchF
		const sz         = sBase / stretchF
		const sy         = scaleY
			? scaleY.min + rand() * (scaleY.max - scaleY.min)
			: sBase
		const rotY       = rotRange[0] + rand() * (rotRange[1] - rotRange[0])
		const rotX       = tilt > 0 ? (rand() * 2 - 1) * tilt : 0
		const rotZ       = tilt > 0 ? (rand() * 2 - 1) * tilt : 0
		const yOffset    = yJit.min + rand() * (yJit.max - yJit.min)

		// Compose rotation. In DCL's Quaternion.multiply(a, b) convention,
		// `a` is applied AFTER `b` in the LOCAL frame — so to get "base
		// orientation, then random spin/tilt around the WORLD axes," we
		// pre-multiply the spin/tilt onto the base. This is the order that
		// actually lays the mesh flat first, then jitters it, rather than
		// rolling around the mesh's own tilted axes.
		const spinTilt = Quaternion.fromEulerDegrees(rotX, rotY, rotZ)
		let finalRot = spinTilt
		if (baseRotQ !== null) {
			finalRot = Quaternion.multiply(baseRotQ, spinTilt)
		}

		const e = engine.addEntity()
		Transform.create(e, {
			position: Vector3.create(x, y + yOffset, z),
			scale   : Vector3.create(sx, sy, sz),
			rotation: finalRot,
		})
		GltfContainer.create(e, {
			src                         : model.src,
			// Static scatter props keep default colliders so players cannot
			// walk through boulders. Pickups/powerups override this below
			// once implemented (typically no collider, hit via trigger).
			visibleMeshesCollisionMask  : undefined,
			invisibleMeshesCollisionMask: undefined,
		})

		if (kind !== 'static') {
			// TODO: wire pickup/powerup handlers. For now the entity is
			// still placed as a visual so the artist can validate positions.
			console.log(`scatter[${label}]: kind='${kind}' not yet implemented; placed as static visual`)
		}

		placed.push({ entity: e, kind, src: model.src, x, z })
	}

	console.log(`scatter[${label}]: placed ${placed.length}/${spec.count} (skipped ${skipped})`)
	return placed
}
