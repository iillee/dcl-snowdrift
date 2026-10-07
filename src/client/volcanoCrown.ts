/**
 * volcanoCrown.ts (client) — glowing lava lake + dark inner crater wall.
 *
 * The crown itself is terrain (extruded crown levels). This module adds:
 *   - Inner lining: thin dark basalt on lava-facing crown faces (always).
 *   - Lava lids: spawned ONLY after the 3/3 ignition thaw. Until then
 *     no orange entities exist — scale-hiding leaked through snow.
 *
 * Rebuilds lining on terrain change; thaw / setVolcanoLavaVisible
 * spawns or destroys lava lids.
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
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

import { TERRAIN_CELL_M, groundYForLevel } from 'src/shared/settings'
import { activeTerrain } from 'src/shared/terrain/terrainCache'
import {
	DIR_DX,
	DIR_DZ,
	LANDFORM_LAVA,
	TerrainMap,
	cellCenterWorld,
} from 'src/shared/terrain/terrainMap'
import {
	volcanoCrownCells,
	volcanoLavaCells,
	volcanoLavaTopY,
	volcanoRimY,
} from 'src/shared/terrain/volcanoCrown'


// MARK: Tuning
const LAVA_SINK_M   = 0.05
const LINING_T_M    = 0.1
const LINING_GAP_M  = 0.03
/** Lining bottom relative to rim: at/below snow base so dark continues under the ice-cap. */
const LINING_BELOW_RIM_M = 0.05
const LINING_TOP_GAP_M    = 0.03
const COLOR_BASALT  = Color4.create(0.16, 0.12, 0.11, 1)
const COLOR_LAVA    = Color4.create(1.0, 0.42, 0.04, 1)
const LAVA_EMISSIVE = Color3.create(1.0, 0.38, 0.03)
const LAVA_EMISSIVE_INTENSITY = 3


// MARK: State
const liningEntities: Entity[] = []
const lavaEntities  : Entity[] = []
let lastMap: TerrainMap | null = null
let installed = false
/** True after 3/3 thaw has revealed lava. */
let lavaVisible = false


// MARK: clearLava
function clearLava(): void {
	for (const e of lavaEntities) engine.removeEntity(e)
	lavaEntities.length = 0
}


// MARK: clearAll
function clearAll(): void {
	for (const e of liningEntities) engine.removeEntity(e)
	liningEntities.length = 0
	clearLava()
}


// MARK: spawnBox
function spawnBox(
	cx      : number,
	cz      : number,
	sx      : number,
	sz      : number,
	bottomY : number,
	topY    : number,
	collide : boolean,
	bucket  : Entity[],
): Entity {
	const h = topY - bottomY
	const e = engine.addEntity()
	bucket.push(e)
	Transform.create(e, {
		position: Vector3.create(cx, bottomY + h / 2, cz),
		scale   : Vector3.create(sx, h, sz),
	})
	MeshRenderer.setBox(e)
	if (collide) MeshCollider.setBox(e, ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER)
	return e
}


// MARK: spawnLavaLids
/** Row-merged glowing lava boxes. Call only when thawed. */
function spawnLavaLids(map: TerrainMap): number {
	clearLava()
	const rimY    = volcanoRimY()
	const lavaTop = volcanoLavaTopY()
	const lava    = new Set(volcanoLavaCells(map))
	const mobile  = isMobile()
	let runs = 0
	for (let cz = 0; cz < map.h; cz++) {
		let cx = 0
		while (cx < map.w) {
			if (!lava.has(cz * map.w + cx)) { cx++; continue }
			const start = cx
			while (cx < map.w && lava.has(cz * map.w + cx)) cx++
			const len  = cx - start
			const a    = cellCenterWorld(start, cz)
			const midX = a.x + ((len - 1) * TERRAIN_CELL_M) / 2
			const e = spawnBox(midX, a.z, len * TERRAIN_CELL_M, TERRAIN_CELL_M,
				rimY - LAVA_SINK_M, lavaTop, true, lavaEntities)
			if (mobile) {
				Material.setBasicMaterial(e, { diffuseColor: COLOR_LAVA, castShadows: false })
			} else {
				Material.setPbrMaterial(e, {
					albedoColor      : COLOR_LAVA,
					emissiveColor    : LAVA_EMISSIVE,
					emissiveIntensity: LAVA_EMISSIVE_INTENSITY,
					roughness        : 0.6,
					metallic         : 0.0,
					castShadows      : false,
				})
			}
			runs++
		}
	}
	return runs
}


// MARK: buildForMap
function buildForMap(map: TerrainMap | null): void {
	clearAll()
	if (!map || !map.volcano) return
	const rimY = volcanoRimY()

	// Inner lining on lava-facing crown faces (dark basalt only).
	// Bottom at/below rim so dark rock continues under the snow/ice-cap.
	let plates = 0
	for (const i of volcanoCrownCells(map)) {
		const cx  = i % map.w
		const cz  = (i - cx) / map.w
		const c   = cellCenterWorld(cx, cz)
		const top = groundYForLevel(map.levels[i]) - LINING_TOP_GAP_M
		for (let d = 0; d < 4; d++) {
			const nx = cx + DIR_DX[d]
			const nz = cz + DIR_DZ[d]
			if (nx < 0 || nz < 0 || nx >= map.w || nz >= map.h) continue
			if (map.landforms[nz * map.w + nx] !== LANDFORM_LAVA) continue
			const off = TERRAIN_CELL_M / 2 + LINING_GAP_M + LINING_T_M / 2
			const px  = c.x + DIR_DX[d] * off
			const pz  = c.z + DIR_DZ[d] * off
			const sx  = DIR_DX[d] !== 0 ? LINING_T_M : TERRAIN_CELL_M
			const sz  = DIR_DZ[d] !== 0 ? LINING_T_M : TERRAIN_CELL_M
			const e   = spawnBox(px, pz, sx, sz, rimY - LINING_BELOW_RIM_M, top, false, liningEntities)
			Material.setPbrMaterial(e, {
				albedoColor      : COLOR_BASALT,
				roughness        : 1.0,
				metallic         : 0.0,
				specularIntensity: 0.0,
			})
			plates++
		}
	}

	const lavaRuns = lavaVisible ? spawnLavaLids(map) : 0
	console.log(
		`volcanoCrown: seed ${map.usedSeed}: lining=${plates} ` +
		`lavaRuns=${lavaRuns} thawed=${lavaVisible}`,
	)
}


// MARK: setVolcanoLavaVisible
/**
 * Reveal or bury lava lids by spawn/destroy — no orange mesh exists
 * while dormant. Idempotent; re-syncs entities if terrain rebuilt.
 */
export function setVolcanoLavaVisible(visible: boolean): void {
	if (lavaVisible === visible) {
		if (visible && lavaEntities.length === 0 && lastMap) spawnLavaLids(lastMap)
		if (!visible && lavaEntities.length > 0) clearLava()
		return
	}
	lavaVisible = visible
	if (visible) {
		const n = lastMap ? spawnLavaLids(lastMap) : 0
		console.log(`volcanoCrown: setVolcanoLavaVisible: true (${n} runs)`)
	} else {
		clearLava()
		console.log('volcanoCrown: setVolcanoLavaVisible: false (cleared)')
	}
}


// MARK: beginVolcanoThaw
/**
 * 3/3 station thaw: spawn lava. Full snow retract across the crater
 * needs server meltDisc / paintTick — left for a later pass. Smoke is
 * driven by setVolcanoSmokeBoost(3) from the station sync.
 */
export function beginVolcanoThaw(): void {
	console.log('volcanoCrown: beginVolcanoThaw')
	setVolcanoLavaVisible(true)
}


// MARK: setupVolcanoCrown
/** Install the lining builder (+ thaw-gated lava). Idempotent. */
export function setupVolcanoCrown(): void {
	if (installed) return
	installed = true
	engine.addSystem(() => {
		const map = activeTerrain()
		if (map === lastMap) return
		lastMap = map
		buildForMap(map)
	})
	console.log('volcanoCrown: setupVolcanoCrown: installed, waiting for terrain')
}
