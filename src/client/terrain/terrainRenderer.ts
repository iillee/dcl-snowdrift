/**
 * terrainRenderer.ts — greybox elevation geometry.
 *
 * Milestone 2 draws the terrain map as solid boxes, not as the dual-grid
 * cliff kit. Cells of the same level are merged into greedy rectangles
 * and each rectangle becomes one box rising from below y=0 to that
 * level's walkable surface, so the sides read as cliff faces and the
 * top is the ground. That is a few hundred entities instead of the
 * ~1100 corner pieces the final kit needs, which is what we want while
 * the shapes are still being tuned.
 *
 * Each rectangle spawns two boxes: a rock-coloured body and a thin
 * ground-coloured cap on top. That keeps every cliff face the same rock
 * regardless of the level it holds up, and mirrors how the final art
 * splits into a cliff kit plus a snow layer on top.
 *
 * The cap tops ARE the ground: there is no separate ground slab, and
 * the snow renderer lays its tiles directly on them.
 *
 * Replaces perimeter.ts. The spawned / ready / generation accessors
 * keep the same shape so the load timeline and splash gates are
 * unchanged.
 */

import {
	ColliderLayer,
	Entity,
	Material,
	MeshCollider,
	MeshRenderer,
	Transform,
	engine,
} from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'

import { TERRAIN_CELL_M, groundYForLevel } from 'src/shared/settings'
import { getTerrain } from 'src/shared/terrain/terrainCache'
import { mergeLevelRects } from 'src/shared/terrain/terrainGen'
import { TERRAIN_ORIGIN_M } from 'src/shared/terrain/terrainMap'

import { clearLadders, setupLadders } from 'src/client/terrain/ladders'


// MARK: Tuning

/** How far every slab extends below y=0 so nothing reads as floating. */
const SLAB_BASE_Y = -4

/**
 * Thickness of the cap sitting on each slab, metres. Only its top face
 * is ever meant to be read, so keep it thin: on a cliff lip the side
 * shows as a painted stripe between the snow and the rock.
 */
const CAP_M = 0.15

/**
 * Exposed rock. Every cliff face is this colour at every level — height
 * is read from the geometry, not from a tint, the same way the final
 * cliff kit will read.
 */
const COLOR_ROCK = Color4.create(0.34, 0.34, 0.37, 1)

/** Melt-blue ground the snow lies on, at every level. */
const COLOR_GROUND = Color4.create(106 / 255, 153 / 255, 252 / 255, 1)


// MARK: State

const terrainEntities: Entity[] = []
let terrainSeed       = 0
let terrainGeneration = 0


// MARK: setTerrainSeed
/**
 * Set the layout seed the next setupTerrain() builds from. Call before
 * setupTerrain() and before any snow mask refresh so both read the
 * same map.
 */
export function setTerrainSeed(seed: number): void {
	terrainSeed = seed >>> 0
}


// MARK: clearTerrain
/** Remove every terrain and ladder entity. No-op when nothing is up. */
export function clearTerrain(): void {
	for (const e of terrainEntities) engine.removeEntity(e)
	terrainEntities.length = 0
	clearLadders()
}


// MARK: hasTerrainSpawned
/** True once setupTerrain has built geometry at least once. */
export function hasTerrainSpawned(): boolean {
	return terrainEntities.length > 0
}


// MARK: isTerrainReady
/**
 * True once the terrain is on screen. Boxes are primitives with no
 * asset load, so spawning is the whole story — this exists so the load
 * timeline keeps the same two-stage gate it had for cliff GLBs.
 */
export function isTerrainReady(): boolean {
	return terrainEntities.length > 0
}


// MARK: getTerrainGeneration
/** Increments every time setupTerrain rebuilds. */
export function getTerrainGeneration(): number {
	return terrainGeneration
}


// MARK: setupTerrain
/**
 * (Re)build the terrain for the current seed. Idempotent: clears any
 * previous build first, so the seed watcher can call it freely.
 */
export function setupTerrain(): void {
	clearTerrain()
	const map   = getTerrain(terrainSeed)
	const rects = mergeLevelRects(map)

	for (const r of rects) {
		const top     = groundYForLevel(r.level)
		const centerX = TERRAIN_ORIGIN_M + (r.cx + r.w / 2) * TERRAIN_CELL_M
		const centerZ = TERRAIN_ORIGIN_M + (r.cz + r.h / 2) * TERRAIN_CELL_M
		const sizeX   = r.w * TERRAIN_CELL_M
		const sizeZ   = r.h * TERRAIN_CELL_M

		// Body and cap meet at a shared interior face, so neither one
		// has a coplanar twin to fight with.
		spawnSlab(centerX, centerZ, sizeX, sizeZ, SLAB_BASE_Y, top - CAP_M, COLOR_ROCK)
		spawnSlab(centerX, centerZ, sizeX, sizeZ, top - CAP_M, top, COLOR_GROUND)
	}

	setupLadders(map)
	terrainGeneration++

	console.log(
		`terrainRenderer: setupTerrain: seed ${map.usedSeed} (try ${map.attempts}), ` +
		`${rects.length} slabs, ${map.ladders.length} ladders, ` +
		`${map.regionLevel.length} regions, ${map.destinations.length} destinations`
	)
}


// MARK: spawnSlab
// One axis-aligned box spanning bottomY..topY, tracked for teardown.
function spawnSlab(
	centerX : number,
	centerZ : number,
	sizeX   : number,
	sizeZ   : number,
	bottomY : number,
	topY    : number,
	color   : Color4,
): void {
	const height = topY - bottomY
	const e      = engine.addEntity()
	terrainEntities.push(e)
	Transform.create(e, {
		position: Vector3.create(centerX, bottomY + height / 2, centerZ),
		scale   : Vector3.create(sizeX, height, sizeZ),
	})
	MeshRenderer.setBox(e)
	MeshCollider.setBox(e, ColliderLayer.CL_PHYSICS)
	Material.setPbrMaterial(e, {
		albedoColor:       color,
		roughness:         1.0,
		metallic:          0.0,
		specularIntensity: 0.0,
	})
}


