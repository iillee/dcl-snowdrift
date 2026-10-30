/**
 * oasisVeg.ts - deterministic regrowth plan for the oasis floors (floating-crystals ruleset). Pure: no
 * engine calls, so the client renderer (client/terrain/oasisVegetation.ts) and oasisCheck share it.
 *
 * Every melted 4 m oasis cell gets, from (cycle seed, cell) alone:
 *   - a grass shade (0 = stays bare earth, 1..3 = dark / mid / light green, in low-frequency patches)
 *     and a pop-in time (GRASS_MIN_S..+GRASS_SPREAD_S after the cell melted),
 *   - a few decorations placed inside it: pines (growing), round bushes, lilac-grey rocks, denser toward
 *     the obelisk, each with its own start time + grow duration relative to the cell's melt time.
 * Times are local epoch ms derived from the oasis entries' melt clock (shared/terrain/oasis.ts), which is
 * itself derived from the server release age, so every client (and a late joiner) agrees. -Infinity = grown.
 * Overlapping oases: cells are keyed globally, so a cell exists once (owner = the oasis that melts it first).
 */

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import {
	OBELISK_PIT_SIZE_M,
	TERRAIN_ORIGIN_M,
	TerrainMap,
	groundYAtWorld,
	isLavaAtWorld,
	levelAtWorld,
} from 'src/shared/terrain/terrainMap'
import {
	OASIS_CELL_M,
	OASIS_DROP_M,
	OASIS_RADIUS_M,
	OasisEntry,
	oasisReachM,
	oasisCellCentre,
	oasisCellIndex,
	oasisCellInfo,
	oasisHash01,
} from 'src/shared/terrain/oasis'


// MARK: Tuning

/** Grass pops in this many seconds (min..min+spread) after its cell melted: the greening spreads cell by cell. */
export const VEG_GRASS_MIN_S = 2
export const VEG_GRASS_SPREAD_S = 40
/** Fraction of cells that stay bare earth near the rim / centre (patches of earth between the grass). */
export const VEG_BARE_RIM = 0.10
export const VEG_BARE_CENTRE = 0.20
/** Rocks pop (scale in over ~2 s), bushes scale in, pines grow; seconds after their cell melted. */
export const VEG_ROCK_START_S = 10
export const VEG_ROCK_SPREAD_S = 30
export const VEG_BUSH_START_S = 14
export const VEG_BUSH_SPREAD_S = 30
export const VEG_BUSH_GROW_S = 6
export const VEG_TREE_START_S = 15
export const VEG_TREE_SPREAD_S = 35
export const VEG_TREE_GROW_MIN_S = 45
export const VEG_TREE_GROW_SPREAD_S = 35
/** Per-oasis entity caps (per kind items; a pine is 2-3 entities). */
/**
 * Density / bare-patch profile radius (m): the ORIGINAL 47.2 m oasis radius. The smaller melted patch keeps the same look, density and
 * spacing at every distance from the obelisk (nothing is thinned for the radius change); only the caps scale with the patch area.
 */
export const VEG_PROFILE_R_M = 47.17
/** Patch area relative to the original 47.2 m oasis (scales the per-oasis caps). */
export const VEG_AREA_SCALE = (OASIS_RADIUS_M * OASIS_RADIUS_M) / (VEG_PROFILE_R_M * VEG_PROFILE_R_M)
export const VEG_MAX_TREES = Math.ceil(32 * VEG_AREA_SCALE)
/**
 * Finale pulse: cells opened ONLY by the pulse (the ring between OASIS_RADIUS_M and OASIS_FINALE_RADIUS_M) form their own group per oasis
 * ("<x,z>#f") with the caps scaled by (cells / VEG_BASE_CELLS), i.e. the same density as the first patch (never fewer than the base caps).
 */
export const VEG_BASE_CELLS = Math.round((Math.PI * OASIS_RADIUS_M * OASIS_RADIUS_M) / (OASIS_CELL_M * OASIS_CELL_M))
export const VEG_FIN_SUFFIX = '#f'
/** Pines keep their canopies apart: centre distance >= this x (radius a + radius b), so tall ones never clump. */
export const VEG_TREE_SPACING_K = 0.9
/** Two pines this tall or taller (m) stay at least VEG_TREE_TALL_SPACING_M apart (no clumps of giants). */
export const VEG_TREE_TALL_H_M = 19
export const VEG_TREE_TALL_SPACING_M = 13
/** Canopy radius as a fraction of pine height (lower cone, see client placeItem: 0.18 two cones, 0.16 one). */
export const VEG_TREE_CANOPY_FRAC = 0.18
export const VEG_TREE_CANOPY_FRAC_SMALL = 0.16
export const VEG_MAX_BUSHES = Math.ceil(70 * VEG_AREA_SCALE)
export const VEG_MAX_ROCKS = Math.ceil(20 * VEG_AREA_SCALE)
/** Thickness of a grass slab (m): sits just above the earth floor, under the walking step. */
export const VEG_GRASS_TOP_M = 0.03
/** Keep decorations this far (m, Chebyshev) from the obelisk centre: its 6 m plinth + margin. */
export const VEG_PLINTH_CLEAR_M = OBELISK_PIT_SIZE_M / 2 + 3
/** Keep decorations this far (m, Chebyshev) from the main hearth: the fire + the spawn spot + a margin. */
export const VEG_HEARTH_CLEAR_M = 6
/** Keep decorations this far (m) from a ladder foot / landing. */
export const VEG_LADDER_CLEAR_M = 7
/** Keep decorations this far (m) inside a cliff edge. */
export const VEG_CLIFF_CLEAR_M = 1.5

export const VEG_TREE = 0
export const VEG_BUSH = 1
export const VEG_ROCK = 2
export type VegKind = 0 | 1 | 2

export interface VegItem {
	kind    : VegKind
	x       : number
	z       : number
	/** Floor height (m) the item stands on (earth top); grass slabs add VEG_GRASS_TOP_M. */
	y       : number
	yaw     : number
	/** Three 0..1 rolls: size, shape, shade variant. */
	s0      : number
	s1      : number
	s2      : number
	/** Local epoch ms the item starts to appear / the ms it takes to reach full size. */
	startMs : number
	durMs   : number
	/** Sort key: lower survives the per-oasis cap. */
	pri     : number
}

export interface VegCell {
	key     : number
	ix      : number
	iz      : number
	x       : number
	z       : number
	/** "x,z" of the oasis entry that owns (first melts) this cell. */
	ownerKey: string
	exposeMs: number
	/** 0 = bare earth, 1..3 = grass shade. */
	shade   : number
	/** Local epoch ms the grass pops in (Infinity for bare cells). */
	grassMs : number
	/** Earth floor top Y (m). */
	y       : number
	items   : VegItem[]
}


// MARK: keys

export function vegCellKey(ix: number, iz: number): number {
	return (ix + 2048) * 4096 + (iz + 2048)
}

export function vegOwnerKey(e: OasisEntry): string {
	return e.x.toFixed(1) + ',' + e.z.toFixed(1)
}


// MARK: noise

function smooth(t: number): number { return t * t * (3 - 2 * t) }

/** Value noise in [0, 1) with features about `scaleM` wide. */
function valueNoise(salt: number, x: number, z: number, scaleM: number): number {
	const gx = x / scaleM
	const gz = z / scaleM
	const ix = Math.floor(gx)
	const iz = Math.floor(gz)
	const fx = smooth(gx - ix)
	const fz = smooth(gz - iz)
	const a = oasisHash01(salt, ix, iz, 1)
	const b = oasisHash01(salt, ix + 1, iz, 1)
	const c = oasisHash01(salt, ix, iz + 1, 1)
	const d = oasisHash01(salt, ix + 1, iz + 1, 1)
	return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz
}


// MARK: greedyRects

/** Greedy merge of equal non-zero values in an nx * nz grid into rectangles (same scan as the terrain renderer). */
export function greedyRects(mask: Uint8Array, nx: number, nz: number): Array<{ ix: number; iz: number; w: number; h: number; v: number }> {
	const used = new Uint8Array(nx * nz)
	const out: Array<{ ix: number; iz: number; w: number; h: number; v: number }> = []
	for (let iz = 0; iz < nz; iz++) {
		for (let ix = 0; ix < nx; ix++) {
			const v = mask[iz * nx + ix]
			if (v === 0 || used[iz * nx + ix]) continue
			let w = 1
			while (ix + w < nx && !used[iz * nx + ix + w] && mask[iz * nx + ix + w] === v) w++
			let h = 1
			for (; iz + h < nz; h++) {
				let ok = true
				for (let k = 0; k < w; k++) {
					const j = (iz + h) * nx + ix + k
					if (used[j] || mask[j] !== v) { ok = false; break }
				}
				if (!ok) break
			}
			for (let dz = 0; dz < h; dz++) for (let dx = 0; dx < w; dx++) used[(iz + dz) * nx + ix + dx] = 1
			out.push({ ix, iz, w, h, v })
		}
	}
	return out
}


// MARK: mergeGrassRects

/** One merged grass rectangle: centre (x, z), size, the shared floor Y of every cell it covers, and the shade. */
export interface GrassRect { x: number; z: number; sx: number; sz: number; y: number; shade: number }

/**
 * Greedy-merge the grass cells into rectangles, one pass PER floor Y: cells on different terraces / wall blocks (different
 * `y`) are never merged, so a rectangle sits at the exact floor height of every cell it covers (a single Y for a mixed
 * rectangle put grass up in the air above the lower terrace). Cells must share the 4 m grid (OASIS_CELL_M).
 */
export function mergeGrassRects(cells: readonly VegCell[]): GrassRect[] {
	const byY = new Map<number, VegCell[]>()
	for (const c of cells) {
		if (c.shade === 0) continue
		const k = Math.round(c.y * 1000)
		let a = byY.get(k)
		if (!a) { a = []; byY.set(k, a) }
		a.push(c)
	}
	const out: GrassRect[] = []
	for (const list of byY.values()) {
		let minIx = Infinity, minIz = Infinity, maxIx = -Infinity, maxIz = -Infinity
		for (const c of list) { minIx = Math.min(minIx, c.ix); maxIx = Math.max(maxIx, c.ix); minIz = Math.min(minIz, c.iz); maxIz = Math.max(maxIz, c.iz) }
		const nx = maxIx - minIx + 1, nz = maxIz - minIz + 1
		const mask = new Uint8Array(nx * nz)
		for (const c of list) mask[(c.iz - minIz) * nx + c.ix - minIx] = c.shade
		const first = list[0]
		for (const r of greedyRects(mask, nx, nz)) {
			const x0 = first.x + (minIx + r.ix - first.ix) * OASIS_CELL_M - OASIS_CELL_M / 2
			const z0 = first.z + (minIz + r.iz - first.iz) * OASIS_CELL_M - OASIS_CELL_M / 2
			out.push({ x: x0 + (r.w * OASIS_CELL_M) / 2, z: z0 + (r.h * OASIS_CELL_M) / 2, sx: r.w * OASIS_CELL_M, sz: r.h * OASIS_CELL_M, y: first.y, shade: r.v })
		}
	}
	return out
}


// MARK: buildVegCells

/**
 * The regrowth plan for every cell the given oasis entries melt (now or later) that is not already in `known`.
 * Deterministic in (map seed, entries' position / level / melt start). `known` is not modified.
 */
export function buildVegCells(map: TerrainMap, entries: readonly OasisEntry[], known: ReadonlySet<number>): VegCell[] {
	const salt = map.usedSeed | 0
	const cells = new Map<number, VegCell & { owner: OasisEntry; d: number }>()

	// Pass 1: the cells.
	for (const e of entries) {
		const reach = oasisReachM() + OASIS_CELL_M
		const ix0 = oasisCellIndex(e.x - reach)
		const ix1 = oasisCellIndex(e.x + reach)
		const iz0 = oasisCellIndex(e.z - reach)
		const iz1 = oasisCellIndex(e.z + reach)
		for (let iz = iz0; iz <= iz1; iz++) {
			for (let ix = ix0; ix <= ix1; ix++) {
				const key = vegCellKey(ix, iz)
				if (known.has(key) || cells.has(key)) continue
				const x = oasisCellCentre(ix)
				const z = oasisCellCentre(iz)
				const info = oasisCellInfo(map, x, z)
				if (info.entry === null || info.ms === Number.POSITIVE_INFINITY) continue
				const f = Math.min(1, info.d / VEG_PROFILE_R_M)
				const hBare = oasisHash01(salt, ix, iz, 2)
				const bare = hBare < VEG_BARE_RIM + (VEG_BARE_CENTRE - VEG_BARE_RIM) * (1 - f)
				const n = valueNoise(salt, x, z, 14) + (oasisHash01(salt, ix, iz, 3) - 0.5) * 0.12
				const shade = bare ? 0 : n < 0.36 ? 1 : n < 0.68 ? 2 : 3
				const grassMs = bare ? Number.POSITIVE_INFINITY : info.ms + (VEG_GRASS_MIN_S + oasisHash01(salt, ix, iz, 4) * VEG_GRASS_SPREAD_S) * 1000
				cells.set(key, {
					key, ix, iz, x, z, ownerKey: vegOwnerKey(info.entry) + (info.fin ? VEG_FIN_SUFFIX : ''), exposeMs: info.ms, shade, grassMs,
					y: groundYAtWorld(map, x, z) - OASIS_DROP_M, items: [], owner: info.entry, d: info.d,
				})
			}
		}
	}

	// Pass 2: decorations (trees need all four neighbour cells melted too, so none overhang the rim).
	const has = (ix: number, iz: number): boolean => known.has(vegCellKey(ix, iz)) || cells.has(vegCellKey(ix, iz))
	for (const c of cells.values()) {
		const f = Math.min(1, c.d / VEG_PROFILE_R_M)
		const interior = has(c.ix - 1, c.iz) && has(c.ix + 1, c.iz) && has(c.ix, c.iz - 1) && has(c.ix, c.iz + 1)
		const t = (s: number): number => oasisHash01(salt, c.ix, c.iz, s)
		const place = (kind: VegKind, slot: number, startS: number, spreadS: number, durMs: number): void => {
			const salt0 = 20 + kind * 8 + slot * 4
			const m = OASIS_CELL_M * 0.18
			const x = c.x - OASIS_CELL_M / 2 + m + t(salt0) * (OASIS_CELL_M - 2 * m)
			const z = c.z - OASIS_CELL_M / 2 + m + t(salt0 + 1) * (OASIS_CELL_M - 2 * m)
			if (!vegPosOk(map, c.owner, x, z)) return
			const h = t(salt0 + 2)
			const startMs = c.exposeMs + (startS + t(salt0 + 3) * spreadS) * 1000
			c.items.push({
				kind, x, z, y: c.y, yaw: t(salt0 + 1) * 360, s0: h, s1: t(salt0 + 3), s2: t(salt0 + 2) * 0.5 + t(salt0) * 0.5,
				startMs, durMs, pri: t(90 + kind * 4 + slot) * (kind === VEG_TREE ? 0.9 + 0.3 * f : 0.5 + f),
			})
		}
		// pines: at most one candidate per cell, nearly even across the oasis (thinned afterwards by canopy spacing)
		const lamTree = 0.8 - 0.2 * f
		if (interior && t(10) < lamTree) place(VEG_TREE, 0, VEG_TREE_START_S, VEG_TREE_SPREAD_S, (VEG_TREE_GROW_MIN_S + t(11) * VEG_TREE_GROW_SPREAD_S) * 1000)
		// bushes: up to two, ~1 per cell at the centre, ~0.25 at the rim
		const lamBush = 1.0 + (0.25 - 1.0) * f
		for (let s = 0; s < 2; s++) if (t(12 + s) < lamBush / 2) place(VEG_BUSH, s, VEG_BUSH_START_S, VEG_BUSH_SPREAD_S, VEG_BUSH_GROW_S * 1000)
		// rocks: sparse
		if (t(14) < 0.1) place(VEG_ROCK, 0, VEG_ROCK_START_S, VEG_ROCK_SPREAD_S, 2000)
	}

	// Per-oasis caps: keep the lowest `pri` of each kind (centre first).
	const byOwner = new Map<string, VegItem[][]>()
	const ownerOf = new Map<string, OasisEntry>()
	for (const c of cells.values()) {
		ownerOf.set(c.ownerKey, c.owner)
		let lists = byOwner.get(c.ownerKey)
		if (!lists) { lists = [[], [], []]; byOwner.set(c.ownerKey, lists) }
		for (const it of c.items) lists[it.kind].push(it)
	}
	const baseCaps = [VEG_MAX_TREES, VEG_MAX_BUSHES, VEG_MAX_ROCKS]
	const groupCells = new Map<string, number>()
	for (const c of cells.values()) groupCells.set(c.ownerKey, (groupCells.get(c.ownerKey) ?? 0) + 1)
	const drop = new Set<VegItem>()
	for (const [ownerKey, lists] of byOwner) {
		const sc = ownerKey.endsWith(VEG_FIN_SUFFIX) ? Math.max(1, (groupCells.get(ownerKey) ?? 0) / VEG_BASE_CELLS) : 1
		const caps = baseCaps.map((v) => Math.ceil(v * sc))
		for (let k = 0; k < 3; k++) {
			if (k === VEG_TREE) {
				// Greedy by priority: a pine is kept only if its canopy clears every kept pine (radius sum) and the obelisk / hearth.
				lists[k].sort((a, b) => a.pri - b.pri)
				const kept: VegItem[] = []
				const own = ownerOf.get(ownerKey)
				for (const it of lists[k]) {
					const r = vegTreeRadiusM(it)
					let ok = kept.length < caps[k]
					if (ok && own && Math.hypot(it.x - own.x, it.z - own.z) < 3 + r) ok = false
					if (ok && Math.hypot(it.x - CAMPFIRE_WORLD_X, it.z - CAMPFIRE_WORLD_Z) < 2 + r) ok = false
					if (ok && !vegCanopyClear(map, it.x, it.z, r)) ok = false // no canopy over a cliff drop / into a taller wall
					for (let j = 0; ok && j < kept.length; j++) {
						const dd = Math.hypot(it.x - kept[j].x, it.z - kept[j].z)
						if (dd < VEG_TREE_SPACING_K * (r + vegTreeRadiusM(kept[j]))) ok = false
						else if (dd < VEG_TREE_TALL_SPACING_M && vegTreeHeightM(it) >= VEG_TREE_TALL_H_M && vegTreeHeightM(kept[j]) >= VEG_TREE_TALL_H_M) ok = false
					}
					if (ok) kept.push(it); else drop.add(it)
				}
				continue
			}
			if (lists[k].length <= caps[k]) continue
			lists[k].sort((a, b) => a.pri - b.pri)
			for (let i = caps[k]; i < lists[k].length; i++) drop.add(lists[k][i])
		}
	}
	const out: VegCell[] = []
	for (const c of cells.values()) {
		if (drop.size > 0) c.items = c.items.filter((it) => !drop.has(it))
		out.push({ key: c.key, ix: c.ix, iz: c.iz, x: c.x, z: c.z, ownerKey: c.ownerKey, exposeMs: c.exposeMs, shade: c.shade, grassMs: c.grassMs, y: c.y, items: c.items })
	}
	out.sort((a, b) => a.key - b.key)
	return out
}


// MARK: vegCanopyClear

/** True when the terrace under (x, z) continues (same level, no lava) for 0.7 x the canopy radius all round: pines never overhang a cliff. */
export function vegCanopyClear(map: TerrainMap, x: number, z: number, r: number): boolean {
	const lv = levelAtWorld(map, x, z)
	const k = 0.7 * r
	const q = k * Math.SQRT1_2
	for (const [ox, oz] of [[k, 0], [-k, 0], [0, k], [0, -k], [q, q], [-q, q], [q, -q], [-q, -q]]) {
		if (levelAtWorld(map, x + ox, z + oz) !== lv || isLavaAtWorld(map, x + ox, z + oz)) return false
	}
	return true
}


// MARK: vegPosOk

/** Static keep-outs for a decoration at (x, z): obelisk plinth, hearth, ladders, cliff edges, lava. */
export function vegPosOk(map: TerrainMap, owner: OasisEntry, x: number, z: number): boolean {
	if (Math.abs(x - owner.x) < VEG_PLINTH_CLEAR_M && Math.abs(z - owner.z) < VEG_PLINTH_CLEAR_M) return false
	for (const st of map.stations) {
		// other obelisks' plinths too (oases can overlap)
		const sx = TERRAIN_ORIGIN_M + (st.cx + 0.5) * 16
		const sz = TERRAIN_ORIGIN_M + (st.cz + 0.5) * 16
		if (Math.abs(x - sx) < VEG_PLINTH_CLEAR_M && Math.abs(z - sz) < VEG_PLINTH_CLEAR_M) return false
	}
	if (Math.abs(x - CAMPFIRE_WORLD_X) < VEG_HEARTH_CLEAR_M && Math.abs(z - CAMPFIRE_WORLD_Z) < VEG_HEARTH_CLEAR_M) return false
	for (const l of map.ladders) {
		if (Math.hypot(x - l.bottom.x, z - l.bottom.z) < VEG_LADDER_CLEAR_M) return false
		if (Math.hypot(x - l.top.x, z - l.top.z) < VEG_LADDER_CLEAR_M) return false
	}
	const m = VEG_CLIFF_CLEAR_M
	const own = levelAtWorld(map, x, z) // the item's own terrace (oases span every terrace in reach)
	for (const [ox, oz] of [[-m, -m], [m, -m], [-m, m], [m, m]]) {
		if (levelAtWorld(map, x + ox, z + oz) !== own || isLavaAtWorld(map, x + ox, z + oz)) return false
	}
	return true
}


// MARK: stage maths

/** 0..1 growth of an item at local epoch `nowMs` (0 before it starts, 1 when grown). */
export function vegGrowth(it: { startMs: number; durMs: number }, nowMs: number): number {
	if (it.startMs === Number.NEGATIVE_INFINITY) return 1
	if (nowMs <= it.startMs) return 0
	const u = (nowMs - it.startMs) / Math.max(1, it.durMs)
	return u >= 1 ? 1 : u
}

/**
 * World scale references (measured): avatar ~1.8 m; the choppable dead tree_4 is a 4.81 m tall GLB at scale 4..8 (x 0.97..1.0 of
 * the log-share scale), i.e. 19..38 m tall (mean ~29 m), canopy ~3.7 m x scale wide. Pines span saplings to the low end of that.
 * Pine height (m) from the item's size roll: 4.5..30.5 m, mean ~15 m, about a third of them 19 m or taller (the choppable range).
 */
export const VEG_TREE_MIN_H_M = 4.5
export const VEG_TREE_MAX_H_M = 30.5
/** Pines this tall or taller get two stacked cones (a narrower cone on top), shorter ones one cone. */
export const VEG_TREE_TIER_H_M = 9
export function vegTreeHeightM(it: VegItem): number {
	return VEG_TREE_MIN_H_M + (VEG_TREE_MAX_H_M - VEG_TREE_MIN_H_M) * Math.pow(it.s0, 1.5)
}
/** Canopy radius (m) of a grown pine. */
export function vegTreeRadiusM(it: VegItem): number {
	const h = vegTreeHeightM(it)
	return h * (h >= VEG_TREE_TIER_H_M ? VEG_TREE_CANOPY_FRAC : VEG_TREE_CANOPY_FRAC_SMALL)
}