/**
 * volcanoCrown.ts (client) — glowing lava lake + dark inner crater wall.
 *
 * The crown itself is terrain (extruded crown levels). This module adds:
 *   - Inner lining: thin dark basalt on lava-facing crown faces (always).
 *   - Lava lids: one box per lava cell, staged by landed monuments
 *     (setVolcanoLavaStage 0..3). Stage 0 = no lava entities at all
 *     (scale-hiding leaked through snow). Stage 1 a small dim pool at
 *     the lake centre, stage 2 wider and brighter, stage 3 the full
 *     glowing lake (the eruption look). The pool spreads outward from
 *     the centre and height / glow / colour blend over
 *     LAVA_STAGE_BLEND_S. Tunables: src/shared/volcanoStages.ts.
 *
 * Rebuilds lining + lava cells on terrain change.
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
	volcanoLavaCentroid,
	volcanoRimY,
} from 'src/shared/terrain/volcanoCrown'
import {
	LAVA_COVER_BY_STAGE,
	LAVA_EDGE_SOFT,
	LAVA_EMISSIVE_BY_STAGE,
	LAVA_HEAT_BY_STAGE,
	LAVA_LIT_MIN_PRESENCE,
	LAVA_RELIGHT_ABOVE_M,
	LAVA_RELIGHT_REACH_M,
	LAVA_STAGE_BLEND_S,
	LAVA_TOP_BY_STAGE,
	volcanoStageIndex,
} from 'src/shared/volcanoStages'


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
/** Cooler crust colours for the low stages (blended by LAVA_HEAT_BY_STAGE). */
const COLOR_CRUST    = Color4.create(0.30, 0.08, 0.03, 1)
const CRUST_EMISSIVE = Color3.create(0.70, 0.16, 0.02)
/** Lowest lid height while a cell is still spreading in (m above the rim). */
const LAVA_MIN_TOP_M = -0.03


// MARK: State
const liningEntities: Entity[] = []
let lastMap: TerrainMap | null = null
let installed = false

import { CRYSTAL_IDLE_LAVA_COVER, CRYSTAL_IDLE_LAVA_EMISSIVE, CRYSTAL_IDLE_LAVA_HEAT, CRYSTAL_IDLE_LAVA_TOP_M, isFloatingCrystals } from 'src/shared/ruleset'

/** One lava cell: world centre, normalised distance from the lake centre (0 = centre cell). */
type LavaCell = { x: number; z: number; d: number; e: Entity | null; a: number }
const lavaCells: LavaCell[] = []
/** Live lava look (blended toward the stage target). */
type LavaParams = { cover: number; top: number; emis: number; heat: number }
function lavaStageParams(st: number): LavaParams {
	// Floating crystals: a low idle lava glow from the start.
	if (st <= 0 && isFloatingCrystals()) return {
		cover: CRYSTAL_IDLE_LAVA_COVER, top: CRYSTAL_IDLE_LAVA_TOP_M,
		emis : CRYSTAL_IDLE_LAVA_EMISSIVE, heat: CRYSTAL_IDLE_LAVA_HEAT,
	}
	return {
		cover: LAVA_COVER_BY_STAGE[st],
		top  : LAVA_TOP_BY_STAGE[st],
		emis : LAVA_EMISSIVE_BY_STAGE[st],
		heat : LAVA_HEAT_BY_STAGE[st],
	}
}
let lavaStage = 0
let lavaCur : LavaParams = lavaStageParams(0)
let lavaFrom: LavaParams = lavaStageParams(0)
let lavaBlendT = LAVA_STAGE_BLEND_S


// MARK: clearLava
function clearLava(): void {
	for (const c of lavaCells) {
		if (c.e !== null) engine.removeEntity(c.e)
		c.e = null
		c.a = 0
	}
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


// MARK: buildLavaCells
/** Collect lava cells with their normalised distance from the lake centre. */
function buildLavaCells(map: TerrainMap): void {
	clearLava()
	lavaCells.length = 0
	const cells = volcanoLavaCells(map)
	const c = volcanoLavaCentroid(map)
	if (cells.length === 0 || !c) return
	const raw: Array<{ x: number; z: number; r: number }> = []
	for (const i of cells) {
		const cx = i % map.w
		const cz = (i - cx) / map.w
		const w  = cellCenterWorld(cx, cz)
		raw.push({ x: w.x, z: w.z, r: Math.hypot(cx + 0.5 - c.fx, cz + 0.5 - c.fz) })
	}
	let rMin = Infinity
	let rMax = 0
	for (const p of raw) { rMin = Math.min(rMin, p.r); rMax = Math.max(rMax, p.r) }
	const span = Math.max(1e-3, rMax - rMin)
	for (const p of raw) lavaCells.push({ x: p.x, z: p.z, d: (p.r - rMin) / span, e: null, a: 0 })
}


// MARK: applyLava
/**
 * Spawn / reshape / recolour lava cells for the live params. A cell's
 * presence `a` (0..1) ramps across LAVA_EDGE_SOFT behind the spreading
 * front; the centre cell is present whenever there is any lava.
 */
function applyLava(): void {
	const p      = lavaCur
	const rimY   = volcanoRimY()
	const bottom = rimY - LAVA_SINK_M
	const mobile = isMobile()
	for (const c of lavaCells) {
		// Centre cell (d = 0) is first in and present whenever cover > 0.
		const a = p.cover <= 0 ? 0 : Math.max(0, Math.min(1, (p.cover - c.d) / LAVA_EDGE_SOFT))
		if (a <= 0) {
			if (c.e !== null) { engine.removeEntity(c.e); c.e = null }
			c.a = 0
			continue
		}
		const top = rimY + LAVA_MIN_TOP_M + (p.top - LAVA_MIN_TOP_M) * a
		const h   = Math.max(0.01, top - bottom)
		if (c.e === null) {
			const e = engine.addEntity()
			Transform.create(e, {
				position: Vector3.create(c.x, bottom + h / 2, c.z),
				scale   : Vector3.create(TERRAIN_CELL_M, h, TERRAIN_CELL_M),
			})
			MeshRenderer.setBox(e)
			MeshCollider.setBox(e, ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER)
			c.e = e
		} else {
			const tr = Transform.getMutable(c.e)
			tr.position = Vector3.create(c.x, bottom + h / 2, c.z)
			tr.scale    = Vector3.create(TERRAIN_CELL_M, h, TERRAIN_CELL_M)
		}
		c.a = a
		const k = Math.max(0, Math.min(1, p.heat))
		const col = Color4.create(
			COLOR_CRUST.r + (COLOR_LAVA.r - COLOR_CRUST.r) * k,
			COLOR_CRUST.g + (COLOR_LAVA.g - COLOR_CRUST.g) * k,
			COLOR_CRUST.b + (COLOR_LAVA.b - COLOR_CRUST.b) * k,
			1,
		)
		if (mobile) {
			Material.setBasicMaterial(c.e, { diffuseColor: col, castShadows: false })
		} else {
			Material.setPbrMaterial(c.e, {
				albedoColor      : col,
				emissiveColor    : Color3.create(
					CRUST_EMISSIVE.r + (LAVA_EMISSIVE.r - CRUST_EMISSIVE.r) * k,
					CRUST_EMISSIVE.g + (LAVA_EMISSIVE.g - CRUST_EMISSIVE.g) * k,
					CRUST_EMISSIVE.b + (LAVA_EMISSIVE.b - CRUST_EMISSIVE.b) * k,
				),
				emissiveIntensity: p.emis * a,
				roughness        : 0.6,
				metallic         : 0.0,
				castShadows      : false,
			})
		}
	}
}


// MARK: lavaBlendSystem
/** Ease the lava look toward the stage target (only while blending). */
function lavaBlendSystem(dt: number): void {
	if (lavaBlendT >= LAVA_STAGE_BLEND_S) return
	lavaBlendT = Math.min(LAVA_STAGE_BLEND_S, lavaBlendT + dt)
	const u = lavaBlendT / LAVA_STAGE_BLEND_S
	const k = u * u * (3 - 2 * u)
	const to = lavaStageParams(lavaStage)
	lavaCur = {
		cover: lavaFrom.cover + (to.cover - lavaFrom.cover) * k,
		top  : lavaFrom.top   + (to.top   - lavaFrom.top)   * k,
		emis : lavaFrom.emis  + (to.emis  - lavaFrom.emis)  * k,
		heat : lavaFrom.heat  + (to.heat  - lavaFrom.heat)  * k,
	}
	applyLava()
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

	buildLavaCells(map)
	applyLava()
	console.log(
		`volcanoCrown: seed ${map.usedSeed}: lining=${plates} ` +
		`lavaCells=${lavaCells.length} stage=${lavaStage}`,
	)
}


// MARK: nearestLitLava
/**
 * Nearest point on a lit lava cell (presence >= LAVA_LIT_MIN_PRESENCE)
 * to world (x, z), with its horizontal distance; null when no lava.
 */
export function nearestLitLava(x: number, z: number): { x: number; z: number; d: number } | null {
	const half = TERRAIN_CELL_M / 2
	let best: { x: number; z: number; d: number } | null = null
	for (const c of lavaCells) {
		if (c.e === null || c.a < LAVA_LIT_MIN_PRESENCE) continue
		const nx = Math.max(c.x - half, Math.min(c.x + half, x))
		const nz = Math.max(c.z - half, Math.min(c.z + half, z))
		const d  = Math.hypot(x - nx, z - nz)
		if (best === null || d < best.d) best = { x: c.x, z: c.z, d }
	}
	return best
}


// MARK: isInLavaRelightRange
/**
 * True when the local player can light their torch from the lava: within
 * LAVA_RELIGHT_REACH_M of a lit lava cell's edge and no more than
 * LAVA_RELIGHT_ABOVE_M above the lava (standing in the crater or on the
 * crown lip looking in). Same prompt / E press as a campfire.
 */
export function isInLavaRelightRange(): boolean {
	if (lavaStage <= 0) return false
	const t = Transform.getOrNull(engine.PlayerEntity)
	if (t === null) return false
	const { x, y, z } = t.position
	const dy = y - volcanoRimY()
	if (dy < -2 || dy > LAVA_RELIGHT_ABOVE_M) return false
	const n = nearestLitLava(x, z)
	return n !== null && n.d <= LAVA_RELIGHT_REACH_M
}


// MARK: setVolcanoLavaStage
/**
 * Lava stage from landed monuments (0..3). 0 = no lava entities; 1..3
 * spread / rise / brighten per src/shared/volcanoStages.ts, blended over
 * LAVA_STAGE_BLEND_S. Idempotent; safe before terrain exists.
 */
export function setVolcanoLavaStage(n: number): void {
	const next = volcanoStageIndex(n)
	if (next === lavaStage) return
	console.log(`volcanoCrown: lava stage ${lavaStage} -> ${next}`)
	lavaStage  = next
	lavaFrom   = { ...lavaCur }
	lavaBlendT = 0
}


// MARK: setVolcanoLavaVisible
/** Legacy toggle: full lake (stage 3) or none. */
export function setVolcanoLavaVisible(visible: boolean): void {
	setVolcanoLavaStage(visible ? 3 : 0)
}


// MARK: beginVolcanoThaw
/** 3/3 station thaw: full lava lake (smoke via setVolcanoSmokeBoost(3)). */
export function beginVolcanoThaw(): void {
	console.log('volcanoCrown: beginVolcanoThaw')
	setVolcanoLavaStage(3)
}


// MARK: setupVolcanoCrown
/** Install the lining builder (+ thaw-gated lava). Idempotent. */
export function setupVolcanoCrown(): void {
	if (installed) return
	installed = true
	engine.addSystem(lavaBlendSystem)
	engine.addSystem(() => {
		const map = activeTerrain()
		if (map === lastMap) return
		lastMap = map
		buildForMap(map)
	})
	console.log('volcanoCrown: setupVolcanoCrown: installed, waiting for terrain')
}
