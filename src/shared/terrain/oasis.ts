/**
 * oasis.ts - permanently thawed "oasis" circles around released crystals
 * (floating-crystals ruleset). Pure registry + cell math, shared by the
 * client (terrain renderer, vegetation, object re-seating) and the server
 * (ground Y queries), so both agree on where the terrain cap is gone.
 *
 * The terrain cap (terrainRenderer CAP_M thick, melt-blue, on top of every
 * rock slab) is one walkable step. Inside an oasis the cap is removed and the
 * earth under it shows, OASIS_DROP_M lower. The oasis is a blocky circle of
 * OASIS_CELL_M cells, only on the monument's own terrain level, never on the
 * monument's own pit square. The hearth is not special: its cell melts like any other and the hearth objects re-seat
 * (client/hearthSeat.ts).
 *
 * Timing (all derived from the release time, so late joiners see the same state):
 *  1. The release burst (heat front) melts only the middle OASIS_INNER_M instantly.
 *  2. From the end of the burst (`meltStartMs`) the remaining caps melt outward over
 *     OASIS_MELT_S, ring by ring (OASIS_BAND_M rings) with a per-cell irregular edge
 *     (OASIS_JITTER_M), until the full OASIS_RADIUS_M circle is open.
 * Released oases are never removed until oasisClear (cycle reset / new map).
 *
 * Overlaps are a plain union: a cell is lowered if ANY entry lowers it (the drop
 * is a constant step, so there is nothing to add up).
 */

import { CRYSTAL_HEAT_RADIUS_M, CRYSTAL_THAW_DELAY_S, CRYSTAL_THAW_SPREAD_S } from 'src/shared/ruleset'
import {
	MONUMENT_PIT_SIZE_M,
	TERRAIN_ORIGIN_M,
	TerrainMap,
	groundYAtWorld,
	isLavaAtWorld,
	levelAtWorld,
} from 'src/shared/terrain/terrainMap'

/** Edge of one oasis cell (m). Divides the 16 m terrain cell; 4 m = ~490 cells per oasis (blocky, mobile-cheap). */
export const OASIS_CELL_M = 4
/** Reveal rings (m): the lowered area grows in steps of this width as the melt passes. */
export const OASIS_BAND_M = 4
/** How far the earth floor sits below the old walkable top (m). Under DCL_MAX_AUTO_STEP_M (0.3). */
export const OASIS_DROP_M = 0.27
/** Oasis radius (m) on cell centres: the heat radius minus half a cell diagonal, so a cell never reaches past the melted snow disc. */
export const OASIS_RADIUS_M = CRYSTAL_HEAT_RADIUS_M - OASIS_CELL_M * Math.SQRT1_2
/** Radius (m) the release burst melts instantly (the middle section). */
export const OASIS_INNER_M = 12
/** Seconds the rest of the caps take to melt outward after the burst. */
export const OASIS_MELT_S = 90
/** Per-cell irregularity (m, +/-) of the outward melt edge. */
export const OASIS_JITTER_M = 3
/** Ms after the server release at which the burst is over and the outward melt starts. */
export const OASIS_MELT_DELAY_MS = (CRYSTAL_THAW_DELAY_S + CRYSTAL_THAW_SPREAD_S) * 1000

export interface OasisEntry {
	x     : number
	z     : number
	level : number
	/** Radius (m) reached so far (burst, then timed melt); Infinity = fully open. */
	reveal: number
	/** Local epoch ms when the outward melt starts. -Infinity = already complete. */
	meltStartMs: number
}

let entries: OasisEntry[] = []
/** Map the entries' levels came from (the listener `was` callback has no map argument). */
let mapRef: TerrainMap | null = null
let version = 0
type Listener = (wasLowered: (x: number, z: number) => boolean) => void
const listeners: Listener[] = []
/** Server release times (local epoch ms) noted per monument position before the oasis registers. */
let notes: Array<{ x: number; z: number; ms: number }> = []


// MARK: hash

/** Small deterministic 32-bit hash of up to four integers (unsigned result). */
export function oasisHash(a: number, b: number, c: number = 0, d: number = 0): number {
	let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1) ^ Math.imul(d | 0, 0x85ebca6b)
	h ^= h >>> 15
	h = Math.imul(h, 0x2c1b3c6d)
	h ^= h >>> 12
	h = Math.imul(h, 0x297a2d39)
	h ^= h >>> 15
	return h >>> 0
}

/** oasisHash scaled to [0, 1). */
export function oasisHash01(a: number, b: number, c: number = 0, d: number = 0): number {
	return oasisHash(a, b, c, d) / 4294967296
}


// MARK: registry

/** Increments on every change (release, reveal ring, clear). */
export function oasisVersion(): number { return version }

/** Live entries (read only). */
export function oasisEntries(): readonly OasisEntry[] { return entries }

/** True when at least one crystal has an oasis registered. */
export function oasisAny(): boolean { return entries.length > 0 }

function findAt<T extends { x: number; z: number }>(list: readonly T[], x: number, z: number): T | undefined {
	for (const e of list) if (Math.abs(e.x - x) < 0.5 && Math.abs(e.z - z) < 0.5) return e
	return undefined
}

/** Reveal radius quantised to rings: the only value that changes what is lowered. */
export function oasisQuantReveal(r: number): number {
	if (!(r > 0)) return 0
	if (r >= OASIS_RADIUS_M) return OASIS_RADIUS_M
	return Math.floor(r / OASIS_BAND_M) * OASIS_BAND_M
}

function notify(prev: OasisEntry[]): void {
	version++
	if (listeners.length === 0) return
	const was = (x: number, z: number): boolean => loweredWith(prev, null, x, z)
	for (const l of listeners) l(was)
}

function snapshot(): OasisEntry[] { return entries.map((e) => ({ ...e })) }

/** Radius (m) the timed outward melt has reached at local epoch `nowMs` (0 before it starts, Infinity once done). */
export function oasisTimedReveal(meltStartMs: number, nowMs: number): number {
	const t = (nowMs - meltStartMs) / 1000
	if (!(t > 0)) return 0
	if (t >= OASIS_MELT_S) return Number.POSITIVE_INFINITY
	return OASIS_INNER_M + (OASIS_RADIUS_M - OASIS_INNER_M) * (t / OASIS_MELT_S)
}

/** Note when monument (x, z) was released (local epoch ms). Call before oasisRelease; the earliest note wins. */
export function oasisNoteRelease(x: number, z: number, releaseMs: number): void {
	const n = findAt(notes, x, z)
	if (n) n.ms = Math.min(n.ms, releaseMs)
	else notes.push({ x, z, ms: releaseMs })
}

/**
 * Register a released crystal's oasis at its station centre (x, z). `burst` is the release burst's
 * reveal so far (0 = just started, Infinity = finished / hydrated); it never opens more than OASIS_INNER_M.
 * The outward melt is timed from the noted release (oasisNoteRelease); with no note a fresh burst starts
 * the melt now, and a hydrated one is taken as already complete. Existing entries only ever grow.
 */
export function oasisRelease(map: TerrainMap, x: number, z: number, burst: number, nowMs: number = Date.now()): void {
	const prev = snapshot()
	mapRef = map
	const b = Math.min(burst, OASIS_INNER_M)
	let e = findAt(entries, x, z)
	if (!e) {
		const note = findAt(notes, x, z)
		const meltStartMs = note ? note.ms + OASIS_MELT_DELAY_MS : (burst === Number.POSITIVE_INFINITY ? Number.NEGATIVE_INFINITY : nowMs + CRYSTAL_THAW_SPREAD_S * 1000)
		e = { x, z, level: levelAtWorld(map, x, z), reveal: 0, meltStartMs }
		entries.push(e)
	}
	const timed = oasisTimedReveal(e.meltStartMs, nowMs)
	const target = Math.max(b, timed)
	if (oasisQuantReveal(target) <= oasisQuantReveal(e.reveal) && entries.length === prev.length) { e.reveal = Math.max(e.reveal, target); return }
	e.reveal = Math.max(e.reveal, target)
	notify(prev)
}

function growTo(e: OasisEntry, r: number): void {
	if (oasisQuantReveal(r) <= oasisQuantReveal(e.reveal)) { e.reveal = Math.max(e.reveal, r); return }
	const prev = snapshot()
	e.reveal = r
	notify(prev)
}

/** Burst (heat front) progress of the oasis at (x, z): opens at most OASIS_INNER_M. Notifies only when a ring completes. */
export function oasisSetBurstReveal(x: number, z: number, reveal: number): void {
	const e = findAt(entries, x, z)
	if (e) growTo(e, Math.min(reveal, OASIS_INNER_M))
}

/** Advance every oasis's timed outward melt to local epoch `nowMs`. Cheap when nothing changes; call every frame / tick. */
export function oasisTick(nowMs: number): void {
	for (const e of entries) {
		if (e.reveal === Number.POSITIVE_INFINITY) continue
		const r = oasisTimedReveal(e.meltStartMs, nowMs)
		if (r > 0) growTo(e, r)
	}
}

/** Drop every oasis (cycle reset, new map). */
export function oasisClear(): void {
	notes = []
	if (entries.length === 0) return
	const prev = snapshot()
	entries = []
	notify(prev)
}

/**
 * Call `fn` whenever the lowered area changes. `wasLowered(x, z)` answers for the state just before the change, so
 * an object can shift by oasisDeltaY(map, x, z, wasLowered).
 */
export function onOasisChanged(fn: Listener): void { listeners.push(fn) }


// MARK: cell math

/** Index of the oasis cell holding coordinate v. */
export function oasisCellIndex(v: number): number {
	return Math.floor((v - TERRAIN_ORIGIN_M) / OASIS_CELL_M)
}

/** Centre (x or z) of oasis cell index k. */
export function oasisCellCentre(k: number): number {
	return TERRAIN_ORIGIN_M + (k + 0.5) * OASIS_CELL_M
}

function cellCentre(v: number): number {
	return oasisCellCentre(oasisCellIndex(v))
}

/** Reveal radius (m) a cell at distance d from entry `e` needs before it melts: inner cells melt with the burst, the rest at an irregular ring. */
function cellNeed(e: OasisEntry, ix: number, iz: number, d: number): number {
	if (d <= OASIS_INNER_M) return d
	const jit = (oasisHash01(ix, iz, Math.round(e.x * 4), Math.round(e.z * 4)) - 0.5) * 2 * OASIS_JITTER_M
	return Math.min(OASIS_RADIUS_M, Math.max(OASIS_INNER_M + 0.01, d - jit))
}

/** True when this entry can ever lower the cell holding (x, z); fills `out` with its distance + need. */
function cellOf(e: OasisEntry, map: TerrainMap | null, x: number, z: number): number {
	// Returns the radius needed (m) or Infinity when this entry never lowers the cell.
	const ix = oasisCellIndex(x)
	const iz = oasisCellIndex(z)
	const cx = oasisCellCentre(ix)
	const cz = oasisCellCentre(iz)
	const half = MONUMENT_PIT_SIZE_M / 2
	if (Math.abs(x - e.x) < half && Math.abs(z - e.z) < half) return Number.POSITIVE_INFINITY // the monument pit square keeps its height
	const dx = cx - e.x
	const dz = cz - e.z
	const d = Math.sqrt(dx * dx + dz * dz)
	if (d > OASIS_RADIUS_M) return Number.POSITIVE_INFINITY
	const m = map ?? mapRef
	if (m && (levelAtWorld(m, cx, cz) !== e.level || isLavaAtWorld(m, cx, cz))) return Number.POSITIVE_INFINITY
	return cellNeed(e, ix, iz, d)
}

function loweredWith(list: readonly OasisEntry[], map: TerrainMap | null, x: number, z: number): boolean {
	if (list.length === 0) return false
	for (const e of list) {
		const rq = oasisQuantReveal(e.reveal)
		if (rq <= 0) continue
		if (cellOf(e, map, x, z) <= rq) return true
	}
	return false
}


/** True when the terrain cap is gone at world (x, z): inside the revealed part of a released oasis. */
export function oasisLoweredAt(map: TerrainMap, x: number, z: number): boolean {
	if (entries.length === 0) return false
	return loweredWith(entries, map, x, z)
}

/**
 * Local epoch ms at which the cell holding (x, z) is (or was) melted, from the entries' timing alone:
 * Infinity = never (other level, lava, pit, outside), -Infinity = already open for good.
 * Agrees with oasisLoweredAt as the clock passes it (tested in oasisCheck).
 */
export function oasisCellExposeMs(map: TerrainMap, x: number, z: number): number {
	return oasisCellInfo(map, x, z).ms
}

/** Which entry (the first to melt the cell) owns the cell holding (x, z), when it melts, and its centre distance to that entry. */
export function oasisCellInfo(map: TerrainMap, x: number, z: number): { ms: number; entry: OasisEntry | null; d: number } {
	let best = Number.POSITIVE_INFINITY
	let owner: OasisEntry | null = null
	let ownerD = 0
	if (entries.length === 0) return { ms: best, entry: null, d: 0 }
	const cx = cellCentre(x)
	const cz = cellCentre(z)
	for (const e of entries) {
		const need = cellOf(e, map, x, z)
		if (need === Number.POSITIVE_INFINITY) continue
		let ms: number
		if (e.meltStartMs === Number.NEGATIVE_INFINITY) ms = Number.NEGATIVE_INFINITY
		else if (need <= OASIS_INNER_M) ms = e.meltStartMs
		else {
			const reqR = Math.min(OASIS_RADIUS_M, Math.ceil(need / OASIS_BAND_M) * OASIS_BAND_M)
			ms = e.meltStartMs + ((reqR - OASIS_INNER_M) / (OASIS_RADIUS_M - OASIS_INNER_M)) * OASIS_MELT_S * 1000
		}
		// Earliest melt wins; ties (e.g. both already open) go to the nearer monument, then the earlier entry.
		const d = Math.hypot(cx - e.x, cz - e.z)
		if (owner === null || ms < best || (ms === best && d < ownerD)) { best = ms; owner = e; ownerD = d }
	}
	return { ms: best, entry: owner, d: ownerD }
}

/** Metres the floor at (x, z) sits below the cap top: OASIS_DROP_M inside an oasis, else 0. */
export function oasisDropAt(map: TerrainMap, x: number, z: number): number {
	return oasisLoweredAt(map, x, z) ? OASIS_DROP_M : 0
}

/** Y change (m) for an object at (x, z) after an oasis change, given the `wasLowered` callback. Negative = moves down. */
export function oasisDeltaY(map: TerrainMap, x: number, z: number, wasLowered: (x: number, z: number) => boolean): number {
	const now = oasisLoweredAt(map, x, z) ? OASIS_DROP_M : 0
	const was = wasLowered(x, z) ? OASIS_DROP_M : 0
	return was - now
}

/** Walkable surface height including oasis lowering. Use at runtime; layout generation keeps groundYAtWorld. */
export function walkableYAtWorld(map: TerrainMap, x: number, z: number): number {
	return groundYAtWorld(map, x, z) - oasisDropAt(map, x, z)
}