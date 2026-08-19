/**
 * perimeter.ts — decorative cliff ring around the interior playfield.
 *
 * Spawns 4×-scaled maze tile GLBs (turn / straight / fork) along the
 * scene border to give the world a physical boundary and horizon
 * silhouette. Uses the same tile assets and rotation convention as the
 * interior maze, so the two systems visually mate at the interior edge
 * even though the perimeter tiles are much larger.
 *
 * Layout for a 256×256 scene with a centred 128×128 playfield:
 *   - Perimeter ring is 64 m thick (one 4× tile).
 *   - 4 corner tiles (tile-turn-full).
 *   - 8 edge tiles between the corners (2 per edge).
 *   - Occasional fork substitutions add variety on the edges — the
 *     fork's spur points outward for a jagged skyline read.
 *
 * All positions are computed from settings constants so scaling the
 * scene or shrinking/growing the playfield reshapes the ring in place.
 * No network sync — perimeter geometry is client-local and static.
 */

import { engine, ColliderLayer, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import { isInsideCliffBuffer } from 'src/shared/campfire'
import { TILES, TileType } from 'src/shared/maze/tiles'
import {
	MAZE_GRID_HEIGHT,
	MAZE_GRID_WIDTH,
	MAZE_ORIGIN_OFFSET_METERS,
	MAZE_PLAYFIELD_METERS,
	MAZE_TILE_WORLD_METERS,
	SCENE_WORLD_SIZE_X_METERS,
	SCENE_WORLD_SIZE_Z_METERS,
} from 'src/shared/settings'


// MARK: Tuning
// Horizontal scale applied to every perimeter tile GLB. 4 = one perimeter
// tile spans 64 m (4 parcels), matching the width of the perimeter ring.
const PERIM_SCALE   = 4
// Vertical scale — taller than wide so the cliff wall reads as a real
// horizon silhouette instead of a squat 4× tile.
const PERIM_SCALE_Y = 25
// Perimeter tiles use the non-`-full` GLB variants — the `-full` meshes
// are authored for the interior maze and read wrong at 4× scale. The
// interior maze still pulls its models from `TILES[type].model`; this
// override is perimeter-local only.
const PERIM_MODELS: Record<TileType, string> = {
	end:      'assets/models/tile-end.glb',
	straight: 'assets/models/tile-straight.glb',
	turn:     'assets/models/tile-turn.glb',
	fork:     'assets/models/tile-fork.glb',
	cross:    'assets/models/tile-cross.glb',
	ramp:     'assets/models/tile-ramp.glb',
}
// Y for the tile base. Match the interior maze's tile Y (0) so the two
// systems sit on the same floor plane.
const PERIM_Y      = 0
// Fork substitution frequency along edges. 0 disables (all straights),
// 1 substitutes every straight. Deterministic via cellular position, not
// random, so every client sees the same skyline with no sync needed.
const FORK_EVERY_N = 3


// MARK: Derived geometry

/** World size of one perimeter tile after scaling. */
const PERIM_TILE_METERS = MAZE_TILE_WORLD_METERS * PERIM_SCALE

/**
 * Perimeter ring is anchored to the SCENE, not the interior. Corners
 * always sit at the scene corners; edges tile inward from there. Any
 * mismatch between (scene - playfield) / 2 and PERIM_TILE_METERS shows
 * up as a symmetric interior/perimeter overlap, which is the intended
 * read at the current playfield size (160 m in a 256 m scene = 16 m
 * overlap per side).
 */
const CORNER_NEAR_X = 0
const CORNER_NEAR_Z = 0
const CORNER_FAR_X  = SCENE_WORLD_SIZE_X_METERS - PERIM_TILE_METERS
const CORNER_FAR_Z  = SCENE_WORLD_SIZE_Z_METERS - PERIM_TILE_METERS


// MARK: Rotation helper
// Scaled tile GLB pivot is at the SW corner (matches the interior tile
// convention). Under a Y rotation of r × 90° the geometry swings into
// adjacent cells, so we add a compensating XZ offset scaled by the
// perimeter tile size.
const PERIM_ROT_OFFSET: Array<[number, number]> = [
	[0,                 0],                // r=0
	[0,                 PERIM_TILE_METERS], // r=1 (90° CW)
	[PERIM_TILE_METERS, PERIM_TILE_METERS], // r=2
	[PERIM_TILE_METERS, 0],                 // r=3
]


// MARK: spawnPerimTile

/**
 * Spawn one perimeter tile at grid corner (sx, sz) with rotation quarter
 * `r` (0..3). `sx` / `sz` are world coords of the tile's SW corner
 * BEFORE rotation compensation — this function applies the compensation
 * automatically.
 */
function spawnPerimTile(type: TileType, sx: number, sz: number, r: number): void {
	const [dx, dz] = PERIM_ROT_OFFSET[r]
	const e = engine.addEntity()
	Transform.create(e, {
		position: Vector3.create(sx + dx, PERIM_Y, sz + dz),
		rotation: Quaternion.fromEulerDegrees(0, r * 90, 0),
		scale:    Vector3.create(PERIM_SCALE, PERIM_SCALE_Y, PERIM_SCALE),
	})
	GltfContainer.create(e, {
		src:                          PERIM_MODELS[type],
		visibleMeshesCollisionMask:   ColliderLayer.CL_PHYSICS,
		invisibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS,
	})
}


// MARK: setupPerimeter

/**
 * Build the perimeter ring. Idempotent per boot but not cheap to redo
 * (spawns entities), so call once from client bootstrap.
 *
 * Straight-edge tiles are scaled tile-straight rotated so the corridor
 * runs parallel to their edge. Corner tiles are scaled tile-turn rotated
 * so the L wraps the corner (walls face outward). Occasional forks give
 * the perimeter a broken/organic silhouette without ruining alignment.
 */
/**
 * Cardinal direction of an edge along the perimeter — used to route
 * fork spurs and their end-cap tiles inward regardless of which side
 * of the ring we are currently laying down.
 */
type Edge = 'S' | 'N' | 'W' | 'E'


// MARK: spawnEdgeTile
/**
 * Place the perim ring tile at `slot` on `edge`. If it resolves to a
 * fork, also spawn the inward canyon tail (0..N-1 straight sections
 * plus a terminal `end` cap) computed by planCanyonTail().
 */
function spawnEdgeTile(edge: Edge, slot: number, type: TileType): void {
	const [sx, sz] = edgeSlotWorld(edge, slot)
	const plan = planEdgeTile(edge, slot, type)
	const effectiveType = plan.effectiveType

	// Straight rotation runs the corridor parallel to the ring edge.
	// Fork rotation points the spur INWARD along CAP_OFFSET.
	const ringStraightR = (edge === 'S' || edge === 'N') ? 1 : 0
	const r = effectiveType === 'fork' ? FORK_R[edge] : ringStraightR
	spawnPerimTile(effectiveType, sx, sz, r)

	if (effectiveType !== 'fork') return

	// --- Canyon tail ---
	// Depth is a deterministic function of (edge, slot) via canyonDepth().
	// planCanyonTail() also truncates the tail if it would enter the
	// campfire cliff buffer or run off the scene, capping whatever was
	// last placed with an `end` so the canyon never opens into empty
	// space.
	const tail = planCanyonTail(edge, sx, sz, canyonDepth(edge, slot))
	for (const t of tail) {
		spawnPerimTile(t.type, t.sx, t.sz, t.r)
	}
}


// MARK: edgeSlotWorld
/**
 * Convert an (edge, slot) pair to the world (sx, sz) SW-corner-before-
 * rotation position used by spawnPerimTile. `slot` is measured in
 * world meters from the near corner along the edge; the perpendicular
 * axis is pinned to CORNER_NEAR_X/Z or CORNER_FAR_X/Z as appropriate.
 */
function edgeSlotWorld(edge: Edge, slot: number): [number, number] {
	switch (edge) {
		case 'S': return [slot,          CORNER_NEAR_Z]
		case 'N': return [slot,          CORNER_FAR_Z]
		case 'W': return [CORNER_NEAR_X, slot]
		case 'E': return [CORNER_FAR_X,  slot]
	}
}


// MARK: Cap offset / rotation / fork tables (shared)
// Hoisted to module scope so the spawner, the planner, and the canyon
// walker all reference the same numbers — any divergence would desync
// reservations from actual geometry on some clients.
const CAP_OFFSET: Record<Edge, [number, number]> = {
	S: [0,  PERIM_TILE_METERS],  // south edge → cap further N
	N: [0, -PERIM_TILE_METERS],  // north edge → cap further S
	W: [ PERIM_TILE_METERS, 0],  // west edge  → cap further E
	E: [-PERIM_TILE_METERS, 0],  // east edge  → cap further W
}
// End-tile rotation per edge: rotates the single `end` opening to face
// back toward the fork (i.e. outward along the edge's inward axis).
const CAP_R: Record<Edge, number> = { S: 2, N: 0, W: 3, E: 1 }
// Fork rotation per edge: points the fork's spur inward along CAP_OFFSET.
const FORK_R: Record<Edge, number> = { S: 1, N: 3, W: 2, E: 0 }
// Straight rotation for a tile whose corridor runs ALONG the canyon
// (perpendicular to the ring edge). On S/N edges the canyon runs N-S
// → openings N-S → rotation 0. On W/E edges canyon runs E-W → rotation 1.
const CANYON_STRAIGHT_R: Record<Edge, number> = { S: 0, N: 0, W: 1, E: 1 }


// MARK: canyonDepth
// Number of tiles in a fork's inward tail (INCLUDING the terminal end
// cap). 1 = original behaviour (just a cap flush with the perim ring).
// Higher = deeper canyons cutting into the playfield.
const CANYON_MIN_DEPTH = 1
const CANYON_MAX_DEPTH = 3
/**
 * Deterministic depth per fork slot. Hashes (edge, slot) so the same
 * slot yields the same depth on every client with no shared counter.
 * Small integer multiplier + Knuth constant mixes the low bits enough
 * that adjacent slots don't all pick the same depth.
 */
function canyonDepth(edge: Edge, slot: number): number {
	const h = ((edge.charCodeAt(0) * 131 + Math.floor(slot)) * 2654435761) >>> 0
	const range = CANYON_MAX_DEPTH - CANYON_MIN_DEPTH + 1
	return CANYON_MIN_DEPTH + (h % range)
}


// MARK: planCanyonTail
/**
 * Walk `depth` perim-tile steps inward from a fork base at (sx, sz),
 * emitting the tile that should sit at each step. Intermediate tiles
 * are `straight` (aligned with the canyon axis); the terminal tile is
 * an `end` cap (opening pointing back toward the fork).
 *
 * Truncated cleanly when the next step would either:
 *   (a) intrude into the campfire cliff buffer (kept as a hard no-go),
 *   (b) run off the scene bounds (physical impossibility).
 * In both cases the previously-placed tile is rewritten as an `end` so
 * the canyon never terminates in a horizontal opening pointing at
 * nothing.
 *
 * Pure — the caller (spawner or reservation collector) iterates the
 * returned array. Both callers get identical results on every client.
 */
interface CanyonTile { sx: number; sz: number; type: TileType; r: number }
function planCanyonTail(edge: Edge, sx: number, sz: number, depth: number): CanyonTile[] {
	const [dcx, dcz] = CAP_OFFSET[edge]
	const straightR  = CANYON_STRAIGHT_R[edge]
	const endR       = CAP_R[edge]
	const tail: CanyonTile[] = []
	let truncated = false
	for (let i = 1; i <= depth; i++) {
		const tx = sx + dcx * i
		const tz = sz + dcz * i
		// Scene bounds check on the tile footprint.
		if (tx < 0 || tz < 0
		 || tx + PERIM_TILE_METERS > SCENE_WORLD_SIZE_X_METERS
		 || tz + PERIM_TILE_METERS > SCENE_WORLD_SIZE_Z_METERS) { truncated = true; break }
		// Campfire cliff buffer check on the tile centre.
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
	// If truncated mid-walk, rewrite the last placed tile as an end so
	// the canyon terminates in a wall, not an open straight.
	if (truncated && tail.length > 0) {
		tail[tail.length - 1] = { ...tail[tail.length - 1], type: 'end', r: endR }
	}
	return tail
}


// MARK: planEdgeTile
/**
 * Pure decision function — given a nominal (edge, slot, type), return
 * the effective tile type after cliff-buffer downgrade, plus the cap
 * centre if the tile ends up as a fork (needed by callers computing
 * playfield reservations).
 *
 * Kept side-effect-free so both `spawnEdgeTile` (spawns geometry) and
 * `getReservedPlayfieldCells` (reports reservations) can call it and
 * be guaranteed to agree on every slot, on every client.
 */
interface EdgeTilePlan {
	effectiveType: TileType
	/** Only present when effectiveType === 'fork'. */
	capCenter?: { x: number; z: number }
}
function planEdgeTile(edge: Edge, slot: number, type: TileType): EdgeTilePlan {
	if (type !== 'fork') return { effectiveType: type }
	const [sx, sz] = edgeSlotWorld(edge, slot)
	const [dcx, dcz] = CAP_OFFSET[edge]
	const capCenterX = sx + dcx + PERIM_TILE_METERS / 2
	const capCenterZ = sz + dcz + PERIM_TILE_METERS / 2
	// Only downgrade for the campfire cliff buffer. The old
	// isInsidePlayfield guard is intentionally gone — fork caps are
	// now free to poke into the playfield, and the maze generator
	// reserves the corresponding cell so it retreats around them.
	if (isInsideCliffBuffer(capCenterX, capCenterZ)) {
		return { effectiveType: 'straight' }
	}
	return { effectiveType: 'fork', capCenter: { x: capCenterX, z: capCenterZ } }
}


// MARK: iterEdgeSlots
/**
 * Walk every (edge, slot) pair in the exact deterministic order used
 * by setupPerimeter, invoking `cb` with the nominal fork/straight
 * pick (via the same slotIdx counter). Both the spawner and the
 * reservation collector iterate through here so they cannot diverge.
 */
function iterEdgeSlots(cb: (edge: Edge, slot: number, type: TileType) => void): void {
	const numEdgeSlots = Math.max(
		0,
		Math.floor((SCENE_WORLD_SIZE_X_METERS - 2 * PERIM_TILE_METERS) / PERIM_TILE_METERS),
	)
	const edgeSlots: number[] = []
	for (let i = 0; i < numEdgeSlots; i++) {
		edgeSlots.push(PERIM_TILE_METERS * (i + 1))
	}

	let slotIdx = 0
	const pickType = (): TileType => {
		const t: TileType = (slotIdx % FORK_EVERY_N === 0) ? 'fork' : 'straight'
		slotIdx++
		return t
	}

	for (const s of edgeSlots) {
		cb('S', s, pickType())
		cb('N', s, pickType())
	}
	for (const s of edgeSlots) {
		cb('W', s, pickType())
		cb('E', s, pickType())
	}
}


// MARK: Mesas
// Standalone cliff clusters scattered across the interior playfield —
// isolated buttes / mesas that break up the open snow between the
// campfire and the perimeter canyons.
//
// Each mesa is a PAIR of `end` tiles placed so their single openings
// face each other — forming a fully-enclosed 1×2 (or 2×1) cliff
// block with no open sides. The scene has no fully-walled tile in the
// set, so this back-to-back trick is how we get closed cliff chunks.
//
// Layout: coarse grid of candidate slots inside the playfield, each
// deterministically hashed to yes/no + orientation. Slots whose
// footprint (either tile) would overlap the campfire cliff buffer
// are dropped.
//
// Density knobs:
//   MESA_SLOT_SPACING     — world-meter grid spacing between candidate
//                           anchor slots (multiples of PERIM_TILE_METERS
//                           keep mesas aligned with the perim tile grid).
//   MESA_DENSITY_MOD      — 1-in-N slots become a mesa (hash % N === 0).
//                           Lower value → denser field.
const MESA_SLOT_SPACING = PERIM_TILE_METERS * 2   // 128 m between candidates
const MESA_DENSITY_MOD  = 3                        // ~1/3 of slots

interface MesaTile { sx: number; sz: number; type: TileType; r: number }

/**
 * Enumerate every candidate mesa anchor slot in the interior, invoking
 * `cb` with the slot's SW-corner position and a deterministic 32-bit
 * hash derived from that position. Slot range leaves room for the
 * second tile of the mesa pair on either axis (2 × PERIM_TILE_METERS
 * clearance from the far ring).
 */
function iterMesaSlots(cb: (sx: number, sz: number, hash: number) => void): void {
	const minCoord  = PERIM_TILE_METERS
	// Extra PERIM_TILE_METERS margin so the paired second tile still fits
	// inside the interior on both possible orientations.
	const maxCoordX = SCENE_WORLD_SIZE_X_METERS - 3 * PERIM_TILE_METERS
	const maxCoordZ = SCENE_WORLD_SIZE_Z_METERS - 3 * PERIM_TILE_METERS
	for (let sx = minCoord; sx <= maxCoordX; sx += MESA_SLOT_SPACING) {
		for (let sz = minCoord; sz <= maxCoordZ; sz += MESA_SLOT_SPACING) {
			// Simple 2D spatial hash (Teschner et al. constants). Mixes
			// low bits enough that adjacent slots don't correlate.
			const h = ((Math.floor(sx) * 73856093) ^ (Math.floor(sz) * 19349663)) >>> 0
			cb(sx, sz, h)
		}
	}
}

/**
 * Compute the full mesa placement list — two `end` tiles per mesa
 * with their openings facing each other. Pure; both the spawner and
 * the reservation collector call this and iterate the same array.
 *
 * Orientation (vertical vs horizontal 1×2 block) is hash-selected.
 * End tile openings: r=0 opens N, r=1 opens E, r=2 opens S, r=3 opens W.
 *   vertical:   anchor at (sx, sz) r=0 (opens N) + partner at
 *               (sx, sz + P) r=2 (opens S) → openings meet in the middle.
 *   horizontal: anchor at (sx, sz) r=1 (opens E) + partner at
 *               (sx + P, sz) r=3 (opens W) → openings meet in the middle.
 */
function planMesas(): MesaTile[] {
	const out: MesaTile[] = []
	iterMesaSlots((sx, sz, hash) => {
		if (hash % MESA_DENSITY_MOD !== 0) return
		const vertical = ((hash >>> 4) & 1) === 0
		const [dx, dz] = vertical ? [0, PERIM_TILE_METERS] : [PERIM_TILE_METERS, 0]
		const [rA, rB] = vertical ? [0, 2] : [1, 3]
		// Both tile centres checked against the campfire buffer — a mesa
		// whose partner half lands in the buffer is dropped entirely.
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
 * Deduplicated by (sx, sz) world position — without this, two canyons
 * on perpendicular edges whose slots both fall on the first/last
 * position collide (their inward tails target the same corner-adjacent
 * interior tile). First writer wins; later collisions are dropped.
 *
 * Both the spawner (setupPerimeter) and the reservation collector
 * (getReservedPlayfieldCells) iterate this list, so they can never
 * disagree on what geometry exists.
 */
interface CliffPlacement { sx: number; sz: number; type: TileType; r: number }
function computeAllCliffPlacements(): CliffPlacement[] {
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

	// --- 4 corners (fixed positions, always unique) ---
	tryAdd({ sx: CORNER_NEAR_X, sz: CORNER_NEAR_Z, type: 'turn', r: 0 })
	tryAdd({ sx: CORNER_NEAR_X, sz: CORNER_FAR_Z,  type: 'turn', r: 1 })
	tryAdd({ sx: CORNER_FAR_X,  sz: CORNER_FAR_Z,  type: 'turn', r: 2 })
	tryAdd({ sx: CORNER_FAR_X,  sz: CORNER_NEAR_Z, type: 'turn', r: 3 })

	// --- Edge tiles + canyon tails ---
	iterEdgeSlots((edge, slot, type) => {
		const [sx, sz] = edgeSlotWorld(edge, slot)
		const plan = planEdgeTile(edge, slot, type)
		const effectiveType = plan.effectiveType
		const ringStraightR = (edge === 'S' || edge === 'N') ? 1 : 0
		const r = effectiveType === 'fork' ? FORK_R[edge] : ringStraightR
		tryAdd({ sx, sz, type: effectiveType, r })
		if (effectiveType !== 'fork') return
		const tail = planCanyonTail(edge, sx, sz, canyonDepth(edge, slot))
		for (const t of tail) tryAdd(t)
	})

	// --- Mesas ---
	for (const m of planMesas()) tryAdd(m)

	return out
}


// MARK: reserveFootprint
/**
 * Add every playfield grid cell whose CENTRE falls inside the axis-
 * aligned world rect [sx, sx+PERIM_TILE_METERS] × [sz, sz+PERIM_TILE_METERS]
 * to `out`. Because a perim tile is 4× the size of a maze tile, a
 * single perim tile footprint covers up to 4× 4 = 16 maze cells when
 * it sits fully inside the playfield.
 *
 * `shrink` (world meters) tightens the rect uniformly on all sides.
 * Used by the perim ring corner/edge tiles to leave the outermost
 * maze ring UNRESERVED, so those tiles spawn and visually poke out
 * from under the cliff base (intentional snow-underneath-cliff overlap
 * once the cliff art is remodelled shorter). Interior features (canyon
 * caps, mesas) pass shrink=0 so their whole footprint stays reserved.
 */
function reserveFootprint(out: Set<string>, sx: number, sz: number, shrink: number = 0): void {
	const minX = sx + shrink, maxX = sx + PERIM_TILE_METERS - shrink
	const minZ = sz + shrink, maxZ = sz + PERIM_TILE_METERS - shrink
	if (minX >= maxX || minZ >= maxZ) return  // over-shrunk → no reservation
	const O = MAZE_ORIGIN_OFFSET_METERS
	const C = MAZE_TILE_WORLD_METERS
	// Cell (tx, tz) centre = ((tx + 0.5)*C + O, (tz + 0.5)*C + O). Solve
	// for the integer range whose centre lies in [min, max). Small
	// epsilon on the max side keeps a centre exactly ON the boundary
	// from being counted — boundary-hugging is correct behaviour.
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


// MARK: getReservedPlayfieldCells
/**
 * Compute the set of playfield grid cells (tx, tz) that the perimeter
 * cliff geometry physically occupies — corner tiles, edge tiles, and
 * inward-poking fork end-caps. Fed to the maze generator via
 * setReservedCells() so the maze retreats around every cliff footprint
 * instead of clipping through it.
 *
 * Every perim tile is a 64 m (4 × maze-tile) block, so one perim tile
 * that sits fully inside the playfield reserves 16 maze cells. When
 * the playfield is grown so its outer rings overlap the perimeter ring
 * (playfield > SCENE − 2 × PERIM_TILE), this is what keeps maze tiles
 * from spawning underneath cliff geometry.
 *
 * Deterministic, cheap, pure function of settings + FORK_EVERY_N +
 * campfire buffer geometry — no RNG, no netcode, every client computes
 * the same set.
 */
export interface ReservedTile { tx: number; tz: number }
export function getReservedPlayfieldCells(): ReservedTile[] {
	const reserved = new Set<string>()

	// Two-pass reservation for a clean 1-cell overlap on the playfield-
	// FACING sides of every cliff feature, INCLUDING inside corners
	// (concave notches where two cliff features meet at a right angle).
	//
	// Pass 1: compute the full cliff region — union of every cliff
	//         placement's full footprint.
	// Pass 2: 8-way erode. A cell is reserved iff all EIGHT of its
	//         neighbours (4 cardinal + 4 diagonal) are cliff or off-grid.
	//         Cells at an inside corner have at least one diagonal
	//         pointing into open playfield, so they survive erosion and
	//         spawn a snow tile tucked into the notch. Without the
	//         diagonal check, notch cells get all 4 cardinal neighbours
	//         as cliff (via adjacent cliff features) and get reserved,
	//         leaving a visible gap at every inside corner.
	const cliffRegion = new Set<string>()
	for (const p of computeAllCliffPlacements()) {
		reserveFootprint(cliffRegion, p.sx, p.sz)
	}
	const offGridOrCliff = (tx: number, tz: number): boolean => {
		if (tx < 0 || tx >= MAZE_GRID_WIDTH)  return true
		if (tz < 0 || tz >= MAZE_GRID_HEIGHT) return true
		return cliffRegion.has(`${tx},${tz}`)
	}
	for (const key of cliffRegion) {
		const [tx, tz] = key.split(',').map(Number)
		const interior =
			   offGridOrCliff(tx - 1, tz    ) && offGridOrCliff(tx + 1, tz    )
			&& offGridOrCliff(tx,     tz - 1) && offGridOrCliff(tx,     tz + 1)
			&& offGridOrCliff(tx - 1, tz - 1) && offGridOrCliff(tx + 1, tz - 1)
			&& offGridOrCliff(tx - 1, tz + 1) && offGridOrCliff(tx + 1, tz + 1)
		if (interior) reserved.add(key)
	}

	const out: ReservedTile[] = []
	for (const k of reserved) {
		const [tx, tz] = k.split(',').map(Number)
		out.push({ tx, tz })
	}
	return out
}


// MARK: setupPerimeter
export function setupPerimeter(): void {
	// Spawn every cliff tile from the shared, deduplicated placement
	// list. That's the only path that spawns perim geometry now — no
	// more per-category spawn loops — so the visible cliffs and the
	// maze reservations agree by construction.
	const placements = computeAllCliffPlacements()
	for (const p of placements) {
		spawnPerimTile(p.type, p.sx, p.sz, p.r)
	}

	console.log(
		`perimeter: setupPerimeter: ring built ` +
		`(playfield ${MAZE_PLAYFIELD_METERS}m centred in ${SCENE_WORLD_SIZE_X_METERS}m scene, ` +
		`${placements.length} cliff tiles, ` +
		`tile scale ${PERIM_SCALE}× = ${PERIM_TILE_METERS}m/tile)`
	)
}


