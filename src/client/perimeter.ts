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
	isInsidePlayfield,
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
 * Place one edge tile at `slot` position along `edge`. If a fork, also
 * places an `end` tile one perimeter-tile-width inward so the fork's
 * spur is capped rather than opening into empty scene space. End tiles
 * intentionally protrude past the perimeter ring into the interior —
 * this is the seed of the "canyons reaching into the playfield" idea:
 * a dead-end pocket the smaller snow tiles can fill around.
 *
 * @param edge  which side of the perimeter this slot sits on.
 * @param slot  linear position along the edge (world meters from the
 *              near corner, SW-corner-before-rotation convention).
 * @param type  'straight' | 'fork' (other types are legal but not
 *              currently emitted here).
 */
function spawnEdgeTile(edge: Edge, slot: number, type: TileType): void {
	// --- Base tile placement ---
	// Straight rotations run the corridor parallel to the edge.
	// Fork rotations point the spur INWARD (see the r values below).
	const straightR = (edge === 'S' || edge === 'N') ? 1 : 0
	const forkR: Record<Edge, number> = { S: 1, N: 3, W: 2, E: 0 }

	// End-cap offset + rotation per edge. Kept outside the fork branch
	// below so the buffer check can consult the cap position too.
	const capOffset: Record<Edge, [number, number]> = {
		S: [0,  PERIM_TILE_METERS],  // south edge → cap further N
		N: [0, -PERIM_TILE_METERS],  // north edge → cap further S
		W: [ PERIM_TILE_METERS, 0],  // west edge  → cap further E
		E: [-PERIM_TILE_METERS, 0],  // east edge  → cap further W
	}
	const capR: Record<Edge, number> = { S: 2, N: 0, W: 3, E: 1 }

	const [sx, sz] = edgeSlotWorld(edge, slot)

	// If this would be a fork, check whether its end-cap would either
	// (a) intrude into the campfire's cliff exclusion zone, or
	// (b) overlap the snow-tile playfield (which is authoritative in
	//     its own rectangle — cliff bump-ins must live in the empty
	//     ring between playfield and perimeter).
	// Cap centre is the tile SW-corner plus (PERIM_TILE_METERS / 2) on
	// both axes. Downgrade to a straight in either case — straights
	// have no inward opening and don't need a cap.
	let effectiveType = type
	if (effectiveType === 'fork') {
		const [dcx, dcz] = capOffset[edge]
		const capCenterX = sx + dcx + PERIM_TILE_METERS / 2
		const capCenterZ = sz + dcz + PERIM_TILE_METERS / 2
		if (isInsideCliffBuffer(capCenterX, capCenterZ)
		 || isInsidePlayfield(capCenterX, capCenterZ)) {
			effectiveType = 'straight'
		}
	}

	const r = effectiveType === 'fork' ? forkR[edge] : straightR
	spawnPerimTile(effectiveType, sx, sz, r)

	if (effectiveType !== 'fork') return

	// --- End-cap placement ---
	// Sits one perimeter-tile-width further inward. End's single opening
	// faces the fork so their opening walls meet; end's other three
	// sides are cliff, closing the passage.
	const [cx, cz] = capOffset[edge]
	spawnPerimTile('end', sx + cx, sz + cz, capR[edge])
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


// MARK: setupPerimeter
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

	// --- Edges: derive slot count from scene size so growth in
	// SCENE_WORLD_SIZE_X/Z_METERS auto-fills the ring instead of
	// leaving gaps in the middle of each side. Total span between
	// the two corners is (SCENE - 2 * PERIM_TILE); slots start at
	// PERIM_TILE (just inside the near corner) and step by one
	// perimeter tile each.
	const numEdgeSlots = Math.max(
		0,
		Math.floor((SCENE_WORLD_SIZE_X_METERS - 2 * PERIM_TILE_METERS) / PERIM_TILE_METERS),
	)
	const edgeSlots: number[] = []
	for (let i = 0; i < numEdgeSlots; i++) {
		edgeSlots.push(PERIM_TILE_METERS * (i + 1))
	}

	// Deterministic fork counter so every client places forks at the
	// same slots — no seed, no sync.
	let slotIdx = 0
	const pickType = (): TileType => {
		const t: TileType = (slotIdx % FORK_EVERY_N === 0) ? 'fork' : 'straight'
		slotIdx++
		return t
	}

	for (const s of edgeSlots) {
		spawnEdgeTile('S', s, pickType())
		spawnEdgeTile('N', s, pickType())
	}
	for (const s of edgeSlots) {
		spawnEdgeTile('W', s, pickType())
		spawnEdgeTile('E', s, pickType())
	}

	console.log(
		`perimeter: setupPerimeter: ring built ` +
		`(playfield ${MAZE_PLAYFIELD_METERS}m centred in ${SCENE_WORLD_SIZE_X_METERS}m scene, ` +
		`${numEdgeSlots} edge tiles per side, ` +
		`tile scale ${PERIM_SCALE}× = ${PERIM_TILE_METERS}m/tile)`
	)
}


