/**
 * Invisible perimeter wall: four thin physics-only box colliders just
 * inside the scene boundary so players cannot leave the playable area.
 * Derived from the active WORLD_PROFILE (scene size), not hardcoded.
 */
import { engine, Transform, MeshCollider, ColliderLayer } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import {
	SCENE_WORLD_SIZE_X_METERS, SCENE_WORLD_SIZE_Z_METERS,
	TERRAIN_LEVEL_STEP_M, TERRAIN_LEVEL_MOUNTAIN, TERRAIN_MOUNTAIN_PEAK_STEPS,
	TERRAIN_MOUNTAIN_STEP_M, TERRAIN_LEVEL_VOLCANO_RIM, TERRAIN_CROWN_BASE_M,
	TERRAIN_CROWN_STEP_M, TERRAIN_CROWN_STEPS,
} from 'src/shared/settings'

const INSET_M = 0.5
const THICKNESS_M = 0.5
const MARGIN_ABOVE_TERRAIN_M = 40

let spawned = false

export function setupPerimeterWall(): void {
	if (spawned) return
	spawned = true
	const sx = SCENE_WORLD_SIZE_X_METERS
	const sz = SCENE_WORLD_SIZE_Z_METERS
	const mountainTop = TERRAIN_LEVEL_MOUNTAIN * TERRAIN_LEVEL_STEP_M + TERRAIN_MOUNTAIN_PEAK_STEPS * TERRAIN_MOUNTAIN_STEP_M
	const crownTop = TERRAIN_LEVEL_VOLCANO_RIM * TERRAIN_LEVEL_STEP_M + TERRAIN_CROWN_BASE_M + (TERRAIN_CROWN_STEPS - 1) * TERRAIN_CROWN_STEP_M
	const maxTerrain = Math.max(mountainTop, crownTop)
	// DCL scene height limit: log2(parcels + 1) * 20 m.
	const parcels = (sx / 16) * (sz / 16)
	const heightLimit = Math.log2(parcels + 1) * 20
	const height = Math.min(maxTerrain + MARGIN_ABOVE_TERRAIN_M, heightLimit - 1)
	const cy = height / 2 - 1 // dip 1 m below ground
	const h = height + 2 > heightLimit ? height : height + 1
	const walls: Array<[number, number, number, number]> = [
		[sx / 2, INSET_M, sx - 2 * INSET_M, THICKNESS_M],
		[sx / 2, sz - INSET_M, sx - 2 * INSET_M, THICKNESS_M],
		[INSET_M, sz / 2, THICKNESS_M, sz - 2 * INSET_M],
		[sx - INSET_M, sz / 2, THICKNESS_M, sz - 2 * INSET_M],
	]
	for (const [x, z, w, d] of walls) {
		const e = engine.addEntity()
		Transform.create(e, { position: Vector3.create(x, cy, z), scale: Vector3.create(w, h, d) })
		MeshCollider.setBox(e, ColliderLayer.CL_PHYSICS)
	}
	console.log(`perimeterWall: ${sx}x${sz} m, top ${(cy + h / 2).toFixed(1)} m (terrain max ${maxTerrain} m, limit ${heightLimit.toFixed(1)} m)`)
}
