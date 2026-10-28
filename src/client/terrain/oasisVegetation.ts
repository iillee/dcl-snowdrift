/**
 * oasisVegetation.ts - regrowth on the melted oasis floors (floating-crystals ruleset), client only.
 *
 * Plan (cells, shades, items, start times) comes from shared/terrain/oasisVeg.ts and is a pure function of the
 * oasis entries (release clock) + cycle seed, so every client draws the same thing at the same time and a late
 * joiner lands mid-growth. This module only turns the plan into entities:
 *   - grass: thin 4 m slabs (3 greens) popping in cell by cell after the cap melted; once every grass cell of an
 *     oasis is due they are replaced by greedy-merged rectangles (one entity per same-shade rectangle);
 *   - rocks / bushes pop and scale in, pines grow (2-3 primitive entities each). Colliders (physics layer only, never
 *     pointer / chop logic): a pine's TRUNK (the canopy stays walk-through) once it is > 30% grown, a rock as soon as it is
 *     drawn; bushes have none. A collider is never switched on while the player stands in its footprint (it waits until they
 *     step out), so nobody is trapped. Decorative otherwise: no resource logic is touched.
 * Items near fire-network path cubes and fires are skipped only when they are about to spawn; once drawn, an item (and the merged
 * grass, which ignores paths altogether) stays, so lighting a new fire later never makes grown vegetation vanish.
 * All spawning is batched (VEG_BUDGET_PER_TICK entities per 0.2 s tick). Everything clears with the oases (cycle reset).
 */

import { ColliderLayer, Entity, Material, MeshCollider, MeshRenderer, Transform, engine } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'

import { activeTerrain } from 'src/shared/terrain/terrainCache'
import { OASIS_CELL_M, oasisCapR, oasisEntries, oasisVersion } from 'src/shared/terrain/oasis'
import {
	VEG_BUSH, VEG_GRASS_TOP_M, VEG_ROCK, VEG_TREE, VEG_TREE_TIER_H_M, VegCell, VegItem,
	buildVegCells, mergeGrassRects, vegGrowth, vegOwnerKey, vegTreeHeightM,
} from 'src/shared/terrain/oasisVeg'
import { getPlacedFirePositions } from 'src/client/hiddenCampfire'
import { forEachGlowPoint } from 'src/client/fireNetworkGlow'


// MARK: Tuning

/** System cadence (s). */
const VEG_TICK_S = 0.2
/** Entities created per tick (mobile allows ~300 addEntity per frame; stay far under). */
const VEG_BUDGET_PER_TICK = 60
/** Spawn-time keep-outs (m): fire-network path cubes, fires. Never applied to items already drawn. */
const VEG_PATH_CLEAR_M = 2
const VEG_FIRE_CLEAR_M = 3.5
const RETIRE_FRAMES = 2
/** A pine trunk collider is enabled once the (eased) growth passes this. */
const TRUNK_COLLIDER_MIN_GROWTH = 0.3
/** Trunk visual / collider minimum width (m). */
const TRUNK_MIN_W_M = 0.4
/** Avatar radius + margin (m): a collider is not enabled while the player is this close to its footprint edge. */
const PLAYER_CLEAR_M = 0.45

const GRASS_COLORS = [
	Color4.create(0.27, 0.46, 0.20, 1),
	Color4.create(0.36, 0.58, 0.24, 1),
	Color4.create(0.50, 0.70, 0.30, 1),
]
const PINE_COLORS = [
	Color4.create(0.09, 0.26, 0.15, 1),
	Color4.create(0.11, 0.30, 0.17, 1),
	Color4.create(0.07, 0.21, 0.14, 1),
]
const TRUNK_COLOR = Color4.create(0.28, 0.19, 0.12, 1)
const BUSH_COLORS = [
	Color4.create(0.20, 0.42, 0.17, 1),
	Color4.create(0.26, 0.47, 0.20, 1),
	Color4.create(0.16, 0.35, 0.18, 1),
]
const ROCK_COLORS = [
	Color4.create(0.62, 0.58, 0.74, 1),
	Color4.create(0.53, 0.50, 0.66, 1),
	Color4.create(0.70, 0.66, 0.78, 1),
]


// MARK: State

interface LiveCell { c: VegCell; e: Entity | null; shown: boolean }
interface LiveItem { it: VegItem; parts: Entity[]; spawned: boolean; done: boolean; blocked: boolean; shownScale: number; coll: boolean }
interface Group { key: string; cells: LiveCell[]; merged: Entity[] | null }

const cellsByKey = new Map<number, LiveCell>()
const known = new Set<number>()
const groups = new Map<string, Group>()
const items: LiveItem[] = []
const retire: Array<{ e: Entity; frames: number }> = []
let installed = false
let seenVersion = -1
let syncedKeys = new Set<string>()
/** Oasis cap radius the plan was built for (changes once when the finale pulse is scheduled: the ring beyond the first patch is planned then). */
let capSeen = 0
let acc = 0
let retryFrames = 0
/** Entities this module has alive (debug / report). */
let alive = 0


// MARK: install / clear

/** Start the system (idempotent). Called with the terrain renderer's systems. */
export function installOasisVegetation(): void {
	if (installed) return
	installed = true
	engine.addSystem(vegSystem, undefined, 'oasisVegetationSystem')
}

/** Remove every vegetation entity and forget the plan (cycle reset, new map). */
export function clearOasisVegetation(): void {
	for (const lc of cellsByKey.values()) if (lc.e !== null) engine.removeEntity(lc.e)
	for (const g of groups.values()) if (g.merged) for (const e of g.merged) engine.removeEntity(e)
	for (const li of items) for (const e of li.parts) engine.removeEntity(e)
	for (const r of retire) engine.removeEntity(r.e)
	cellsByKey.clear()
	known.clear()
	groups.clear()
	items.length = 0
	retire.length = 0
	syncedKeys = new Set<string>()
	capSeen = 0
	alive = 0
	seenVersion = -1
}

/** Live counts (debug / perf). */
export function oasisVegetationStats(): { cells: number; items: number; entities: number } {
	return { cells: cellsByKey.size, items: items.filter((i) => i.spawned && !i.blocked).length, entities: alive }
}


// MARK: entity helpers

function newBox(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: Color4): Entity {
	const e = engine.addEntity()
	alive++
	Transform.create(e, { position: Vector3.create(x, y, z), scale: Vector3.create(sx, sy, sz) })
	MeshRenderer.setBox(e)
	paint(e, color)
	return e
}

function paint(e: Entity, color: Color4): void {
	Material.setPbrMaterial(e, { albedoColor: color, roughness: 1.0, metallic: 0.0, specularIntensity: 0.0 })
}

function newPrim(kind: 'cone' | 'trunk' | 'sphere' | 'box', color: Color4): Entity {
	const e = engine.addEntity()
	alive++
	Transform.create(e, { position: Vector3.Zero(), scale: Vector3.create(0.001, 0.001, 0.001) })
	if (kind === 'cone') MeshRenderer.setCylinder(e, 0.5, 0)
	else if (kind === 'trunk') MeshRenderer.setCylinder(e, 0.5, 0.5)
	else if (kind === 'sphere') MeshRenderer.setSphere(e)
	else MeshRenderer.setBox(e)
	paint(e, color)
	return e
}

function retireEntity(e: Entity): void {
	retire.push({ e, frames: RETIRE_FRAMES })
}

function drop(e: Entity): void {
	engine.removeEntity(e)
	alive--
}


// MARK: sync

/** Build the plan for oases that are not planned yet; reset when the entry set changed incompatibly. */
function sync(): void {
	const entries = oasisEntries()
	if (entries.length === 0) { if (cellsByKey.size > 0) clearOasisVegetation(); return }
	const map = activeTerrain()
	if (!map) return
	const keys = new Set(entries.map(vegOwnerKey))
	for (const k of syncedKeys) if (!keys.has(k)) { clearOasisVegetation(); break }
	let fresh = false
	for (const k of keys) if (!syncedKeys.has(k)) fresh = true
	if (oasisCapR() !== capSeen) fresh = true
	if (!fresh) return
	syncedKeys = keys
	capSeen = oasisCapR()
	const cells = buildVegCells(map, entries, known)
	for (const c of cells) {
		const lc: LiveCell = { c, e: null, shown: false }
		cellsByKey.set(c.key, lc)
		known.add(c.key)
		let g = groups.get(c.ownerKey)
		if (!g) { g = { key: c.ownerKey, cells: [], merged: null }; groups.set(c.ownerKey, g) }
		g.cells.push(lc)
		for (const it of c.items) items.push({ it, parts: [], spawned: false, done: false, blocked: false, shownScale: -1, coll: false })
	}
}


// MARK: keep-outs

interface Blockers { pts: Map<number, number[]> }

function buildBlockers(): Blockers {
	const pts = new Map<number, number[]>()
	const add = (x: number, z: number, r: number): void => {
		const k = Math.floor(x / 8) * 100003 + Math.floor(z / 8)
		let a = pts.get(k)
		if (!a) { a = []; pts.set(k, a) }
		a.push(x, z, r)
	}
	forEachGlowPoint((x, z) => add(x, z, VEG_PATH_CLEAR_M))
	for (const p of getPlacedFirePositions()) add(p.x, p.z, VEG_FIRE_CLEAR_M)
	return { pts }
}

function blocked(b: Blockers, x: number, z: number): boolean {
	const gx = Math.floor(x / 8)
	const gz = Math.floor(z / 8)
	for (let dz = -1; dz <= 1; dz++) {
		for (let dx = -1; dx <= 1; dx++) {
			const a = b.pts.get((gx + dx) * 100003 + (gz + dz))
			if (!a) continue
			for (let i = 0; i < a.length; i += 3) {
				const ex = x - a[i]
				const ez = z - a[i + 1]
				if (ex * ex + ez * ez < a[i + 2] * a[i + 2]) return true
			}
		}
	}
	return false
}


// MARK: item parts

function spawnParts(li: LiveItem): void {
	const it = li.it
	if (it.kind === VEG_TREE) {
		const col = PINE_COLORS[Math.min(2, Math.floor(it.s2 * 3))]
		li.parts.push(newPrim('trunk', TRUNK_COLOR), newPrim('cone', col))
		if (vegTreeHeightM(it) >= VEG_TREE_TIER_H_M) li.parts.push(newPrim('cone', col))
	} else if (it.kind === VEG_BUSH) {
		li.parts.push(newPrim('sphere', BUSH_COLORS[Math.min(2, Math.floor(it.s2 * 3))]))
	} else {
		li.parts.push(newPrim('box', ROCK_COLORS[Math.min(2, Math.floor(it.s2 * 3))]))
	}
	li.spawned = true
	li.shownScale = -1
}

function setPart(e: Entity, x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
	const tr = Transform.getMutableOrNull(e)
	if (tr === null) return
	tr.position = Vector3.create(x, y, z)
	tr.scale = Vector3.create(sx, sy, sz)
}

/** Lay the item's parts out at growth g (0..1, eased). */
function placeItem(li: LiveItem, g: number): void {
	const it = li.it
	const base = it.y + VEG_GRASS_TOP_M - 0.02
	const gg = Math.max(0.03, g)
	if (it.kind === VEG_TREE) {
		const H = vegTreeHeightM(it) * gg
		const tw = Math.max(0.05 * H, TRUNK_MIN_W_M * gg)
		setPart(li.parts[0], it.x, base + 0.11 * H, it.z, tw, 0.22 * H, tw)
		if (li.parts.length === 3) {
			setPart(li.parts[1], it.x, base + 0.14 * H + 0.26 * H, it.z, 0.36 * H, 0.52 * H, 0.36 * H)
			setPart(li.parts[2], it.x, base + 0.40 * H + 0.30 * H, it.z, 0.24 * H, 0.60 * H, 0.24 * H)
		} else {
			setPart(li.parts[1], it.x, base + 0.14 * H + 0.43 * H, it.z, 0.32 * H, 0.86 * H, 0.32 * H)
		}
	} else if (it.kind === VEG_BUSH) {
		const w = (1.0 + 1.2 * it.s0) * gg // 1.0..2.2 m wide: waist to chest high on a 1.8 m avatar
		const h = (0.6 + 0.8 * it.s1) * gg
		setPart(li.parts[0], it.x, base + h * 0.35, it.z, w, h, w)
	} else {
		const a = (0.6 + 1.0 * it.s0) * gg // boulders: knee to hip high, 0.4..1.0 m tall
		const b = (0.4 + 0.6 * it.s1) * gg
		const c = (0.5 + 0.9 * it.s2) * gg
		const e = li.parts[0]
		const tr = Transform.getMutableOrNull(e)
		if (tr === null) return
		tr.position = Vector3.create(it.x, base + b * 0.35, it.z)
		tr.scale = Vector3.create(a, b, c)
		tr.rotation = Quaternion.fromEulerDegrees(it.s1 * 10 - 5, it.yaw, it.s0 * 10 - 5)
	}
}



// MARK: colliders

/** Footprint radius (m) of the item's collider at full size (circle round the trunk / rock). */
function colliderRadiusM(it: VegItem): number {
	if (it.kind === VEG_TREE) return Math.max(0.05 * vegTreeHeightM(it), TRUNK_MIN_W_M) / 2
	const a = 0.6 + 1.0 * it.s0
	const c = 0.5 + 0.9 * it.s2
	return Math.hypot(a, c) / 2
}

/** Turn on the item's physics collider (pine trunk / rock) once grown enough and nobody stands in the spot. */
function tryEnableCollider(li: LiveItem, eased: number): void {
	const it = li.it
	if (it.kind === VEG_TREE && eased < TRUNK_COLLIDER_MIN_GROWTH) return
	const p = Transform.getOrNull(engine.PlayerEntity)
	if (p !== null) {
		const r = colliderRadiusM(it) + PLAYER_CLEAR_M
		const dy = p.position.y - it.y
		if (dy > -1 && dy < 4 && Math.hypot(p.position.x - it.x, p.position.z - it.z) < r) return // retry next tick
	}
	const e = li.parts[0]
	if (it.kind === VEG_TREE) MeshCollider.setCylinder(e, 0.5, 0.5, ColliderLayer.CL_PHYSICS)
	else MeshCollider.setBox(e, ColliderLayer.CL_PHYSICS)
	li.coll = true
}


// MARK: vegSystem

function vegSystem(dt: number): void {
	if (retire.length > 0) {
		let w = 0
		for (const r of retire) {
			r.frames--
			if (r.frames <= 0) drop(r.e)
			else retire[w++] = r
		}
		retire.length = w
	}
	const v = oasisVersion()
	// Retry while oases exist but nothing is planned yet (terrain map not ready when they registered, e.g. a late joiner).
	retryFrames++
	if (v !== seenVersion || (cellsByKey.size === 0 && retryFrames % 12 === 0 && oasisEntries().length > 0)) {
		seenVersion = v
		sync()
	}
	if (cellsByKey.size === 0) return
	acc += dt
	if (acc < VEG_TICK_S) return
	acc = 0
	const now = Date.now()
	let budget = VEG_BUDGET_PER_TICK

	mergeDueGroups(now)
	budget = growGrass(now, budget)

	let blockers: Blockers | null = null

	for (const li of items) {
		if (li.blocked) continue
		const g = vegGrowth(li.it, now)
		if (!li.spawned) {
			if (g <= 0 || budget <= 0) continue
			if (blockers === null) blockers = buildBlockers()
			if (blocked(blockers, li.it.x, li.it.z)) { li.blocked = true; continue }
			spawnParts(li)
			budget -= li.parts.length
		}
		if (!li.spawned) continue
		const eased = g * g * (3 - 2 * g)
		if (!li.coll && li.it.kind !== VEG_BUSH) tryEnableCollider(li, eased)
		if (li.done) continue
		if (Math.abs(eased - li.shownScale) < 0.01 && g < 1) continue
		li.shownScale = eased
		placeItem(li, eased)
		if (g >= 1) li.done = true
	}
}


// MARK: grass

function growGrass(now: number, budgetIn: number): number {
	let budget = budgetIn
	for (const g of groups.values()) {
		if (g.merged !== null) continue
		for (const lc of g.cells) {
			if (budget <= 0) return budget
			const c = lc.c
			if (lc.shown || c.shade === 0 || now < c.grassMs) continue
			lc.e = newBox(c.x, c.y + (VEG_GRASS_TOP_M - 0.01) / 2, c.z, OASIS_CELL_M, VEG_GRASS_TOP_M + 0.01, OASIS_CELL_M, GRASS_COLORS[c.shade - 1])
			lc.shown = true
			budget--
		}
	}
	return budget
}

/** Oases whose grass is all due become greedy-merged rectangles (late joiners skip the per-cell phase entirely). */
function mergeDueGroups(now: number): void {
	for (const g of groups.values()) {
		if (g.merged !== null) continue
		let due = true
		for (const lc of g.cells) if (lc.c.shade !== 0 && now < lc.c.grassMs) { due = false; break }
		if (!due) continue
		const merged: Entity[] = []
		for (const r of mergeGrassRects(g.cells.map((lc) => lc.c))) {
			// Each rectangle covers cells of ONE floor Y only (mergeGrassRects), so it sits at its own terrace height.
			merged.push(newBox(r.x, r.y + (VEG_GRASS_TOP_M - 0.01) / 2, r.z, r.sx, VEG_GRASS_TOP_M + 0.01, r.sz, GRASS_COLORS[r.shade - 1]))
		}
		// New rectangles are up; the per-cell slabs go a couple of frames later (no frame without grass).
		for (const lc of g.cells) { if (lc.e !== null) { retireEntity(lc.e); lc.e = null } lc.shown = true }
		g.merged = merged
	}
}