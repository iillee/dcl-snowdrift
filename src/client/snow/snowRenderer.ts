/**
 * snowRenderer.ts — draws the snow layer from snowModel.
 *
 * Ground: a few large slabs (top at SNOW_GROUND_TOP_Y, melt-blue, physics
 * collider) covering every unmasked tile. Replaces the per-tile GLBs.
 *
 * Snow: one quadtree per 16 m root. A node renders as a single mesh when
 * every cell under it shares a stage; otherwise it splits (16 -> 8 -> 4 ->
 * 2 -> 1). Distant 16 m nodes that do not touch melt are shadow-receiving
 * planes (no cast). Cubes stay under the player, around any melt lip,
 * and on anything smaller than 16 m, so a runner cannot look under a
 * paper-thin sheet. Stage 0 renders nothing, so the blue ground shows.
 *
 * A dirty root is rebuilt create-first: new nodes spawn before old ones
 * leave, and replaced parents stay for RETIRE_FRAMES (sunk so their
 * top plane cannot z-fight the replacements). Roots are processed
 * urgent-first, then nearest, under a per-frame entity-creation budget.
 *
 * Only 1 m leaves animate: melts drop, regrowth rises. Coarser nodes
 * appear at their final height.
 */

import {
	ColliderLayer,
	engine,
	Entity,
	LightSource,
	Material,
	MeshCollider,
	MeshRenderer,
	Transform,
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import {
	SNOW_CELL_M,
	SNOW_CELLS_X,
	SNOW_CELLS_Z,
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
const RETIRE_FRAMES           = 2
const RETIRE_SINK_M           = 0.08
const ROOT_COUNT              = SNOW_TILES_X * SNOW_TILES_Z
const BOX_BASE_Y              = SNOW_GROUND_TOP_Y + BOX_LIFT_M
// Only a full 16 m tile far from the player and from melt becomes a plane.
const PLANE_MIN_M             = 16
const PLANE_MELT_PAD_CELLS    = 16
const PLANE_PLAYER_KEEP_M     = 48
const PLANE_PLAYER_KEEP_M2    = PLANE_PLAYER_KEEP_M * PLANE_PLAYER_KEEP_M
const PLANE_ROT               = Quaternion.fromEulerDegrees(-90, 0, 0)
// Node id = size * stride + local cell index; stride must exceed SNOW_TILE_CELL_COUNT.
const NODE_SIZE_STRIDE        = 1024

const SNOW_WHITE  = Color4.create(0.82, 0.86, 0.92, 1)
const GROUND_BLUE = Color4.create(106 / 255, 153 / 255, 252 / 255, 1)

type NodeRec   = { entity: Entity; stage: number; plane: boolean }
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
const retireQueue: Array<{ entity: Entity; framesLeft: number }> = []

let groundEntities:   Entity[] = []
let builtMaskVersion  = -1
let initialized       = false
let waitMs            = 0
let syncFallbackUsed  = false
let coldOpenSettled   = false
let liveNodeCount     = 0


// MARK: initSnowRenderer

/** Register the render and animation systems. Call after initSnowModel and initSnowBrush. */
export function initSnowRenderer(): void {
	if (initialized) return
	initialized = true
	engine.addSystem(snowRenderSystem)
	engine.addSystem(leafAnimSystem)
	setupSnowSun()
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
	flushRetireQueue()

	if (maskVersion() !== builtMaskVersion) {
		builtMaskVersion = maskVersion()
		rebuildGround()
		for (let k = 0; k < ROOT_COUNT; k++) {
			pendingRoots.add(k)
			fullPassRemaining.add(k)
		}
	}

	drainDirtyRoots(pendingRoots, urgentRoots)
	promoteNearbyPlanes()

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
	const focus = readFocusXZ()
	const px    = focus.x
	const pz    = focus.z
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
	let urgentLeft = order.length - rest.length
	for (const k of order) {
		const isUrgent = urgentLeft > 0
		if (isUrgent) urgentLeft--
		if (!isUrgent && spent >= CREATE_BUDGET_PER_FRAME) break
		// Urgent roots (local torch / stomp) always rebuild this frame so
		// a 16 m pristine cube cannot stay standing under the player.
		const cap = isUrgent || spent === 0
			? Number.POSITIVE_INFINITY
			: CREATE_HARD_CAP - spent
		const created = rebuildRoot(k, cap)
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
			rs.nodes.set(id, { entity: e, stage: newStage, plane: false })
			liveNodeCount++
		}
		startLeafAnim(rs.nodes.get(id)!.entity, x, z, SNOW_STAGE_HEIGHT_M[newStage], durationMs, false)
		animatedIds.add(id)
	}

	// Spawn replacements while the old parent is still up. Mobile often
	// shows a new box a frame late; removing first flashes empty ground.
	for (const [id, stage] of desired) {
		if (animatedIds.has(id)) continue
		const live = rs.nodes.get(id)
		const size = Math.floor(id / NODE_SIZE_STRIDE)
		const rem  = id - size * NODE_SIZE_STRIDE
		const lz   = Math.floor(rem / SNOW_TILE_CELLS)
		const lx   = rem - lz * SNOW_TILE_CELLS
		const x    = rootX + (lx + size / 2) * SNOW_CELL_M
		const z    = rootZ + (lz + size / 2) * SNOW_CELL_M
		const h     = SNOW_STAGE_HEIGHT_M[stage]
		const sizeM = size * SNOW_CELL_M
		const plane = wantsLodPlane(tileKey, lx, lz, size, stages, x, z)
		if (live !== undefined) {
			if (live.plane !== plane) {
				queueRetire(live.entity)
				rs.nodes.delete(id)
				liveNodeCount--
			} else {
				if (live.stage !== stage) {
					setBoxPose(live.entity, x, z, sizeM, h, plane)
					live.stage = stage
				}
				continue
			}
		}
		const e = createBox(x, z, sizeM, h, plane)
		rs.nodes.set(id, { entity: e, stage, plane })
		liveNodeCount++
	}

	for (const [id, rec] of rs.nodes) {
		if (desired.has(id)) continue
		queueRetire(rec.entity)
		rs.nodes.delete(id)
		liveNodeCount--
	}

	for (let i = 0; i < SNOW_TILE_CELL_COUNT; i++) rs.snapshot[i] = stages[base + i]
	return creates
}


// MARK: stageAtWorldCell

/** Stage at a world cell, or -1 off the playfield. Masked tiles read as 0. */
function stageAtWorldCell(
	gx    : number,
	gz    : number,
	stages: Uint8Array,
): number {
	if (gx < 0 || gz < 0 || gx >= SNOW_CELLS_X || gz >= SNOW_CELLS_Z) return -1
	const tx = Math.floor(gx / SNOW_TILE_CELLS)
	const tz = Math.floor(gz / SNOW_TILE_CELLS)
	const key = tz * SNOW_TILES_X + tx
	if (isTileMasked(key)) return 0
	const col = gx - tx * SNOW_TILE_CELLS
	const row = gz - tz * SNOW_TILE_CELLS
	return stages[key * SNOW_TILE_CELL_COUNT + row * SNOW_TILE_CELLS + col]
}


// MARK: readFocusXZ

/** Player XZ, or the spawn hearth if the avatar is not ready yet. */
function readFocusXZ(): { x: number; z: number } {
	const player = Transform.getOrNull(engine.PlayerEntity)
	if (player !== null) return { x: player.position.x, z: player.position.z }
	return { x: CAMPFIRE_WORLD_X, z: CAMPFIRE_WORLD_Z }
}


// MARK: promoteNearbyPlanes

/** Convert any plane still inside the keep radius into a cube this frame. */
function promoteNearbyPlanes(): void {
	if (roots.size === 0) return
	const { x: px, z: pz } = readFocusXZ()
	const keep = PLANE_PLAYER_KEEP_M + SNOW_TILE_M * 0.5
	const minTx = Math.max(0, Math.floor((px - keep - SNOW_ORIGIN_M) / SNOW_TILE_M))
	const maxTx = Math.min(SNOW_TILES_X - 1, Math.floor((px + keep - SNOW_ORIGIN_M) / SNOW_TILE_M))
	const minTz = Math.max(0, Math.floor((pz - keep - SNOW_ORIGIN_M) / SNOW_TILE_M))
	const maxTz = Math.min(SNOW_TILES_Z - 1, Math.floor((pz + keep - SNOW_ORIGIN_M) / SNOW_TILE_M))
	for (let tz = minTz; tz <= maxTz; tz++) {
		for (let tx = minTx; tx <= maxTx; tx++) {
			const k  = tz * SNOW_TILES_X + tx
			const rs = roots.get(k)
			if (rs === undefined) continue
			for (const rec of rs.nodes.values()) {
				if (!rec.plane) continue
				pendingRoots.add(k)
				urgentRoots.add(k)
				break
			}
		}
	}
}


// MARK: nodeTouchesMelt

/** True if any cell in the pad around this node is melted (stage 0). */
function nodeTouchesMelt(
	tileKey  : number,
	lx       : number,
	lz       : number,
	sizeCells: number,
	stages   : Uint8Array,
): boolean {
	const { tx, tz } = tileCoordsFromKey(tileKey)
	const gx0 = tx * SNOW_TILE_CELLS + lx
	const gz0 = tz * SNOW_TILE_CELLS + lz
	const gx1 = gx0 + sizeCells
	const gz1 = gz0 + sizeCells
	const pad = PLANE_MELT_PAD_CELLS
	for (let gz = gz0 - pad; gz < gz1 + pad; gz++) {
		for (let gx = gx0 - pad; gx < gx1 + pad; gx++) {
			if (gx >= gx0 && gx < gx1 && gz >= gz0 && gz < gz1) continue
			if (stageAtWorldCell(gx, gz, stages) === 0) return true
		}
	}
	return false
}


// MARK: wantsLodPlane

/** 16 m sheet only when far from the player and not near a melt lip. */
function wantsLodPlane(
	tileKey  : number,
	lx       : number,
	lz       : number,
	sizeCells: number,
	stages   : Uint8Array,
	worldX   : number,
	worldZ   : number,
): boolean {
	if (sizeCells * SNOW_CELL_M < PLANE_MIN_M) return false
	const focus = readFocusXZ()
	const dx    = worldX - focus.x
	const dz    = worldZ - focus.z
	if (dx * dx + dz * dz < PLANE_PLAYER_KEEP_M2) return false
	return !nodeTouchesMelt(tileKey, lx, lz, sizeCells, stages)
}


// MARK: createBox

function createBox(
	x:       number,
	z:       number,
	size:    number,
	heightM: number,
	plane:   boolean = false,
): Entity {
	const e = engine.addEntity()
	if (plane) {
		Transform.create(e, {
			position: Vector3.create(x, BOX_BASE_Y + heightM, z),
			rotation: PLANE_ROT,
			scale   : Vector3.create(size, size, 1),
		})
		MeshRenderer.setPlane(e)
	} else {
		Transform.create(e, {
			position: Vector3.create(x, BOX_BASE_Y + heightM / 2, z),
			scale   : Vector3.create(size, heightM, size),
		})
		MeshRenderer.setBox(e)
	}
	Material.setPbrMaterial(e, {
		albedoColor:       SNOW_WHITE,
		roughness:         1.0,
		metallic:          0.0,
		specularIntensity: 0.0,
		castShadows:       !plane,
	})
	return e
}


// MARK: setBoxPose

function setBoxPose(
	e:       Entity,
	x:       number,
	z:       number,
	size:    number,
	heightM: number,
	plane:   boolean = false,
): void {
	const tr = Transform.getMutableOrNull(e)
	if (tr === null) {
		console.log('snowRenderer: setBoxPose: missing transform, skipping pose write')
		return
	}
	if (plane) {
		tr.position = Vector3.create(x, BOX_BASE_Y + heightM, z)
		tr.rotation = PLANE_ROT
		tr.scale    = Vector3.create(size, size, 1)
		return
	}
	tr.position = Vector3.create(x, BOX_BASE_Y + heightM / 2, z)
	tr.scale    = Vector3.create(size, heightM, size)
}


// MARK: queueRetire

function queueRetire(e: Entity): void {
	anims.delete(e)
	sinkRetiringBox(e)
	retireQueue.push({ entity: e, framesLeft: RETIRE_FRAMES })
}


// MARK: sinkRetiringBox

function sinkRetiringBox(e: Entity): void {
	const tr = Transform.getMutableOrNull(e)
	if (tr === null) {
		console.log('snowRenderer: sinkRetiringBox: missing transform, skipping sink')
		return
	}
	tr.position = Vector3.create(tr.position.x, tr.position.y - RETIRE_SINK_M, tr.position.z)
}


// MARK: flushRetireQueue

function flushRetireQueue(): void {
	if (retireQueue.length === 0) return
	let write = 0
	for (let i = 0; i < retireQueue.length; i++) {
		const item = retireQueue[i]
		item.framesLeft--
		if (item.framesLeft > 0) {
			retireQueue[write] = item
			write++
			continue
		}
		engine.removeEntity(item.entity)
	}
	retireQueue.length = write
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
	if (durationMs <= 0) {
		if (removeAtEnd) {
			engine.removeEntity(e)
			return
		}
		setBoxPose(e, x, z, SNOW_CELL_M, endH)
		return
	}
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


// MARK: setupSnowSun

/**
 * Invisible morning key light. Scene ambient at the Morning preset
 * washes the snow to a flat white; a low-angle shadow-casting spot
 * restores side form on the cubes.
 */
function setupSnowSun(): void {
	try {
		const sun = engine.addEntity()
		Transform.create(sun, {
			position: Vector3.create(
				CAMPFIRE_WORLD_X + 140,
				90,
				CAMPFIRE_WORLD_Z - 140,
			),
			rotation: Quaternion.fromEulerDegrees(-48, -45, 0),
		})
		LightSource.create(sun, {
			type:      LightSource.Type.Spot({ innerAngle: 70, outerAngle: 95 }),
			color:     Color3.create(1.0, 0.93, 0.82),
			intensity: 90000,
			range:     380,
			shadow:    true,
		})
		console.log('snowRenderer: setupSnowSun: morning key light placed over playfield')
	} catch (err) {
		console.error('snowRenderer: setupSnowSun: failed to place key light:', err)
	}
}
