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
 * 2 -> 1). Distant 16 m nodes are LOD boxes: the same full-height box
 * as near snow, but they do not cast shadows (the only real cost the old
 * LOD saved). Every snow node is a box, so wherever the snow height
 * changes (bare / melted ground, a lower stage, a cliff lip, the
 * near/far LOD seam) the taller node's own side face closes the step.
 * The old LOD drew a top-only plane, which floated as a sideless sheet
 * next to any lower neighbour. Stage 0 renders nothing, so the blue
 * ground shows.
 *
 * Far from melt, pristine roots coalesce into larger multi-tile boxes
 * (32 / 64 / 128 / 256 m) so a bigger playfield does not pay one entity
 * per 16 m tile; a block only coalesces when every tile in it shares
 * one level. Covered roots skip their fine quadtree until the player or
 * a melt lip approaches. Coarse sheets are always thick boxes (never
 * paper planes) so cliff lips keep vertical snow faces — a sheet never
 * spans two elevations.
 *
 * A dirty root is rebuilt create-first: new nodes spawn before old ones
 * leave, and replaced parents stay for RETIRE_FRAMES (sunk so their
 * top plane cannot z-fight the replacements). Roots are processed
 * urgent-first, then nearest, under a per-frame entity-creation budget.
 *
 * Only 1 m leaves animate: melts drop, regrowth rises. Coarser nodes
 * appear at their final height.
 *
 * Cell offsets (setSnowCellOffsets): per-cell signed base offset (m)
 * from the obelisks. Such cells always render as 1 m leaves whose
 * underside sits at ground + offset:
 *   - offset > 0: snow lying on top of a frozen obelisk ice chunk
 *     (raised by the ice height), normal stage height on top.
 *   - offset < 0: an activated obelisk's empty recess, depth d = -offset
 *     below the ground. Any snow (stage > 0) fills the recess back to
 *     ground level plus the normal stage height on top.
 * Tiles holding offset cells never coalesce into coarse sheets.
 */

import {
	engine,
	Entity,
	LightSource,
	Material,
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
	tileKeyOfCell,
} from 'src/shared/snowGrid'
import { getTerrain } from 'src/shared/terrain/terrainCache'

import {
	drainDirtyRoots,
	drainFrontRoots,
	getDisplayedStages,
	isHeatFrontActive,
	isSnowHydrated,
} from 'src/client/snow/snowModel'

const CREATE_BUDGET_PER_FRAME = 150
/** Max urgent (budget-exempt) tile rebuilds per frame, nearest first. */
const URGENT_MAX_PER_FRAME = 6
const CREATE_HARD_CAP         = 300
// While a predicted crystal heat front sweeps (snowModel.isHeatFrontActive): the roots at the
// front rebuild first and under a bigger budget, so the melt keeps up with the sphere edge.
const FRONT_CREATE_BUDGET_PER_FRAME = 420
const FRONT_CREATE_HARD_CAP         = 700
const SYNC_FALLBACK_MS        = 8000
const BOX_LIFT_M              = 0.01
const MELTED_LEAF_HEIGHT_M    = 0.02
const LEAF_DROP_MS            = 300
const LEAF_RISE_MS            = 400
const RETIRE_FRAMES           = 2
const RETIRE_SINK_M           = 0.08
const ROOT_COUNT              = SNOW_TILES_X * SNOW_TILES_Z
// Only a full 16 m tile far from the player becomes an LOD box (a
// normal box with sides that does not cast shadows). Never a top-only
// plane: a plane has no side faces, so any height step next to it
// (melt, lower stage, cliff, LOD seam) read as a floating sheet.
const PLANE_MIN_M             = 16
const PLANE_MELT_PAD_CELLS    = 16
const PLANE_PLAYER_KEEP_M     = 48
const PLANE_PLAYER_KEEP_M2    = PLANE_PLAYER_KEEP_M * PLANE_PLAYER_KEEP_M
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
/** Roots a predicted heat front touched and not yet rebuilt (front priority). */
const frontRoots        = new Set<number>()
const fullPassRemaining = new Set<number>()
const anims             = new Map<Entity, LeafAnim>()
const retireQueue: Array<{ entity: Entity; framesLeft: number }> = []
const coarsePlanes      = new Map<string, CoarseRec>()
/**
 * Coarse sheets that are no longer wanted but still stand in (sunk) for
 * the roots they covered until those roots' fine nodes exist. Retiring a
 * 128-256 m sheet at once left its tiles bare for many frames while the
 * per-frame create budget rebuilt them (snow chunks flickering out as a
 * fast melt front, e.g. the crystal burst, invalidated sheets).
 */
const heldCoarse: Array<{ entity: Entity; tiles: number[]; framesLeft: number }> = []
/** Safety cap on how long a held sheet may stand in (frames). */
const COARSE_HOLD_MAX_FRAMES = 180

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
/** Signed base offset (m) per snow cell key at an obelisk (see header). */
let cellOffset        = new Map<number, number>()
/** Roots (tile keys) holding at least one offset cell. */
let pitTiles          = new Set<number>()


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


// MARK: setSnowCellOffsets
/**
 * Replace the obelisk cell-offset layer (cell key -> signed offset in
 * m, see header). Only roots holding a cell whose offset changed are
 * rebuilt from scratch (heights are baked into node transforms), and
 * coarse sheets are repacked so none spans an obelisk. Empty map = no
 * offsets (cycle reset / no obelisk).
 */
export function setSnowCellOffsets(next: Map<number, number>): void {
	const nextTiles = new Set<number>()
	for (const key of next.keys()) nextTiles.add(tileKeyOfCell(key))
	const touched = new Set<number>()
	for (const [key, v] of next) if (cellOffset.get(key) !== v) touched.add(tileKeyOfCell(key))
	for (const key of cellOffset.keys()) if (!next.has(key)) touched.add(tileKeyOfCell(key))
	cellOffset = next
	pitTiles   = nextTiles
	for (const k of touched) {
		if (k < 0 || k >= ROOT_COUNT) continue
		dropRootNodes(k)
		pendingRoots.add(k)
		urgentRoots.add(k)
	}
	if (touched.size > 0) coarseDirty = true
	console.log(`snowRenderer: setSnowCellOffsets: ${next.size} offset cells in ${nextTiles.size} roots (${touched.size} rebuilt)`)
}


// MARK: getSnowCellLiftM
/** How far (m, >= 0) the snow on cell `key` is raised (lying on obelisk ice). */
export function getSnowCellLiftM(key: number): number {
	const v = cellOffset.get(key)
	return v !== undefined && v > 0 ? v : 0
}


// MARK: cellOffsetOf
/** Signed base offset (m) of local cell i of a root, 0 when none. */
function cellOffsetOf(tileKey: number, i: number): number {
	if (!pitTiles.has(tileKey)) return 0
	return cellOffset.get(tileKey * SNOW_TILE_CELL_COUNT + i) ?? 0
}


// MARK: leafHeight
/**
 * Leaf box height for a stage over base offset `off` (melted = thin
 * leaf). In an empty recess (off < 0) any snow fills it to ground level.
 */
function leafHeight(stage: number, off: number): number {
	if (stage <= 0) return MELTED_LEAF_HEIGHT_M
	// Snow on obelisk ice: one section max (the mound's snow cap).
	if (off > 0) return SNOW_STAGE_HEIGHT_M[1]
	return SNOW_STAGE_HEIGHT_M[stage] + (off < 0 ? -off : 0)
}


// MARK: nodeHasOffset
/** True when any cell under this node carries a base offset. */
function nodeHasOffset(tileKey: number, lx: number, lz: number, size: number): boolean {
	if (!pitTiles.has(tileKey)) return false
	for (let r = lz; r < lz + size; r++) {
		for (let c = lx; c < lx + size; c++) {
			if (cellOffsetOf(tileKey, r * SNOW_TILE_CELLS + c) !== 0) return true
		}
	}
	return false
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
	for (const h of heldCoarse) queueRetire(h.entity)
	heldCoarse.length = 0
}


// MARK: holdCoarseSheet
// Sink an unwanted coarse sheet (so it cannot z-fight fine nodes) but
// keep it drawn until every root it covered has been rebuilt.
function holdCoarseSheet(rec: CoarseRec): void {
	anims.delete(rec.entity)
	sinkRetiringBox(rec.entity)
	const tiles: number[] = []
	for (let rz = 0; rz < rec.tiles; rz++) for (let rx = 0; rx < rec.tiles; rx++) tiles.push((rec.tz + rz) * SNOW_TILES_X + rec.tx + rx)
	heldCoarse.push({ entity: rec.entity, tiles, framesLeft: COARSE_HOLD_MAX_FRAMES })
}


// MARK: releaseHeldCoarse
function releaseHeldCoarse(): void {
	if (heldCoarse.length === 0) return
	let write = 0
	for (const h of heldCoarse) {
		h.framesLeft--
		let waiting = false
		if (h.framesLeft > 0) for (const k of h.tiles) if (pendingRoots.has(k)) { waiting = true; break }
		if (waiting) { heldCoarse[write++] = h; continue }
		// Already sunk: remove after the usual retire frames.
		retireQueue.push({ entity: h.entity, framesLeft: RETIRE_FRAMES })
	}
	heldCoarse.length = write
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
	drainFrontRoots(frontRoots)
	if (pendingRoots.size > dirtyBefore) coarseDirty = true

	promoteNearbyPlanes()

	if (coarseDirty) syncCoarsePlanes()

	if (pendingRoots.size > 0) processPendingRoots()
	releaseHeldCoarse()

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

	// Heat-front roots next (nearest the focus first), ahead of ordinary dirty roots.
	const urgentCount = order.length
	const frontActive = isHeatFrontActive()
	const frontSet    = new Set<number>()
	if (frontRoots.size > 0) {
		const fr: Array<{ k: number; d: number }> = []
		for (const k of frontRoots) {
			if (!pendingRoots.has(k)) { frontRoots.delete(k); continue }
			if (inOrder.has(k)) continue
			fr.push({ k, d: distSq(k) })
		}
		fr.sort((a, b) => a.d - b.d)
		for (const r of fr) { order.push(r.k); inOrder.add(r.k); frontSet.add(r.k) }
	}
	const budget  = frontActive ? FRONT_CREATE_BUDGET_PER_FRAME : CREATE_BUDGET_PER_FRAME
	const hardCap = frontActive ? FRONT_CREATE_HARD_CAP : CREATE_HARD_CAP

	const rest: Array<{ k: number; d: number }> = []
	for (const k of pendingRoots) {
		if (inOrder.has(k)) continue
		rest.push({ k, d: distSq(k) })
	}
	rest.sort((a, b) => a.d - b.d)
	for (const r of rest) order.push(r.k)

	let spent = 0
	let idx = 0
	for (const k of order) {
		const isUrgent = idx++ < urgentCount
		if (!isUrgent && spent >= budget) break
		// Urgent roots (local torch / stomp) always rebuild this frame so
		// a 16 m pristine cube cannot stay standing under the player.
		const cap = isUrgent || spent === 0
			? Number.POSITIVE_INFINITY
			: hardCap - spent
		const created = rebuildRoot(k, cap)
		if (created < 0) {
			// A front root too big for what is left this frame waits for the next one; the rest of
			// the front must not starve behind it.
			if (frontSet.has(k)) continue
			break
		}
		spent += created
		pendingRoots.delete(k)
		fullPassRemaining.delete(k)
		frontRoots.delete(k)
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
		// Offset cells each have their own base: always 1 m leaves.
		if (size > 1 && nodeHasOffset(tileKey, lx, lz, size)) {
			const h = size / 2
			emit(lx,     lz,     h)
			emit(lx + h, lz,     h)
			emit(lx,     lz + h, h)
			emit(lx + h, lz + h, h)
			return
		}
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
		const off      = cellOffsetOf(tileKey, i)
		const leafY    = baseY + off
		const prevH    = leafHeight(rs.snapshot[i], off)
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
				e = createBox(x, z, leafY, SNOW_CELL_M, prevH)
			}
			startLeafAnim(e, x, z, leafY, MELTED_LEAF_HEIGHT_M, LEAF_DROP_MS, true)
			continue
		}

		if (desired.get(id) !== newStage) continue
		const durationMs = newStage < rs.snapshot[i] ? LEAF_DROP_MS : LEAF_RISE_MS
		if (live !== undefined) {
			live.stage = newStage
		} else {
			const e = createBox(x, z, leafY, SNOW_CELL_M, prevH)
			rs.nodes.set(id, { entity: e, stage: newStage, plane: false })
			liveNodeCount++
		}
		startLeafAnim(rs.nodes.get(id)!.entity, x, z, leafY, leafHeight(newStage, off), durationMs, false)
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
		const off   = size === 1 ? cellOffsetOf(tileKey, lz * SNOW_TILE_CELLS + lx) : 0
		const nodeY = baseY + off
		const h     = off !== 0 ? leafHeight(stage, off) : SNOW_STAGE_HEIGHT_M[stage]
		const sizeM = size * SNOW_CELL_M
		const plane = wantsLodPlane(tileKey, lx, lz, size, stages, x, z)
		if (live !== undefined) {
			if (live.plane !== plane) {
				queueRetire(live.entity)
				rs.nodes.delete(id)
				liveNodeCount--
			} else {
				if (live.stage !== stage) {
					setBoxPose(live.entity, x, z, nodeY, sizeM, h, plane)
					live.stage = stage
				}
				continue
			}
		}
		const e = createBox(x, z, nodeY, sizeM, h, plane)
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
			if (pitTiles.has(k)) return false
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
		holdCoarseSheet(rec)
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
 * LOD (non-shadow-casting box) for a full 16 m node far from the player.
 * The LOD node is still a full box with side faces, so it is safe on a
 * melt lip, next to lower stages and on a cliff edge; no neighbour scan
 * is needed (the old top-only plane had to scan a 48x48-cell melt pad
 * per node and still went stale when a neighbour melted later).
 */
function wantsLodPlane(
	_tileKey : number,
	_lx      : number,
	_lz      : number,
	sizeCells: number,
	_stages  : Uint8Array,
	worldX   : number,
	worldZ   : number,
): boolean {
	if (sizeCells * SNOW_CELL_M < PLANE_MIN_M) return false
	const focus = readFocusXZ()
	const dx    = worldX - focus.x
	const dz    = worldZ - focus.z
	return dx * dx + dz * dz >= PLANE_PLAYER_KEEP_M2
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
	// `plane` = distant LOD node: same box (with sides), no shadow cast.
	const e = engine.addEntity()
	Transform.create(e, {
		position: Vector3.create(x, baseY + heightM / 2, z),
		scale   : Vector3.create(size, heightM, size),
	})
	MeshRenderer.setBox(e)
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
	void plane // LOD nodes are boxes too; only their shadow flag differs.
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
