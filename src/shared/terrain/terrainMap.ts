/**
 * terrainMap.ts — elevation map types and world-space queries.
 *
 * The map is a TERRAIN_GRID_W × TERRAIN_GRID_H grid of 16 m cells laid
 * over the playfield (same grid as the snow tiles). Each cell has a
 * level; walkable surface height is level × TERRAIN_LEVEL_STEP_M above
 * the old flat ground. Built by generateTerrain() in terrainGen.ts.
 *
 * Cliff faces are centred on the boundary line between two cells: the
 * base reaches CLIFF_HALF_TAPER_M into the low cell and the lip sits
 * CLIFF_HALF_TAPER_M inside the high cell.
 *
 * Pure; safe for client and server.
 */

import {
	MAZE_ORIGIN_OFFSET_METERS,
	TERRAIN_CELL_M,
	TERRAIN_GRID_H,
	TERRAIN_GRID_W,
	TERRAIN_LEVEL_MOUNTAIN,
	groundYForLevel,
} from 'src/shared/settings'

export { groundYForLevel }


// MARK: Constants

/** World X / Z of the grid's SW corner. */
export const TERRAIN_ORIGIN_M = MAZE_ORIGIN_OFFSET_METERS

/** Half the horizontal lean of a cliff face (base to lip is twice this). */
export const CLIFF_HALF_TAPER_M = 2

/**
 * Thin ground cap on each greybox slab. Rock body ends here; snow sits
 * on top of groundY. Ladders stop at the rock lip so they don't poke
 * into the snow pack.
 */
export const CLIFF_CAP_M = 0.15

/**
 * How far the ladder foot sits out from the cliff face into the low
 * cell, and how far the landing sits in from the lip on the high cell.
 * Shared by the generator (world endpoints) and the renderer (rail pose).
 */
export const LADDER_FOOT_M = CLIFF_HALF_TAPER_M + 1.5
export const LADDER_LAND_M = CLIFF_HALF_TAPER_M + 2

/** Cardinal step tables. Index 0 = N (+Z), 1 = E (+X), 2 = S, 3 = W. */
export const DIR_DX: readonly number[] = [0, 1, 0, -1]
export const DIR_DZ: readonly number[] = [1, 0, -1, 0]

/** Landform tag stored per cell. */
export const LANDFORM_NONE    = 0
export const LANDFORM_HEARTH  = 1
export const LANDFORM_CANYON  = 2
export const LANDFORM_RIDGE   = 3
export const LANDFORM_PLATEAU = 4
export const LANDFORM_BASIN   = 5


// MARK: Types

/** One ladder joining a cell to the cell one level above it. */
export interface TerrainLadder {
	lowCx    : number
	lowCz    : number
	highCx   : number
	highCz   : number
	/** Direction from the low cell to the high cell (0..3). */
	dir      : number
	lowLevel : number
	/** Where a climber stands at the foot (world). */
	bottom   : { x: number; y: number; z: number }
	/** Where a climber arrives at the top (world). */
	top      : { x: number; y: number; z: number }
}

/** A far region worth an expedition (Phase 2 grove site). */
export interface TerrainDestination {
	region : number
	level  : number
	area   : number
	cx     : number
	cz     : number
	/** Route steps from the hearth (cells, ladders and drops included). */
	route  : number
}

export interface TerrainMap {
	/** Seed requested by the caller. */
	seed          : number
	/** Seed actually used after validation retries. */
	usedSeed      : number
	attempts      : number
	w             : number
	h             : number
	/** Level per cell, index cz * w + cx. */
	levels        : Uint8Array
	/** Region id per cell, -1 for mountain. */
	regions       : Int16Array
	/** LANDFORM_* tag per cell. */
	landforms     : Uint8Array
	regionLevel   : number[]
	regionArea    : number[]
	hearthCx      : number
	hearthCz      : number
	hearthRegion  : number
	ladders       : TerrainLadder[]
	destinations  : TerrainDestination[]
	/** Route steps from the hearth per cell, -1 when unreachable. */
	routeDist     : Int32Array
}


// MARK: cellIndex
/** Flat index of cell (cx, cz). Caller guarantees in-grid coords. */
export function cellIndex(
	cx: number,
	cz: number,
): number {
	return cz * TERRAIN_GRID_W + cx
}


// MARK: inGrid
/** True when (cx, cz) addresses a real cell. */
export function inGrid(
	cx: number,
	cz: number,
): boolean {
	return cx >= 0 && cz >= 0 && cx < TERRAIN_GRID_W && cz < TERRAIN_GRID_H
}


// MARK: cellOfWorld
/** Cell under world (x, z). May be out of grid; check with inGrid. */
export function cellOfWorld(
	x: number,
	z: number,
): { cx: number; cz: number } {
	return {
		cx: Math.floor((x - TERRAIN_ORIGIN_M) / TERRAIN_CELL_M),
		cz: Math.floor((z - TERRAIN_ORIGIN_M) / TERRAIN_CELL_M),
	}
}


// MARK: cellCenterWorld
/** World (x, z) of a cell's centre. */
export function cellCenterWorld(
	cx: number,
	cz: number,
): { x: number; z: number } {
	return {
		x: TERRAIN_ORIGIN_M + (cx + 0.5) * TERRAIN_CELL_M,
		z: TERRAIN_ORIGIN_M + (cz + 0.5) * TERRAIN_CELL_M,
	}
}


// MARK: levelAt
/** Level of cell (cx, cz). Off-grid reads as mountain. */
export function levelAt(
	map: TerrainMap,
	cx:  number,
	cz:  number,
): number {
	if (!inGrid(cx, cz)) return TERRAIN_LEVEL_MOUNTAIN
	return map.levels[cellIndex(cx, cz)]
}


// MARK: levelAtWorld
/** Level under world (x, z). Off-grid reads as mountain. */
export function levelAtWorld(
	map: TerrainMap,
	x:   number,
	z:   number,
): number {
	const { cx, cz } = cellOfWorld(x, z)
	return levelAt(map, cx, cz)
}


// MARK: groundYAtWorld
/** Walkable surface height under world (x, z). */
export function groundYAtWorld(
	map: TerrainMap,
	x:   number,
	z:   number,
): number {
	return groundYForLevel(levelAtWorld(map, x, z))
}
