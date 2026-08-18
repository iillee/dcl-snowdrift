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
export function setupPerimeter(): void {
	// --- 4 corners ---
	// turn at r=0 has openings [N, E]  → walls face S and W (SW corner).
	// r=1 → [E, S] (NW corner: walls N + W).
	// r=2 → [S, W] (NE corner: walls N + E).
	// r=3 → [W, N] (SE corner: walls S + E).
	spawnPerimTile('turn', CORNER_NEAR_X, CORNER_NEAR_Z, 0)  // SW
	spawnPerimTile('turn', CORNER_NEAR_X, CORNER_FAR_Z,  1)  // NW
	spawnPerimTile('turn', CORNER_FAR_X,  CORNER_FAR_Z,  2)  // NE
	spawnPerimTile('turn', CORNER_FAR_X,  CORNER_NEAR_Z, 3)  // SE

	// --- Edges: 2 tiles per side between the corners ---
	// Edge tiles tile inward from the corner at PERIM_TILE_METERS stride.
	// For a 256 m scene with 64 m corners that leaves 128 m of edge span
	// = exactly 2 perimeter tiles per side, symmetric about scene centre.
	const edgeSlots = [PERIM_TILE_METERS, PERIM_TILE_METERS * 2]

	// Deterministic fork counter so every client places forks at the
	// same slots — no seed, no sync.
	let slotIdx = 0
	const pickType = (): TileType => {
		const t: TileType = (slotIdx % FORK_EVERY_N === 0) ? 'fork' : 'straight'
		slotIdx++
		return t
	}

	for (const x of edgeSlots) {
		// South edge: straight at r=1 → openings [E, W]; fork at r=1 →
		// [E, S, N] (spur points north, inward toward the playfield).
		const tS = pickType()
		spawnPerimTile(tS, x, CORNER_NEAR_Z, 1)
		// North edge: straight at r=1; fork at r=3 → [W, N, S] (spur
		// points south, inward).
		const tN = pickType()
		spawnPerimTile(tN, x, CORNER_FAR_Z, tN === 'fork' ? 3 : 1)
	}
	for (const z of edgeSlots) {
		// West edge: straight at r=0 → openings [N, S]; fork at r=2 →
		// [S, W, E] (spur points east, inward).
		const tW = pickType()
		spawnPerimTile(tW, CORNER_NEAR_X, z, tW === 'fork' ? 2 : 0)
		// East edge: straight at r=0; fork at r=0 → [N, S, W] (spur
		// points west, inward).
		const tE = pickType()
		spawnPerimTile(tE, CORNER_FAR_X, z, 0)
	}

	console.log(
		`perimeter: setupPerimeter: ring built ` +
		`(playfield ${MAZE_PLAYFIELD_METERS}m centred in ${SCENE_WORLD_SIZE_X_METERS}m scene, ` +
		`tile scale ${PERIM_SCALE}× = ${PERIM_TILE_METERS}m/tile)`
	)
}


