/**
 * summitMapTable.ts — waist-high stone map tablet on the volcano rim.
 *
 * Pillar + flat slate. Engraved landmark marks sit on the slate in
 * world-axis alignment (local +X/+Z = scene +X/+Z). Click opens the
 * summit map UI. Rebuilds when activeTerrain() changes.
 *
 * Flat black-and-white engraving: volcano = triangle, spawn = circle,
 * stations = X. Slate footprint matches the map face size.
 */

import {
	ColliderLayer,
	engine,
	Entity,
	InputAction,
	Material,
	MeshCollider,
	MeshRenderer,
	Transform,
	pointerEventsSystem,
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'

import { openSummitMap } from 'src/client/summitMap'
import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { MAZE_PLAYFIELD_METERS } from 'src/shared/settings'
import { pickSummitMapSeat } from 'src/shared/terrain/summitMapSeat'
import { activeTerrain } from 'src/shared/terrain/terrainCache'
import {
	TERRAIN_ORIGIN_M,
	TerrainMap,
	cellCenterWorld,
} from 'src/shared/terrain/terrainMap'
import { volcanoLavaCentroid } from 'src/shared/terrain/volcanoCrown'


/** Map face and slate share one footprint (no oversized base). */
const MAP_FACE_M = 1.15
const SLAB_W_M   = MAP_FACE_M
const BLOCK_SINK_M = 0.20
const PILLAR_H_M = 1.00
const SLAB_H_M   = 0.09
const MARKER_H_M = 0.045

const CLICK_MAX_DIST_M = 8

const COLOR_STONE = Color4.create(0.42, 0.40, 0.36, 1)
const COLOR_SLATE = Color4.create(0.55, 0.52, 0.46, 1)
const COLOR_INK   = Color4.create(0.08, 0.07, 0.06, 1)

const entities: Entity[] = []
let clickTargets: Entity[] = []
let lastSeed = -1
let installed = false


function worldToMapLocal(worldX: number, worldZ: number): { x: number; z: number } {
	const extent = MAZE_PLAYFIELD_METERS
	const nx = (worldX - TERRAIN_ORIGIN_M) / extent - 0.5
	const nz = (worldZ - TERRAIN_ORIGIN_M) / extent - 0.5
	return {
		x: Math.max(-0.48, Math.min(0.48, nx)) * MAP_FACE_M,
		z: Math.max(-0.48, Math.min(0.48, nz)) * MAP_FACE_M,
	}
}


function engraveMaterial(): { albedoColor: Color4; roughness: number; metallic: number } {
	return {
		albedoColor: COLOR_INK,
		roughness:   0.95,
		metallic:    0,
	}
}


function spawnBox(
	parent: Entity | undefined,
	pos: { x: number; y: number; z: number },
	scale: { x: number; y: number; z: number },
	color: Color4,
	pointer: boolean,
): Entity {
	const e = engine.addEntity()
	entities.push(e)
	Transform.create(e, {
		position: Vector3.create(pos.x, pos.y, pos.z),
		scale:    Vector3.create(scale.x, scale.y, scale.z),
		rotation: Quaternion.Identity(),
		parent,
	})
	MeshRenderer.setBox(e)
	MeshCollider.setBox(
		e,
		pointer
			? ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER
			: ColliderLayer.CL_PHYSICS,
	)
	Material.setPbrMaterial(e, {
		albedoColor: color,
		roughness:   0.9,
		metallic:    0.02,
	})
	return e
}


function markY(): number {
	return PILLAR_H_M + SLAB_H_M + MARKER_H_M / 2 + 0.01
}


/** Flat disk — circle when viewed from above. */
function spawnCircleMark(root: Entity, worldX: number, worldZ: number, sizeM: number): void {
	const { x, z } = worldToMapLocal(worldX, worldZ)
	const e = engine.addEntity()
	entities.push(e)
	Transform.create(e, {
		parent: root,
		position: Vector3.create(x, markY(), z),
		scale:    Vector3.create(sizeM, MARKER_H_M, sizeM),
		rotation: Quaternion.Identity(),
	})
	MeshRenderer.setCylinder(e)
	Material.setPbrMaterial(e, engraveMaterial())
}


/** Two crossed bars — X when viewed from above. */
function spawnXMark(root: Entity, worldX: number, worldZ: number, sizeM: number): void {
	const { x, z } = worldToMapLocal(worldX, worldZ)
	const y = markY()
	const barLen = sizeM * 1.15
	const barW   = sizeM * 0.22
	for (const yaw of [45, -45]) {
		const e = engine.addEntity()
		entities.push(e)
		Transform.create(e, {
			parent: root,
			position: Vector3.create(x, y, z),
			scale:    Vector3.create(barW, MARKER_H_M, barLen),
			rotation: Quaternion.fromEulerDegrees(0, yaw, 0),
		})
		MeshRenderer.setBox(e)
		Material.setPbrMaterial(e, engraveMaterial())
	}
}


/** Equilateral triangle outline — triangle when viewed from above. */
function spawnTriangleMark(root: Entity, worldX: number, worldZ: number, sizeM: number): void {
	const { x, z } = worldToMapLocal(worldX, worldZ)
	const y = markY()
	const h = sizeM * 0.866025
	const v0 = { x: 0, z: h * 0.55 }
	const v1 = { x: -sizeM / 2, z: -h * 0.45 }
	const v2 = { x: sizeM / 2, z: -h * 0.45 }
	const edges: Array<[{ x: number; z: number }, { x: number; z: number }]> = [
		[v0, v1],
		[v1, v2],
		[v2, v0],
	]
	const thickness = sizeM * 0.18
	for (const [a, b] of edges) {
		const mx = (a.x + b.x) / 2
		const mz = (a.z + b.z) / 2
		const dx = b.x - a.x
		const dz = b.z - a.z
		const len = Math.sqrt(dx * dx + dz * dz)
		const yaw = Math.atan2(dx, dz) * (180 / Math.PI)
		const e = engine.addEntity()
		entities.push(e)
		Transform.create(e, {
			parent: root,
			position: Vector3.create(x + mx, y, z + mz),
			scale:    Vector3.create(thickness, MARKER_H_M, len),
			rotation: Quaternion.fromEulerDegrees(0, yaw, 0),
		})
		MeshRenderer.setBox(e)
		Material.setPbrMaterial(e, engraveMaterial())
	}
}


function clearTable(): void {
	for (const e of clickTargets) {
		try { pointerEventsSystem.removeOnPointerDown(e) } catch { /* gone */ }
	}
	clickTargets = []
	for (const e of entities) {
		try { engine.removeEntity(e) } catch { /* gone */ }
	}
	entities.length = 0
}


function bindClick(e: Entity): void {
	clickTargets.push(e)
	pointerEventsSystem.onPointerDown(
		{
			entity: e,
			opts: {
				button: InputAction.IA_POINTER,
				hoverText: 'View Map',
				maxDistance: CLICK_MAX_DIST_M,
				showFeedback: true,
				showHighlight: true,
			},
		},
		() => openSummitMap(),
	)
}


function buildTable(map: TerrainMap): void {
	clearTable()
	const seat = pickSummitMapSeat(map)
	if (!seat) {
		console.log('summitMapTable: no seat for this terrain')
		return
	}

	// Root at ground. Identity rotation → map local +X/+Z = scene +X/+Z.
	const root = engine.addEntity()
	entities.push(root)
	Transform.create(root, {
		position: Vector3.create(seat.x, seat.y, seat.z),
		rotation: Quaternion.Identity(),
		scale:    Vector3.One(),
	})

	// Single solid block: map-face footprint extruded down to (slightly below) ground.
	const blockTop = PILLAR_H_M + SLAB_H_M
	const blockBottom = -BLOCK_SINK_M
	const block = spawnBox(
		root,
		{ x: 0, y: (blockTop + blockBottom) / 2, z: 0 },
		{ x: SLAB_W_M, y: blockTop - blockBottom, z: SLAB_W_M },
		COLOR_SLATE,
		true,
	)
	bindClick(block)

	const lava = volcanoLavaCentroid(map)
	if (lava) {
		const { x, z } = cellCenterWorld(Math.floor(lava.fx), Math.floor(lava.fz))
		spawnTriangleMark(root, x, z, 0.16)
	} else if (map.volcano) {
		const { x, z } = cellCenterWorld(map.volcano.cx, map.volcano.cz)
		spawnTriangleMark(root, x, z, 0.16)
	}

	spawnCircleMark(root, CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z, 0.11)

	for (const st of map.stations) {
		const { x, z } = cellCenterWorld(st.cx, st.cz)
		spawnXMark(root, x, z, 0.10)
	}

	console.log(
		`summitMapTable: placed at cell (${seat.cx},${seat.cz}) ` +
		`world=(${seat.x.toFixed(1)},${seat.y.toFixed(1)},${seat.z.toFixed(1)}) ` +
		`seed=${map.usedSeed} slate=${SLAB_W_M.toFixed(2)}m=map`,
	)
}


function syncToTerrain(): void {
	const map = activeTerrain()
	if (!map) return
	if (map.usedSeed === lastSeed && entities.length > 0) return
	lastSeed = map.usedSeed
	buildTable(map)
}


export function setupSummitMapTable(): void {
	if (installed) return
	installed = true
	engine.addSystem(() => { syncToTerrain() })
	console.log('summitMapTable: setupSummitMapTable: installed')
}
