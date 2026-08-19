/**
 * generator.ts — grid state + placement rules + BFS maze growth.
 *
 * Deterministic given a seed. `generate()` mutates module-private state
 * (`grid`, `placeCounter`) — callers loop over seeds via `resetGrid()` +
 * `setSeed()` + `generate()` + `validate()` until a valid maze surfaces.
 *
 * No engine imports. Pure over tiles + rng + math. The visual side
 * (spawning entities) lives in rebuild.ts.
 *
 * Grid coordinates are integer cell indices; world Y is a real number
 * quantized to STEP multiples (with 3-decimal rounding to defeat float
 * drift from repeated `y + STEP` arithmetic).
 */

import {
	MAZE_GRID_HEIGHT,
	MAZE_GRID_WIDTH,
	MAZE_MAX_STACK_Y_METERS,
	MAZE_ORIGIN_OFFSET_METERS,
	MAZE_RAMP_STEP_METERS,
	MAZE_TILE_GLTF_SCALE,
	MAZE_TILE_WORLD_METERS,
	SCENE_WORLD_SIZE_METERS,
} from 'src/shared/settings'

import { rand, setSeed } from 'src/shared/maze/rng'
import {
	ALL_DIRS, DX, DZ, Dir, N, E, S, W, OPP,
	TILES, TileType,
	GROWTH_PRIMARY, GROWTH_FALLBACK,
	openingsAt, highDirAt,
} from 'src/shared/maze/tiles'

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
export const STEP        = MAZE_RAMP_STEP_METERS
export const MAX_Y       = MAZE_MAX_STACK_Y_METERS

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

// MARK: Placement rules
// Returns true iff the tile can legally occupy (x, z, y) at rotation r
// given the current grid contents. Encodes: vertical stacking rules,
// cross-level parallel-ramp rules, ramp-handshake rules, preemptive
// unsatisfiability checks, no-two-ramps-in-a-row, and edge connectivity
// against every neighbor at same level and one-below (for ramp decks).
function canPlace(t: TileType, r: number, x: number, z: number, y: number): boolean {
  if (grid.has(key(x, z, y))) return false
  const opens = openingsAt(t, r)
  const highDir = highDirAt(t, r)
  const iAmRamp = !!TILES[t].isRamp

  // Vertical stacking rule:
  //  - The cell above a ramp must be empty OR another ramp (chained upward).
  //  - The cell below a ramp is unrestricted (ramps only go up, so there's empty
  //    air beneath the deck that any tile can occupy).
  const above = grid.get(key(x, z, y + STEP))
  if (above?.type === 'ramp' && !iAmRamp) return false
  if (iAmRamp && above && above.type !== 'ramp') return false
  // Stacked ramps must share the same rotation (same climb direction),
  // otherwise perpendicular ramps collide in a tight vertical space.
  if (iAmRamp && above?.type === 'ramp' && above.r !== r) return false
  const below = grid.get(key(x, z, y - STEP))
  if (iAmRamp && below?.type === 'ramp' && below.r !== r) return false
  // Non-ramp tiles cannot sit above a ramp cell (would clip the ramp's deck).
  if (!iAmRamp && below?.type === 'ramp') return false

  // Cross-level parallel ramp rule.
  // Two ramps that are (a) offset by one STEP in Y, (b) orthogonally adjacent in
  // XZ, and (c) parallel (same axis) must share the SAME high direction — i.e.
  // same rotation, not opposite. Opposite-high parallels form fragile "V"
  // configurations whose resolution requires several dependent placements to
  // succeed; when any link fails, one end is left dangling. Requiring matched
  // high directions collapses these into clean, always-resolvable staircases.
  if (iAmRamp) {
    for (const d of ALL_DIRS) {
      // Only check neighbors along MY axis — same-axis ramps interact via
      // their sloping edges on the axis-aligned column boundary. Cross-axis
      // neighbors meet as wall‑to‑wall regardless of rotation, so they don't
      // create edge mismatches.
      if ((d % 2) !== (r % 2)) continue
      const nx = x + DX[d], nz = z + DZ[d]
      if (!inBounds(nx, nz)) continue
      for (const dy of [STEP, -STEP]) {
        const nb = grid.get(key(nx, nz, y + dy))
        if (nb?.type !== 'ramp') continue
        // Same axis (guaranteed by d filter) but different rotation → opposite
        // highs → misaligned edges on shared boundary at differing Y → reject.
        if (nb.r !== r) return false
      }
    }
  }

  // Adjacent-ramp handshake rule.
  // A ramp's cell-above is locked to be either empty OR a same-rotation ramp.
  // Consequence: if one ramp's HIGH side points at an orthogonally-adjacent
  // same-Y ramp, the pointer's high opening lands in the neighbor's cell-above,
  // which is constrained to the neighbor's rotation. Unless the two ramps share
  // a rotation (matched handshake) OR both high-sides point at each other
  // (parallel-opposite ramps meeting edge-to-edge at Y+STEP), the opening is
  // structurally unsatisfiable → dangling end. Reject up front.
  if (iAmRamp) {
    for (const d of ALL_DIRS) {
      const nx = x + DX[d], nz = z + DZ[d]
      if (!inBounds(nx, nz)) continue
      const nb = grid.get(key(nx, nz, y))
      if (nb?.type !== 'ramp') continue
      const nbHigh = highDirAt(nb.type, nb.r)!
      const mePointsAtNb = highDir === d              // my high goes toward neighbor
      const nbPointsAtMe = nbHigh === OPP[d]          // neighbor's high comes toward me
      if (!mePointsAtNb && !nbPointsAtMe) continue    // no high-side interaction, other checks cover it
      if (nb.r === r) continue                        // same rotation → clean handshake
      if (mePointsAtNb && nbPointsAtMe) continue      // parallel-opposite meeting at shared high edge
      return false                                     // asymmetric point → unsatisfiable
    }
  }

  // Preemptive: if I'm a ramp, my high side lands at (targetX, targetZ, y+STEP).
  // If that cell already has a ramp at y=y with a DIFFERENT rotation, the
  // target cell can never be filled (non-ramp above ramp is forbidden, and only
  // same-rotation ramps can stack). Reject me now to save a wasted attempt.
  if (iAmRamp && highDir !== null) {
    const tx = x + DX[highDir]
    const tz = z + DZ[highDir]
    if (inBounds(tx, tz)) {
      const targetBelow = grid.get(key(tx, tz, y))
      if (targetBelow?.type === 'ramp' && targetBelow.r !== r) return false
    }
  }

  // No-two-ramps-in-a-row rule: a ramp cannot connect directly to another
  // ramp. Forces at least one flat tile between elevation changes, breaking up
  // long staircases and giving the maze more horizontal breathing room.
  if (iAmRamp) {
    for (const d of opens) {
      const nx = x + DX[d], nz = z + DZ[d]
      if (!inBounds(nx, nz)) continue
      const ny = highDir === d ? y + STEP : y
      const nb = grid.get(key(nx, nz, ny))
      if (nb?.type === 'ramp') return false
      // Also check the ramp-below case: if a lower ramp's high side reaches
      // my opening's level, that's still a ramp-to-ramp connection.
      if (ny >= STEP) {
        const under = grid.get(key(nx, nz, ny - STEP))
        if (under?.type === 'ramp' && highDirAt(under.type, under.r) === OPP[d]) return false
      }
    }
  }

  for (const d of ALL_DIRS) {
    const isOpen = opens.has(d)
    const nx = x + DX[d], nz = z + DZ[d]
    // Reserved cells are treated identically to off-grid: no opening may
    // point into them (nothing will ever be placed there to receive it).
    if (!inBounds(nx, nz) || isReserved(nx, nz)) {
      if (isOpen) return false // opening would face off-grid or reserved cell
      continue
    }
    // Height at which MY opening on side d sits
    const myY = highDir === d ? y + STEP : y
    if (myY > MAX_Y) return false

    const back = OPP[d]

    // (a) Neighbor at same level as my opening
    const nb1 = grid.get(key(nx, nz, myY))
    if (nb1) {
      const nb1Opens = openingsAt(nb1.type, nb1.r)
      const nb1High = highDirAt(nb1.type, nb1.r)
      if (nb1High === back) {
        // Neighbor's back side is its ramp-high: no horizontal opening from nb1
        // itself at Y=myY. BUT if a ramp below nb1 has its high reaching myY on
        // this edge (same-rotation stack), that lower ramp's high deck IS the
        // walkway our opening receives — so "open" is still valid. Only reject
        // when neither nb1 nor a matching lower ramp provides the connection.
        if (isOpen) {
          if (myY < STEP) return false
          const under = grid.get(key(nx, nz, myY - STEP))
          if (!under || under.type !== 'ramp' || highDirAt(under.type, under.r) !== back) return false
        }
      } else {
        if (nb1Opens.has(back) !== isOpen) return false
      }
    }
    // (a2) If this side is MY ramp's high side, my Y=y level is a wall on that side.
    // A neighbor at (nx, nz, y) with a horizontal opening pointing back at us would
    // die into that wall — reject.
    if (highDir === d) {
      const nbAtY = grid.get(key(nx, nz, y))
      if (nbAtY) {
        const nbAtYOpens = openingsAt(nbAtY.type, nbAtY.r)
        const nbAtYHigh = highDirAt(nbAtY.type, nbAtY.r)
        if (nbAtYOpens.has(back) && nbAtYHigh !== back) return false
      }
    }
    // (b) Ramp below whose upper level reaches my Y.
    //  - If its high side points at me → my side must be OPEN (connects to ramp's high).
    //  - Otherwise (wall side or low side facing me) → my side must be CLOSED,
    //    since there's nothing valid to connect to at this elevation.
    if (myY >= STEP) {
      const nb2 = grid.get(key(nx, nz, myY - STEP))
      if (nb2?.type === 'ramp') {
        const nb2High = highDirAt(nb2.type, nb2.r)
        if (nb2High === back) {
          if (!isOpen) return false
        } else {
          if (isOpen) return false
        }
      }
    }
  }
  return true
}

function placeTile(t: TileType, r: number, x: number, z: number, y: number): void {
  grid.set(key(x, z, y), { type: t, r, x, z, y, order: placeCounter++ })
}

/**
 * Post-generation sanity — SIMPLIFIED.
 *
 * With every non-reserved cell placed as a `cross` at r=0, coverage is
 * the only invariant that can fail. Opening-alignment checks are moot
 * (every tile has all 4 openings and there are no ramps).
 */
export function validate(): boolean {
  return grid.size === GRID_W * GRID_H - reservedCells.size
}

function shuffle<T>(a: T[]): T[] {
  const b = a.slice()
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[b[i], b[j]] = [b[j], b[i]]
  }
  return b
}

/**
 * Populate the grid — SIMPLIFIED.
 *
 * Every non-reserved cell gets a `cross` tile at rotation 0 (which uses
 * `tile-cross-full.glb`, the flat 4-way-open snow tile with no walls).
 * The maze is pure snow infill; cliffs live in the reservation set,
 * everything else is walkable ground. No orientation, no opening-
 * alignment checks, no backtracking, no seed retries.
 *
 * The old solver (canPlace / solveCells / all the ramp handshake rules)
 * is left intact below but is now dead code — kept for one commit so
 * the diff is reviewable; slated for deletion in a follow-up cleanup.
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
 * Recursive backtracking placement. At each cell, tries tile candidates
 * (in shuffled order per rotation) and backtracks on dead ends.
 *
 * Cell-position pool policy:
 *   • Interior cells (all 4 neighbors in-grid) → ONLY `cross`. Every side
 *     must be open to receive the surrounding tiles' openings, and cross
 *     is the only 4-way tile.
 *   • Edge / corner cells → primary pool then fallback. canPlace() rejects
 *     any tile whose openings don't match the constraints from neighbors
 *     (already-placed cross tiles) and off-grid walls, so the solver
 *     naturally picks fork on edges and turn on corners.
 *
 * With MAX_Y=0, ramp openings self-reject in canPlace so ramps never
 * survive even if they were in the pool.
 */
function solveCells(cells: Array<{ x: number; z: number }>, idx: number): boolean {
  if (idx === cells.length) return true
  const { x, z } = cells[idx]
  // Dynamic pool policy — count closed sides (off-grid OR reserved) and
  // pick the tile family whose opening pattern matches. With an empty
  // reservation set this reduces exactly to the old wall-count policy:
  // corners → turn, edges → fork, interior → cross.
  //
  //   Closed sides | Pool
  //   -------------+-------------------------------------------
  //   4            | (skip) — unreachable island, coverage n/a
  //   3            | end       (single opening)
  //   2 opposite   | straight  (two collinear openings)
  //   2 adjacent   | turn      (two perpendicular openings)
  //   1            | fork      (three openings)
  //   0            | cross     (four openings)
  const wN = isClosedSide(x + DX[N], z + DZ[N])
  const wE = isClosedSide(x + DX[E], z + DZ[E])
  const wS = isClosedSide(x + DX[S], z + DZ[S])
  const wW = isClosedSide(x + DX[W], z + DZ[W])
  const closedCount = (wN ? 1 : 0) + (wE ? 1 : 0) + (wS ? 1 : 0) + (wW ? 1 : 0)

  // 4-walls island: nothing can legally sit here. Skip the cell — it
  // was excluded from the coverage target already (only reachable when
  // reservations surround a cell, or on a 1×1 grid).
  if (closedCount === 4) return solveCells(cells, idx + 1)

  let pool: TileType[]
  if (closedCount === 3) {
    pool = ['end']
  } else if (closedCount === 2) {
    // Opposite pair → straight; adjacent pair → turn.
    const opposite = (wN && wS) || (wE && wW)
    pool = opposite ? ['straight'] : ['turn']
  } else if (closedCount === 1) {
    pool = ['fork']
  } else {
    pool = ['cross']
  }
  const pools: TileType[][] = [pool]
  for (const pool of pools) {
    for (const t of shuffle(pool)) {
      for (const r of shuffle([0, 1, 2, 3])) {
        if (!canPlace(t, r, x, z, 0)) continue
        placeTile(t, r, x, z, 0)
        if (solveCells(cells, idx + 1)) return true
        grid.delete(key(x, z, 0))
        placeCounter-- // reclaim the id so BFS order stays contiguous
      }
    }
  }
  return false
}

/**
 * Iterate seeds starting at `startSeed` until one produces a valid maze
 * or the attempt budget is exhausted. Returns the winning seed, or null
 * if none was found. Deterministic: same startSeed always yields the
 * same winner across every client.
 */
export function generateWithRetry(startSeed: number, maxAttempts = 2000): number | null {
  for (let i = 0; i < maxAttempts; i++) {
    const trySeed = startSeed + i
    setSeed(trySeed)
    resetGrid()
    generate()
    if (validate()) return trySeed
  }
  return null
}
