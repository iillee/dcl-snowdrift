/**
 * fireNetworkGlow.ts (client) — soft warm line along fire-network paths.
 *
 * Mirrors fireLinkState from the server and re-routes each link with the
 * shared routeFireLink, so the glow sits exactly on the melted cells.
 * Each route is cut into <= GLOW_PIECE_M pieces (one thin emissive box
 * each, no collider, no shadow). Pieces grow in outward from both fires
 * in step with the server melt, and shrink away from the dead end when a
 * link breaks. Pieces beyond NETWORK_GLOW_DRAW_DIST_M of the player hide.
 */

import { engine, Entity, Material, MeshRenderer, Transform } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'

import {
	FIRE_NETWORK_DEBUG,
	NETWORK_GLOW_DRAW_DIST_M,
	NETWORK_GLOW_FADE_S,
	NETWORK_GLOW_LIFT_M,
	NETWORK_GLOW_STYLE,
	NETWORK_TILE_BAND_M,
	NETWORK_PATH_WARM_ENABLED,
	NETWORK_PATH_WARM_RADIUS_M,
	NETWORK_TILE_FIRE_CLEAR_M,
	NETWORK_TILE_SCALE_S,
	NETWORK_TILE_INSET_M,
	NETWORK_TILE_LIFT_M,
	NETWORK_TILE_MERGE_MAX,
	NETWORK_TILE_THICK_M,
	rasterizeRuns,
	NETWORK_GLOW_WIDTH_M,
	NETWORK_MELT_S,
	NETWORK_REFREEZE_S,
	linkKey,
	routeFireLink,
} from 'src/shared/fireNetwork'
import { room } from 'src/shared/messages'
import { activeTerrain } from 'src/shared/terrain/terrainCache'
import { TerrainMap, groundYAtWorld } from 'src/shared/terrain/terrainMap'
import { SNOW_CELL_M, cellCenterWorld as snowCellCenter, cellCoordsFromKey, cellKey, forEachCellInDisc } from 'src/shared/snowGrid'
import { onCycleSeedChange } from 'src/client/cycle'


// MARK: Tuning
/** Longest single glow box (m). Fewer, longer pieces = fewer entities. */
const GLOW_PIECE_M     = 16
/** Box height (m). */
const GLOW_THICK_M     = 0.03
const GLOW_COLOR       = Color4.create(1, 0.62, 0.22, 1)
const GLOW_EMISSIVE    = Color3.create(1, 0.5, 0.12)
const GLOW_EMISSIVE_I  = 1.6
/** LOD check cadence (s). */
const GLOW_LOD_S       = 0.5


interface Piece { e: Entity; t: number; sx: number; sy: number; sz: number; pos: Vector3; shown: number; visible: boolean }
interface GlowLink { a: number; b: number; state: number; t0Ms: number; deadA: boolean; deadB: boolean; L: number; pieces: Piece[]; warm: Map<number, number> }

const glow = new Map<string, GlowLink>()
let lodClock = 0
let installed = false


/** Cell key -> links whose glow band covers it (heat-path warmth lookup). */
const warmIndex = new Map<number, Set<GlowLink>>()

/** True when this link's band at distance t (m from fire A) is currently glowing (melted in, not yet retreated). */
function shownAt(l: GlowLink, t: number, now: number): boolean {
	const age = (now - l.t0Ms) / 1000
	if (l.state === 1) return Math.min(t, l.L - t) <= (l.L / 2) * Math.min(1, age / NETWORK_MELT_S)
	const u = Math.min(1, age / NETWORK_REFREEZE_S)
	const fromDead = l.deadA && l.deadB ? Math.min(t, l.L - t) / (l.L / 2) : l.deadA ? t / l.L : (l.L - t) / l.L
	return fromDead > u
}

/** Heat path: is world (x, z) within NETWORK_PATH_WARM_RADIUS_M of a glowing path cell? */
export function isOnHeatPath(x: number, z: number): boolean {
	if (!NETWORK_PATH_WARM_ENABLED || warmIndex.size === 0) return false
	const now = Date.now()
	let hit = false
	forEachCellInDisc(x, z, NETWORK_PATH_WARM_RADIUS_M + SNOW_CELL_M / 2, (key) => {
		if (hit) return
		const ls = warmIndex.get(key)
		if (!ls) return
		for (const l of ls) { if (shownAt(l, l.warm.get(key)!, now)) { hit = true; return } }
	})
	return hit
}

/** Live glow entities (debug / perf). */
export function getGlowEntityCount(): number {
	let n = 0
	for (const l of glow.values()) n += l.pieces.length
	return n
}

function addBox(pos: Vector3, yaw: number, sx: number, sy: number, sz: number, t: number, out: Piece[]): void {
	const e = engine.addEntity()
	Transform.create(e, { position: pos, rotation: Quaternion.fromEulerDegrees(0, yaw, 0), scale: Vector3.create(0, sy, 0) })
	MeshRenderer.setBox(e)
	Material.setPbrMaterial(e, {
		albedoColor: GLOW_COLOR, emissiveColor: GLOW_EMISSIVE, emissiveIntensity: GLOW_EMISSIVE_I,
		roughness: 1, metallic: 0, castShadows: false,
	})
	out.push({ e, t, sx, sy, sz, pos, shown: 0, visible: true })
}

/**
 * Tile style: snow cells within NETWORK_TILE_BAND_M of the centreline,
 * grouped into row runs of up to NETWORK_TILE_MERGE_MAX cells (one box
 * each, inset so the grid gaps read). Each box animates on its smallest t.
 */
function buildTiles(map: TerrainMap, runs: Parameters<typeof rasterizeRuns>[1], ends: { x: number; z: number }[]): Piece[] {
	const cells = rasterizeRuns(map, runs, NETWORK_TILE_BAND_M)
	const byKey = new Map<number, number>()
	const clear2 = NETWORK_TILE_FIRE_CLEAR_M * NETWORK_TILE_FIRE_CLEAR_M
	for (const c of cells) {
		// Keep the pit / log pile clear: the path starts just outside the fire.
		const w = snowCellCenter(c.key)
		if (ends.some((e) => (w.x - e.x) ** 2 + (w.z - e.z) ** 2 < clear2)) continue
		byKey.set(c.key, c.t)
	}
	const done = new Set<number>()
	const out: Piece[] = []
	const keys = [...byKey.keys()].sort((a, b) => a - b)
	for (const k of keys) {
		if (done.has(k)) continue
		const { gx, gz } = cellCoordsFromKey(k)
		let n = 1
		let tMin = byKey.get(k)!
		while (n < NETWORK_TILE_MERGE_MAX) {
			const nk = cellKey(gx + n, gz)
			if (!byKey.has(nk) || done.has(nk)) break
			tMin = Math.min(tMin, byKey.get(nk)!)
			n++
		}
		for (let i = 0; i < n; i++) done.add(cellKey(gx + i, gz))
		const c0 = snowCellCenter(k)
		const x = c0.x + (n - 1) * SNOW_CELL_M / 2
		const y = groundYAtWorld(map, c0.x, c0.z) + NETWORK_TILE_LIFT_M + NETWORK_TILE_THICK_M / 2
		addBox(Vector3.create(x, y, c0.z), 0, n * SNOW_CELL_M - NETWORK_TILE_INSET_M, NETWORK_TILE_THICK_M, SNOW_CELL_M - NETWORK_TILE_INSET_M, tMin, out)
	}
	return out
}


/** Distinct fires in held links (help panel). */
export function getLinkedFireCount(): number {
	const ids = new Set<number>()
	for (const l of glow.values()) if (l.state === 1) { ids.add(l.a); ids.add(l.b) }
	return ids.size
}


function removeLink(k: string): void {
	const l = glow.get(k)
	if (!l) return
	for (const p of l.pieces) engine.removeEntity(p.e)
	for (const key of l.warm.keys()) { const s = warmIndex.get(key); if (s) { s.delete(l); if (s.size === 0) warmIndex.delete(key) } }
	glow.delete(k)
}


function buildPieces(ax: number, az: number, bx: number, bz: number, a: number, b: number): { L: number; pieces: Piece[]; warm: Map<number, number> } | null {
	const map = activeTerrain()
	if (!map) return null
	const r = routeFireLink(map, { id: a, x: ax, z: az }, { id: b, x: bx, z: bz })
	if (!r) return null
	if (NETWORK_GLOW_STYLE === 'tiles') {
		const pieces = buildTiles(map, r.runs, [{ x: ax, z: az }, { x: bx, z: bz }])
		if (FIRE_NETWORK_DEBUG) console.log(`fireNetworkGlow: ${linkKey(a, b)} ${pieces.length} tile boxes`)
		return { L: Math.max(1, r.lengthM), pieces, warm: bandCells(map, r.runs) }
	}
	const pieces: Piece[] = []
	let t0 = 0
	for (const run of r.runs) {
		for (let k = 1; k < run.pts.length; k++) {
			const p = run.pts[k - 1], q = run.pts[k]
			const L = Math.hypot(q.x - p.x, q.z - p.z)
			const n = Math.max(1, Math.ceil(L / GLOW_PIECE_M))
			const yaw = Math.atan2(q.x - p.x, q.z - p.z) * 180 / Math.PI
			for (let s = 0; s < n; s++) {
				const u = (s + 0.5) / n
				const x = p.x + (q.x - p.x) * u, z = p.z + (q.z - p.z) * u
				const y = groundYAtWorld(map, x, z) + NETWORK_GLOW_LIFT_M
				addBox(Vector3.create(x, y, z), yaw, NETWORK_GLOW_WIDTH_M, GLOW_THICK_M, L / n, t0 + L * u, pieces)
			}
			t0 += L
		}
	}
	return { L: Math.max(1, r.lengthM), pieces, warm: bandCells(map, r.runs) }
}

function bandCells(map: TerrainMap, runs: Parameters<typeof rasterizeRuns>[1]): Map<number, number> {
	const m = new Map<number, number>()
	for (const c of rasterizeRuns(map, runs, NETWORK_TILE_BAND_M)) m.set(c.key, c.t)
	return m
}


function onLinkState(m: { a: number; b: number; ax: number; az: number; bx: number; bz: number; state: number; ageMs: number; deadA: number; deadB: number }): void {
	const k = linkKey(m.a, m.b)
	let l = glow.get(k)
	if (!l) {
		const built = buildPieces(m.ax, m.az, m.bx, m.bz, m.a, m.b)
		if (!built) { if (FIRE_NETWORK_DEBUG) console.log(`fireNetworkGlow: ${k} no route on client`); return }
		l = { a: m.a, b: m.b, state: m.state, t0Ms: 0, deadA: false, deadB: false, L: built.L, pieces: built.pieces, warm: built.warm }
		glow.set(k, l)
		for (const key of l.warm.keys()) { let s = warmIndex.get(key); if (!s) { s = new Set(); warmIndex.set(key, s) } s.add(l) }
	}
	l.state = m.state
	l.t0Ms = Date.now() - Math.max(0, m.ageMs)
	l.deadA = m.deadA === 1
	l.deadB = m.deadB === 1
	if (FIRE_NETWORK_DEBUG) console.log(`fireNetworkGlow: ${k} state=${m.state} age=${m.ageMs} pieces=${l.pieces.length}`)
}


function tick(dt: number): void {
	lodClock += dt
	const lod = lodClock >= GLOW_LOD_S
	if (lod) lodClock = 0
	const me = Transform.getOrNull(engine.PlayerEntity)?.position
	const now = Date.now()
	// Each tile eases 0 <-> 1 over NETWORK_TILE_SCALE_S, scaled from its centre.
	const stepK = dt / Math.max(0.05, NETWORK_GLOW_STYLE === 'tiles' ? NETWORK_TILE_SCALE_S : NETWORK_GLOW_FADE_S / 3)
	for (const [k, l] of glow) {
		const age = (now - l.t0Ms) / 1000
		let allGone = l.state === 0
		for (const p of l.pieces) {
			let want: number
			if (l.state === 1) {
				const reach = (l.L / 2) * Math.min(1, age / NETWORK_MELT_S)
				want = Math.min(p.t, l.L - p.t) <= reach ? 1 : 0
			} else {
				const u = Math.min(1, age / NETWORK_REFREEZE_S)
				const fromDead = l.deadA && l.deadB ? Math.min(p.t, l.L - p.t) / (l.L / 2) : l.deadA ? p.t / l.L : (l.L - p.t) / l.L
				want = fromDead <= u ? 0 : 1
			}
			if (lod && me) p.visible = Math.hypot(p.pos.x - me.x, p.pos.z - me.z) <= NETWORK_GLOW_DRAW_DIST_M
			const target = p.visible ? want : 0
			const prev = p.shown
			p.shown = target > p.shown ? Math.min(target, p.shown + stepK) : Math.max(target, p.shown - stepK)
			if (p.shown > 0 || want > 0) allGone = false
			if (p.shown !== prev) {
				const t = Transform.getMutable(p.e)
				const k = 1 - (1 - p.shown) * (1 - p.shown) // ease-out
				t.scale = Vector3.create(p.sx * k, p.sy * k, p.sz * k)
			}
		}
		if (allGone) removeLink(k)
	}
}


export function setupFireNetworkGlow(): void {
	if (installed) return
	installed = true
	room.onMessage('fireLinkState', (m) => onLinkState(m))
	let failed = false
	engine.addSystem((dt: number) => {
		if (failed) return
		try { tick(dt) } catch (err) { failed = true; console.error('fireNetworkGlow: DISABLED after error', err) }
	})
	onCycleSeedChange(() => { for (const k of [...glow.keys()]) removeLink(k) })
	console.log('fireNetworkGlow: installed')
}
