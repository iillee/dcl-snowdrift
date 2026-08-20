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

import { engine, ColliderLayer, Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
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


// MARK: Seed
/**
 * Global perimeter seed. Mixed into every deterministic hash in this
 * module (fork slot selection, canyon depth, mesa density). Bump by
 * one to get a completely fresh cliff layout without changing any
 * other tuning; all clients still agree because the constant is baked
 * into the build.
 *
 * Long-term idea: derive this from the current calendar day or week
 * (via `~system/Runtime` getWorldTime or similar) so the scene layout
 * rotates on a schedule while staying identical for every player at
 * any given moment.
 */
let PERIM_SEED = 0


// MARK: setPerimeterSeed
/**
 * Set the seed mixed into every deterministic hash in this module
 * (fork slot selection, canyon depth, mesa density). Call BEFORE
 * setupPerimeter() and BEFORE the maze generator's
 * getReservedPlayfieldCells() so both see the same layout.
 *
 * The reroll button in the top action bar flows through here so
 * every reroll produces a fresh cliff skyline.
 */
export function setPerimeterSeed(seed: number): void {
	PERIM_SEED = seed | 0
}


// MARK: Tuning
// Perimeter tiles now use the dedicated `tile-cliff-*.glb` models,
// authored at final size in SketchUp/Blender — 64 m footprint, correct
// height, no runtime scaling needed. This replaces the previous
// 4× horizontal / 25× vertical runtime scale on the interior maze
// tiles, which mangled PBR normals and tiling textures.
//
// `cross` and `ramp` are never emitted by the perimeter planner
// (see computeAllCliffPlacements — only turn / straight / fork / end
// are placed). They stay in the map as placeholders so the Record type
// stays exhaustive; if the planner ever grows a cross/ramp case, swap
// in real assets.
const PERIM_MODELS: Record<TileType, string> = {
	end:      'assets/models/tile-cliff-end.glb',
	straight: 'assets/models/tile-cliff-straight.glb',
	turn:     'assets/models/tile-cliff-turn.glb',
	fork:     'assets/models/tile-cliff-fork.glb',
	cross:    'assets/models/tile-cliff-turn.glb', // unused; placeholder
	ramp:     'assets/models/tile-cliff-straight.glb', // unused; placeholder
}
// Y for the tile base. Match the interior maze's tile Y (0) so the two
// systems sit on the same floor plane.
const PERIM_Y      = 0
// Fork substitution frequency along edges. 0 disables (all straights),
// 1 substitutes every straight. Deterministic via cellular position, not
// random, so every client sees the same skyline with no sync needed.
const FORK_EVERY_N = 3


// MARK: Derived geometry

/**
 * World size of one perimeter tile. The new `tile-cliff-*.glb` models
 * are authored at 64 m footprint, so this is a plain constant now —
 * no longer derived from MAZE_TILE_WORLD_METERS × a runtime scale.
 * If the cliff art footprint ever changes, update this value; the rest
 * of the perimeter geometry (canyon steps, mesa spacing, corner
 * anchors) is derived from it.
 */
const PERIM_TILE_METERS = 64

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
// SW-corner pivot convention: the mesh origin sits at the SW corner of
// the 64 m footprint (matches the interior tile convention). Under a
// Y rotation of r × 90° the geometry swings into adjacent cells, so we
// add a compensating XZ offset scaled by the perimeter tile size.
const PERIM_ROT_OFFSET: Array<[number, number]> = [
	[0,                 0],                 // r=0
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
const perimEntities: Entity[] = []


// MARK: clearPerimeter
/**
 * Tear down every currently-spawned perimeter cliff entity. Call
 * before setupPerimeter() on a reroll so the old cliff skyline
 * disappears cleanly. No-op if nothing has been spawned yet.
 */
export function clearPerimeter(): void {
	for (const e of perimEntities) engine.removeEntity(e)
	perimEntities.length = 0
}


// MARK: hasPerimeterSpawned
/** True once setupPerimeter has run at least once and cliffs exist. */
export function hasPerimeterSpawned(): boolean {
	return perimEntities.length > 0
}


function spawnPerimTile(type: TileType, sx: number, sz: number, r: number): void {
	const [dx, dz] = PERIM_ROT_OFFSET[r]
	const e = engine.addEntity()
	perimEntities.push(e)
	Transform.create(e, {
		position: Vector3.create(sx + dx, PERIM_Y, sz + dz),
		rotation: Quaternion.fromEulerDegrees(0, r * 90, 0),
		// Cliff models are authored at final size on all three axes.
		scale:    Vector3.One(),
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
	const h = (((edge.charCodeAt(0) * 131 + Math.floor(slot)) ^ (PERIM_SEED * 2246822519)) * 2654435761) >>> 0
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
 * Kept side-effect-free so both the spawner and
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

	// Seed-mixed hash of (edge, slot) picks fork vs straight. Keeps the
	// 1-in-FORK_EVERY_N density but distributes forks pseudorandomly
	// per seed instead of at a fixed period. Every client agrees
	// because PERIM_SEED is a build-time constant.
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
			const h = (((Math.floor(sx) * 73856093) ^ (Math.floor(sz) * 19349663) ^ (PERIM_SEED * 2246822519)) >>> 0)
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
		let effectiveType = plan.effectiveType
		const ringStraightR = (edge === 'S' || edge === 'N') ? 1 : 0

		// If this is a fork, compute its canyon tail up front and verify
		// the FIRST inward tile is actually going to be placed. Two ways
		// a fork can end up open-ended:
		//   (a) planCanyonTail returns an empty array — every step was
		//       rejected off-scene or inside the campfire cliff buffer.
		//   (b) The first tail tile position already exists in `seen`
		//       (a corner turn tile or another canyon's tile got there
		//       first, e.g. two perpendicular canyons meeting near an
		//       inside corner). tryAdd would silently drop it, leaving
		//       the fork spur pointing at nothing.
		// Downgrade the fork to a straight in either case so the
		// perimeter ring stays visually sealed.
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

	// --- Mesas ---
	// Mesa halves are emitted in consecutive pairs by planMesas(). Both
	// halves must live or die together — a lone `end` tile in the middle
	// of the playfield reads as a broken orphan instead of a closed mesa
	// chunk. If EITHER half collides with an already-placed tile, drop
	// the whole pair.
	const mesas = planMesas()
	for (let i = 0; i < mesas.length; i += 2) {
		const a = mesas[i]
		const b = mesas[i + 1]
		if (!b) break // odd count guard (planMesas always emits pairs; belt & braces)
		if (seen.has(posKey(a.sx, a.sz)) || seen.has(posKey(b.sx, b.sz))) continue
		tryAdd(a)
		tryAdd(b)
	}

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
interface Shrink4 { minX: number; maxX: number; minZ: number; maxZ: number }
function reserveFootprint(
	out: Set<string>,
	sx:  number,
	sz:  number,
	s:   Shrink4 = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
): void {
	const minX = sx + s.minX, maxX = sx + PERIM_TILE_METERS - s.maxX
	const minZ = sz + s.minZ, maxZ = sz + PERIM_TILE_METERS - s.maxZ
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


// MARK: rotateShrink
/**
 * Rotate a canonical (r=0) per-side shrink spec by r × 90° CW around
 * the tile centre. Under a 90° CW rotation of the tile:
 *   +X face  → becomes the +Z face (east becomes north)
 *   +Z face  → becomes the −X face (north becomes west)
 *   −X face  → becomes the −Z face
 *   −Z face  → becomes the +X face
 */
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
/**
 * Local (lx, lz) cells within a 4×4 cliff tile footprint that sit in
 * the concave notch of its shape — the pocket a snow tile should fill.
 * lx / lz are in the range 0..3, addressing the 16 maze cells that
 * make up one 64 m perim tile, with (0,0) at the tile's SW-corner
 * grid slot BEFORE rotation compensation.
 *
 * Rotation lookup tables assume the model's "canonical" orientation
 * (r=0) has:
 *   turn — L wrapping the SW corner of the tile (walls on S and W
 *          faces of the tile) with concave notch at the NE corner
 *          cell (3, 3).
 *   fork — T with crossbar along the +X (east) face and spur
 *          pointing −X (west); concave notches at the two west-corner
 *          cells (0, 0) and (0, 3).
 *
 * If either guess is wrong for the actual model, swap the local-cell
 * pairs for that type here — the rotation math will follow.
 */
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
/**
 * Rotate a local (lx, lz) cell inside a 4×4 tile by r × 90° CW around
 * the tile centre. Matches the rotation convention used elsewhere in
 * this module (r=1 = 90° CW under Y-up left-handed coords).
 */
function rotateLocalCell(lx: number, lz: number, r: number): [number, number] {
	const N = 3 // (grid size along an axis) - 1
	switch (((r % 4) + 4) % 4) {
		case 0: return [lx,     lz]
		case 1: return [lz,     N - lx]
		case 2: return [N - lx, N - lz]
		case 3: return [N - lz, lx]
	}
	return [lx, lz]
}


// MARK: unreserveCell
/**
 * Remove the maze cell whose world position corresponds to local cell
 * (lx, lz) inside the 4×4 tile at world SW-corner (sx, sz) from the
 * reservation set. No-op if that cell is off-grid or was never in the
 * set.
 */
function unreserveCell(out: Set<string>, sx: number, sz: number, lx: number, lz: number): void {
	const O = MAZE_ORIGIN_OFFSET_METERS
	const C = MAZE_TILE_WORLD_METERS
	// Centre of local cell in world coords.
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

	// Per-type reservation shrink expressed per side (minX, maxX, minZ,
	// maxZ) in world meters, in the tile's CANONICAL (r=0) orientation;
	// rotated to the placement's actual r below.
	//
	// The new tile-cliff-*.glb models have different fill patterns
	// inside their shared 4×4 maze-cell (64 m) footprint. Canonical
	// orientation conventions used here (r=0):
	//   straight — length along Z (openings N/S); fills middle 2 rows
	//              perpendicular to length. Shrink 1 cell on ±X only.
	//   end      — opens +Z (north); cliff wraps 3 closed sides (±X, −Z).
	//              Shrink 1 cell on the 3 closed sides only; open side
	//              stays at 0 so the outer strip there is reserved,
	//              preventing snow from slipping under the neighbouring
	//              canyon-tail cliff.
	//   fork     — T-shape; geometry extends across most of the tile.
	//   turn     — L-shape; geometry extends across two full sides.
	//   Fork/turn reserve the full footprint (handled below via the
	//   insideCornerLocalCells un-reserve pass, which pokes just the
	//   concave-notch cell(s) as snow).
	//
	// Replaces the previous full-footprint + 8-way-erode approach
	// (designed for cliff models that filled their entire footprint);
	// with pre-shrunk reservations the shrink IS the erosion, and a
	// second erosion pass would kill all reservations.
	const C = MAZE_TILE_WORLD_METERS
	const CLIFF_SHRINK: Record<TileType, Shrink4> = {
		straight: { minX: C, maxX: C, minZ: 0, maxZ: 0 },
		end:      { minX: C, maxX: C, minZ: C, maxZ: 0 },
		fork:     { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
		turn:     { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
		cross:    { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, // unused
		ramp:     { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, // unused
	}
	for (const p of computeAllCliffPlacements()) {
		const rotated = rotateShrink(CLIFF_SHRINK[p.type], p.r)
		reserveFootprint(reserved, p.sx, p.sz, rotated)
		// Turn/fork have concave notches inside their L / T shape that
		// leave a small pocket of playfield tucked between the cliff arms.
		// Un-reserve those pocket cells so a snow tile spawns there.
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


// MARK: setupPerimeter
/**
 * (Re)spawn the perimeter cliff ring for the current PERIM_SEED.
 * Fully idempotent: calls clearPerimeter() first so bootstrap and
 * seed-watcher paths can invoke this freely without double-spawning.
 */
export function setupPerimeter(): void {
	clearPerimeter()
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
		`${placements.length} cliff tiles at ${PERIM_TILE_METERS}m/tile, ` +
		`cliff art authored at 1:1 scale)`
	)
}


