/**
 * perimeter.ts (shared) — pure planning + geometry for the decorative
 * cliff ring around the interior playfield.
 *
 * Extracted from src/client/perimeter.ts so both server-side placement
 * code (e.g. src/shared/camp.ts) and client-side spawn code can query
 * the same deterministic cliff layout without duplicating logic. The
 * client module still owns all ECS spawn / teardown; this module owns
 * every constant, every planning function, and the reservation helper.
 *
 * Deterministic model:
 *   - PERIM_SEED is a module-scoped integer set via setPerimeterSeed().
 *     Every hash / density decision below mixes it in, so all callers
 *     that run setPerimeterSeed(sameValue) get an identical placement
 *     list. The cycle system pushes the current cycle seed through
 *     here so a reroll rebuilds the ring at a fresh silhouette.
 *   - No RNG, no netcode. Server and every client compute the same
 *     `computeAllCliffPlacements()` array locally.
 *
 * New helper: `isPointOnCliff(x, z)` — used by src/shared/camp.ts to
 * skip compass bearings that would land the pilgrimage camp on top of
 * a cliff. Cheap O(N) scan; N is small (dozens of tiles).
 */

import { isInsideCliffBuffer } from 'src/shared/campfire'
import { TileType } from 'src/shared/maze/tiles'
import {
	MAZE_GRID_HEIGHT,
	MAZE_GRID_WIDTH,
	MAZE_ORIGIN_OFFSET_METERS,
	MAZE_TILE_WORLD_METERS,
	SCENE_WORLD_SIZE_X_METERS,
	SCENE_WORLD_SIZE_Z_METERS,
} from 'src/shared/settings'


// MARK: Seed
/**
 * Global perimeter seed. Mixed into every deterministic hash in this
 * module (fork slot selection, canyon depth, mesa density). Set via
 * setPerimeterSeed(); all callers agree on placement as long as they
 * called setPerimeterSeed(sameValue) first.
 */
let PERIM_SEED = 0


// MARK: setPerimeterSeed
/**
 * Set the seed mixed into every deterministic hash in this module.
 * Call BEFORE consumers (setupPerimeter, getReservedPlayfieldCells,
 * getCampWorldPosition-with-cliff-avoid) so they all see the same
 * layout. The reroll button in the top action bar flows through here.
 */
export function setPerimeterSeed(seed: number): void {
	PERIM_SEED = seed | 0
}


// MARK: getPerimeterSeed
/** Read-only accessor. Useful for logging / diagnostics. */
export function getPerimeterSeed(): number {
	return PERIM_SEED
}


// MARK: Tuning
/**
 * Fork substitution frequency along edges. 0 disables (all straights),
 * 1 substitutes every straight. Deterministic via cellular position,
 * not random, so every client sees the same skyline with no sync.
 */
const FORK_EVERY_N = 3


// MARK: Derived geometry
/**
 * World size of one perimeter tile. The `tile-cliff-*.glb` models are
 * authored at 64 m footprint, so this is a plain constant. If the
 * cliff art footprint ever changes, update this value; the rest of
 * the perimeter geometry (canyon steps, mesa spacing, corner anchors)
 * is derived from it.
 */
export const PERIM_TILE_METERS = 64

/**
 * Perimeter ring is anchored to the SCENE, not the interior. Corners
 * always sit at the scene corners; edges tile inward from there.
 */
export const CORNER_NEAR_X = 0
export const CORNER_NEAR_Z = 0
export const CORNER_FAR_X  = SCENE_WORLD_SIZE_X_METERS - PERIM_TILE_METERS
export const CORNER_FAR_Z  = SCENE_WORLD_SIZE_Z_METERS - PERIM_TILE_METERS


// MARK: Edge type
/**
 * Cardinal direction of an edge along the perimeter — used to route
 * fork spurs and their end-cap tiles inward regardless of which side
 * of the ring we are currently laying down.
 */
export type Edge = 'S' | 'N' | 'W' | 'E'


// MARK: edgeSlotWorld
/**
 * Convert an (edge, slot) pair to the world (sx, sz) SW-corner-before-
 * rotation position used by spawn tiles. `slot` is measured in world
 * meters from the near corner along the edge.
 */
export function edgeSlotWorld(edge: Edge, slot: number): [number, number] {
	switch (edge) {
		case 'S': return [slot,          CORNER_NEAR_Z]
		case 'N': return [slot,          CORNER_FAR_Z]
		case 'W': return [CORNER_NEAR_X, slot]
		case 'E': return [CORNER_FAR_X,  slot]
	}
}


// MARK: Cap offset / rotation / fork tables (shared)
// Hoisted so the spawner, the planner, and the canyon walker all
// reference the same numbers — any divergence would desync
// reservations from actual geometry on some clients.
export const CAP_OFFSET: Record<Edge, [number, number]> = {
	S: [0,  PERIM_TILE_METERS],  // south edge → cap further N
	N: [0, -PERIM_TILE_METERS],  // north edge → cap further S
	W: [ PERIM_TILE_METERS, 0],  // west edge  → cap further E
	E: [-PERIM_TILE_METERS, 0],  // east edge  → cap further W
}
/** End-tile rotation per edge: opening faces back toward the fork. */
export const CAP_R: Record<Edge, number> = { S: 2, N: 0, W: 3, E: 1 }
/** Fork rotation per edge: spur points inward along CAP_OFFSET. */
export const FORK_R: Record<Edge, number> = { S: 1, N: 3, W: 2, E: 0 }
/** Straight tile rotation for the perpendicular canyon corridor. */
export const CANYON_STRAIGHT_R: Record<Edge, number> = { S: 0, N: 0, W: 1, E: 1 }


// MARK: canyonDepth
const CANYON_MIN_DEPTH = 1
const CANYON_MAX_DEPTH = 3
/**
 * Deterministic depth per fork slot. Hashes (edge, slot, seed) so the
 * same slot yields the same depth on every client with no shared
 * counter.
 */
function canyonDepth(edge: Edge, slot: number): number {
	const h = (((edge.charCodeAt(0) * 131 + Math.floor(slot)) ^ (PERIM_SEED * 2246822519)) * 2654435761) >>> 0
	const range = CANYON_MAX_DEPTH - CANYON_MIN_DEPTH + 1
	return CANYON_MIN_DEPTH + (h % range)
}


// MARK: planCanyonTail
/**
 * Walk `depth` perim-tile steps inward from a fork base at (sx, sz),
 * emitting the tile that should sit at each step. Terminates with an
 * `end` cap; truncates cleanly on scene bounds or campfire buffer.
 */
export interface CanyonTile { sx: number; sz: number; type: TileType; r: number }
export function planCanyonTail(edge: Edge, sx: number, sz: number, depth: number): CanyonTile[] {
	const [dcx, dcz] = CAP_OFFSET[edge]
	const straightR  = CANYON_STRAIGHT_R[edge]
	const endR       = CAP_R[edge]
	const tail: CanyonTile[] = []
	let truncated = false
	for (let i = 1; i <= depth; i++) {
		const tx = sx + dcx * i
		const tz = sz + dcz * i
		if (tx < 0 || tz < 0
		 || tx + PERIM_TILE_METERS > SCENE_WORLD_SIZE_X_METERS
		 || tz + PERIM_TILE_METERS > SCENE_WORLD_SIZE_Z_METERS) { truncated = true; break }
		const cx = tx + PERIM_TILE_METERS / 2
		const cz = tz + PERIM_TILE_METERS / 2
		if (isInsideCliffBuffer(cx, cz)) { truncated = true; break }
		const isLast = i === depth
		tail.push({
			sx: tx, sz: tz,
			type: isLast ? 'end' : 'straight',
			r:    isLast ? endR : straightR,
		})
	}
	if (truncated && tail.length > 0) {
		tail[tail.length - 1] = { ...tail[tail.length - 1], type: 'end', r: endR }
	}
	return tail
}


// MARK: planEdgeTile
export interface EdgeTilePlan {
	effectiveType: TileType
	/** Only present when effectiveType === 'fork'. */
	capCenter?: { x: number; z: number }
}
export function planEdgeTile(edge: Edge, slot: number, type: TileType): EdgeTilePlan {
	if (type !== 'fork') return { effectiveType: type }
	const [sx, sz] = edgeSlotWorld(edge, slot)
	const [dcx, dcz] = CAP_OFFSET[edge]
	const capCenterX = sx + dcx + PERIM_TILE_METERS / 2
	const capCenterZ = sz + dcz + PERIM_TILE_METERS / 2
	if (isInsideCliffBuffer(capCenterX, capCenterZ)) {
		return { effectiveType: 'straight' }
	}
	return { effectiveType: 'fork', capCenter: { x: capCenterX, z: capCenterZ } }
}


// MARK: iterEdgeSlots
export function iterEdgeSlots(cb: (edge: Edge, slot: number, type: TileType) => void): void {
	const numEdgeSlots = Math.max(
		0,
		Math.floor((SCENE_WORLD_SIZE_X_METERS - 2 * PERIM_TILE_METERS) / PERIM_TILE_METERS),
	)
	const edgeSlots: number[] = []
	for (let i = 0; i < numEdgeSlots; i++) {
		edgeSlots.push(PERIM_TILE_METERS * (i + 1))
	}

	const pickType = (edge: Edge, s: number): TileType => {
		const h = (((edge.charCodeAt(0) * 2654435761) ^ (Math.floor(s) * 40503) ^ (PERIM_SEED * 2246822519)) >>> 0)
		return (h % FORK_EVERY_N === 0) ? 'fork' : 'straight'
	}

	for (const s of edgeSlots) {
		cb('S', s, pickType('S', s))
		cb('N', s, pickType('N', s))
	}
	for (const s of edgeSlots) {
		cb('W', s, pickType('W', s))
		cb('E', s, pickType('E', s))
	}
}


// MARK: Mesas
const MESA_SLOT_SPACING = PERIM_TILE_METERS * 2   // 128 m between candidates
const MESA_DENSITY_MOD  = 3                        // ~1/3 of slots

export interface MesaTile { sx: number; sz: number; type: TileType; r: number }

function iterMesaSlots(cb: (sx: number, sz: number, hash: number) => void): void {
	const minCoord  = PERIM_TILE_METERS
	const maxCoordX = SCENE_WORLD_SIZE_X_METERS - 3 * PERIM_TILE_METERS
	const maxCoordZ = SCENE_WORLD_SIZE_Z_METERS - 3 * PERIM_TILE_METERS
	for (let sx = minCoord; sx <= maxCoordX; sx += MESA_SLOT_SPACING) {
		for (let sz = minCoord; sz <= maxCoordZ; sz += MESA_SLOT_SPACING) {
			const h = (((Math.floor(sx) * 73856093) ^ (Math.floor(sz) * 19349663) ^ (PERIM_SEED * 2246822519)) >>> 0)
			cb(sx, sz, h)
		}
	}
}

function planMesas(): MesaTile[] {
	const out: MesaTile[] = []
	iterMesaSlots((sx, sz, hash) => {
		if (hash % MESA_DENSITY_MOD !== 0) return
		const vertical = ((hash >>> 4) & 1) === 0
		const [dx, dz] = vertical ? [0, PERIM_TILE_METERS] : [PERIM_TILE_METERS, 0]
		const [rA, rB] = vertical ? [0, 2] : [1, 3]
		const cAX = sx + PERIM_TILE_METERS / 2
		const cAZ = sz + PERIM_TILE_METERS / 2
		const cBX = sx + dx + PERIM_TILE_METERS / 2
		const cBZ = sz + dz + PERIM_TILE_METERS / 2
		if (isInsideCliffBuffer(cAX, cAZ) || isInsideCliffBuffer(cBX, cBZ)) return
		out.push({ sx,       sz,       type: 'end', r: rA })
		out.push({ sx: sx+dx, sz: sz+dz, type: 'end', r: rB })
	})
	return out
}


// MARK: computeAllCliffPlacements
/**
 * Build the full deterministic list of every cliff tile the perimeter
 * system will spawn: 4 corners, every edge slot (straight or fork),
 * every canyon tail tile beyond each fork, every mesa half.
 *
 * Deduplicated by (sx, sz) world position. Both the spawner and the
 * reservation collector (and now the camp placement) iterate this
 * list, so they can never disagree on what geometry exists.
 */
export interface CliffPlacement { sx: number; sz: number; type: TileType; r: number }
export function computeAllCliffPlacements(): CliffPlacement[] {
	const out: CliffPlacement[] = []
	const seen = new Set<string>()
	const posKey = (sx: number, sz: number) => `${Math.round(sx)},${Math.round(sz)}`
	const tryAdd = (p: CliffPlacement): boolean => {
		const k = posKey(p.sx, p.sz)
		if (seen.has(k)) return false
		seen.add(k)
		out.push(p)
		return true
	}

	// 4 corners
	tryAdd({ sx: CORNER_NEAR_X, sz: CORNER_NEAR_Z, type: 'turn', r: 0 })
	tryAdd({ sx: CORNER_NEAR_X, sz: CORNER_FAR_Z,  type: 'turn', r: 1 })
	tryAdd({ sx: CORNER_FAR_X,  sz: CORNER_FAR_Z,  type: 'turn', r: 2 })
	tryAdd({ sx: CORNER_FAR_X,  sz: CORNER_NEAR_Z, type: 'turn', r: 3 })

	// Edge tiles + canyon tails
	iterEdgeSlots((edge, slot, type) => {
		const [sx, sz] = edgeSlotWorld(edge, slot)
		const plan = planEdgeTile(edge, slot, type)
		let effectiveType = plan.effectiveType
		const ringStraightR = (edge === 'S' || edge === 'N') ? 1 : 0

		let tail: CanyonTile[] = []
		if (effectiveType === 'fork') {
			tail = planCanyonTail(edge, sx, sz, canyonDepth(edge, slot))
			const firstBlocked = tail.length > 0 && seen.has(posKey(tail[0].sx, tail[0].sz))
			if (tail.length === 0 || firstBlocked) effectiveType = 'straight'
		}

		const r = effectiveType === 'fork' ? FORK_R[edge] : ringStraightR
		tryAdd({ sx, sz, type: effectiveType, r })
		if (effectiveType !== 'fork') return
		for (const t of tail) tryAdd(t)
	})

	// Mesas (paired end tiles). Drop entire pair on any collision.
	const mesas = planMesas()
	for (let i = 0; i < mesas.length; i += 2) {
		const a = mesas[i]
		const b = mesas[i + 1]
		if (!b) break
		if (seen.has(posKey(a.sx, a.sz)) || seen.has(posKey(b.sx, b.sz))) continue
		tryAdd(a)
		tryAdd(b)
	}

	return out
}


// MARK: isPointOnCliff
/**
 * True if world point (x, z) sits inside any cliff tile's 64 m
 * axis-aligned footprint at the CURRENT perimeter seed. O(N) scan
 * over the cliff placement list (N is small — dozens of tiles).
 *
 * `pad` (metres, default 0) enlarges every footprint on all sides —
 * useful for "camp needs to sit at least pad metres clear of any
 * cliff face" checks. Camp placement in src/shared/camp.ts passes
 * `pad = CAMP_MELT_RADIUS_M` so the whole warm ring stays on snow.
 *
 * Assumes setPerimeterSeed() has been called for the intended cycle
 * seed first; without that, the check runs against seed 0's layout.
 */
export function isPointOnCliff(x: number, z: number, pad: number = 0): boolean {
	const placements = computeAllCliffPlacements()
	for (const p of placements) {
		const minX = p.sx - pad
		const minZ = p.sz - pad
		const maxX = p.sx + PERIM_TILE_METERS + pad
		const maxZ = p.sz + PERIM_TILE_METERS + pad
		if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) return true
	}
	return false
}


// MARK: reserveFootprint
interface Shrink4 { minX: number; maxX: number; minZ: number; maxZ: number }
function reserveFootprint(
	out: Set<string>,
	sx:  number,
	sz:  number,
	s:   Shrink4 = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
): void {
	const minX = sx + s.minX, maxX = sx + PERIM_TILE_METERS - s.maxX
	const minZ = sz + s.minZ, maxZ = sz + PERIM_TILE_METERS - s.maxZ
	if (minX >= maxX || minZ >= maxZ) return
	const O = MAZE_ORIGIN_OFFSET_METERS
	const C = MAZE_TILE_WORLD_METERS
	const EPS = 1e-6
	const txMin = Math.max(0, Math.ceil((minX - O) / C - 0.5))
	const txMax = Math.min(MAZE_GRID_WIDTH  - 1, Math.floor((maxX - O) / C - 0.5 - EPS))
	const tzMin = Math.max(0, Math.ceil((minZ - O) / C - 0.5))
	const tzMax = Math.min(MAZE_GRID_HEIGHT - 1, Math.floor((maxZ - O) / C - 0.5 - EPS))
	for (let tz = tzMin; tz <= tzMax; tz++) {
		for (let tx = txMin; tx <= txMax; tx++) {
			out.add(`${tx},${tz}`)
		}
	}
}


// MARK: rotateShrink
function rotateShrink(s: Shrink4, r: number): Shrink4 {
	switch (((r % 4) + 4) % 4) {
		case 0: return s
		case 1: return { minX: s.minZ, maxX: s.maxZ, minZ: s.maxX, maxZ: s.minX }
		case 2: return { minX: s.maxX, maxX: s.minX, minZ: s.maxZ, maxZ: s.minZ }
		case 3: return { minX: s.maxZ, maxX: s.minZ, minZ: s.minX, maxZ: s.maxX }
	}
	return s
}


// MARK: insideCornerLocalCells
function insideCornerLocalCells(type: TileType, r: number): Array<[number, number]> {
	let canonical: Array<[number, number]>
	switch (type) {
		case 'turn': canonical = [[3, 3]]; break
		case 'fork': canonical = [[0, 0], [0, 3]]; break
		default: return []
	}
	return canonical.map(([x, z]) => rotateLocalCell(x, z, r))
}


// MARK: rotateLocalCell
function rotateLocalCell(lx: number, lz: number, r: number): [number, number] {
	const N = 3
	switch (((r % 4) + 4) % 4) {
		case 0: return [lx,     lz]
		case 1: return [lz,     N - lx]
		case 2: return [N - lx, N - lz]
		case 3: return [N - lz, lx]
	}
	return [lx, lz]
}


// MARK: unreserveCell
function unreserveCell(out: Set<string>, sx: number, sz: number, lx: number, lz: number): void {
	const O = MAZE_ORIGIN_OFFSET_METERS
	const C = MAZE_TILE_WORLD_METERS
	const wx = sx + (lx + 0.5) * C
	const wz = sz + (lz + 0.5) * C
	const tx = Math.floor((wx - O) / C)
	const tz = Math.floor((wz - O) / C)
	if (tx < 0 || tx >= MAZE_GRID_WIDTH)  return
	if (tz < 0 || tz >= MAZE_GRID_HEIGHT) return
	out.delete(`${tx},${tz}`)
}


// MARK: getReservedPlayfieldCells
/**
 * Compute the set of playfield grid cells (tx, tz) that the perimeter
 * cliff geometry physically occupies. Fed to the maze generator so
 * the maze retreats around every cliff footprint instead of clipping
 * through it. Deterministic pure function; every client agrees.
 */
export interface ReservedTile { tx: number; tz: number }
export function getReservedPlayfieldCells(): ReservedTile[] {
	const reserved = new Set<string>()

	const C = MAZE_TILE_WORLD_METERS
	const CLIFF_SHRINK: Record<TileType, Shrink4> = {
		straight: { minX: C, maxX: C, minZ: 0, maxZ: 0 },
		end:      { minX: C, maxX: C, minZ: C, maxZ: 0 },
		fork:     { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
		turn:     { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
		cross:    { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
		ramp:     { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
	}
	for (const p of computeAllCliffPlacements()) {
		const rotated = rotateShrink(CLIFF_SHRINK[p.type], p.r)
		reserveFootprint(reserved, p.sx, p.sz, rotated)
		for (const [lx, lz] of insideCornerLocalCells(p.type, p.r)) {
			unreserveCell(reserved, p.sx, p.sz, lx, lz)
		}
	}

	const out: ReservedTile[] = []
	for (const k of reserved) {
		const [tx, tz] = k.split(',').map(Number)
		out.push({ tx, tz })
	}
	return out
}
