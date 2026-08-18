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

import { TILES, TileType } from 'src/shared/maze/tiles'
import {
	MAZE_ORIGIN_OFFSET_METERS,
	MAZE_PLAYFIELD_METERS,
	MAZE_TILE_WORLD_METERS,
	SCENE_WORLD_SIZE_X_METERS,
	SCENE_WORLD_SIZE_Z_METERS,
} from 'src/shared/settings'


// MARK: Tuning
// Uniform scale applied to every perimeter tile GLB. 4 = one perimeter
// tile spans 64 m (4 parcels), matching the width of the perimeter ring.
const PERIM_SCALE  = 4
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

/** Interior playfield bounds in scene world coords. */
const INT_MIN_X = MAZE_ORIGIN_OFFSET_METERS
const INT_MIN_Z = MAZE_ORIGIN_OFFSET_METERS
const INT_MAX_X = MAZE_ORIGIN_OFFSET_METERS + MAZE_PLAYFIELD_METERS
const INT_MAX_Z = MAZE_ORIGIN_OFFSET_METERS + MAZE_PLAYFIELD_METERS

/** Perimeter ring inner edge = interior outer edge. */
const RING_OUT_X = SCENE_WORLD_SIZE_X_METERS
const RING_OUT_Z = SCENE_WORLD_SIZE_Z_METERS


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
		scale:    Vector3.create(PERIM_SCALE, PERIM_SCALE, PERIM_SCALE),
	})
	GltfContainer.create(e, {
		src:                          TILES[type].model,
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
export function setupPerimeter(): void {
	// --- 4 corners ---
	// turn at r=0 has openings [N, E]  → walls face S and W (SW corner).
	// r=1 → [E, S] (NW corner: walls N + W).
	// r=2 → [S, W] (NE corner: walls N + E).
	// r=3 → [W, N] (SE corner: walls S + E).
	spawnPerimTile('turn', 0,               0,               0)  // SW
	spawnPerimTile('turn', 0,               INT_MAX_Z,       1)  // NW
	spawnPerimTile('turn', INT_MAX_X,       INT_MAX_Z,       2)  // NE
	spawnPerimTile('turn', INT_MAX_X,       0,               3)  // SE

	// --- Edges: 2 tiles per side between the corners ---
	// Interior spans INT_MIN..INT_MAX; edge tiles sit at PERIM_TILE_METERS
	// stride starting one perimeter-tile in from the corner.
	const edgeSlots = [INT_MIN_X, INT_MIN_X + PERIM_TILE_METERS]

	// Deterministic fork counter so every client places forks at the
	// same slots — no seed, no sync.
	let slotIdx = 0
	const pickType = (): TileType => {
		const t: TileType = (slotIdx % FORK_EVERY_N === 0) ? 'fork' : 'straight'
		slotIdx++
		return t
	}

	for (const x of edgeSlots) {
		// South edge: straight at r=1 → openings [E, W]; fork at r=3 →
		// [W, E, S] (spur points south, outward).
		const tS = pickType()
		spawnPerimTile(tS, x, 0, tS === 'fork' ? 3 : 1)
		// North edge: straight at r=1; fork at r=1 → [E, W, N] (spur out).
		const tN = pickType()
		spawnPerimTile(tN, x, INT_MAX_Z, tN === 'fork' ? 1 : 1)
	}
	for (const z of edgeSlots) {
		// West edge: straight at r=0 → openings [N, S]; fork at r=0 →
		// [N, S, W] (spur points west, outward).
		const tW = pickType()
		spawnPerimTile(tW, 0, z, 0)
		// East edge: straight at r=0; fork at r=2 → [S, N, E] (spur out).
		const tE = pickType()
		spawnPerimTile(tE, INT_MAX_X, z, tE === 'fork' ? 2 : 0)
	}

	console.log(
		`perimeter: setupPerimeter: ring built ` +
		`(playfield ${MAZE_PLAYFIELD_METERS}m centred in ${SCENE_WORLD_SIZE_X_METERS}m scene, ` +
		`tile scale ${PERIM_SCALE}× = ${PERIM_TILE_METERS}m/tile)`
	)
}


// Note: RING_OUT_X / RING_OUT_Z retained above for future perimeter
// extensions (multi-thick rings, exterior scatter clamp). Silence
// unused-warning for now.
void RING_OUT_X
void RING_OUT_Z
