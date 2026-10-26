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
	NETWORK_CUBE_BOB_DIST_M,
	NETWORK_CUBE_BOB_M,
	NETWORK_CUBE_BOB_PERIOD_S,
	NETWORK_CUBE_BOB_WAVELENGTH_M,
	NETWORK_CUBE_FLOAT_M,
	NETWORK_CUBE_SIZE_M,
	NETWORK_CUBE_SPACING_M,
	NETWORK_CUBE_TILT_DEG,
	NETWORK_CUBE_SHAPE,
	NETWORK_SHARE_WAVE_COUNT,
	NETWORK_SHARE_WAVE_GAP_S,
	NETWORK_SHARE_WAVE_SCALE,
	NETWORK_SHARE_WAVE_TRAVEL_S,
	NETWORK_SHARE_WAVE_WIDTH_M,
	NETWORK_CUBE_PULSE_AMP,
	NETWORK_CUBE_PULSE_PERIOD_S,
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
	NETWORK_PATH_REFREEZE_ENABLED,
	linkKey,
	routeFireLink,
} from 'src/shared/fireNetwork'
import { room } from 'src/shared/messages'
import { activeTerrain } from 'src/shared/terrain/terrainCache'
import { TerrainMap, groundYAtWorld, levelAtWorld } from 'src/shared/terrain/terrainMap'
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


interface Piece { e: Entity; t: number; sx: number; sy: number; sz: number; pos: Vector3; shown: number; visible: boolean; bob: boolean; pulsed: boolean; wave: number; waveApplied: number }
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
	if (!NETWORK_PATH_REFREEZE_ENABLED) return false
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

function addBox(pos: Vector3, yaw: number, sx: number, sy: number, sz: number, t: number, out: Piece[], roll = 0, sphere = false): void {
	const e = engine.addEntity()
	Transform.create(e, { position: pos, rotation: Quaternion.fromEulerDegrees(roll, yaw, roll), scale: Vector3.create(0, roll || sphere ? 0 : sy, 0) })
	if (sphere) MeshRenderer.setSphere(e)
	else MeshRenderer.setBox(e)
	Material.setPbrMaterial(e, {
		albedoColor: GLOW_COLOR, emissiveColor: GLOW_EMISSIVE, emissiveIntensity: GLOW_EMISSIVE_I,
		roughness: 1, metallic: 0, castShadows: false,
	})
	out.push({ e, t, sx, sy, sz, pos, shown: 0, visible: true, bob: false, pulsed: false, wave: 1, waveApplied: 1 })
}

/**
 * Cube style: one floating diamond cube every NETWORK_CUBE_SPACING_M along
 * the route centreline, NETWORK_CUBE_FLOAT_M above the ground. Runs are
 * already split at ladders, and cubes whose spot is off the run's level
 * (cliff face / lip) are skipped, so nothing sits on the climb.
 */
function buildCubes(map: TerrainMap, runs: Parameters<typeof rasterizeRuns>[1], ends: { x: number; z: number }[]): Piece[] {
	const out: Piece[] = []
	const clear2 = NETWORK_TILE_FIRE_CLEAR_M * NETWORK_TILE_FIRE_CLEAR_M
	const step = Math.max(0.25, NETWORK_CUBE_SPACING_M)
	const s = NETWORK_CUBE_SIZE_M
	let t0 = 0
	for (const r of runs) {
		let next = step / 2 // first cube half a step into each run
		let runT = 0
		for (let k = 1; k < r.pts.length; k++) {
			const p = r.pts[k - 1], q = r.pts[k]
			const L = Math.hypot(q.x - p.x, q.z - p.z)
			const yaw = Math.atan2(q.x - p.x, q.z - p.z) * 180 / Math.PI
			while (next <= runT + L) {
				const u = L > 0 ? (next - runT) / L : 0
				const x = p.x + (q.x - p.x) * u, z = p.z + (q.z - p.z) * u
				next += step
				if (ends.some((e) => (x - e.x) ** 2 + (z - e.z) ** 2 < clear2)) continue
				if (levelAtWorld(map, x, z) !== r.level) continue
				const y = groundYAtWorld(map, x, z) + NETWORK_CUBE_FLOAT_M
				const sph = NETWORK_CUBE_SHAPE === 'sphere'
				addBox(Vector3.create(x, y, z), yaw, s, s, s, t0 + runT + L * u, out, sph ? 0 : NETWORK_CUBE_TILT_DEG, sph)
			}
			runT += L
		}
		t0 += runT
	}
	return out
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
	if (NETWORK_GLOW_STYLE === 'cubes') {
		const pieces = buildCubes(map, r.runs, [{ x: ax, z: az }, { x: bx, z: bz }])
		if (FIRE_NETWORK_DEBUG) console.log(`fireNetworkGlow: ${linkKey(a, b)} ${pieces.length} cubes`)
		return { L: Math.max(1, r.lengthM), pieces, warm: bandCells(map, r.runs) }
	}
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
	const bobOn = NETWORK_GLOW_STYLE === 'cubes' && NETWORK_CUBE_BOB_M > 0
	const pulseOn = NETWORK_GLOW_STYLE === 'cubes' && NETWORK_CUBE_PULSE_AMP > 0
	const pulseW = (2 * Math.PI) / Math.max(0.2, NETWORK_CUBE_PULSE_PERIOD_S)
	const bobK = (2 * Math.PI) / Math.max(1, NETWORK_CUBE_BOB_WAVELENGTH_M)
	const bobW = (2 * Math.PI) / Math.max(0.2, NETWORK_CUBE_BOB_PERIOD_S)
	// Each tile eases 0 <-> 1 over NETWORK_TILE_SCALE_S, scaled from its centre.
	const stepK = dt / Math.max(0.05, NETWORK_GLOW_STYLE !== 'line' ? NETWORK_TILE_SCALE_S : NETWORK_GLOW_FADE_S / 3)
	for (const [k, l] of glow) {
		const age = (now - l.t0Ms) / 1000
		let allGone = l.state === 0
		for (const p of l.pieces) {
			let want: number
			if (l.state === 1) {
				const reach = (l.L / 2) * Math.min(1, age / NETWORK_MELT_S)
				want = Math.min(p.t, l.L - p.t) <= reach ? 1 : 0
			} else {
				const u = NETWORK_PATH_REFREEZE_ENABLED ? Math.min(1, age / NETWORK_REFREEZE_S) : 1
				const fromDead = l.deadA && l.deadB ? Math.min(p.t, l.L - p.t) / (l.L / 2) : l.deadA ? p.t / l.L : (l.L - p.t) / l.L
				want = fromDead <= u ? 0 : 1
			}
			if (lod && me) {
				const d = Math.hypot(p.pos.x - me.x, p.pos.z - me.z)
				p.visible = d <= NETWORK_GLOW_DRAW_DIST_M
				p.bob = (bobOn || pulseOn) && d <= NETWORK_CUBE_BOB_DIST_M
			}
			const target = p.visible ? want : 0
			const prev = p.shown
			p.shown = target > p.shown ? Math.min(target, p.shown + stepK) : Math.max(target, p.shown - stepK)
			if (p.shown > 0 || want > 0) allGone = false
			const pulsing = pulseOn && p.bob && p.shown > 0
			if (p.shown !== prev || pulsing || p.pulsed || p.wave !== p.waveApplied) {
				const t = Transform.getMutable(p.e)
				let k = 1 - (1 - p.shown) * (1 - p.shown) // ease-out grow/shrink
				if (pulsing) k *= 1 + NETWORK_CUBE_PULSE_AMP * Math.sin(pulseW * now / 1000 - p.t * 0.6)
				k *= p.wave // share wave swell (any distance)
				p.waveApplied = p.wave
				p.pulsed = pulsing
				t.scale = Vector3.create(p.sx * k, p.sy * k, p.sz * k)
			}
			if (bobOn && p.bob && p.shown > 0) {
				const y = p.pos.y + NETWORK_CUBE_BOB_M * Math.sin(bobW * now / 1000 - p.t * bobK)
				Transform.getMutable(p.e).position = Vector3.create(p.pos.x, y, p.pos.z)
			}
		}
		if (allGone) removeLink(k)
	}
}


// MARK: share wave
/**
 * Fuel-share feedback: a swell that runs through the EXISTING trail
 * spheres from the fed fire to each receiver (via the middle fire for 2
 * hops). Each wave only sets Piece.wave (a scale multiplier) on spheres
 * under its front; tick() multiplies it into the grow / pulse scale.
 * Overlapping waves take the max. No entities are spawned.
 */
interface WaveHit { p: Piece; s: number }
interface Wave { hits: WaveHit[]; len: number; t0: number; dur: number }
const WAVE_MAX = 32
const waves: Wave[] = []
const waveTouched = new Set<Piece>()

/** Held-link path (list of links + direction) from fire `from` to `to`, BFS. */
function linkPath(from: number, to: number): { l: GlowLink; fwd: boolean }[] | null {
	const prev = new Map<number, { id: number; l: GlowLink }>()
	const q = [from]
	const seen = new Set([from])
	while (q.length) {
		const c = q.shift()!
		if (c === to) break
		for (const l of glow.values()) {
			if (l.state !== 1) continue
			const o = l.a === c ? l.b : l.b === c ? l.a : -1
			if (o < 0 || seen.has(o)) continue
			seen.add(o); prev.set(o, { id: c, l }); q.push(o)
		}
	}
	if (!seen.has(to)) return null
	const out: { l: GlowLink; fwd: boolean }[] = []
	for (let c = to; c !== from; ) { const p = prev.get(c)!; out.unshift({ l: p.l, fwd: p.l.a === p.id }); c = p.id }
	return out
}

function onShare(m: { from: number; ids: number[] }): void {
	const now = Date.now() / 1000
	for (const to of m.ids) {
		if (to === m.from) continue
		const path = linkPath(m.from, to)
		if (!path) continue
		const hits: WaveHit[] = []
		let off = 0
		for (const h of path) {
			for (const p of h.l.pieces) hits.push({ p, s: off + (h.fwd ? p.t : h.l.L - p.t) })
			off += h.l.L
		}
		if (hits.length === 0) continue
		const dur = NETWORK_SHARE_WAVE_TRAVEL_S * path.length
		for (let i = 0; i < Math.max(1, NETWORK_SHARE_WAVE_COUNT) && waves.length < WAVE_MAX; i++) {
			waves.push({ hits, len: off, t0: now + i * NETWORK_SHARE_WAVE_GAP_S, dur })
		}
	}
}

function tickWaves(): void {
	if (waves.length === 0 && waveTouched.size === 0) return
	for (const p of waveTouched) p.wave = 1
	waveTouched.clear()
	const now = Date.now() / 1000
	const W = Math.max(0.1, NETWORK_SHARE_WAVE_WIDTH_M)
	const peak = NETWORK_SHARE_WAVE_SCALE - 1
	for (let i = waves.length - 1; i >= 0; i--) {
		const w = waves[i]
		const u = (now - w.t0) / w.dur
		if (u < 0) continue
		// Front runs from -W to len + W so the swell enters and leaves fully.
		const front = -W + u * (w.len + 2 * W)
		if (front > w.len + W) { waves.splice(i, 1); continue }
		for (const h of w.hits) {
			const d = Math.abs(h.s - front)
			if (d >= W) continue
			const m = 1 + peak * 0.5 * (1 + Math.cos(Math.PI * d / W))
			if (m > h.p.wave) h.p.wave = m
			waveTouched.add(h.p)
		}
	}
}

function clearWaves(): void {
	waves.length = 0
	for (const p of waveTouched) p.wave = 1
	waveTouched.clear()
}

export function setupFireNetworkGlow(): void {
	if (installed) return
	installed = true
	room.onMessage('fireLinkState', (m) => onLinkState(m))
	room.onMessage('fireNetworkShare', (m) => { try { onShare(m) } catch (err) { console.error('fireNetworkGlow: share burst error', err) } })
	let failed = false
	engine.addSystem((dt: number) => {
		if (failed) return
		try { tickWaves(); tick(dt) } catch (err) { failed = true; console.error('fireNetworkGlow: DISABLED after error', err) }
	})
	onCycleSeedChange(() => { clearWaves(); for (const k of [...glow.keys()]) removeLink(k) })
	console.log('fireNetworkGlow: installed')
}
