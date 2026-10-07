/**
 * snowRenderer.ts — draws the snow layer from snowModel.
 *
 * Ground belongs to the terrain renderer. Snow lies on top of it at
 * every elevation: a 16 m snow tile covers exactly one 16 m terrain
 * cell, so each root has a single ground height (baseYForTile).
 * applyTerrainLevels adopts a layout's elevations when the seed
 * arrives and again on every reroll. Building starts on the first
 * frame, before the seed or the CRDT snapshot arrive.
 *
 * Snow: one quadtree per 16 m root. A node renders as a single mesh when
 * every cell under it shares a stage; otherwise it splits (16 -> 8 -> 4 ->
 * 2 -> 1). Distant 16 m nodes that do not touch melt are shadow-receiving
 * planes (no cast). Cubes stay under the player, around any melt lip,
 * and on anything smaller than 16 m, so a runner cannot look under a
 * paper-thin sheet. Stage 0 renders nothing, so the blue ground shows.
 *
 * Far from melt, pristine roots coalesce into larger multi-tile boxes
 * (32 / 64 / 128 / 256 m) so a bigger playfield does not pay one entity
 * per 16 m tile; a block only coalesces when every tile in it shares
 * one level. Covered roots skip their fine quadtree until the player or
 * a melt lip approaches. Coarse sheets are always thick boxes (never
 * paper planes) so cliff lips keep vertical snow faces — a sheet never
 * spans two elevations, and single-tile LOD planes are refused on any
 * level boundary.
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
import { TERRAIN_LEVEL_MID, groundYForLevel } from 'src/shared/settings'
import {
	SNOW_CELL_M,
	SNOW_CELLS_X,
	SNOW_CELLS_Z,
	SNOW_ORIGIN_M,
	SNOW_STAGE_HEIGHT_M,
	SNOW_TILE_CELL_COUNT,
	SNOW_TILE_CELLS,
	SNOW_TILE_M,
	SNOW_TILES_X,
	SNOW_TILES_Z,
	STAGE_PRISTINE,
	tileCoordsFromKey,
} from 'src/shared/snowGrid'
import { getTerrain } from 'src/shared/terrain/terrainCache'

import {
	drainDirtyRoots,
	getDisplayedStages,
	isSnowHydrated,
} from 'src/client/snow/snowModel'

const CREATE_BUDGET_PER_FRAME = 150
/** Max urgent (budget-exempt) tile rebuilds per frame, nearest first. */
const URGENT_MAX_PER_FRAME = 6
const CREATE_HARD_CAP         = 300
const SYNC_FALLBACK_MS        = 8000
const BOX_LIFT_M              = 0.01
const MELTED_LEAF_HEIGHT_M    = 0.02
const LEAF_DROP_MS            = 300
const LEAF_RISE_MS            = 400
const RETIRE_FRAMES           = 2
const RETIRE_SINK_M           = 0.08
const ROOT_COUNT              = SNOW_TILES_X * SNOW_TILES_Z
// Only a full 16 m tile far from the player and from melt becomes a plane.
const PLANE_MIN_M             = 16
const PLANE_MELT_PAD_CELLS    = 16
const PLANE_PLAYER_KEEP_M     = 48
const PLANE_PLAYER_KEEP_M2    = PLANE_PLAYER_KEEP_M * PLANE_PLAYER_KEEP_M
const PLANE_ROT               = Quaternion.fromEulerDegrees(-90, 0, 0)
// Node id = size * stride + local cell index; stride must exceed SNOW_TILE_CELL_COUNT.
const NODE_SIZE_STRIDE        = 1024
// Multi-tile LOD: largest first. Further from melt/player → bigger sheets.
// playerKeepM is clearance from the block's EDGE (not centre), so a 256 m
// sheet cannot slide in close while its centre stays "far enough".
// Sheets are thick boxes only (see syncCoarsePlanes → createBox plane=false).
const COARSE_LEVELS: ReadonlyArray<{
	tiles:         number
	playerKeepM:   number
	meltPadCells:  number
}> = [
	{ tiles: 16, playerKeepM: 128, meltPadCells: 64 },
	{ tiles: 8,  playerKeepM: 80,  meltPadCells: 40 },
	{ tiles: 4,  playerKeepM: 56,  meltPadCells: 28 },
	{ tiles: 2,  playerKeepM: 40,  meltPadCells: 20 },
]
// Near a melt lip, refuse nodes larger than this so the hearth is not a 16 m cliff.
const MELT_LIP_MAX_CELLS = 4

const SNOW_WHITE  = Color4.create(0.82, 0.86, 0.92, 1)
const GROUND_BLUE = Color4.create(106 / 255, 153 / 255, 252 / 255, 1)

type NodeRec   = { entity: Entity; stage: number; plane: boolean }
type RootState = { nodes: Map<number, NodeRec>; snapshot: Uint8Array }
type LeafAnim  = {
	x:          number
	z:          number
	baseY:      number
	startH:     number
	endH:       number
	elapsedMs:  number
	durationMs: number
	removeAtEnd: boolean
}
type CoarseRec = {
	tx:     number
	tz:     number
	tiles:  number
	entity: Entity
	stage:  number
}

const roots             = new Map<number, RootState>()
const pendingRoots      = new Set<number>()
const urgentRoots       = new Set<number>()
const fullPassRemaining = new Set<number>()
const anims             = new Map<Entity, LeafAnim>()
const retireQueue: Array<{ entity: Entity; framesLeft: number }> = []
const coarsePlanes      = new Map<string, CoarseRec>()

let groundEntities:   Entity[] = []
let initialized       = false
let waitMs            = 0
let syncFallbackUsed  = false
let coldOpenSettled   = false
let liveNodeCount     = 0
// Terrain level of each 16 m root. A snow tile and a terrain cell are
// both 16 m, so the mapping is 1:1 and every tile has exactly one
// ground height. Defaults to the hearth level for the frames before a
// seed lands.
let tileLevel         = new Uint8Array(ROOT_COUNT).fill(TERRAIN_LEVEL_MID)
let coarseCovered     = new Uint8Array(ROOT_COUNT)
let coarseDirty       = true


// MARK: initSnowRenderer

/** Register the render and animation systems. Call after initSnowModel and initSnowBrush. */
export function initSnowRenderer(): void {
	if (initialized) return
	initialized = true
	buildGround()
	for (let k = 0; k < ROOT_COUNT; k++) {
		pendingRoots.add(k)
		fullPassRemaining.add(k)
	}
	engine.addSystem(snowRenderSystem)
	engine.addSystem(leafAnimSystem)
	setupSnowSun()
}


// MARK: isSnowSettled

/**
 * Latched true once every root has been built at least once and the
 * initial CRDT state is applied (or the sync fallback elapsed). Live
 * edits never reset it.
 */
export function isSnowSettled(): boolean {
	return coldOpenSettled
}


// MARK: isSnowRebuilding

/** True while the cold-open full pass is still in flight. */
export function isSnowRebuilding(): boolean {
	return fullPassRemaining.size > 0
}


// MARK: applyTerrainLevels
/**
 * Adopt the elevation of a layout. Snow lies on every level; what
 * changes per tile is the height it sits at. Any tile whose level
 * moved is rebuilt, so a reroll does not leave snow floating over the
 * previous layout's ground.
 */
export function applyTerrainLevels(mazeSeed: number): void {
	const map  = getTerrain(mazeSeed)
	const next = new Uint8Array(ROOT_COUNT).fill(TERRAIN_LEVEL_MID)
	for (let tz = 0; tz < SNOW_TILES_Z && tz < map.h; tz++) {
		for (let tx = 0; tx < SNOW_TILES_X && tx < map.w; tx++) {
			next[tz * SNOW_TILES_X + tx] = map.levels[tz * map.w + tx]
		}
	}
	let dirty = 0
	for (let k = 0; k < ROOT_COUNT; k++) {
		if (next[k] === tileLevel[k]) continue
		// A node's height is baked into its transform when it is
		// created, and rebuildRoot only repositions nodes whose STAGE
		// changed. Retire this root's nodes outright so the rebuild
		// recreates them at the new ground height instead of leaving
		// them hanging at the old one.
		dropRootNodes(k)
		pendingRoots.add(k)
		fullPassRemaining.add(k)
		dirty++
	}
	// Coarse sheets are keyed by position and size, not by height, so a
	// block that stays eligible across the change would keep its old
	// base. Drop them all and let syncCoarsePlanes repack.
	if (dirty > 0) dropAllCoarseSheets()
	tileLevel = next
	coarseDirty = true
	console.log(
		`snowRenderer: applyTerrainLevels: ${dirty} roots changed level and are rebuilding`,
	)
}


// MARK: dropRootNodes
// Retire every node of one root and forget its state, so the next
// rebuildRoot treats it as a first build.
function dropRootNodes(tileKey: number): void {
	const rs = roots.get(tileKey)
	if (rs === undefined) return
	for (const rec of rs.nodes.values()) {
		queueRetire(rec.entity)
		liveNodeCount--
	}
	rs.nodes.clear()
	roots.delete(tileKey)
}


// MARK: dropAllCoarseSheets
// Retire every coarse sheet so syncCoarsePlanes rebuilds them at the
// current heights. coarseCovered is deliberately left alone: it is the
// record of which roots a sheet was covering, and syncCoarsePlanes
// diffs against it to decide which roots must go back to fine nodes.
// Clearing it would strand those roots with neither.
function dropAllCoarseSheets(): void {
	for (const rec of coarsePlanes.values()) {
		queueRetire(rec.entity)
		liveNodeCount--
	}
	coarsePlanes.clear()
}


// MARK: baseYForTile
// Underside of the snow on this root: the terrain surface, lifted a
// hair so the snow does not z-fight the cap it rests on.
function baseYForTile(tileKey: number): number {
	return groundYForLevel(tileLevel[tileKey]) + BOX_LIFT_M
}


// MARK: snowRenderStats

/** Live entity counts for logging and the debug HUD. */
export function snowRenderStats(): { nodes: number; animating: number; ground: number; pendingRoots: number; coarse: number } {
	return {
		nodes:        liveNodeCount,
		animating:    anims.size,
		ground:       groundEntities.length,
		pendingRoots: pendingRoots.size,
		coarse:       coarsePlanes.size,
	}
}


// MARK: snowRenderSystem

function snowRenderSystem(dt: number): void {
	flushRetireQueue()

	const dirtyBefore = pendingRoots.size
	drainDirtyRoots(pendingRoots, urgentRoots)
	if (pendingRoots.size > dirtyBefore) coarseDirty = true

	promoteNearbyPlanes()

	if (coarseDirty) syncCoarsePlanes()

	if (pendingRoots.size > 0) processPendingRoots()

	// Pristine snow is drawn without waiting on the server. The splash
	// still holds for the CRDT snapshot so the campfire ring is melted
	// on the first visible frame.
	let dataReady = isSnowHydrated()
	if (!dataReady) {
		waitMs += dt * 1000
		if (waitMs >= SYNC_FALLBACK_MS) {
			dataReady = true
			if (!syncFallbackUsed) {
				syncFallbackUsed = true
				console.log(`snowRenderer: snowRenderSystem: no CRDT sync after ${SYNC_FALLBACK_MS}ms, releasing with local state`)
			}
		}
	}

	if (!coldOpenSettled && dataReady && fullPassRemaining.size === 0 && pendingRoots.size === 0) {
		coldOpenSettled = true
		console.log(
			`snowRenderer: snowRenderSystem: cold open settled, ${liveNodeCount} snow nodes ` +
			`(${coarsePlanes.size} coarse), ${groundEntities.length} ground slabs`
		)
	}
}


// MARK: processPendingRoots

function processPendingRoots(): void {
	const focus = readFocusXZ()
	const px    = focus.x
	const pz    = focus.z
	const distSq = (k: number): number => {
		const { tx, tz } = tileCoordsFromKey(k)
		const dx = SNOW_ORIGIN_M + (tx + 0.5) * SNOW_TILE_M - px
		const dz = SNOW_ORIGIN_M + (tz + 0.5) * SNOW_TILE_M - pz
		return dx * dx + dz * dz
	}

	// Urgent = rebuild this frame regardless of budget. Only honour that
	// for a handful of tiles nearest the player: a world thaw marks every
	// tile urgent at once, and rebuilding all 2704 in one frame froze the
	// scene. Overflow urgent tiles fall back to the budgeted queue.
	const urgentList: Array<{ k: number; d: number }> = []
	for (const k of urgentRoots) if (pendingRoots.has(k)) urgentList.push({ k, d: distSq(k) })
	urgentRoots.clear()
	urgentList.sort((a, b) => a.d - b.d)
	const order: number[] = []
	const inOrder = new Set<number>()
	for (const u of urgentList) {
		if (order.length >= URGENT_MAX_PER_FRAME) break
		order.push(u.k)
		inOrder.add(u.k)
	}

	const rest: Array<{ k: number; d: number }> = []
	for (const k of pendingRoots) {
		if (inOrder.has(k)) continue
		rest.push({ k, d: distSq(k) })
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
			if (u > 0) {
				// Keep melt lips fine so the hearth is not a 16 m snow cliff.
				if (size > MELT_LIP_MAX_CELLS && nodeTouchesMelt(tileKey, lx, lz, size, stages)) {
					const h = size / 2
					emit(lx,     lz,     h)
					emit(lx + h, lz,     h)
					emit(lx,     lz + h, h)
					emit(lx + h, lz + h, h)
					return
				}
				out.set(nodeId(lx, lz, size), u)
			}
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

	let rs = roots.get(tileKey)
	const firstBuild = rs === undefined
	if (rs === undefined) {
		rs = { nodes: new Map(), snapshot: stages.slice(base, base + SNOW_TILE_CELL_COUNT) }
		roots.set(tileKey, rs)
	}

	// Multi-tile coarse sheet owns this root — keep snapshot current and
	// retire any leftover fine nodes so we do not double-draw.
	if (coarseCovered[tileKey] === 1) {
		for (const rec of rs.nodes.values()) {
			queueRetire(rec.entity)
			liveNodeCount--
		}
		rs.nodes.clear()
		for (let i = 0; i < SNOW_TILE_CELL_COUNT; i++) rs.snapshot[i] = stages[base + i]
		return 0
	}

	const desired = buildDesired(tileKey, stages)

	// Cells whose stage changed since the last build animate as 1 m leaves.
	const changedLeaves: number[] = []
	if (!firstBuild) {
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
	const baseY = baseYForTile(tileKey)
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
				e = createBox(x, z, baseY, SNOW_CELL_M, prevH)
			}
			startLeafAnim(e, x, z, baseY, MELTED_LEAF_HEIGHT_M, LEAF_DROP_MS, true)
			continue
		}

		if (desired.get(id) !== newStage) continue
		const durationMs = newStage < rs.snapshot[i] ? LEAF_DROP_MS : LEAF_RISE_MS
		if (live !== undefined) {
			live.stage = newStage
		} else {
			const e = createBox(x, z, baseY, SNOW_CELL_M, prevH)
			rs.nodes.set(id, { entity: e, stage: newStage, plane: false })
			liveNodeCount++
		}
		startLeafAnim(rs.nodes.get(id)!.entity, x, z, baseY, SNOW_STAGE_HEIGHT_M[newStage], durationMs, false)
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
					setBoxPose(live.entity, x, z, baseY, sizeM, h, plane)
					live.stage = stage
				}
				continue
			}
		}
		const e = createBox(x, z, baseY, sizeM, h, plane)
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

/** Stage at a world cell, or -1 off the playfield. */
function stageAtWorldCell(
	gx    : number,
	gz    : number,
	stages: Uint8Array,
): number {
	if (gx < 0 || gz < 0 || gx >= SNOW_CELLS_X || gz >= SNOW_CELLS_Z) return -1
	const tx = Math.floor(gx / SNOW_TILE_CELLS)
	const tz = Math.floor(gz / SNOW_TILE_CELLS)
	const key = tz * SNOW_TILES_X + tx
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
	if (roots.size === 0 && coarsePlanes.size === 0) return
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

	// Tear coarse sheets down when the player walks into their keep radius.
	for (const rec of coarsePlanes.values()) {
		const level = coarseLevelForTiles(rec.tiles)
		if (level === null) continue
		if (distSqToTileBlock(px, pz, rec.tx, rec.tz, rec.tiles) < level.playerKeepM * level.playerKeepM) {
			coarseDirty = true
			return
		}
	}
}


// MARK: coarseLevelForTiles

function coarseLevelForTiles(tiles: number): { tiles: number; playerKeepM: number; meltPadCells: number } | null {
	for (const level of COARSE_LEVELS) {
		if (level.tiles === tiles) return level
	}
	return null
}


// MARK: coarseKey

function coarseKey(
	tx:    number,
	tz:    number,
	tiles: number,
): string {
	return `${tx},${tz},${tiles}`
}


// MARK: tileIsUniformPristine

function tileIsUniformPristine(
	tileKey: number,
	stages:  Uint8Array,
): boolean {
	const base = tileKey * SNOW_TILE_CELL_COUNT
	for (let i = 0; i < SNOW_TILE_CELL_COUNT; i++) {
		if (stages[base + i] !== STAGE_PRISTINE) return false
	}
	return true
}


// MARK: distSqToTileBlock

/** Squared distance from a world XZ point to an N×N tile block's AABB. */
function distSqToTileBlock(
	px:    number,
	pz:    number,
	tx0:   number,
	tz0:   number,
	tiles: number,
): number {
	const minX = SNOW_ORIGIN_M + tx0 * SNOW_TILE_M
	const minZ = SNOW_ORIGIN_M + tz0 * SNOW_TILE_M
	const maxX = minX + tiles * SNOW_TILE_M
	const maxZ = minZ + tiles * SNOW_TILE_M
	const cx   = px < minX ? minX : (px > maxX ? maxX : px)
	const cz   = pz < minZ ? minZ : (pz > maxZ ? maxZ : pz)
	const dx   = px - cx
	const dz   = pz - cz
	return dx * dx + dz * dz
}


// MARK: coarseBlockEligible

/**
 * True when an N×N tile block can collapse into one LOD sheet: all on
 * one terrain level, fully pristine, far from the player (edge
 * clearance), and clear of melt. A block spanning two levels would have
 * to pick one height and leave the other half buried or floating.
 */
function coarseBlockEligible(
	tx0:    number,
	tz0:    number,
	tiles:  number,
	level:  { playerKeepM: number; meltPadCells: number },
	stages: Uint8Array,
	focus:  { x: number; z: number },
): boolean {
	const blockLevel = tileLevel[tz0 * SNOW_TILES_X + tx0]
	for (let tz = tz0; tz < tz0 + tiles; tz++) {
		for (let tx = tx0; tx < tx0 + tiles; tx++) {
			const k = tz * SNOW_TILES_X + tx
			if (tileLevel[k] !== blockLevel) return false
			if (!tileIsUniformPristine(k, stages)) return false
		}
	}

	if (distSqToTileBlock(focus.x, focus.z, tx0, tz0, tiles) < level.playerKeepM * level.playerKeepM) {
		return false
	}

	const gx0 = tx0 * SNOW_TILE_CELLS
	const gz0 = tz0 * SNOW_TILE_CELLS
	const gx1 = gx0 + tiles * SNOW_TILE_CELLS
	const gz1 = gz0 + tiles * SNOW_TILE_CELLS
	const pad = level.meltPadCells
	for (let gz = gz0 - pad; gz < gz1 + pad; gz++) {
		for (let gx = gx0 - pad; gx < gx1 + pad; gx++) {
			if (gx >= gx0 && gx < gx1 && gz >= gz0 && gz < gz1) continue
			if (stageAtWorldCell(gx, gz, stages) === 0) return false
		}
	}
	return true
}


// MARK: syncCoarsePlanes

/**
 * Greedy largest-first packing of pristine multi-tile snow sheets. Runs
 * only when melt, cliffs, or the player invalidate the previous layout.
 */
function syncCoarsePlanes(): void {
	coarseDirty = false
	const stages = getDisplayedStages()
	const focus  = readFocusXZ()
	const nextCovered = new Uint8Array(ROOT_COUNT)
	const desired = new Map<string, { tx: number; tz: number; tiles: number; stage: number }>()

	for (const level of COARSE_LEVELS) {
		const n = level.tiles
		for (let tz = 0; tz + n <= SNOW_TILES_Z; tz += n) {
			for (let tx = 0; tx + n <= SNOW_TILES_X; tx += n) {
				let blocked = false
				for (let rz = 0; rz < n && !blocked; rz++) {
					for (let rx = 0; rx < n; rx++) {
						if (nextCovered[(tz + rz) * SNOW_TILES_X + (tx + rx)] === 1) {
							blocked = true
							break
						}
					}
				}
				if (blocked) continue
				if (!coarseBlockEligible(tx, tz, n, level, stages, focus)) continue

				desired.set(coarseKey(tx, tz, n), { tx, tz, tiles: n, stage: STAGE_PRISTINE })
				for (let rz = 0; rz < n; rz++) {
					for (let rx = 0; rx < n; rx++) {
						nextCovered[(tz + rz) * SNOW_TILES_X + (tx + rx)] = 1
					}
				}
			}
		}
	}

	for (const [key, rec] of coarsePlanes) {
		if (desired.has(key)) continue
		queueRetire(rec.entity)
		coarsePlanes.delete(key)
		liveNodeCount--
	}

	for (const [key, want] of desired) {
		if (coarsePlanes.has(key)) continue
		const sizeM = want.tiles * SNOW_TILE_M
		const x     = SNOW_ORIGIN_M + (want.tx + want.tiles / 2) * SNOW_TILE_M
		const z     = SNOW_ORIGIN_M + (want.tz + want.tiles / 2) * SNOW_TILE_M
		// Uniform level across the block, so any member tile's base works.
		const baseY = baseYForTile(want.tz * SNOW_TILES_X + want.tx)
		const e     = createBox(x, z, baseY, sizeM, SNOW_STAGE_HEIGHT_M[want.stage], false)
		coarsePlanes.set(key, {
			tx:     want.tx,
			tz:     want.tz,
			tiles:  want.tiles,
			entity: e,
			stage:  want.stage,
		})
		liveNodeCount++
	}

	for (let k = 0; k < ROOT_COUNT; k++) {
		const was = coarseCovered[k]
		const now = nextCovered[k]
		if (was === now) continue
		if (now === 1) {
			const rs = roots.get(k)
			if (rs !== undefined && rs.nodes.size > 0) {
				pendingRoots.add(k)
			} else {
				pendingRoots.delete(k)
				fullPassRemaining.delete(k)
				if (rs !== undefined) {
					const base = k * SNOW_TILE_CELL_COUNT
					for (let i = 0; i < SNOW_TILE_CELL_COUNT; i++) rs.snapshot[i] = stages[base + i]
				}
			}
			continue
		}
		pendingRoots.add(k)
		urgentRoots.add(k)
	}
	coarseCovered = nextCovered
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

/**
 * 16 m sheet only when far from the player, not near a melt lip, and
 * not on a cliff edge. A plane has no sides, so on a lip it leaves the
 * snow looking like paper laid over bare rock from any angle that can
 * see the drop.
 */
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
	if (tileOnLevelBoundary(tileKey)) return false
	const focus = readFocusXZ()
	const dx    = worldX - focus.x
	const dz    = worldZ - focus.z
	if (dx * dx + dz * dz < PLANE_PLAYER_KEEP_M2) return false
	return !nodeTouchesMelt(tileKey, lx, lz, sizeCells, stages)
}


// MARK: tileOnLevelBoundary
// True when any 4-neighbour tile sits at a different elevation, i.e.
// this tile owns a cliff edge. Off-grid neighbours count, since the
// playfield edge is a drop too.
function tileOnLevelBoundary(tileKey: number): boolean {
	const { tx, tz } = tileCoordsFromKey(tileKey)
	const here = tileLevel[tileKey]
	for (let i = 0; i < 4; i++) {
		const nx = tx + (i === 0 ? 1 : i === 1 ? -1 : 0)
		const nz = tz + (i === 2 ? 1 : i === 3 ? -1 : 0)
		if (nx < 0 || nz < 0 || nx >= SNOW_TILES_X || nz >= SNOW_TILES_Z) return true
		if (tileLevel[nz * SNOW_TILES_X + nx] !== here) return true
	}
	return false
}


// MARK: createBox

function createBox(
	x:       number,
	z:       number,
	baseY:   number,
	size:    number,
	heightM: number,
	plane:   boolean = false,
): Entity {
	const e = engine.addEntity()
	if (plane) {
		Transform.create(e, {
			position: Vector3.create(x, baseY + heightM, z),
			rotation: PLANE_ROT,
			scale   : Vector3.create(size, size, 1),
		})
		MeshRenderer.setPlane(e)
	} else {
		Transform.create(e, {
			position: Vector3.create(x, baseY + heightM / 2, z),
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
	baseY:   number,
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
		tr.position = Vector3.create(x, baseY + heightM, z)
		tr.rotation = PLANE_ROT
		tr.scale    = Vector3.create(size, size, 1)
		return
	}
	tr.position = Vector3.create(x, baseY + heightM / 2, z)
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
	baseY:       number,
	endH:        number,
	durationMs:  number,
	removeAtEnd: boolean,
): void {
	if (durationMs <= 0) {
		if (removeAtEnd) {
			engine.removeEntity(e)
			return
		}
		setBoxPose(e, x, z, baseY, SNOW_CELL_M, endH)
		return
	}
	const tr     = Transform.getOrNull(e)
	const startH = tr ? tr.scale.y : endH
	anims.set(e, { x, z, baseY, startH, endH, elapsedMs: 0, durationMs, removeAtEnd })
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
		tr.position = Vector3.create(a.x, a.baseY + h / 2, a.z)
		tr.scale    = Vector3.create(SNOW_CELL_M, h, SNOW_CELL_M)
		if (raw < 1) continue
		anims.delete(e)
		if (a.removeAtEnd) engine.removeEntity(e)
	}
}


// MARK: buildGround

/**
 * No-op since the terrain renderer owns the ground. Its hearth-level
 * slabs are tinted melt-blue, so a melted cell reads the same as it did
 * on the old single playfield slab.
 */
function buildGround(): void {
	for (const e of groundEntities) engine.removeEntity(e)
	groundEntities = []
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
			range:     900,
			shadow:    true,
		})
		console.log('snowRenderer: setupSnowSun: morning key light placed over playfield')
	} catch (err) {
		console.error('snowRenderer: setupSnowSun: failed to place key light:', err)
	}
}
