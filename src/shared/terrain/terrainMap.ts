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

// MARK: Monument pit
/**
 * Each monument sits in the centre of a shallow square recess cut into
 * its 16 m cell: ONE step down (MONUMENT_PIT_DEPTH_M, walkable), with a
 * socket in the middle the obelisk is seated in. While frozen the recess
 * holds a mound of ice chunks rising MONUMENT_ICE_TOP_M above the ground
 * (src/shared/monumentIce.ts); snow falls on the ice top like anywhere
 * else, so it reads as a snowy mound with the black obelisk tip poking
 * out. Shared so the terrain renderer (recess), the server (snow over
 * melted chunks) and the monument visuals (ice chunks) all agree.
 * Keep the size an even multiple of MONUMENT_ICE_CHUNK_M so the recess
 * edges and ice chunks land on 1 m snow-cell boundaries. The server only
 * clears + protects the snow over an ice chunk once it melts.
 */
/** Recess / ice footprint edge length (m), centred on the station cell centre. */
export const MONUMENT_PIT_SIZE_M = 6
/**
 * Max height (m) a Decentraland avatar walks up without jumping
 * (docs.decentraland.org, 3D modeling > Colliders: "Players can walk up
 * a step of up to 30 centimeters"). The recess and socket risers stay
 * under it; the ice mound is deliberately far over it.
 */
export const DCL_MAX_AUTO_STEP_M = 0.3
/**
 * Recess floor depth below the cell's ground surface (m). 0: no recess,
 * the ground around the socket is flat at normal level and the ice
 * chunks sit directly on it. Only the centre socket is cut down.
 */
export const MONUMENT_PIT_DEPTH_M = 0
/** Obelisk square cross-section (m). The socket matches it. */
export const MONUMENT_OBELISK_WIDTH_M = 3
/**
 * Square socket in the centre of the pit floor the obelisk sits in and
 * rises out of: the obelisk width plus a hair of clearance per side so
 * its faces never z-fight the socket walls.
 */
export const MONUMENT_SOCKET_SIZE_M = MONUMENT_OBELISK_WIDTH_M + 0.1
/**
 * Socket depth below the ground (m). Deeper than a default DCL jump
 * (~1 m); no stair any more: the client fills it with an invisible collider plug\n * at ground level so nobody can drop in. While frozen the obelisk shaft\n * runs on down through the socket floor.
 */
export const MONUMENT_SOCKET_DEPTH_M = 1.5
/** Clutter margin (m) kept clear around the ice edge (room to walk round and melt it). */
export const MONUMENT_PIT_RIM_CLEAR_M = 2
/**
 * Minimum hovering bottom-tip height above the station's own ground (m).
 * The real hover height is target-relative (monumentHoverBottomY); this
 * only matters if a station's ground ever sat close to the volcano rim.
 */
export const MONUMENT_HOVER_BOTTOM_H_M = 50
/**
 * Hovering bottom tip sits this far ABOVE the beam's target height (the
 * crater rim aim point, ~81 m world) so every monument's volcano beam
 * descends slightly toward the volcano, whatever the local ground (m).
 * Tune 15..25.
 */
export const MONUMENT_HOVER_ABOVE_TARGET_M = 20

// MARK: monumentHoverBottomY
/**
 * World Y of a hovering monument's bottom tip (the volcano beam origin),
 * before bob. max(target + MONUMENT_HOVER_ABOVE_TARGET_M, ground +
 * MONUMENT_HOVER_BOTTOM_H_M) + liftM (terrain-gen clearance step),
 * clamped to `maxBottomY` (caller's scene-ceiling limit). Shared by
 * terrain gen's beam check and the client so they agree.
 */
export function monumentHoverBottomY(
	groundY   : number,
	targetY   : number,
	liftM     : number,
	maxBottomY: number = Number.POSITIVE_INFINITY,
): number {
	const want = Math.max(targetY + MONUMENT_HOVER_ABOVE_TARGET_M, groundY + MONUMENT_HOVER_BOTTOM_H_M) + liftM
	return Math.min(want, maxBottomY)
}

/** Clutter keep-out radius (m) around every monument cell centre (covers the pit + rim). */
export const STATION_CLEAR_M = Math.ceil(
	(MONUMENT_PIT_SIZE_M / 2 + MONUMENT_PIT_RIM_CLEAR_M) * Math.SQRT2,
)

/** True when (x, z) is within STATION_CLEAR_M + extraM of any monument. */
export function nearStation(
	map   : TerrainMap,
	x     : number,
	z     : number,
	extraM: number,
): boolean {
	const r = STATION_CLEAR_M + extraM
	for (const s of map.stations) {
		const c  = cellCenterWorld(s.cx, s.cz)
		const dx = x - c.x
		const dz = z - c.z
		if (dx * dx + dz * dz < r * r) return true
	}
	return false
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
 * Ignition station socket (monument). Frozen in an ice-filled pit, it
 * rises to hover (monumentHoverBottomY: rim aim + MONUMENT_HOVER_ABOVE_TARGET_M
 * + beamLiftM) and beams
 * from its bottom tip to the volcano, so the socket itself needs no
 * line of sight: low ground and canyons are valid. Not a grove.
 */
export interface TerrainStation {
	cx     : number
	cz     : number
	level  : number
	region : number
	/** Route steps from the hearth (cells, ladders and drops included). */
	route  : number
	/** True for the guaranteed near-spawn monument (always index 0 when present). */
	near?  : boolean
	/** Extra hover height (m) on top of monumentHoverBottomY so the beam clears terrain. 0/undefined = none. */
	beamLiftM?: number
	/** World point the beam aims at (visible rim point). Undefined = lava centroid. */
	aimX?  : number
	aimY?  : number
	aimZ?  : number
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
	/** Ignition stations (3), monument pits. Empty when placement failed. */
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
