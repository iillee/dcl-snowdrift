/**
 * oasis.ts - permanently thawed "oasis" circles around released crystals
 * (floating-crystals ruleset). Pure registry + cell math, shared by the
 * client (terrain renderer, vegetation, object re-seating) and the server
 * (ground Y queries), so both agree on where the terrain cap is gone.
 *
 * The terrain cap (terrainRenderer CAP_M thick, melt-blue, on top of every
 * rock slab) is one walkable step. Inside an oasis the cap is removed and the
 * earth under it shows, OASIS_DROP_M lower. The oasis is a blocky circle of
 * OASIS_CELL_M cells on EVERY walkable terrace within reach (each cell keeps its own terrace height; cliff walls are
 * untouched; melt timing is by horizontal distance), never on lava or the volcano crown (mountain wall blocks inside the circle melt like terraces), never on the
 * monument's own pit square. The hearth is not special: its cell melts like any other and the hearth objects re-seat
 * (client/hearthSeat.ts).
 *
 * Timing (all derived from the release time, so late joiners see the same state):
 *  1. The release burst (heat front) melts only the middle OASIS_INNER_M instantly.
 *  2. From the end of the burst (`meltStartMs`) the remaining caps melt outward over
 *     OASIS_MELT_S, ring by ring (OASIS_BAND_M rings) with a per-cell irregular edge
 *     (OASIS_JITTER_M), until the ragged OASIS_RADIUS_M (+/- OASIS_JITTER_M) patch is open; the caps beyond stay frozen for good.
 * Released oases are never removed until oasisClear (cycle reset / new map).
 *  3. FINALE PULSE (optional, one time per cycle): once the ending schedules its pulse (oasisSetFinalePulse) every oasis
 *     keeps opening OUTWARD from where it is (the first patch, or for a still-melting oasis its current radius) to the larger
 *     ragged OASIS_FINALE_RADIUS_M (+/- OASIS_JITTER_M) patch, GRADUALLY over OASIS_FINALE_MELT_S (~60 s, like the first oasis),
 *     with the same jitter / cell / ring rules (cells beyond OASIS_RADIUS_M simply have a later melt time). The SNOW melts much
 *     faster than this (finale.ts FINALE_PULSE_S); only the permafrost cap / earth / plants follow the slow clock.
 *
 * Overlaps are a plain union: a cell is lowered if ANY entry lowers it (the drop
 * is a constant step, so there is nothing to add up).
 */

import { isCrownLevel, isMountainLevel } from 'src/shared/settings'
import { CRYSTAL_HEAT_RADIUS_M, CRYSTAL_THAW_DELAY_S, CRYSTAL_THAW_SPREAD_S } from 'src/shared/ruleset'
import {
	MONUMENT_PIT_SIZE_M,
	TERRAIN_ORIGIN_M,
	TerrainMap,
	cellCenterWorld,
	groundYAtWorld,
	isLavaAtWorld,
	levelAtWorld,
} from 'src/shared/terrain/terrainMap'

/**
 * Levels an oasis never touches: the volcano crown (and lava, checked per cell). The impassable mountain band / peak blocks
 * (levels MOUNTAIN..MOUNTAIN_MAX) DO melt: they are walls with a flat top inside the circle, so they get a cap and an earth floor like a terrace.
 */
export function oasisExcludedLevel(level: number): boolean {
	return isMountainLevel(level) && isCrownLevel(level)
}

/**
 * True when the terrain renderer gives this rect a melt cap: every walkable terrace, plus mountain wall blocks an oasis can reach (never the
 * crown). A mountain rect WITHOUT a cap cannot melt, so it would stay bare blue rock inside the oasis circle (oasisCheck asserts no lowered
 * cell ever sits in an uncapped rect). Shared so the renderer and the check use one rule.
 */
export function oasisRectHasCap(map: TerrainMap, level: number, cx: number, cz: number, sx: number, sz: number): boolean {
	if (!isMountainLevel(level)) return true
	if (oasisExcludedLevel(level)) return false
	const reach = OASIS_FINALE_REACH_M + OASIS_CELL_M
	for (const st of map.stations) {
		const p = cellCenterWorld(st.cx, st.cz)
		const dx = Math.max(Math.abs(p.x - cx) - sx / 2, 0), dz = Math.max(Math.abs(p.z - cz) - sz / 2, 0)
		if (dx * dx + dz * dz <= reach * reach) return true
	}
	return false
}

/** Edge of one oasis cell (m). Divides the 16 m terrain cell; 4 m = ~490 cells per oasis (blocky, mobile-cheap). */
export const OASIS_CELL_M = 4
/** Reveal rings (m): the lowered area grows in steps of this width as the melt passes. */
export const OASIS_BAND_M = 4
/** How far the earth floor sits below the old walkable top (m). Under DCL_MAX_AUTO_STEP_M (0.3). */
export const OASIS_DROP_M = 0.27
/**
 * Nominal final oasis radius (m) on cell centres. Luke's playtest: a ragged blocky patch clearly smaller than the 50 m snow
 * disc, ringed by permafrost caps that never melt (the blue ring is the intended look). Measured from his mid-melt screenshot
 * (patch ~0.75 of the cap circle, i.e. 28-36 m); 32 m nominal with the +/- OASIS_JITTER_M edge below gives a 28..36 m edge.
 * The snow still melts out to CRYSTAL_HEAT_RADIUS_M (heat front, unchanged).
 */
export const OASIS_RADIUS_M = 32
/** Radius (m) the release burst melts instantly (the middle section). */
export const OASIS_INNER_M = 12
/** Seconds the rest of the caps take to melt outward after the burst. */
export const OASIS_MELT_S = 60
/** Per-cell irregularity (m, +/-) of the outward melt edge; it also ragged-ises the final edge (a cell is in when d - jitter <= radius). */
export const OASIS_JITTER_M = 4
/** Farthest cell centre (m) that can ever melt BEFORE the finale pulse. */
export const OASIS_REACH_M = OASIS_RADIUS_M + OASIS_JITTER_M
/**
 * FINALE pulse: nominal radius (m) every oasis grows to (tunable, multiple of OASIS_BAND_M; ~60-70 m), and the seconds the
 * gradual outward opening of the permafrost cap takes (~60 s, same as the first oasis). Linear in time from the radius the
 * oasis had when the pulse started (see oasisEntryPulseReveal).
 */
export const OASIS_FINALE_RADIUS_M = 64
export const OASIS_FINALE_MELT_S = 60
/** Farthest cell centre (m) that can ever melt once the finale pulse exists (terrain caps are built for it ahead of time). */
export const OASIS_FINALE_REACH_M = OASIS_FINALE_RADIUS_M + OASIS_JITTER_M
/** Ms after the server release at which the burst is over and the outward melt starts. */
export const OASIS_MELT_DELAY_MS = (CRYSTAL_THAW_DELAY_S + CRYSTAL_THAW_SPREAD_S) * 1000

export interface OasisEntry {
	x     : number
	z     : number
	level : number
	/** Radius (m) reached so far (burst, timed melt, then the finale pulse); never above OASIS_FINALE_RADIUS_M. */
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
/** Local epoch ms the finale pulse starts at (Infinity = none scheduled this cycle). Survives oasisClear (the finale owns it). */
let pulseMs = Number.POSITIVE_INFINITY


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
	if (r >= OASIS_FINALE_RADIUS_M) return OASIS_FINALE_RADIUS_M
	return Math.floor(r / OASIS_BAND_M) * OASIS_BAND_M
}

/** Largest radius (m) any cell can need right now: the finale radius once the pulse is scheduled, else OASIS_RADIUS_M. */
export function oasisCapR(): number {
	return pulseMs === Number.POSITIVE_INFINITY ? OASIS_RADIUS_M : OASIS_FINALE_RADIUS_M
}

/** Farthest cell centre (m) that can melt right now. */
export function oasisReachM(): number {
	return oasisCapR() + OASIS_JITTER_M
}

/** Local epoch ms the finale pulse starts (Infinity = none). */
export function oasisFinalePulseMs(): number {
	return pulseMs
}

/**
 * Schedule (or, with Infinity, cancel) the finale pulse: from local epoch `ms` every oasis grows to OASIS_FINALE_RADIUS_M over
 * OASIS_FINALE_MELT_S. Idempotent; the server and every client derive the same `ms` from the finale start, so a late joiner
 * (even after the pulse) sees the finished state.
 */
export function oasisSetFinalePulse(ms: number): void {
	if (ms === pulseMs) return
	const prev = snapshot()
	pulseMs = ms
	notify(prev)
}

/** Radius (m) an oasis had when the finale pulse started: its timed melt so far (at least the burst), never above OASIS_RADIUS_M. */
function pulseStartRadius(meltStartMs: number): number {
	return Math.max(OASIS_INNER_M, Math.min(OASIS_RADIUS_M, oasisTimedReveal(meltStartMs, pulseMs)))
}

/**
 * Radius (m) the finale pulse has opened oasis `e` to at local epoch `nowMs` (0 before the pulse starts, OASIS_FINALE_RADIUS_M
 * once done). Linear over OASIS_FINALE_MELT_S from the radius the oasis had at the pulse start, so an oasis that was still
 * melting continues without a jump. Depends only on the release note and the pulse time, so every client agrees.
 */
export function oasisEntryPulseReveal(meltStartMs: number, nowMs: number): number {
	const t = (nowMs - pulseMs) / 1000
	if (!(t > 0)) return 0
	if (t >= OASIS_FINALE_MELT_S) return OASIS_FINALE_RADIUS_M
	const s = pulseStartRadius(meltStartMs)
	return s + ((OASIS_FINALE_RADIUS_M - s) * t) / OASIS_FINALE_MELT_S
}

function notify(prev: OasisEntry[]): void {
	version++
	if (listeners.length === 0) return
	const was = (x: number, z: number): boolean => loweredWith(prev, null, x, z)
	for (const l of listeners) l(was)
}

function snapshot(): OasisEntry[] { return entries.map((e) => ({ ...e })) }

/** Radius (m) the timed outward melt has reached at local epoch `nowMs` (0 before it starts, OASIS_RADIUS_M once done). */
export function oasisTimedReveal(meltStartMs: number, nowMs: number): number {
	const t = (nowMs - meltStartMs) / 1000
	if (!(t > 0)) return 0
	if (t >= OASIS_MELT_S) return OASIS_RADIUS_M
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
	const timed = Math.max(oasisTimedReveal(e.meltStartMs, nowMs), oasisEntryPulseReveal(e.meltStartMs, nowMs))
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
		if (e.reveal >= OASIS_FINALE_RADIUS_M) continue
		const r = Math.max(oasisTimedReveal(e.meltStartMs, nowMs), oasisEntryPulseReveal(e.meltStartMs, nowMs))
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
	// Beyond the cap (OASIS_RADIUS_M, or the finale radius once the pulse exists) the cell stays frozen for good (ragged final edge).
	return Math.max(OASIS_INNER_M + 0.01, d - jit)
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
	if (d > oasisReachM()) return Number.POSITIVE_INFINITY
	const m = map ?? mapRef
	if (m && (oasisExcludedLevel(levelAtWorld(m, cx, cz)) || isLavaAtWorld(m, cx, cz))) return Number.POSITIVE_INFINITY
	const need = cellNeed(e, ix, iz, d)
	return need > oasisCapR() ? Number.POSITIVE_INFINITY : need
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
 * Infinity = never (mountain, lava, pit, outside), -Infinity = already open for good.
 * Agrees with oasisLoweredAt as the clock passes it (tested in oasisCheck).
 */
export function oasisCellExposeMs(map: TerrainMap, x: number, z: number): number {
	return oasisCellInfo(map, x, z).ms
}

/** Which entry (the first to melt the cell) owns the cell holding (x, z), when it melts, and its centre distance to that entry. */
export function oasisCellInfo(map: TerrainMap, x: number, z: number): { ms: number; entry: OasisEntry | null; d: number; fin: boolean } {
	let best = Number.POSITIVE_INFINITY
	let owner: OasisEntry | null = null
	let ownerD = 0
	let ownerFin = false
	if (entries.length === 0) return { ms: best, entry: null, d: 0, fin: false }
	const cx = cellCentre(x)
	const cz = cellCentre(z)
	for (const e of entries) {
		const need = cellOf(e, map, x, z)
		if (need === Number.POSITIVE_INFINITY) continue
		let ms: number = Number.POSITIVE_INFINITY
		if (need > OASIS_RADIUS_M) { /* only the finale pulse can open this cell */ }
		else if (e.meltStartMs === Number.NEGATIVE_INFINITY) ms = Number.NEGATIVE_INFINITY
		else if (need <= OASIS_INNER_M) ms = e.meltStartMs
		else {
			const reqR = Math.min(OASIS_RADIUS_M, Math.ceil(need / OASIS_BAND_M) * OASIS_BAND_M)
			ms = e.meltStartMs + ((reqR - OASIS_INNER_M) / (OASIS_RADIUS_M - OASIS_INNER_M)) * OASIS_MELT_S * 1000
		}
		// Finale pulse: the front passes ring reqP at pulseMs + (reqP - s) / (BIG - s) * OASIS_FINALE_MELT_S (s = radius at the pulse start).
		let msP = Number.POSITIVE_INFINITY
		if (pulseMs !== Number.POSITIVE_INFINITY) {
			const reqP = Math.min(OASIS_FINALE_RADIUS_M, Math.ceil(need / OASIS_BAND_M) * OASIS_BAND_M)
			const s = pulseStartRadius(e.meltStartMs)
			msP = pulseMs + (Math.max(0, reqP - s) / (OASIS_FINALE_RADIUS_M - s)) * OASIS_FINALE_MELT_S * 1000
		}
		if (msP < ms) ms = msP
		// Only the ring beyond the first patch is a "finale" cell (own vegetation group); inner cells keep their group.
		const fin = need > OASIS_RADIUS_M
		// Earliest melt wins; ties (e.g. both already open) go to the nearer monument, then the earlier entry.
		const d = Math.hypot(cx - e.x, cz - e.z)
		if (owner === null || ms < best || (ms === best && d < ownerD)) { best = ms; owner = e; ownerD = d; ownerFin = fin }
	}
	return { ms: best, entry: owner, d: ownerD, fin: ownerFin }
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