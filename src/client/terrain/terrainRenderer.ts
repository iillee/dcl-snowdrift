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
 * Each playable rectangle spawns a rock-coloured body plus a thin
 * ground-coloured cap when the player is nearby. The cap is the melt-
 * blue ice under the snow; far caps are culled and the rock stretches
 * to the full walkable height so physics stays continuous. Mountain /
 * boundary-wall rects never get a cap — nobody walks up there, and the
 * snow layer still covers them for the distant silhouette.
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

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import {
	TERRAIN_CELL_M,
	groundYForLevel,
	isMountainLevel,
} from 'src/shared/settings'
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
 * Spawn / keep melt-blue caps within this distance of the player
 * (AABB edge, not centre). Farther caps are culled; mountain never
 * gets one.
 */
const CAP_KEEP_M  = 100
const CAP_KEEP_M2 = CAP_KEEP_M * CAP_KEEP_M

/**
 * Exposed rock. Matches the baseColorFactor on the authored
 * tile-cliff-*.glb models so the greybox reads as the same slate the
 * eventual cliff kit will use. Every cliff face is this colour at
 * every level — height is read from the geometry, not from a tint.
 */
const COLOR_ROCK = Color4.create(0.2525, 0.3354, 0.6314, 1)

/** Melt-blue ground the snow lies on, at every playable level. */
const COLOR_GROUND = Color4.create(106 / 255, 153 / 255, 252 / 255, 1)


// MARK: State

type RectGeom = {
	centerX : number
	centerZ : number
	sizeX   : number
	sizeZ   : number
	top     : number
	wantsCap: boolean
	rock    : Entity
	cap     : Entity | null
}

const rectGeoms: RectGeom[] = []
const terrainEntities: Entity[] = []
let terrainSeed       = 0
let terrainGeneration = 0
let capLodInstalled   = false


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
	rectGeoms.length = 0
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
	ensureCapLodSystem()
	const map   = getTerrain(terrainSeed)
	const rects = mergeLevelRects(map)
	const focus = readFocusXZ()
	let   caps  = 0

	for (const r of rects) {
		const top      = groundYForLevel(r.level)
		const centerX  = TERRAIN_ORIGIN_M + (r.cx + r.w / 2) * TERRAIN_CELL_M
		const centerZ  = TERRAIN_ORIGIN_M + (r.cz + r.h / 2) * TERRAIN_CELL_M
		const sizeX    = r.w * TERRAIN_CELL_M
		const sizeZ    = r.h * TERRAIN_CELL_M
		const wantsCap = !isMountainLevel(r.level)
		const showCap  = wantsCap && distSqToRect(focus.x, focus.z, centerX, centerZ, sizeX, sizeZ) < CAP_KEEP_M2
		const rockTop  = showCap ? top - CAP_M : top
		const rock     = spawnSlab(centerX, centerZ, sizeX, sizeZ, SLAB_BASE_Y, rockTop, COLOR_ROCK)
		let   cap: Entity | null = null
		if (showCap) {
			cap = spawnSlab(centerX, centerZ, sizeX, sizeZ, top - CAP_M, top, COLOR_GROUND)
			caps++
		}
		rectGeoms.push({
			centerX,
			centerZ,
			sizeX,
			sizeZ,
			top,
			wantsCap,
			rock,
			cap,
		})
	}

	setupLadders(map)
	terrainGeneration++

	console.log(
		`terrainRenderer: setupTerrain: seed ${map.usedSeed} (try ${map.attempts}), ` +
		`${rects.length} rock slabs, ${caps} caps (keep=${CAP_KEEP_M}m), ` +
		`${map.ladders.length} ladders, ${map.regionLevel.length} regions, ` +
		`${map.destinations.length} destinations`
	)
}


// MARK: ensureCapLodSystem

function ensureCapLodSystem(): void {
	if (capLodInstalled) return
	capLodInstalled = true
	engine.addSystem(capLodSystem)
}


// MARK: capLodSystem
/**
 * Stream melt-blue caps around the player. Mountain rects are skipped.
 * Rock height tracks the cap so the walkable surface never drops when
 * a far cap is removed.
 */
function capLodSystem(): void {
	if (rectGeoms.length === 0) return
	const focus = readFocusXZ()
	for (const g of rectGeoms) {
		if (!g.wantsCap) continue
		const near = distSqToRect(focus.x, focus.z, g.centerX, g.centerZ, g.sizeX, g.sizeZ) < CAP_KEEP_M2
		if (near && g.cap === null) {
			setSlabSpan(g.rock, g.centerX, g.centerZ, g.sizeX, g.sizeZ, SLAB_BASE_Y, g.top - CAP_M)
			g.cap = spawnSlab(g.centerX, g.centerZ, g.sizeX, g.sizeZ, g.top - CAP_M, g.top, COLOR_GROUND)
			continue
		}
		if (!near && g.cap !== null) {
			removeTracked(g.cap)
			g.cap = null
			setSlabSpan(g.rock, g.centerX, g.centerZ, g.sizeX, g.sizeZ, SLAB_BASE_Y, g.top)
		}
	}
}


// MARK: readFocusXZ

/** Player XZ, or the hearth if the avatar is not ready yet. */
function readFocusXZ(): { x: number; z: number } {
	const player = Transform.getOrNull(engine.PlayerEntity)
	if (player !== null) return { x: player.position.x, z: player.position.z }
	return { x: CAMPFIRE_WORLD_X, z: CAMPFIRE_WORLD_Z }
}


// MARK: distSqToRect

/** Squared distance from a world XZ point to a centred AABB's edge. */
function distSqToRect(
	px     : number,
	pz     : number,
	centerX: number,
	centerZ: number,
	sizeX  : number,
	sizeZ  : number,
): number {
	const halfX = sizeX * 0.5
	const halfZ = sizeZ * 0.5
	const minX  = centerX - halfX
	const maxX  = centerX + halfX
	const minZ  = centerZ - halfZ
	const maxZ  = centerZ + halfZ
	const cx    = px < minX ? minX : (px > maxX ? maxX : px)
	const cz    = pz < minZ ? minZ : (pz > maxZ ? maxZ : pz)
	const dx    = px - cx
	const dz    = pz - cz
	return dx * dx + dz * dz
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
): Entity {
	const height = topY - bottomY
	const e      = engine.addEntity()
	terrainEntities.push(e)
	Transform.create(e, {
		position: Vector3.create(centerX, bottomY + height / 2, centerZ),
		scale   : Vector3.create(sizeX, height, sizeZ),
	})
	MeshRenderer.setBox(e)
	// 3rd-person camera only blocks on PHYSICS|POINTER — CL_CAMERA alone
	// does not stop the orbit cam from clipping through walls.
	MeshCollider.setBox(e, ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER)
	Material.setPbrMaterial(e, {
		albedoColor:       color,
		roughness:         1.0,
		metallic:          0.0,
		specularIntensity: 0.0,
	})
	return e
}


// MARK: setSlabSpan
// Resize an existing rock box when a cap is added or removed.
function setSlabSpan(
	e       : Entity,
	centerX : number,
	centerZ : number,
	sizeX   : number,
	sizeZ   : number,
	bottomY : number,
	topY    : number,
): void {
	const height = topY - bottomY
	const tr     = Transform.getMutableOrNull(e)
	if (tr === null) {
		console.log('terrainRenderer: setSlabSpan: missing transform, skipping resize')
		return
	}
	tr.position = Vector3.create(centerX, bottomY + height / 2, centerZ)
	tr.scale    = Vector3.create(sizeX, height, sizeZ)
}


// MARK: removeTracked

function removeTracked(e: Entity): void {
	const i = terrainEntities.indexOf(e)
	if (i >= 0) terrainEntities.splice(i, 1)
	engine.removeEntity(e)
}
