/**
 * generator.ts — grid state + trivial cross-fill placement.
 *
 * Deterministic. Every non-reserved cell in the playfield receives a
 * flat 4-way `cross` tile at r=0; cliffs live in the reservation set
 * fed in by the caller before generate().
 *
 * No engine imports. The visual side (spawning entities) lives in
 * rebuild.ts.
 */

import {
	MAZE_GRID_HEIGHT,
	MAZE_GRID_WIDTH,
	MAZE_ORIGIN_OFFSET_METERS,
	MAZE_RAMP_STEP_METERS,
	MAZE_TILE_GLTF_SCALE,
	MAZE_TILE_WORLD_METERS,
	SCENE_WORLD_SIZE_METERS,
} from 'src/shared/settings'

import { TileType } from 'src/shared/maze/tiles'

// MARK: World-scale aliases
// Masters live in src/shared/settings.ts (SCENE_ / MAZE_ / PAINT_ names).
// Short aliases kept for maze-local readability; prefer settings names
// at mixed call sites.
export const TILE_SCALE  = MAZE_TILE_GLTF_SCALE
export const CELL        = MAZE_TILE_WORLD_METERS
export const SCENE_SIZE  = SCENE_WORLD_SIZE_METERS
export const GRID_W      = MAZE_GRID_WIDTH
export const GRID_H      = MAZE_GRID_HEIGHT
export const MAZE_ORIGIN = MAZE_ORIGIN_OFFSET_METERS
// STEP is still exported because paint.ts derives its per-cell Y offsets
// from it (ramp-slope math + flat-tile top surface). No ramps are
// actually placed by generate() today.
export const STEP        = MAZE_RAMP_STEP_METERS

export interface Placed {
  type: TileType
  r: number
  x: number
  z: number
  y: number
  /** BFS order (seed=0, seed's neighbors=1..N, etc.). Used for reveal cascade. */
  order: number
}

// MARK: Grid state
// Kept module-private; callers touch the grid only via the exported
// helpers below (`resetGrid`, `getPlacedTilesInOrder`, `lookupTile`,
// `hasPlacementAt`). Prevents accidental mutation from the render side.
const grid = new Map<string, Placed>()
let placeCounter = 0

// Y quantization: STEP is 10.767, so `y + STEP + STEP` drifts. Rounding
// to 3 decimals makes lookups match regardless of accumulated float error.
const key = (x: number, z: number, y: number) =>
  `${x},${z},${Math.round(y * 1000) / 1000}`

const inBounds = (x: number, z: number) =>
  x >= 0 && x < GRID_W && z >= 0 && z < GRID_H


// MARK: Reserved cells
// Set of playfield grid cells (at y=0) that the maze generator must
// treat as unavailable — they belong to another system (currently the
// perimeter cliff generator's inward-poking end-caps). Openings that
// would face into a reserved cell are treated exactly like off-grid
// openings (illegal), and reserved cells never receive a tile.
//
// Lifecycle: owned by the caller (see rebuild.ts). `resetGrid()` does
// NOT clear this — reservations persist across seed retries within a
// single rebuild. Call `setReservedCells()` before `generateWithRetry()`.
const reservedCells = new Set<string>()

/**
 * Replace the current reservation set. Pass an empty array (or omit)
 * to clear. Reserved cells use only (tx, tz); y is implicitly 0 (the
 * base level all placement happens on).
 */
export function setReservedCells(cells: Array<{ tx: number; tz: number }> = []): void {
  reservedCells.clear()
  for (const c of cells) reservedCells.add(key(c.tx, c.tz, 0))
}

const isReserved = (x: number, z: number) => reservedCells.has(key(x, z, 0))

/** Neighbor is unavailable — off-grid OR reserved by another system. */
const isClosedSide = (x: number, z: number) => !inBounds(x, z) || isReserved(x, z)

export function resetGrid(): void {
  // Intentionally does NOT clear reservedCells — the caller owns that
  // lifecycle via setReservedCells() and reservations must persist
  // across seed retries inside generateWithRetry().
  grid.clear()
  placeCounter = 0
}

export function gridSize(): number {
  return grid.size
}

/** BFS-order iteration — seeds first, then neighbors, ideal for reveal cascade. */
export function getPlacedTilesInOrder(): Placed[] {
  return [...grid.values()].sort((a, b) => a.order - b.order)
}

/**
 * Look up the highest tile at (tx, tz) whose Y is at or below the player's
 * feet (with a small tolerance). Used by the painting system to resolve
 * world-space player position → the tile they're standing on.
 */
export function lookupTile(
  tx: number, tz: number, playerY: number,
): { type: TileType; r: number; y: number } | null {
  let best: Placed | null = null
  for (const p of grid.values()) {
    if (p.x !== tx || p.z !== tz) continue
    if (p.y > playerY + 0.5) continue
    if (!best || p.y > best.y) best = p
  }
  return best ? { type: best.type, r: best.r, y: best.y } : null
}

// MARK: Rotation offsets
// GLB pivot is at the tile's SW corner (geometry extends +X/+Z), so
// rotating swings geometry into other cells. This offset compensates
// so the rotated tile still fills its intended parcel.
export const ROT_OFFSET: Array<[number, number]> = [
  [0, 0],           // r=0: no offset
  [0, CELL],        // r=1: 90° CW
  [CELL, CELL],     // r=2: 180°
  [CELL, 0],        // r=3: 270° CW
]

function placeTile(t: TileType, r: number, x: number, z: number, y: number): void {
	grid.set(key(x, z, y), { type: t, r, x, z, y, order: placeCounter++ })
}

/**
 * Post-generation sanity: every non-reserved cell must be filled.
 * That's the only invariant left — every tile is a cross at r=0 so
 * opening-alignment is trivially satisfied.
 */
export function validate(): boolean {
	return grid.size === GRID_W * GRID_H - reservedCells.size
}

/**
 * Populate the grid. Every non-reserved cell gets a `cross` tile at
 * rotation 0 (uses `tile-cross-full.glb`, the flat 4-way-open snow tile
 * with no walls). Cliffs live in the reservation set; everything else
 * is walkable ground.
 */
export function generate(): void {
	for (let z = 0; z < GRID_H; z++) {
		for (let x = 0; x < GRID_W; x++) {
			if (isReserved(x, z)) continue
			placeTile('cross', 0, x, z, 0)
		}
	}
}

/**
 * Deterministic single-shot generate. `seed` is accepted for API
 * compatibility with the older retry-until-valid solver, but is
 * unused: the current generator can never fail (uniform cross fill).
 * Returns the input seed on success, null on the impossible-
 * validate-failure branch.
 */
export function generateWithRetry(startSeed: number, _maxAttempts = 1): number | null {
	resetGrid()
	generate()
	return validate() ? startSeed : null
}
