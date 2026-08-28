/**
 * perimeter.ts (client) — ECS spawn / teardown for the decorative
 * cliff ring around the interior playfield.
 *
 * All pure geometry + planning code lives in src/shared/perimeter.ts
 * so server-side placement code (src/shared/camp.ts, future waypoints)
 * can query the same deterministic layout. This file is just the
 * bridge from that plan to actual Entities with GltfContainers.
 *
 * Public surface for the rest of the client:
 *   - setPerimeterSeed()          (re-exported from shared)
 *   - setupPerimeter()            (spawn everything for current seed)
 *   - clearPerimeter()            (tear down; call before re-setup)
 *   - hasPerimeterSpawned()
 *   - getReservedPlayfieldCells() (re-exported from shared)
 *   - type ReservedTile           (re-exported from shared)
 */

import { engine, ColliderLayer, Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import { TileType } from 'src/shared/maze/tiles'
import {
	MAZE_PLAYFIELD_METERS,
	SCENE_WORLD_SIZE_X_METERS,
} from 'src/shared/settings'
import {
	computeAllCliffPlacements,
	PERIM_TILE_METERS,
} from 'src/shared/perimeter'


// MARK: Re-exports (backward-compat for existing client imports)
export {
	getReservedPlayfieldCells,
	setPerimeterSeed,
} from 'src/shared/perimeter'
export type { ReservedTile } from 'src/shared/perimeter'


// MARK: Asset mapping
// `cross` and `ramp` are never emitted by the perimeter planner (see
// shared/perimeter::computeAllCliffPlacements — only turn / straight /
// fork / end are placed). They stay in the map as placeholders so the
// Record type stays exhaustive; if the planner ever grows a
// cross/ramp case, swap in real assets.
const PERIM_MODELS: Record<TileType, string> = {
	end:      'assets/models/tile-cliff-end.glb',
	straight: 'assets/models/tile-cliff-straight.glb',
	turn:     'assets/models/tile-cliff-turn.glb',
	fork:     'assets/models/tile-cliff-fork.glb',
	cross:    'assets/models/tile-cliff-turn.glb',      // unused; placeholder
	ramp:     'assets/models/tile-cliff-straight.glb',  // unused; placeholder
}
/** Y for the tile base. Matches the interior maze's tile Y so the two
 *  systems sit on the same floor plane. */
const PERIM_Y = 0


// MARK: Rotation helper
// SW-corner pivot convention: the mesh origin sits at the SW corner of
// the 64 m footprint. Under a Y rotation of r × 90° the geometry
// swings into adjacent cells, so we add a compensating XZ offset.
const PERIM_ROT_OFFSET: Array<[number, number]> = [
	[0,                 0],                 // r=0
	[0,                 PERIM_TILE_METERS], // r=1 (90° CW)
	[PERIM_TILE_METERS, PERIM_TILE_METERS], // r=2
	[PERIM_TILE_METERS, 0],                 // r=3
]


// MARK: Spawned entity registry
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


// MARK: spawnPerimTile
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
 * (Re)spawn the perimeter cliff ring for the current PERIM_SEED.
 * Fully idempotent: calls clearPerimeter() first so bootstrap and
 * seed-watcher paths can invoke this freely without double-spawning.
 * The placement list comes from shared/perimeter so the visible
 * cliffs and the maze reservations agree by construction.
 */
export function setupPerimeter(): void {
	clearPerimeter()
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
