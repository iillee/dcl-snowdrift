/**
 * snowGrid.ts — snow cell coordinate math, integer cell keys, and the
 * PaintTile wire byte. Pure; safe for client and server.
 *
 * Layout (see design/paint-rewrite.md §3):
 *   cell (gx, gz) is 1 m² inside the playfield, 0 <= gx < SNOW_CELLS_X
 *   tile = SNOW_TILE_CELLS² cells, the CRDT batching unit
 *   cellKey = tileKey * SNOW_TILE_CELL_COUNT + row * SNOW_TILE_CELLS + col
 *
 * The key layout matches the legacy paintGrid.packCellKey at level 0, so
 * legacy clients and tile network ids stay compatible during cutover.
 */

import {
	MAZE_GRID_HEIGHT,
	MAZE_GRID_WIDTH,
	MAZE_ORIGIN_OFFSET_METERS,
	PAINT_CELL_SIZE_METERS,
	PAINT_CELLS_PER_TILE_AXIS,
} from 'src/shared/settings'


// MARK: Grid constants

/** Edge length of one snow cell in meters. */
export const SNOW_CELL_M          = PAINT_CELL_SIZE_METERS
/** Cells along one edge of a tile. */
export const SNOW_TILE_CELLS      = PAINT_CELLS_PER_TILE_AXIS
/** Cells per tile (length of PaintTile.cells). */
export const SNOW_TILE_CELL_COUNT = SNOW_TILE_CELLS * SNOW_TILE_CELLS
/** Edge length of one tile in meters. */
export const SNOW_TILE_M          = SNOW_TILE_CELLS * SNOW_CELL_M
/** Tile grid dimensions. */
export const SNOW_TILES_X         = MAZE_GRID_WIDTH
export const SNOW_TILES_Z         = MAZE_GRID_HEIGHT
/** Cell grid dimensions. */
export const SNOW_CELLS_X         = SNOW_TILES_X * SNOW_TILE_CELLS
export const SNOW_CELLS_Z         = SNOW_TILES_Z * SNOW_TILE_CELLS
/** World coord of the playfield's SW corner (both axes). */
export const SNOW_ORIGIN_M        = MAZE_ORIGIN_OFFSET_METERS
/** World Y of the walkable ground surface (top of the ground slab).
 *  Matches CAMPFIRE_WORLD_Y / LOGS_PILE_WORLD_Y so props sit on the slab,
 *  not inside it. Player.y on the old tile collider read ~0.5 because the
 *  avatar origin is above the visual floor. */
export const SNOW_GROUND_TOP_Y    = 0.25


// MARK: Stages

/** 0 = melted flat, 1..2 = regrowth, 3 = pristine. */
export type SnowStage = 0 | 1 | 2 | 3

export const STAGE_MELTED:   SnowStage = 0
export const STAGE_PRISTINE: SnowStage = 3

/** Visible snow height above the ground for each stage (meters). */
export const SNOW_STAGE_HEIGHT_M: readonly number[] = [0, 0.5, 1.0, 1.5]


// MARK: Wire byte
// 0 = pristine. Otherwise MELT_FLAG | stage (stage 0..2). MELT_FLAG equals
// the legacy "palette index 2" encoding so legacy clients render it as melt.
const SNOW_MELT_FLAG = 2 << 2


// MARK: snowByteFromStage

/** Encode a stage as a PaintTile byte. */
export function snowByteFromStage(stage: SnowStage): number {
	if (stage === STAGE_PRISTINE) return 0
	return SNOW_MELT_FLAG | stage
}


// MARK: stageFromSnowByte

/** Decode a PaintTile byte to a stage. */
export function stageFromSnowByte(byte: number): SnowStage {
	if (byte === 0) return STAGE_PRISTINE
	return (byte & 0x3) as SnowStage
}


// MARK: cellKey

/** Integer key for global cell (gx, gz). Caller guarantees in-range coords. */
export function cellKey(
	gx: number,
	gz: number,
): number {
	const tx   = Math.floor(gx / SNOW_TILE_CELLS)
	const tz   = Math.floor(gz / SNOW_TILE_CELLS)
	const col  = gx - tx * SNOW_TILE_CELLS
	const row  = gz - tz * SNOW_TILE_CELLS
	return (tz * SNOW_TILES_X + tx) * SNOW_TILE_CELL_COUNT + row * SNOW_TILE_CELLS + col
}


// MARK: isCellInRange

/** True when (gx, gz) lies inside the playfield cell grid. */
export function isCellInRange(
	gx: number,
	gz: number,
): boolean {
	return gx >= 0 && gx < SNOW_CELLS_X && gz >= 0 && gz < SNOW_CELLS_Z
}


// MARK: isCellKeyValid

/** True when `key` is an integer that addresses a real cell. */
export function isCellKeyValid(key: number): boolean {
	return Number.isInteger(key) && key >= 0 && key < SNOW_TILES_X * SNOW_TILES_Z * SNOW_TILE_CELL_COUNT
}


// MARK: cellCoordsFromKey

/** Decode a cell key into global cell coords. */
export function cellCoordsFromKey(key: number): { gx: number; gz: number } {
	const tileKey  = Math.floor(key / SNOW_TILE_CELL_COUNT)
	const localIdx = key - tileKey * SNOW_TILE_CELL_COUNT
	const tz       = Math.floor(tileKey / SNOW_TILES_X)
	const tx       = tileKey - tz * SNOW_TILES_X
	const row      = Math.floor(localIdx / SNOW_TILE_CELLS)
	const col      = localIdx - row * SNOW_TILE_CELLS
	return { gx: tx * SNOW_TILE_CELLS + col, gz: tz * SNOW_TILE_CELLS + row }
}


// MARK: tileKeyOfCell

/** Owning tile key of a cell key. */
export function tileKeyOfCell(key: number): number {
	return Math.floor(key / SNOW_TILE_CELL_COUNT)
}


// MARK: localIndexOfCell

/** Index of a cell inside its tile's PaintTile.cells array. */
export function localIndexOfCell(key: number): number {
	return key - tileKeyOfCell(key) * SNOW_TILE_CELL_COUNT
}


// MARK: tileCoordsFromKey

/** Decode a tile key into tile grid coords. */
export function tileCoordsFromKey(tileKey: number): { tx: number; tz: number } {
	const tz = Math.floor(tileKey / SNOW_TILES_X)
	return { tx: tileKey - tz * SNOW_TILES_X, tz }
}


// MARK: worldToCell

/** Global cell coords under world (x, z). May be out of range; check with isCellInRange. */
export function worldToCell(
	x: number,
	z: number,
): { gx: number; gz: number } {
	return {
		gx: Math.floor((x - SNOW_ORIGIN_M) / SNOW_CELL_M),
		gz: Math.floor((z - SNOW_ORIGIN_M) / SNOW_CELL_M),
	}
}


// MARK: worldToCellKey

/** Cell key under world (x, z), or null when outside the playfield. */
export function worldToCellKey(
	x: number,
	z: number,
): number | null {
	const { gx, gz } = worldToCell(x, z)
	if (!isCellInRange(gx, gz)) return null
	return cellKey(gx, gz)
}


// MARK: cellCenterWorld

/** World (x, z) of a cell's centre. */
export function cellCenterWorld(key: number): { x: number; z: number } {
	const { gx, gz } = cellCoordsFromKey(key)
	return {
		x: SNOW_ORIGIN_M + (gx + 0.5) * SNOW_CELL_M,
		z: SNOW_ORIGIN_M + (gz + 0.5) * SNOW_CELL_M,
	}
}


// MARK: forEachCellInDisc

/**
 * Visit every in-range cell whose centre lies within `radiusM` of world
 * (cx, cz). `visit` receives the cell key and squared distance.
 */
export function forEachCellInDisc(
	cx:      number,
	cz:      number,
	radiusM: number,
	visit:   (key: number, distSq: number) => void,
): void {
	if (radiusM <= 0) return
	const r2    = radiusM * radiusM
	const min   = worldToCell(cx - radiusM, cz - radiusM)
	const max   = worldToCell(cx + radiusM, cz + radiusM)
	const gx0   = Math.max(0, min.gx)
	const gz0   = Math.max(0, min.gz)
	const gx1   = Math.min(SNOW_CELLS_X - 1, max.gx)
	const gz1   = Math.min(SNOW_CELLS_Z - 1, max.gz)
	for (let gz = gz0; gz <= gz1; gz++) {
		const dz = SNOW_ORIGIN_M + (gz + 0.5) * SNOW_CELL_M - cz
		for (let gx = gx0; gx <= gx1; gx++) {
			const dx = SNOW_ORIGIN_M + (gx + 0.5) * SNOW_CELL_M - cx
			const d2 = dx * dx + dz * dz
			if (d2 > r2) continue
			visit(cellKey(gx, gz), d2)
		}
	}
}


// MARK: snowGridCapacity

/** Static grid stats for logging and the debug HUD. */
export function snowGridCapacity(): {
	cellsPerTileAxis: number
	tiles:            number
	cellCapacity:     number
} {
	const tiles = SNOW_TILES_X * SNOW_TILES_Z
	return {
		cellsPerTileAxis: SNOW_TILE_CELLS,
		tiles,
		cellCapacity:     tiles * SNOW_TILE_CELL_COUNT,
	}
}
