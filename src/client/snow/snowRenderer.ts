/**
 * snowRenderer.ts — draws the snow layer from snowModel.
 *
 * Ground: a few large slabs (top at SNOW_GROUND_TOP_Y, melt-blue, physics
 * collider) covering every unmasked tile. Replaces the per-tile GLBs.
 *
 * Snow: one quadtree per 16 m root. A node renders as a single box when
 * every cell under it shares a stage; otherwise it splits (16 -> 8 -> 4 ->
 * 2 -> 1). Stage 0 renders nothing, so the blue ground shows.
 *
 * A dirty root is rebuilt atomically: desired nodes are diffed against
 * live nodes and all creates / removes happen in the same frame. Roots
 * are processed urgent-first (local optimistic edits), then nearest to
 * the player, under a per-frame entity-creation budget.
 *
 * Only 1 m leaves animate: melts drop, regrowth rises. Coarser nodes
 * appear at their final height.
 */

import {
	ColliderLayer,
	engine,
	Entity,
	Material,
	MeshCollider,
	MeshRenderer,
	Transform,
} from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'

import {
	SNOW_CELL_M,
	SNOW_GROUND_TOP_Y,
	SNOW_ORIGIN_M,
	SNOW_STAGE_HEIGHT_M,
	SNOW_TILE_CELL_COUNT,
	SNOW_TILE_CELLS,
	SNOW_TILE_M,
	SNOW_TILES_X,
	SNOW_TILES_Z,
	tileCoordsFromKey,
} from 'src/shared/snowGrid'

import {
	computeOpenRects,
	isMaskReady,
	isTileMasked,
	maskVersion,
} from 'src/client/snow/playfieldMask'
import {
	drainDirtyRoots,
	getDisplayedStages,
	isSnowHydrated,
} from 'src/client/snow/snowModel'

const CREATE_BUDGET_PER_FRAME = 150
const CREATE_HARD_CAP         = 300
const SYNC_FALLBACK_MS        = 8000
const GROUND_THICKNESS_M      = 0.5
const BOX_LIFT_M              = 0.01
const MELTED_LEAF_HEIGHT_M    = 0.02
const LEAF_DROP_MS            = 300
const LEAF_RISE_MS            = 400
const ROOT_COUNT              = SNOW_TILES_X * SNOW_TILES_Z
const BOX_BASE_Y              = SNOW_GROUND_TOP_Y + BOX_LIFT_M
// Node id = size * stride + local cell index; stride must exceed SNOW_TILE_CELL_COUNT.
const NODE_SIZE_STRIDE        = 1024

const SNOW_WHITE  = Color4.create(0.94, 0.96, 1.00, 1)
const GROUND_BLUE = Color4.create(106 / 255, 153 / 255, 252 / 255, 1)

type NodeRec   = { entity: Entity; stage: number }
type RootState = { nodes: Map<number, NodeRec>; snapshot: Uint8Array }
type LeafAnim  = {
	x:          number
	z:          number
	startH:     number
	endH:       number
	elapsedMs:  number
	durationMs: number
	removeAtEnd: boolean
}

const roots             = new Map<number, RootState>()
const pendingRoots      = new Set<number>()
const urgentRoots       = new Set<number>()
const fullPassRemaining = new Set<number>()
const anims             = new Map<Entity, LeafAnim>()

let groundEntities:   Entity[] = []
let builtMaskVersion  = -1
let initialized       = false
let waitMs            = 0
let syncFallbackUsed  = false
let coldOpenSettled   = false
let liveNodeCount     = 0


// MARK: initSnowRenderer

/** Register the render and animation systems. Call once at boot, after initSnowModel. */
export function initSnowRenderer(): void {
	if (initialized) return
	initialized = true
	engine.addSystem(snowRenderSystem)
	engine.addSystem(leafAnimSystem)
}


// MARK: isSnowSettled

/**
 * Latched true once the mask is known, the initial CRDT state is applied
 * and every root has been built at least once. Live edits never reset it.
 */
export function isSnowSettled(): boolean {
	return coldOpenSettled
}


// MARK: isSnowRebuilding

/** True while a full pass (cold open or mask change) is still in flight. */
export function isSnowRebuilding(): boolean {
	return fullPassRemaining.size > 0
}


// MARK: snowRenderStats

/** Live entity counts for logging and the debug HUD. */
export function snowRenderStats(): { nodes: number; animating: number; ground: number; pendingRoots: number } {
	return {
		nodes:        liveNodeCount,
		animating:    anims.size,
		ground:       groundEntities.length,
		pendingRoots: pendingRoots.size,
	}
}


// MARK: snowRenderSystem

function snowRenderSystem(dt: number): void {
	if (maskVersion() !== builtMaskVersion) {
		builtMaskVersion = maskVersion()
		rebuildGround()
		for (let k = 0; k < ROOT_COUNT; k++) {
			pendingRoots.add(k)
			fullPassRemaining.add(k)
		}
	}

	drainDirtyRoots(pendingRoots, urgentRoots)

	if (!isMaskReady()) return
	if (!isSnowHydrated()) {
		waitMs += dt * 1000
		if (waitMs < SYNC_FALLBACK_MS) return
		if (!syncFallbackUsed) {
			syncFallbackUsed = true
			console.log(`snowRenderer: snowRenderSystem: no CRDT sync after ${SYNC_FALLBACK_MS}ms, rendering local state`)
		}
	}

	if (pendingRoots.size > 0) processPendingRoots()

	if (!coldOpenSettled && fullPassRemaining.size === 0) {
		coldOpenSettled = true
		console.log(
			`snowRenderer: snowRenderSystem: cold open settled, ${liveNodeCount} snow nodes, ` +
			`${groundEntities.length} ground slabs`
		)
	}
}


// MARK: processPendingRoots

function processPendingRoots(): void {
	const order: number[] = []
	for (const k of urgentRoots) if (pendingRoots.has(k)) order.push(k)
	urgentRoots.clear()

	const rest: Array<{ k: number; d: number }> = []
	const player = Transform.getOrNull(engine.PlayerEntity)
	const px     = player ? player.position.x : SNOW_ORIGIN_M + SNOW_TILES_X * SNOW_TILE_M / 2
	const pz     = player ? player.position.z : SNOW_ORIGIN_M + SNOW_TILES_Z * SNOW_TILE_M / 2
	for (const k of pendingRoots) {
		if (order.indexOf(k) >= 0) continue
		const { tx, tz } = tileCoordsFromKey(k)
		const dx = SNOW_ORIGIN_M + (tx + 0.5) * SNOW_TILE_M - px
		const dz = SNOW_ORIGIN_M + (tz + 0.5) * SNOW_TILE_M - pz
		rest.push({ k, d: dx * dx + dz * dz })
	}
	rest.sort((a, b) => a.d - b.d)
	for (const r of rest) order.push(r.k)

	let spent = 0
	for (const k of order) {
		if (spent >= CREATE_BUDGET_PER_FRAME) break
		// The first root of a frame always proceeds so an oversized rebuild cannot stall forever.
		const created = rebuildRoot(k, spent === 0 ? Number.POSITIVE_INFINITY : CREATE_HARD_CAP - spent)
		if (created < 0) break
		spent += created
		pendingRoots.delete(k)
		fullPassRemaining.delete(k)
	}
}


// MARK: nodeId

function nodeId(
	lx:   number,
	lz:   number,
	size: number,
): number {
	return size * NODE_SIZE_STRIDE + lz * SNOW_TILE_CELLS + lx
}


// MARK: isLeafId

function isLeafId(id: number): boolean {
	return id < 2 * NODE_SIZE_STRIDE
}


// MARK: buildDesired

function buildDesired(
	tileKey: number,
	stages:  Uint8Array,
): Map<number, number> {
	const out  = new Map<number, number>()
	const base = tileKey * SNOW_TILE_CELL_COUNT

	const uniform = (lx: number, lz: number, size: number): number => {
		const first = stages[base + lz * SNOW_TILE_CELLS + lx]
		for (let r = lz; r < lz + size; r++) {
			const rowBase = base + r * SNOW_TILE_CELLS
			for (let c = lx; c < lx + size; c++) {
				if (stages[rowBase + c] !== first) return -1
			}
		}
		return first
	}

	const emit = (lx: number, lz: number, size: number): void => {
		const u = uniform(lx, lz, size)
		if (u >= 0) {
			if (u > 0) out.set(nodeId(lx, lz, size), u)
			return
		}
		const h = size / 2
		emit(lx,     lz,     h)
		emit(lx + h, lz,     h)
		emit(lx,     lz + h, h)
		emit(lx + h, lz + h, h)
	}

	emit(0, 0, SNOW_TILE_CELLS)
	return out
}


// MARK: rebuildRoot

/**
 * Rebuild one root. Returns the number of entities created, or -1 when
 * the rebuild would exceed `createCap` and was deferred untouched.
 */
function rebuildRoot(
	tileKey:   number,
	createCap: number,
): number {
	const stages = getDisplayedStages()
	const base   = tileKey * SNOW_TILE_CELL_COUNT
	const masked = isTileMasked(tileKey)

	let rs = roots.get(tileKey)
	const firstBuild = rs === undefined
	if (rs === undefined) {
		rs = { nodes: new Map(), snapshot: stages.slice(base, base + SNOW_TILE_CELL_COUNT) }
		roots.set(tileKey, rs)
	}

	const desired = masked ? new Map<number, number>() : buildDesired(tileKey, stages)

	// Cells whose stage changed since the last build animate as 1 m leaves.
	const changedLeaves: number[] = []
	if (!firstBuild && !masked) {
		for (let i = 0; i < SNOW_TILE_CELL_COUNT; i++) {
			if (rs.snapshot[i] !== stages[base + i]) changedLeaves.push(i)
		}
	}

	let creates = 0
	for (const [id, stage] of desired) {
		const live = rs.nodes.get(id)
		if (live === undefined || (live.stage !== stage && !isLeafId(id))) creates++
	}
	for (const i of changedLeaves) {
		if (stages[base + i] === 0 && rs.snapshot[i] > 0 && !rs.nodes.has(nodeId(i % SNOW_TILE_CELLS, Math.floor(i / SNOW_TILE_CELLS), 1))) creates++
	}
	if (creates > createCap) return -1

	const { tx, tz } = tileCoordsFromKey(tileKey)
	const rootX = SNOW_ORIGIN_M + tx * SNOW_TILE_M
	const rootZ = SNOW_ORIGIN_M + tz * SNOW_TILE_M
	const animatedIds = new Set<number>()

	for (const i of changedLeaves) {
		const lx       = i % SNOW_TILE_CELLS
		const lz       = Math.floor(i / SNOW_TILE_CELLS)
		const id       = nodeId(lx, lz, 1)
		const prevH    = rs.snapshot[i] > 0 ? SNOW_STAGE_HEIGHT_M[rs.snapshot[i]] : MELTED_LEAF_HEIGHT_M
		const newStage = stages[base + i]
		const x        = rootX + (lx + 0.5) * SNOW_CELL_M
		const z        = rootZ + (lz + 0.5) * SNOW_CELL_M
		const live     = rs.nodes.get(id)

		if (newStage === 0) {
			if (rs.snapshot[i] === 0) continue
			let e: Entity
			if (live !== undefined) {
				e = live.entity
				rs.nodes.delete(id)
				liveNodeCount--
			} else {
				e = createBox(x, z, SNOW_CELL_M, prevH)
			}
			startLeafAnim(e, x, z, MELTED_LEAF_HEIGHT_M, LEAF_DROP_MS, true)
			continue
		}

		if (desired.get(id) !== newStage) continue
		const durationMs = newStage < rs.snapshot[i] ? LEAF_DROP_MS : LEAF_RISE_MS
		if (live !== undefined) {
			live.stage = newStage
		} else {
			const e = createBox(x, z, SNOW_CELL_M, prevH)
			rs.nodes.set(id, { entity: e, stage: newStage })
			liveNodeCount++
		}
		startLeafAnim(rs.nodes.get(id)!.entity, x, z, SNOW_STAGE_HEIGHT_M[newStage], durationMs, false)
		animatedIds.add(id)
	}

	for (const [id, rec] of rs.nodes) {
		if (desired.get(id) === rec.stage) continue
		removeNodeEntity(rec.entity)
		rs.nodes.delete(id)
		liveNodeCount--
	}

	for (const [id, stage] of desired) {
		if (rs.nodes.has(id) || animatedIds.has(id)) continue
		const size = Math.floor(id / NODE_SIZE_STRIDE)
		const rem  = id - size * NODE_SIZE_STRIDE
		const lz   = Math.floor(rem / SNOW_TILE_CELLS)
		const lx   = rem - lz * SNOW_TILE_CELLS
		const x    = rootX + (lx + size / 2) * SNOW_CELL_M
		const z    = rootZ + (lz + size / 2) * SNOW_CELL_M
		const e    = createBox(x, z, size * SNOW_CELL_M, SNOW_STAGE_HEIGHT_M[stage])
		rs.nodes.set(id, { entity: e, stage })
		liveNodeCount++
	}

	for (let i = 0; i < SNOW_TILE_CELL_COUNT; i++) rs.snapshot[i] = stages[base + i]
	return creates
}


// MARK: createBox

function createBox(
	x:       number,
	z:       number,
	size:    number,
	heightM: number,
): Entity {
	const e = engine.addEntity()
	Transform.create(e, {
		position: Vector3.create(x, BOX_BASE_Y + heightM / 2, z),
		scale:    Vector3.create(size, heightM, size),
	})
	MeshRenderer.setBox(e)
	Material.setPbrMaterial(e, {
		albedoColor:       SNOW_WHITE,
		roughness:         1.0,
		metallic:          0.0,
		specularIntensity: 0.0,
	})
	return e
}


// MARK: removeNodeEntity

function removeNodeEntity(e: Entity): void {
	anims.delete(e)
	engine.removeEntity(e)
}


// MARK: startLeafAnim

function startLeafAnim(
	e:           Entity,
	x:           number,
	z:           number,
	endH:        number,
	durationMs:  number,
	removeAtEnd: boolean,
): void {
	const tr     = Transform.getOrNull(e)
	const startH = tr ? tr.scale.y : endH
	anims.set(e, { x, z, startH, endH, elapsedMs: 0, durationMs, removeAtEnd })
}


// MARK: leafAnimSystem

function leafAnimSystem(dt: number): void {
	if (anims.size === 0) return
	const dtMs = dt * 1000
	for (const [e, a] of anims) {
		a.elapsedMs += dtMs
		const raw = Math.min(1, a.elapsedMs / a.durationMs)
		const k   = 1 - Math.pow(1 - raw, 3)
		const h   = a.startH + (a.endH - a.startH) * k
		const tr  = Transform.getMutableOrNull(e)
		if (tr === null) {
			anims.delete(e)
			continue
		}
		tr.position = Vector3.create(a.x, BOX_BASE_Y + h / 2, a.z)
		tr.scale    = Vector3.create(SNOW_CELL_M, h, SNOW_CELL_M)
		if (raw < 1) continue
		anims.delete(e)
		if (a.removeAtEnd) engine.removeEntity(e)
	}
}


// MARK: rebuildGround

function rebuildGround(): void {
	for (const e of groundEntities) engine.removeEntity(e)
	groundEntities = []
	for (const r of computeOpenRects()) {
		const e     = engine.addEntity()
		const sizeX = r.w * SNOW_TILE_M
		const sizeZ = r.h * SNOW_TILE_M
		Transform.create(e, {
			position: Vector3.create(
				SNOW_ORIGIN_M + r.tx * SNOW_TILE_M + sizeX / 2,
				SNOW_GROUND_TOP_Y - GROUND_THICKNESS_M / 2,
				SNOW_ORIGIN_M + r.tz * SNOW_TILE_M + sizeZ / 2,
			),
			scale: Vector3.create(sizeX, GROUND_THICKNESS_M, sizeZ),
		})
		MeshRenderer.setBox(e)
		MeshCollider.setBox(e, ColliderLayer.CL_PHYSICS)
		Material.setPbrMaterial(e, {
			albedoColor:       GROUND_BLUE,
			roughness:         1.0,
			metallic:          0.0,
			specularIntensity: 0.0,
		})
		groundEntities.push(e)
	}
	console.log(`snowRenderer: rebuildGround: ${groundEntities.length} slabs for mask version ${builtMaskVersion}`)
}
