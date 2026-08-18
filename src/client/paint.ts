// Squareoff paint grid. Phase 1 scaffolding — single-player, single-team for now.
// Design doc: assets/docs/SQUAREOFF-DESIGN.md
// Constants from settings / maze; tile grid Map passed in via init().

import { engine, Transform, MeshRenderer, Material, Entity, NetworkEntity, Tween, EasingFunction } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'

import { isInsideMeltRadius } from 'src/shared/campfire'
import { PaintCell, PaletteEntry, PaintCoverage } from 'src/shared/components'
import {
	HI,
	LO,
	MASKS,
	Mask,
	SIZE,
	cellId as sharedCellId,
	rotateMask as sharedRotateMask,
} from 'src/shared/maze/graph'
import { TileType } from 'src/shared/maze/tiles'
import { cellIdToKey, cellKeyFromNetworkId, cellKeyToCellId } from 'src/shared/paintGrid'
import {
	TEAM_COLORS,
	PALETTE_NONE,
	PALETTE_RED,
	PALETTE_BLUE,
	teamPaletteIndex,
} from 'src/shared/palette'
import {
	MAZE_ORIGIN_OFFSET_METERS,
	MAZE_TILE_GLTF_SCALE,
	PAINT_BRUSH_LEAD_METERS,
	PAINT_CELL_SIZE_METERS,

} from 'src/shared/settings'
import { Team } from 'src/shared/team'
import { eventBus, ClientEvents } from 'src/shared/utils/eventBus'

// Re-export shared symbols so existing paint consumers don't need to
// change their import paths.
export { MASKS, type Mask }

import { getBrushCells } from 'src/client/brush'

// Team enum lives in shared/; re-exported for existing `import { Team } from 'src/client/paint'` call sites.
export { Team } from 'src/shared/team'

// Palette colors from PaletteEntry CRDT. Seeded with the same team colors
// the server writes so materials resolve as soon as PaintCell indexes land.
const paletteByIndex = new Map<number, Color4>([
	[PALETTE_NONE, TEAM_COLORS[Team.None]],
	[PALETTE_RED,  TEAM_COLORS[Team.Red]],
	[PALETTE_BLUE, TEAM_COLORS[Team.Blue]],
])

// Last PaintCell (index, stage) seen from CRDT (authoritative reconcile).
// stage 0..2 mirrors the server; stage 3 is not carried on the wire —
// the server represents "fully regrown" by setting index back to NONE.
type AppliedCell = { index: number; stage: 0 | 1 | 2 }
const cellApplied = new Map<number, AppliedCell>()
// cellId → last rendered palette index (optimistic local and/or CRDT).
const renderedIndex = new Map<string, number>()

// Set on teamAssigned. Optimistic paint is skipped until then.
let localTeam: Team = Team.None


// MARK: setLocalTeam
/**
 * Override the local team used for optimistic paint. Note: the server
 * still attributes paintTick messages to the player's assigned roster
 * team, so this only affects the local preview colour — CRDT reconcile
 * will overwrite each cell to the server-authoritative colour.
 */
export function setLocalTeam(team: Team): void {
	localTeam = team
}


// MARK: getLocalTeam
export function getLocalTeam(): Team {
	return localTeam
}


// MARK: initPaintNet

/**
 * Observe PaintCell / PaletteEntry CRDT. Local brush also paints
 * optimistically; CRDT reconcile uses cellApplied so stale replicas do
 * not flash over our pending colour until the server index changes.
 */
export function initPaintNet(): void {
	eventBus.on(ClientEvents.TeamAssigned, ({ team }) => {
		localTeam = team
	})

	engine.addSystem(() => {
		syncPaletteFromCrdt()
		syncCellsFromCrdt()
	})
}


// MARK: syncPaletteFromCrdt

function syncPaletteFromCrdt(): void {
	for (const [_entity, entry] of engine.getEntitiesWith(PaletteEntry)) {
		if (entry.index > PALETTE_BLUE && entry.color.a === 0) continue
		const prev = paletteByIndex.get(entry.index)
		if (prev &&
			prev.r === entry.color.r && prev.g === entry.color.g &&
			prev.b === entry.color.b && prev.a === entry.color.a) {
			continue
		}
		paletteByIndex.set(entry.index, Color4.create(
			entry.color.r, entry.color.g, entry.color.b, entry.color.a,
		))
		for (const [id, idx] of renderedIndex) {
			if (idx === entry.index) applyPaintIndex(id, idx, true)
		}
	}
}


// MARK: syncCellsFromCrdt

function syncCellsFromCrdt(): void {
	for (const [entity, cell] of engine.getEntitiesWith(PaintCell)) {
		const net = NetworkEntity.getOrNull(entity)
		if (!net) continue
		const key = cellKeyFromNetworkId(Number(net.entityId))
		if (key === null) continue
		const prev = cellApplied.get(key)
		const nextStage = Math.max(0, Math.min(2, cell.stage | 0)) as 0 | 1 | 2
		if (prev && prev.index === cell.index && prev.stage === nextStage) continue
		const id = cellKeyToCellId(key)

		if (!prev || prev.index !== cell.index) {
			// Palette flipped — either freshly melted (NONE→team) or the
			// terminal server transition (team→NONE). applyPaintIndex owns
			// the drop/rise tween + material swap.
			applyPaintIndex(id, cell.index, false)
			// Late-join hydrate: server may report a non-zero stage on the
			// same wire message as the initial index (e.g. we joined into a
			// mid-regrown cell). Push the rise-tween on top of the drop.
			if (cell.index !== PALETTE_NONE && (nextStage === 1 || nextStage === 2)) {
				advanceSnowFillStage(id, nextStage)
			}
		} else if (nextStage === 0) {
			// Same team, stage reset to 0 — a melt refresh (campfire ring or
			// player re-stamp). Force the cube back down to flat.
			applyPaintIndex(id, cell.index, true)
		} else {
			// Same team, stage advanced (1 or 2). Rise-tween to that height.
			advanceSnowFillStage(id, nextStage)
		}

		cellApplied.set(key, { index: cell.index, stage: nextStage })
	}
}

// MARK: mask & tile-topology imports
//
// Masks, SIZE/LO/HI, cellId, and rotateMask now live in shared/maze/graph
// (single source of truth used by paint spawning AND bot pathfinding).
// Only paint-specific derivations — mesh spawn helpers, ramp geometry
// with cosA/sinA needed by tile transforms — remain here.

// GLB floor is 0.25 local (0.5m world) above the tile origin. Sit paint cells
// 0.26 local (0.52m world) above origin → 0.02m world above the walkable surface.
export const FLAT_OFFSET = 0.275 * MAZE_TILE_GLTF_SCALE // clears floor + tilted-cell edge sag

/**
 * Flat landing length at each end of a ramp, in world meters.
 * Must match tile-ramp.glb (1.0 local × MAZE_TILE_GLTF_SCALE). Do NOT derive
 * this from paint cell size — when SIZE went 16→32, a 1-cell landing shrank
 * from 2m to 1m and the incline math buried the upper half of the slope.
 */
const RAMP_FLAT_END_METERS = 1.0 * MAZE_TILE_GLTF_SCALE

// Ramp geometry derived from CELL and STEP. Same math used by spawn and lookup
// so cellIds agree.
function rampGeometry(CELL: number, STEP: number) {
	const cellSize     = CELL / SIZE
	const flatLen      = RAMP_FLAT_END_METERS
	const nFlat        = Math.max(1, Math.round(flatLen / cellSize))
	const inclineStart = flatLen
	const inclineEnd   = CELL - flatLen
	const inclineLen   = inclineEnd - inclineStart
	const slopeLen     = Math.sqrt(STEP * STEP + inclineLen * inclineLen)
	// Cap incline row count so total rows (nFlat + nIncline + nFlat) fits within
	// SIZE. Otherwise the top landing row's cellId row-index >= SIZE, which
	// cellIdToKey() rejects — the mesh spawns but never receives paint.
	const nInclineIdeal = Math.round(slopeLen / cellSize)
	const nInclineMax   = SIZE - 2 * nFlat
	const nIncline      = Math.min(nInclineIdeal, nInclineMax)
	const slopeCellSize = slopeLen / nIncline
	const cosA         = inclineLen / slopeLen
	const sinA         = STEP / slopeLen
	return {
		cellSize, flatLen, nFlat,
		inclineStart, inclineEnd, inclineLen,
		slopeLen, nIncline, slopeCellSize, cosA, sinA,
	}
}

// Given canonical (lx, lz) on a ramp, return the cell (col, row) used in
// cellId. Returns null if outside the walkable corridor.
function rampCellIdxFromCanonical(lx: number, lz: number, geom: ReturnType<typeof rampGeometry>): { col: number; row: number } | null {
	const col = Math.floor(lx / geom.cellSize)
	if (col < LO || col >= HI) return null
	let row: number
	if (lz < geom.inclineStart) {
		row = Math.floor(lz / geom.cellSize)
	} else if (lz >= geom.inclineEnd) {
		row = geom.nFlat + geom.nIncline + Math.floor((lz - geom.inclineEnd) / geom.cellSize)
	} else {
		const slopeDist = (lz - geom.inclineStart) / geom.cosA
		row = geom.nFlat + Math.floor(slopeDist / geom.slopeCellSize)
	}
	return { col, row }
}

// MARK: Cell store
// Mesh entities for walkable cells. Paint color comes only from PaintCell CRDT.
// Non-ramp cells spawn as white cubes and tween down to a flat colored slab
// on first paint. Ramp cells stay as tilted planes (kind='plane').
type CellKind = 'cube' | 'plane'
type CellData = {
	entity:   Entity
	kind:     CellKind
	basePos:  Vector3 // world position of the flat state (also the cube's bottom-face center Y)
	cellSize: number
}
const cellEntity  = new Map<string, Entity>()
const cellData    = new Map<string, CellData>()
const paintByTile = new Map<Entity, { entities: Entity[]; ids: string[] }>()

// Cube geometry + drop-tween settings.
const CUBE_HEIGHT       = 1.5
const PAINTED_THICKNESS = 0.02
const DROP_DURATION_MS  = 300

// Snow infill: after a cell is painted (melted) it grows back in three
// discrete stages. As of the server-authoritative regrowth migration,
// stage advancement is owned by the SERVER — clients receive stage
// changes via PaintCell CRDT and just tween the visual to match.
//
// Stage 3 (full snow) is not carried on the wire; instead the server
// sets index back to PALETTE_NONE and the cell rises back to a full
// unpainted cube via the standard applyPaintIndex path.
const SNOW_FILL_STAGE_HEIGHT  = [0.5,   1.0,   CUBE_HEIGHT] as const
const SNOW_FILL_TWEEN_MS      = 400

// Snow-white material for the unpainted cube (independent of PALETTE_NONE
// so resetting the palette does not affect the snow colour).
const CUBE_GREY_MAT = cellMaterialFromColor(Color4.create(1, 1, 1, 1))

type DropAnim = {
	startY:      number
	endY:        number
	startScaleY: number
	endScaleY:   number
	elapsedMs:   number
	durationMs:  number
	// Material to swap in once the tween completes (null = no swap).
	finalMat:    ReturnType<typeof cellMaterialFromColor> | null
}
const dropAnims = new Map<string, DropAnim>()

// Per-cell snow-infill state. `paintedAtMs` is the reference time (in the
// paintClockMs still advances — dropAnims + deferredSpawns lean on it.
let   paintClockMs         = 0


// MARK: advanceSnowFillStage
/**
 * Push a rise-tween on cell `id` toward the height for `stage` (1..2).
 * Called from the CRDT observer when the server advances a cell's
 * regrowth stage. On stage 1 snaps the material back to grey (from the
 * painted team color) since we're no longer showing paint pigment once
 * snow has re-accumulated.
 *
 * Stage 3 (full snow) does not come through here — the server signals
 * that terminal transition by setting PaintCell.index back to NONE,
 * which the CRDT observer routes through applyPaintIndex for the full
 * cube-rise tween + material reset.
 */
function advanceSnowFillStage(id: string, stage: 1 | 2): void {
	const data = cellData.get(id)
	if (!data || data.kind !== 'cube') return

	const targetScaleY = SNOW_FILL_STAGE_HEIGHT[stage - 1]
	const targetY      = data.basePos.y + targetScaleY / 2
	const tr           = Transform.getOrNull(data.entity)
	const startY       = tr ? tr.position.y : data.basePos.y + PAINTED_THICKNESS / 2
	const startScaleY  = tr ? tr.scale.y    : PAINTED_THICKNESS

	if (stage === 1) {
		Material.setPbrMaterial(data.entity, CUBE_GREY_MAT)
	}

	dropAnims.set(id, {
		startY, endY: targetY,
		startScaleY, endScaleY: targetScaleY,
		elapsedMs: 0, durationMs: SNOW_FILL_TWEEN_MS,
		finalMat: null,
	})
}

engine.addSystem((dt: number) => {
	paintClockMs += dt * 1000

	// Drop / rise tweens.
	if (dropAnims.size > 0) {
		const dtMs = dt * 1000
		for (const [id, anim] of dropAnims) {
			anim.elapsedMs += dtMs
			const raw = Math.min(1, anim.elapsedMs / anim.durationMs)
			const k   = 1 - Math.pow(1 - raw, 3) // easeOutCubic
			const data = cellData.get(id)
			if (!data) { dropAnims.delete(id); continue }
			const y  = anim.startY      + (anim.endY      - anim.startY)      * k
			const sy = anim.startScaleY + (anim.endScaleY - anim.startScaleY) * k
			const tr = Transform.getMutableOrNull(data.entity)
			if (!tr) { dropAnims.delete(id); continue }
			tr.position = Vector3.create(data.basePos.x, y, data.basePos.z)
			tr.scale    = Vector3.create(data.cellSize, sy, data.cellSize)
			if (raw >= 1) {
				if (anim.finalMat) Material.setPbrMaterial(data.entity, anim.finalMat)
				dropAnims.delete(id)
			}
		}
	}

	// Snow regrowth is server-authoritative — stage transitions arrive
	// via PaintCell CRDT and are dispatched by syncCellsFromCrdt() to
	// advanceSnowFillStage() / applyPaintIndex() as visual tweens. No
	// client-side timer needed here anymore.
})

// Re-export shared cellId + rotateMask under the original paint.ts names
// so existing callers keep working during migration.
export const cellId = sharedCellId
export const rotateMask = sharedRotateMask

// Matte PBR material. Roughness=1 + metallic=0 + no specular kills the shine
// so paint reads as flat pigment, not plastic. Shared by palette index once
// the Color4 is known.
function cellMaterialFromColor(color: Color4) {
	return {
		albedoColor:       color,
		roughness:         1.0,
		metallic:          0.0,
		specularIntensity: 0.0,
	}
}

function cellMaterialForIndex(index: number): ReturnType<typeof cellMaterialFromColor> | null {
	const color = paletteByIndex.get(index)
	if (!color) return null
	return cellMaterialFromColor(color)
}

// MARK: Deferred spawn
// Paint cells are held back until the tile's grow-in tween finishes so the
// GLB is fully visible before its grid appears. All entries use the same
// delay, so the queue naturally stays FIFO-ordered by dueMs.
const SPAWN_DELAY_MS = 500 // matches spawnTileWithGrow's tween duration
const deferredSpawns: Array<{ dueMs: number; run: () => void }> = []
let spawnClockMs = 0
engine.addSystem((dt: number) => {
  spawnClockMs += dt * 1000
  while (deferredSpawns.length && deferredSpawns[0].dueMs <= spawnClockMs) {
    deferredSpawns.shift()!.run()
  }
})

// Wipe scoring state immediately (so coverage % snaps to 0) without touching
// entities. Actual paint entity removal is driven per-tile by
// removePaintForTile() during the chunked tile teardown — that way paint
// disappears in the same frame as its tile, avoiding ghost cells, while
// the total ~30k removeEntity() cost is spread across several frames.
export function clearAllPaintState() {
	cellApplied.clear()
	renderedIndex.clear()
	paintOutbox.clear()
}

export function removePaintForTile(tileEntity: Entity) {
	const rec = paintByTile.get(tileEntity)
	if (!rec) return
	for (const e of rec.entities) engine.removeEntity(e)
	for (const id of rec.ids) {
		cellEntity.delete(id)
		cellData.delete(id)
		dropAnims.delete(id)
		renderedIndex.delete(id)
		const key = cellIdToKey(id)
		if (key !== null) cellApplied.delete(key)
	}
	paintByTile.delete(tileEntity)
}

/**
 * Reset paint visuals on a tile without destroying meshes (center cross
 * at round boundary). Authoritative clear comes from server PaintCell writes.
 */
export function resetPaintForTile(tileEntity: Entity) {
	const rec = paintByTile.get(tileEntity)
	if (!rec) return
	for (let i = 0; i < rec.entities.length; i++) {
		const id = rec.ids[i]
		renderedIndex.set(id, PALETTE_NONE)
		const key = cellIdToKey(id)
		if (key !== null) cellApplied.set(key, { index: PALETTE_NONE, stage: 0 })
		// Force-drive back to unpainted (cube rises, plane hides).
		applyPaintIndex(id, PALETTE_NONE, true)
	}
}

// MARK: Network outbox
// Cell ids to send as paintTick commands. Not paint state — just the
// client→server request queue, drained at PAINT_TICK_HZ after roster join.
const paintOutbox = new Set<string>()


// MARK: drainPaintOutbox

/** Drain up to `max` pending cell ids for one paintTick. */
export function drainPaintOutbox(max: number): string[] {
	if (paintOutbox.size === 0) return []
	const out: string[] = []
	for (const id of paintOutbox) {
		out.push(id)
		if (out.length >= max) break
	}
	for (const id of out) paintOutbox.delete(id)
	return out
}


// MARK: enqueuePaintCandidate

/**
 * Queue a cell id for paintTick and, once rostered, paint the mesh
 * immediately so the brush stays under the avatar.
 */
export function enqueuePaintCandidate(id: string): void {
	// Drop ids the server cannot pack (e.g. ramp rows outside 0..SIZE-1).
	if (cellIdToKey(id) === null) return
	paintOutbox.add(id)
	if (localTeam === Team.None) return
	const index = teamPaletteIndex(localTeam)
	const data  = cellData.get(id)

	// If the cube is mid-regrowth (server stage 1 or 2), the palette index
	// still matches locally so the fast path below would no-op and leave
	// the half-grown cube standing. Force a fresh drop-down tween back to
	// flat; the server will echo stage=0 shortly after via paintTick.
	const key = cellIdToKey(id)
	const appliedStage = key !== null ? cellApplied.get(key)?.stage ?? 0 : 0
	if (data && data.kind === 'cube' && appliedStage >= 1 && renderedIndex.get(id) === index) {
		applyPaintIndex(id, index, true)
		return
	}

	if (renderedIndex.get(id) === index) return
	applyPaintIndex(id, index, false)
}


// MARK: applyPaintIndex

/**
 * Apply a palette index to a cell mesh (optimistic local or CRDT → view).
 * Same-index calls are a no-op unless `force` (palette colour changed).
 */
export function applyPaintIndex(id: string, index: number, force: boolean): void {
	if (!force && renderedIndex.get(id) === index) return
	renderedIndex.set(id, index)
	const data = cellData.get(id)
	if (!data) return
	const painted = index !== PALETTE_NONE

	if (data.kind === 'cube') {
		// Cube stays grey while it tweens down; team color is applied once flat.
		// On rise (unpaint), snap back to grey immediately.
		if (!painted) Material.setPbrMaterial(data.entity, CUBE_GREY_MAT)
		else          Material.setPbrMaterial(data.entity, CUBE_GREY_MAT)
		const finalMat = painted ? (cellMaterialForIndex(index) ?? null) : null
		const tr = Transform.getOrNull(data.entity)
		const startY      = tr ? tr.position.y : data.basePos.y + CUBE_HEIGHT / 2
		const startScaleY = tr ? tr.scale.y    : CUBE_HEIGHT
		const endScaleY   = painted ? PAINTED_THICKNESS : CUBE_HEIGHT
		const endY        = data.basePos.y + endScaleY / 2
		dropAnims.set(id, {
			startY, endY, startScaleY, endScaleY,
			elapsedMs: 0, durationMs: DROP_DURATION_MS,
			finalMat,
		})
		return
	}

	// Plane cell (ramp): original behavior — recolor only.
	const mat = cellMaterialForIndex(index)
	if (!mat) return
	Material.setPbrMaterial(data.entity, mat)
}

// MARK: Spawn cells
// Called from index.ts after a tile is placed. `tileType` selects the mask,
// `r` rotates it, and (tx, tz, ty) locate the tile in the maze grid.
export function spawnCellsForTile(
  tileType: string,
  r: number,
  tx: number, tz: number, ty: number,
  CELL: number, STEP: number,
  tileEntity: Entity
) {
  const raw = MASKS[tileType as TileType]
  if (!raw) return // designer hasn't authored this tile's mask yet
  // Defer the actual spawn so cells appear after the GLB's grow-in tween.
  deferredSpawns.push({
    dueMs: spawnClockMs + SPAWN_DELAY_MS,
    run: () => spawnCellsForTileImmediate(tileType, r, tx, tz, ty, CELL, STEP, tileEntity),
  })
}

function spawnCellsForTileImmediate(
  tileType: string,
  r: number,
  tx: number, tz: number, ty: number,
  CELL: number, STEP: number,
  tileEntity: Entity
) {
  const raw = MASKS[tileType as TileType]
  if (!raw) return
  const mask = rotateMask(raw, r)
  const h = mask.length, w = mask[0].length
  // World meters per mask cell. Mask is authored at 1 cell = 1m; the tile
  // fills CELL x CELL world meters, so w should equal CELL.
  const cellSize = CELL / w

  const tileWorldX = tx * CELL + MAZE_ORIGIN_OFFSET_METERS
  const tileWorldZ = tz * CELL + MAZE_ORIGIN_OFFSET_METERS

  // Ramp height helper: canonical ramp rises +Z (N high). After tile rotation
  // r, the slope axis rotates too. Given a world (wx, wz) on the tile, we
  // recover the canonical local (lx, lz) via the same math ROT_OFFSET encodes:
  // local +Z direction, in world frame, is (sin(r*90°), cos(r*90°)) applied to
  // the vector from tile center to the point.
  const isRamp = tileType === 'ramp'
  const rad = r * Math.PI / 2
  const sinR = Math.sin(rad), cosR = Math.cos(rad)
  const geom = rampGeometry(CELL, STEP)
  const slopeAngleDeg = Math.atan2(STEP, geom.inclineLen) * 180 / Math.PI

  // Precomputed rotations. Cell base is -90° around X (face up). Incline cells
  // add slope tilt (negative so the canonical +Z / high edge lifts up). Both
  // then get the tile's yaw (r * 90° around Y) so the tilt axis rotates with
  // the tile — canonical tilt is around world X, rotated versions tilt around
  // the corresponding rotated axis.
  const yaw = Quaternion.fromEulerDegrees(0, r * 90, 0)
  const flatRot = Quaternion.multiply(yaw, Quaternion.fromEulerDegrees(-90, 0, 0))
  const inclineRot = Quaternion.multiply(yaw, Quaternion.fromEulerDegrees(-90 - slopeAngleDeg, 0, 0))

  // Convert canonical local (lx, lz) → world (wx, wz), applying the tile's CW
  // yaw around its center. Same math ROT_OFFSET encodes.
  const localToWorld = (lx: number, lz: number) => {
    const cx = lx - CELL / 2, cz = lz - CELL / 2
    const wxRel =  cx * cosR + cz * sinR
    const wzRel = -cx * sinR + cz * cosR
    return {
      wx: tileWorldX + CELL / 2 + wxRel,
      wz: tileWorldZ + CELL / 2 + wzRel,
    }
  }

  let tileRec = paintByTile.get(tileEntity)
  if (!tileRec) {
    tileRec = { entities: [], ids: [] }
    paintByTile.set(tileEntity, tileRec)
  }

	// Ramp cell: tilted plane (unchanged from main).
	const spawnOne = (wx: number, wy: number, wz: number, rot: any, col: number, row: number, scaleY: number = cellSize) => {
		const id  = cellId(tx, tz, ty, col, row)
		const key = cellIdToKey(id)
		const appliedIdx = key !== null ? cellApplied.get(key)?.index : undefined
		const preexisting = appliedIdx ?? renderedIndex.get(id) ?? PALETTE_NONE
		const e = engine.addEntity()
		Transform.create(e, {
			position: Vector3.create(wx, wy, wz),
			rotation: rot,
			scale:    Vector3.create(cellSize, scaleY, 1),
		})
		MeshRenderer.setPlane(e)
		const mat = cellMaterialForIndex(preexisting) ?? cellMaterialForIndex(PALETTE_NONE)!
		Material.setPbrMaterial(e, mat)
		cellEntity.set(id, e)
		cellData.set(id, { entity: e, kind: 'plane', basePos: Vector3.create(wx, wy, wz), cellSize })
		renderedIndex.set(id, preexisting)
		tileRec!.entities.push(e)
		tileRec!.ids.push(id)
	}

	// Flat (non-ramp) cell: white cube standing on the walkable surface.
	// On paint, applyPaintIndex tweens it down to a colored slab at (wx, wy, wz).
	const spawnCube = (wx: number, wy: number, wz: number, col: number, row: number) => {
		const id  = cellId(tx, tz, ty, col, row)
		const key = cellIdToKey(id)
		const appliedIdx   = key !== null ? cellApplied.get(key)?.index : undefined
		const appliedStage = (key !== null ? cellApplied.get(key)?.stage ?? 0 : 0) as 0 | 1 | 2
		const preexisting = appliedIdx ?? renderedIndex.get(id) ?? PALETTE_NONE
		const painted   = preexisting !== PALETTE_NONE
		// If server already reports a regrown stage (1 or 2), spawn the
		// cube at that intermediate height instead of the flat slab.
		const regrownThickness = appliedStage > 0 ? SNOW_FILL_STAGE_HEIGHT[appliedStage - 1] : null
		const thickness = regrownThickness ?? (painted ? PAINTED_THICKNESS : CUBE_HEIGHT)
		const e = engine.addEntity()
		Transform.create(e, {
			position: Vector3.create(wx, wy + thickness / 2, wz),
			scale:    Vector3.create(cellSize, thickness, cellSize),
		})
		MeshRenderer.setBox(e)
		const mat = painted
			? (cellMaterialForIndex(preexisting) ?? CUBE_GREY_MAT)
			: CUBE_GREY_MAT
		Material.setPbrMaterial(e, mat)
		cellEntity.set(id, e)
		cellData.set(id, { entity: e, kind: 'cube', basePos: Vector3.create(wx, wy, wz), cellSize })
		renderedIndex.set(id, preexisting)
		// Server owns regrowth timing now — nothing to schedule locally.
		// If we spawned at a regrown intermediate height, snap the material
		// back to grey so the painted team color is not showing through
		// half-standing snow.
		if (regrownThickness !== null) {
			Material.setPbrMaterial(e, CUBE_GREY_MAT)
		}
		tileRec!.entities.push(e)
		tileRec!.ids.push(id)
	}

  // Ramp: space incline cells along the SLOPE so they tile flush.
  // (col, row) from rampCellIdxFromCanonical() agree with worldToCellId.
  if (isRamp) {
    // Bottom landing
    for (let i = 0; i < geom.nFlat; i++) {
      const lz = (i + 0.5) * geom.cellSize
      for (let col = LO; col < HI; col++) {
        const lx = (col + 0.5) * geom.cellSize
        const idx = rampCellIdxFromCanonical(lx, lz, geom)!
        const { wx, wz } = localToWorld(lx, lz)
        spawnOne(wx, ty + FLAT_OFFSET, wz, flatRot, idx.col, idx.row)
      }
    }
    // Incline — spaced along the slope so cells tile flush on the GLB surface.
    for (let i = 0; i < geom.nIncline; i++) {
      const slopeDist = (i + 0.5) * geom.slopeCellSize
      const lz = geom.inclineStart + slopeDist * geom.cosA
      const y  = ty + FLAT_OFFSET + slopeDist * geom.sinA
      for (let col = LO; col < HI; col++) {
        const lx = (col + 0.5) * geom.cellSize
        const idx = rampCellIdxFromCanonical(lx, lz, geom)!
        const { wx, wz } = localToWorld(lx, lz)
        spawnOne(wx, y, wz, inclineRot, idx.col, idx.row, geom.slopeCellSize)
      }
    }
    // Top landing
    for (let i = 0; i < geom.nFlat; i++) {
      const lz = geom.inclineEnd + (i + 0.5) * geom.cellSize
      for (let col = LO; col < HI; col++) {
        const lx = (col + 0.5) * geom.cellSize
        const idx = rampCellIdxFromCanonical(lx, lz, geom)!
        const { wx, wz } = localToWorld(lx, lz)
        spawnOne(wx, ty + STEP + FLAT_OFFSET, wz, flatRot, idx.col, idx.row)
      }
    }
    return
  }

  // Non-ramp: iterate mask cells. Direct pixelwars positioning — cell N
  // sits at (n + 0.5) * cellSize from the tile SW corner. Works cleanly
  // because SIZE is a multiple of 16 (see settings.ts).
  const flatRotDefault = Quaternion.fromEulerDegrees(-90, 0, 0)
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const ch = mask[row][col]
      if (ch === '.') continue
      const wx = tileWorldX + (col + 0.5) * cellSize
      const wz = tileWorldZ + (row + 0.5) * cellSize

      let wy: number
      if (ch === 'F') {
        wy = ty + FLAT_OFFSET
      } else if (ch >= '0' && ch <= '9') {
        const t = (ch.charCodeAt(0) - 48) / 9
        wy = ty + t * STEP + FLAT_OFFSET
      } else {
        continue
      }
      spawnCube(wx, wy, wz, col, row)
    }
  }
}

// MARK: coverage

/** red/blue from PaintCoverage CRDT; total = local walkable mesh count. */
export function coverage(): { red: number; blue: number; total: number } {
	const total = cellEntity.size
	for (const [, crdt] of engine.getEntitiesWith(PaintCoverage)) {
		return { red: crdt.red, blue: crdt.blue, total }
	}
	return { red: 0, blue: 0, total }
}

// MARK: World to cell
// Reverses spawnCellsForTile. Requires a tile lookup callback so we don't
// need to import the maze grid directly.
// Returns null if the player isn't standing on a known walkable cell.
// groundY is the expected walkable-surface Y for the cell — use it to detect
// airborne states (jumping / gliding / falling) by comparing to player.y.
export function worldToCellId(
  px: number, py: number, pz: number,
  CELL: number, STEP: number,
  lookupTile: (tx: number, tz: number, py: number) => { type: string; r: number; y: number } | null
): { id: string; groundY: number } | null {
  const tx = Math.floor((px - MAZE_ORIGIN_OFFSET_METERS) / CELL)
  const tz = Math.floor((pz - MAZE_ORIGIN_OFFSET_METERS) / CELL)
  const tile = lookupTile(tx, tz, py)
  if (!tile) return null

  const raw = MASKS[tile.type as TileType]
  if (!raw) return null

  const tileWorldX = tx * CELL + MAZE_ORIGIN_OFFSET_METERS
  const tileWorldZ = tz * CELL + MAZE_ORIGIN_OFFSET_METERS

  // Ramp: shared canonical-frame helper.
  if (tile.type === 'ramp') {
    const geom = rampGeometry(CELL, STEP)
    const rad = tile.r * Math.PI / 2
    const sinR = Math.sin(rad), cosR = Math.cos(rad)
    const dx = px - tileWorldX, dz = pz - tileWorldZ
    const cx = dx - CELL / 2, cz = dz - CELL / 2
    const lx = cosR * cx - sinR * cz + CELL / 2
    const lz = sinR * cx + cosR * cz + CELL / 2
    const idx = rampCellIdxFromCanonical(lx, lz, geom)
    if (!idx) return null
    // groundY = walkable surface Y (top of 0.5m floor slab, then + slope rise).
    let surfaceY: number
    if (lz < geom.inclineStart) surfaceY = tile.y + WALKABLE_TOP
    else if (lz >= geom.inclineEnd) surfaceY = tile.y + STEP + WALKABLE_TOP
    else {
      const slopeDist = (lz - geom.inclineStart) / geom.cosA
      surfaceY = tile.y + WALKABLE_TOP + slopeDist * geom.sinA
    }
    return { id: cellId(tx, tz, tile.y, idx.col, idx.row), groundY: surfaceY }
  }

  const mask = rotateMask(raw, tile.r)
  const w = mask[0].length
  const cellSize = CELL / w

  // Direct pixelwars inverse: floor local coord by cellSize.
  const localX = px - tileWorldX
  const localZ = pz - tileWorldZ
  const col = Math.floor(localX / cellSize)
  const row = Math.floor(localZ / cellSize)
  if (col < 0 || col >= w || row < 0 || row >= mask.length) return null
  const ch = mask[row][col]
  if (ch === '.') return null

  return { id: cellId(tx, tz, tile.y, col, row), groundY: tile.y + WALKABLE_TOP }
}

// Top of the tile's floor slab in world meters. Matches how player.y reads when
// the avatar is grounded on a flat tile at tile.y = 0.
const WALKABLE_TOP = 0.5

// MARK: Painting system
// Reads player position, resolves current cell, paints it.

/** Overlay boxes are small transient entities spawned only for cells under
 *  the local player's brush footprint. They bounce up on enter, tween down
 *  on exit, then despawn — keeping the base paint mesh a cheap plane.
 *
 *  Sizing rules (so the box bottom is never above the plane while lifted):
 *    OVERLAY_THICKNESS = BRUSH_LIFT_METERS + OVERLAY_REST_TOP_ABOVE_PLANE
 *    rest    top = plane + OVERLAY_REST_TOP_ABOVE_PLANE
 *    rest    bottom = plane - BRUSH_LIFT_METERS
 *    lifted  top = plane + OVERLAY_REST_TOP_ABOVE_PLANE + BRUSH_LIFT_METERS
 *    lifted  bottom = plane                            (never rises above)
 *
 *  Each overlay is built as an anchor entity (moved by the Tween) with the
 *  colored box + 12 thin black edge boxes as children, so borders inherit
 *  the anchor's motion and stay aligned.
 */
const BRUSH_LIFT_METERS            = 0.25
const OVERLAY_REST_TOP_ABOVE_PLANE = 0.05
const OVERLAY_THICKNESS            = BRUSH_LIFT_METERS + OVERLAY_REST_TOP_ABOVE_PLANE
const OVERLAY_EDGE_THICKNESS       = 0.01
const BRUSH_LIFT_UP_MS             = 140
const BRUSH_LIFT_DOWN_MS           = 220

const OVERLAY_EDGE_MATERIAL = cellMaterialFromColor(Color4.Black())

type Overlay = { anchor: Entity; parts: Entity[]; baseY: number }
/** id -> live overlay + its resting center Y. */
const overlays = new Map<string, Overlay>()

/** Overlays whose down-tween is still playing; removed once due. */
const pendingOverlayRemovals: { dueMs: number; anchor: Entity; parts: Entity[] }[] = []
let overlayClockMs = 0

engine.addSystem((dt: number) => {
	overlayClockMs += dt * 1000
	while (pendingOverlayRemovals.length && pendingOverlayRemovals[0].dueMs <= overlayClockMs) {
		const item = pendingOverlayRemovals.shift()!
		destroyOverlayParts(item.anchor, item.parts)
	}
})


// MARK: destroyOverlayParts

/** Remove anchor + all children (colored box + 12 edges). */
function destroyOverlayParts(anchor: Entity, parts: Entity[]): void {
	for (const p of parts) engine.removeEntity(p)
	engine.removeEntity(anchor)
}


// MARK: buildOverlayParts

/** Spawn the colored box + 12 black edge boxes as children of `anchor`.
 *  All positions are LOCAL (anchor sits at world (wx, restY, wz)). */
function buildOverlayParts(anchor: Entity, colorMat: ReturnType<typeof cellMaterialFromColor>): Entity[] {
	const W = PAINT_CELL_SIZE_METERS
	const H = OVERLAY_THICKNESS
	const D = PAINT_CELL_SIZE_METERS
	const E = OVERLAY_EDGE_THICKNESS
	const parts: Entity[] = []

	const addPart = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, mat: ReturnType<typeof cellMaterialFromColor>) => {
		const p = engine.addEntity()
		Transform.create(p, {
			parent:   anchor,
			position: Vector3.create(lx, ly, lz),
			scale:    Vector3.create(sx, sy, sz),
		})
		MeshRenderer.setBox(p)
		Material.setPbrMaterial(p, mat)
		parts.push(p)
	}

	// Colored core.
	addPart(0, 0, 0, W, H, D, colorMat)

	// 4 top edges (y = +H/2).
	addPart(0,  H/2,  D/2, W, E, E, OVERLAY_EDGE_MATERIAL)
	addPart(0,  H/2, -D/2, W, E, E, OVERLAY_EDGE_MATERIAL)
	addPart(-W/2, H/2, 0,  E, E, D, OVERLAY_EDGE_MATERIAL)
	addPart( W/2, H/2, 0,  E, E, D, OVERLAY_EDGE_MATERIAL)

	// 4 bottom edges (y = -H/2).
	addPart(0, -H/2,  D/2, W, E, E, OVERLAY_EDGE_MATERIAL)
	addPart(0, -H/2, -D/2, W, E, E, OVERLAY_EDGE_MATERIAL)
	addPart(-W/2, -H/2, 0, E, E, D, OVERLAY_EDGE_MATERIAL)
	addPart( W/2, -H/2, 0, E, E, D, OVERLAY_EDGE_MATERIAL)

	// 4 vertical edges (corners).
	addPart(-W/2, 0, -D/2, E, H, E, OVERLAY_EDGE_MATERIAL)
	addPart( W/2, 0, -D/2, E, H, E, OVERLAY_EDGE_MATERIAL)
	addPart(-W/2, 0,  D/2, E, H, E, OVERLAY_EDGE_MATERIAL)
	addPart( W/2, 0,  D/2, E, H, E, OVERLAY_EDGE_MATERIAL)

	return parts
}


// MARK: removeOverlayImmediate

/** Force-remove any live overlay for `id` (used when the underlying tile
 *  despawns). */
function removeOverlayImmediate(id: string): void {
	const ov = overlays.get(id)
	if (!ov) return
	destroyOverlayParts(ov.anchor, ov.parts)
	overlays.delete(id)
}

// Module-scope paint context, stashed by initPaintingSystem so other client
// modules (e.g. locomotion) can query "is the cell under this world point
// painted?" without re-plumbing CELL / STEP / lookupTile through init calls.
let paintCtx: {
	CELL:       number
	STEP:       number
	lookupTile: (tx: number, tz: number, py: number) => { type: string; r: number; y: number } | null
} | null = null


// MARK: isCellPaintedAtWorld
/**
 * True when the paint cell under world point (x, y, z) currently has any
 * non-"none" palette entry rendered. Returns false when off the maze, off
 * a walkable cell, or when the cell is still snow. Safe to call before
 * initPaintingSystem has run — returns false.
 */
export function isCellPaintedAtWorld(x: number, y: number, z: number): boolean {
	return getSnowStageAtWorld(x, y, z) === 0
}


// MARK: getSnowStageAtWorld
/**
 * Snow height stage under world point (x, y, z):
 *   0 = cell is currently painted (melted / flat) — no snow at all
 *   1 = infill stage 1 (~0.5 m of regrowth)
 *   2 = infill stage 2 (~1.0 m of regrowth)
 *   3 = full snow (pristine cube never painted, or fully regrown)
 *
 * Returns 3 when off the maze / off a walkable cell so callers err on the
 * side of "treat it as deep snow." Safe to call before initPaintingSystem
 * has run — returns 3 as well.
 */
export function getSnowStageAtWorld(x: number, y: number, z: number): 0 | 1 | 2 | 3 {
	if (!paintCtx) return 3
	const hit = worldToCellId(x, y, z, paintCtx.CELL, paintCtx.STEP, paintCtx.lookupTile)
	if (!hit) return 3
	const key = cellIdToKey(hit.id)
	if (key === null) return 3
	const applied = cellApplied.get(key)
	// No PaintCell CRDT for this cell (or index reset to NONE by the
	// server's terminal regrowth transition) — treat as full snow.
	if (!applied || applied.index === PALETTE_NONE) return 3
	return applied.stage
}


export function initPaintingSystem(
  CELL: number, STEP: number,
  lookupTile: (tx: number, tz: number, py: number) => { type: string; r: number; y: number } | null,
) {
  paintCtx = { CELL, STEP, lookupTile }
  const GROUND_TOLERANCE = 0.4
  // Brush footprint is read live from src/client/brush.ts so the +/- HUD
  // buttons can grow/shrink the stamp without a scene reload. Offsets in
  // world meters; one cell is CELL / SIZE.
  const step = CELL / SIZE
	// Queue paintTick ids + optimistic local colour; CRDT reconciles.
	// Also lift cells under the brush footprint and drop them once vacated.
	engine.addSystem(() => {
		const newLifted = new Set<string>()
		const t = Transform.getOrNull(engine.PlayerEntity)
		const brushCells = getBrushCells()

		if (t && brushCells > 0) {
			const { x, y, z } = t.position
			// Project the brush ahead of the player along their facing so melt
			// leads their footsteps rather than sitting under them.
			const fwd  = Vector3.rotate(Vector3.Forward(), t.rotation)
			const lead = PAINT_BRUSH_LEAD_METERS
			const sx = x + fwd.x * lead
			const sz = z + fwd.z * lead
			const center = worldToCellId(sx, y, sz, CELL, STEP, lookupTile)
			if (center && y - center.groundY <= GROUND_TOLERANCE) {
				// Solid footprint: paint every cell in an NxN square centered
				// at the brush point. The older ring-around-footprint scheme
				// was designed so players could see under themselves, but with
				// small brushes (max 5x5) that concern is negligible and the
				// ring pattern inflated the visual footprint dramatically
				// (e.g. brush=3 painted a 5x5 ring = 25 cells).
				const half = Math.floor(brushCells / 2)
				for (let dz = -half; dz <= half; dz++) for (let dx = -half; dx <= half; dx++) {
					const hit = worldToCellId(sx + dx * step, y, sz + dz * step, CELL, STEP, lookupTile)
					if (!hit) continue
					if (Math.abs(y - hit.groundY) > 1.5) continue
					enqueuePaintCandidate(hit.id)
					newLifted.add(hit.id)
				}
			}
		}

		// Brush-lift overlays disabled in cube-mode — the cube drop is the feedback.
		void newLifted
	})
}


// MARK: reconcileLiftedCells

/** For each cell currently under the brush, ensure a bouncing overlay
 *  exists; for cells no longer under it, tween the overlay down and
 *  schedule its removal. Overlay core inherits the local player's team
 *  color; edges are always black. */
function reconcileLiftedCells(nowLifted: Set<string>): void {
	// Drop overlays for cells that have left the footprint.
	for (const [id, ov] of overlays) {
		if (nowLifted.has(id)) continue
		const tr = Transform.getOrNull(ov.anchor)
		if (tr) {
			const p = tr.position
			Tween.createOrReplace(ov.anchor, {
				mode: Tween.Mode.Move({
					start: Vector3.create(p.x, p.y,      p.z),
					end:   Vector3.create(p.x, ov.baseY, p.z),
				}),
				duration:        BRUSH_LIFT_DOWN_MS,
				easingFunction:  EasingFunction.EF_EASEOUTQUAD,
			})
			pendingOverlayRemovals.push({
				dueMs:  overlayClockMs + BRUSH_LIFT_DOWN_MS + 30,
				anchor: ov.anchor,
				parts:  ov.parts,
			})
		} else {
			destroyOverlayParts(ov.anchor, ov.parts)
		}
		overlays.delete(id)
	}
	// Spawn + lift overlays for newly-entered cells.
	if (nowLifted.size === 0) return
	const colorIndex = teamPaletteIndex(localTeam)
	const colorMat   = cellMaterialForIndex(colorIndex) ?? cellMaterialForIndex(PALETTE_NONE)!
	for (const id of nowLifted) {
		if (overlays.has(id)) continue
		const cellE = cellEntity.get(id)
		if (cellE === undefined) continue
		const cellTr = Transform.getOrNull(cellE)
		if (!cellTr) continue
		const p     = cellTr.position
		// baseY (rest center) chosen so the box top sits
		// OVERLAY_REST_TOP_ABOVE_PLANE above the plane, and the box bottom
		// tracks BRUSH_LIFT_METERS below — keeping bottom ≤ plane while lifted.
		const baseY  = p.y + OVERLAY_REST_TOP_ABOVE_PLANE - OVERLAY_THICKNESS / 2
		const anchor = engine.addEntity()
		Transform.create(anchor, { position: Vector3.create(p.x, baseY, p.z) })
		const parts = buildOverlayParts(anchor, colorMat)
		overlays.set(id, { anchor, parts, baseY })
		Tween.createOrReplace(anchor, {
			mode: Tween.Mode.Move({
				start: Vector3.create(p.x, baseY,                       p.z),
				end:   Vector3.create(p.x, baseY + BRUSH_LIFT_METERS,   p.z),
			}),
			duration:        BRUSH_LIFT_UP_MS,
			easingFunction:  EasingFunction.EF_EASEOUTBACK,
		})
	}
}
