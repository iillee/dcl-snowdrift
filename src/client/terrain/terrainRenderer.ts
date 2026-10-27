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
import { LevelRect, mergeLevelRects } from 'src/shared/terrain/terrainGen'
import {
	MONUMENT_PIT_DEPTH_M,
	MONUMENT_PIT_SIZE_M,
	MONUMENT_SOCKET_DEPTH_M,
	monumentSocketDepth,
	MONUMENT_SOCKET_SIZE_M,
	TERRAIN_ORIGIN_M,
	TerrainMap,
} from 'src/shared/terrain/terrainMap'

import { MONUMENT_BLACK, MONUMENT_MATTE_PBR } from 'src/client/monumentMaterial'
import { clearLadders, setupLadders } from 'src/client/terrain/ladders'
import { thawWaveReachedRect } from 'src/client/worldThaw'


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
 * gets one. 200 m (was 100): ~61 caps on average, ~103 worst case
 * (was ~24 / ~54), one thin box each. Caps are removed only past
 * CAP_KEEP_M + CAP_HYSTERESIS_M so walking along the edge never flickers.
 */
const CAP_KEEP_M  = 200
const CAP_KEEP_M2 = CAP_KEEP_M * CAP_KEEP_M
const CAP_HYSTERESIS_M = 15
const CAP_DROP_M2 = (CAP_KEEP_M + CAP_HYSTERESIS_M) ** 2

/**
 * Exposed rock. Matches the baseColorFactor on the authored
 * tile-cliff-*.glb models so the greybox reads as the same slate the
 * eventual cliff kit will use. Every cliff face is this colour at
 * every level — height is read from the geometry, not from a tint.
 */
const COLOR_ROCK = Color4.create(0.2525, 0.3354, 0.6314, 1)

/** Melt-blue ground the snow lies on, at every playable level. */
const COLOR_GROUND = Color4.create(106 / 255, 153 / 255, 252 / 255, 1)

/** Monument socket border + socket bottom: the obelisk's matte deep black. */
const COLOR_PIT    = MONUMENT_BLACK
const COLOR_SOCKET = MONUMENT_BLACK


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

	for (const r of carveStationCells(map, rects)) {
		const top     = groundYForLevel(r.level)
		const centerX = TERRAIN_ORIGIN_M + (r.cx + r.w / 2) * TERRAIN_CELL_M
		const centerZ = TERRAIN_ORIGIN_M + (r.cz + r.h / 2) * TERRAIN_CELL_M
		if (addRect(centerX, centerZ, r.w * TERRAIN_CELL_M, r.h * TERRAIN_CELL_M, top, !isMountainLevel(r.level), focus)) caps++
	}
	let pits = 0
	for (const st of map.stations) {
		caps += addMonumentPit(st.cx, st.cz, groundYForLevel(map.levels[st.cz * map.w + st.cx]), focus)
		pits++
	}

	setupLadders(map)
	terrainGeneration++

	console.log(
		`terrainRenderer: setupTerrain: seed ${map.usedSeed} (try ${map.attempts}), ` +
		`${rects.length} rock slabs, ${caps} caps (keep=${CAP_KEEP_M}m), ${pits} monument pits, ` +
		`${map.ladders.length} ladders, ${map.regionLevel.length} regions, ` +
		`${map.destinations.length} destinations`
	)
}


// MARK: addRect
/** One walkable / mountain rect: rock body plus a near cap. True when a cap spawned. */
function addRect(
	centerX : number,
	centerZ : number,
	sizeX   : number,
	sizeZ   : number,
	top     : number,
	wantsCap: boolean,
	focus   : { x: number; z: number },
): boolean {
	const showCap = wantsCap && distSqToRect(focus.x, focus.z, centerX, centerZ, sizeX, sizeZ) < CAP_KEEP_M2
	const rockTop = showCap ? top - CAP_M : top
	const rock    = spawnSlab(centerX, centerZ, sizeX, sizeZ, SLAB_BASE_Y, rockTop, COLOR_ROCK)
	let   cap: Entity | null = null
	if (showCap) cap = spawnSlab(centerX, centerZ, sizeX, sizeZ, top - CAP_M, top, COLOR_GROUND)
	rectGeoms.push({ centerX, centerZ, sizeX, sizeZ, top, wantsCap, rock, cap })
	return cap !== null
}


// MARK: carveStationCells
/**
 * Split merged rects so every monument cell stands alone (it is drawn
 * by addMonumentPit instead). A rect holding a station cell becomes up
 * to four strips around it; repeated per station. Deterministic.
 */
function carveStationCells(map: TerrainMap, rects: LevelRect[]): LevelRect[] {
	let out = rects
	for (const st of map.stations) {
		const next: LevelRect[] = []
		for (const r of out) {
			const inside = st.cx >= r.cx && st.cx < r.cx + r.w && st.cz >= r.cz && st.cz < r.cz + r.h
			if (!inside) { next.push(r); continue }
			const left  = st.cx - r.cx
			const right = r.cx + r.w - st.cx - 1
			const below = st.cz - r.cz
			const above = r.cz + r.h - st.cz - 1
			if (left  > 0) next.push({ cx: r.cx,        cz: r.cz,        w: left,  h: r.h,   level: r.level })
			if (right > 0) next.push({ cx: st.cx + 1,   cz: r.cz,        w: right, h: r.h,   level: r.level })
			if (below > 0) next.push({ cx: st.cx,       cz: r.cz,        w: 1,     h: below, level: r.level })
			if (above > 0) next.push({ cx: st.cx,       cz: st.cz + 1,   w: 1,     h: above, level: r.level })
		}
		out = next
	}
	return out
}


// MARK: addMonumentPit
/**
 * A station cell drawn with a square MONUMENT_PIT_SIZE_M recess in the
 * middle: four ground strips around it (normal rock + cap, so its edge is
 * a rock face), ONE shallow step down to a MONUMENT_PIT_DEPTH_M floor
 * (under the 0.3 m DCL auto-step), and a MONUMENT_SOCKET_SIZE_M square
 * socket MONUMENT_SOCKET_DEPTH_M deep in the centre of the floor that the
 * obelisk sits in. While frozen the recess is filled by the ice mound
 * (stationMarkers). All boxes collide. Returns caps spawned.
 */
function addMonumentPit(cx: number, cz: number, top: number, focus: { x: number; z: number }): number {
	const cell = TERRAIN_CELL_M
	const x0   = TERRAIN_ORIGIN_M + (cx + 0.5) * cell
	const z0   = TERRAIN_ORIGIN_M + (cz + 0.5) * cell
	// Ground right up to a MONUMENT_PIT_SIZE_M square; inside it a dark
	// perimeter band drawn as full-height dark slabs (bedrock to ground
	// top, same height as the cap beside it: flush, no lip, and no
	// coplanar faces so no z-fight), then the plain socket in the middle.
	void MONUMENT_PIT_DEPTH_M
	const pit  = MONUMENT_PIT_SIZE_M
	const band = (cell - pit) / 2
	let caps = 0
	// South + north strips span the full cell; west + east fill between.
	if (addRect(x0, z0 - pit / 2 - band / 2, cell, band, top, true, focus)) caps++
	if (addRect(x0, z0 + pit / 2 + band / 2, cell, band, top, true, focus)) caps++
	if (addRect(x0 - pit / 2 - band / 2, z0, band, pit, top, true, focus)) caps++
	if (addRect(x0 + pit / 2 + band / 2, z0, band, pit, top, true, focus)) caps++

	const socket  = MONUMENT_SOCKET_SIZE_M
	const depth   = monumentSocketDepth(top)
	const socketY = top - depth
	// Black perimeter band, flush with the ground (matte, no reflectivity).
	for (const e of spawnFrame(x0, z0, pit, socket, SLAB_BASE_Y, top, COLOR_PIT)) paintMonumentMatte(e)
	// Plain socket: black bottom, walls are the band's inner faces.
	paintMonumentMatte(spawnSlab(x0, z0, socket, socket, SLAB_BASE_Y, socketY, COLOR_SOCKET))
	// Invisible physics plug filling the socket to ground level, so a
	// player can never drop into the empty 1.5 m socket and get stuck
	// after the obelisk rises. Physics only (not pointer/camera).
	const plug = engine.addEntity()
	terrainEntities.push(plug)
	Transform.create(plug, {
		position: Vector3.create(x0, socketY + depth / 2, z0),
		scale   : Vector3.create(socket, Math.max(0.01, depth), socket),
	})
	MeshCollider.setBox(plug, ColliderLayer.CL_PHYSICS)
	return caps
}


// MARK: spawnFrame
/**
 * Square ring of four slabs centred on (x0, z0): `outer` edge, with an
 * `inner` square hole, spanning bottomY..topY. North + south strips span
 * the full outer width; west + east fill between them.
 */
function spawnFrame(
	x0     : number,
	z0     : number,
	outer  : number,
	inner  : number,
	bottomY: number,
	topY   : number,
	color  : Color4,
): Entity[] {
	const w = (outer - inner) / 2
	if (w <= 0) return []
	return [
		spawnSlab(x0, z0 - inner / 2 - w / 2, outer, w, bottomY, topY, color),
		spawnSlab(x0, z0 + inner / 2 + w / 2, outer, w, bottomY, topY, color),
		spawnSlab(x0 - inner / 2 - w / 2, z0, w, inner, bottomY, topY, color),
		spawnSlab(x0 + inner / 2 + w / 2, z0, w, inner, bottomY, topY, color),
	]
}


// MARK: paintMonumentMatte
/** Monument stone: matte deep black, no reflectivity (src/client/monumentMaterial.ts). */
function paintMonumentMatte(e: Entity): void {
	Material.setPbrMaterial(e, { ...MONUMENT_MATTE_PBR })
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
		// After the world thaw the ice cap melts off as the wave reaches
		// the rect: drop it and run the rock to the full walkable height
		// (same as a distance-culled cap). Reset brings caps back.
		const d2 = distSqToRect(focus.x, focus.z, g.centerX, g.centerZ, g.sizeX, g.sizeZ)
		const near = d2 < (g.cap === null ? CAP_KEEP_M2 : CAP_DROP_M2)
			&& !thawWaveReachedRect(g.centerX, g.centerZ, g.sizeX, g.sizeZ)
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
