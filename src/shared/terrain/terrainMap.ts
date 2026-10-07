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
	VOLCANO_LAVA_TOP_ABOVE_RIM_M,
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
/** High stretched plateau stamped as the volcano caldera landmark. */
export const LANDFORM_VOLCANO = 6
/** Volcano crater interior: rim-level lava lake (visual lava on top). */
export const LANDFORM_LAVA    = 7


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

/** A far Low / Mid region worth an expedition (major grove socket). */
export interface TerrainDestination {
	region : number
	level  : number
	area   : number
	cx     : number
	cz     : number
	/** Route steps from the hearth (cells, ladders and drops included). */
	route  : number
}

/**
 * Volcano landmark on a High / mountain-adjacent plateau. Not a grove —
 * no wood pool, no grove pit cluster.
 */
export interface TerrainVolcano {
	region : number
	level  : number
	area   : number
	cx     : number
	cz     : number
	/** Route steps from the hearth (cells, ladders and drops included). */
	route  : number
}

/**
 * Ignition station socket — exploration landmark with line of sight to
 * the volcano. Not a grove: no wood pool, no pit cluster. Beams /
 * tablets / activation are a later pass; the generator only places the
 * socket and validates LOS + separation.
 */
export interface TerrainStation {
	cx     : number
	cz     : number
	level  : number
	region : number
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
	/** Major grove sockets only (Low + Mid). */
	destinations  : TerrainDestination[]
	/** High plateau volcano landmark, or null when placement failed. */
	volcano       : TerrainVolcano | null
	/** Ignition stations (3) with LOS to the volcano. Empty when placement failed. */
	stations      : TerrainStation[]
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
/**
 * Walkable surface height under world (x, z). Crown cells report their
 * extruded top; lava cells report the lava lid (rim + 1.7 m), which is
 * the collider you actually stand on.
 */
export function groundYAtWorld(
	map: TerrainMap,
	x:   number,
	z:   number,
): number {
	const { cx, cz } = cellOfWorld(x, z)
	const y = groundYForLevel(levelAt(map, cx, cz))
	if (inGrid(cx, cz) && map.landforms[cellIndex(cx, cz)] === LANDFORM_LAVA) {
		return y + VOLCANO_LAVA_TOP_ABOVE_RIM_M
	}
	return y
}


// MARK: isLavaAtWorld
/** True when world (x, z) is over the volcano lava lake. */
export function isLavaAtWorld(
	map: TerrainMap,
	x:   number,
	z:   number,
): boolean {
	const { cx, cz } = cellOfWorld(x, z)
	return inGrid(cx, cz) && map.landforms[cellIndex(cx, cz)] === LANDFORM_LAVA
}


// MARK: groundFlatWithin
/**
 * True when every cell a disc of radius `r` at world (x, z) touches has
 * the same walkable surface height as the cell under its centre. Keeps
 * props off cliff lips, where part of the footprint hangs over a drop.
 */
export function groundFlatWithin(
	map: TerrainMap,
	x:   number,
	z:   number,
	r:   number,
): boolean {
	const y   = groundYAtWorld(map, x, z)
	const c0  = cellOfWorld(x - r, z - r)
	const c1  = cellOfWorld(x + r, z + r)
	const rSq = r * r
	for (let cz = c0.cz; cz <= c1.cz; cz++) {
		for (let cx = c0.cx; cx <= c1.cx; cx++) {
			const x0 = TERRAIN_ORIGIN_M + cx * TERRAIN_CELL_M
			const z0 = TERRAIN_ORIGIN_M + cz * TERRAIN_CELL_M
			const dx = Math.max(x0 - x, 0, x - (x0 + TERRAIN_CELL_M))
			const dz = Math.max(z0 - z, 0, z - (z0 + TERRAIN_CELL_M))
			if (dx * dx + dz * dz >= rSq) continue
			const c = cellCenterWorld(cx, cz)
			if (Math.abs(groundYAtWorld(map, c.x, c.z) - y) > 0.01) return false
		}
	}
	return true
}
