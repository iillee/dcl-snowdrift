/**
 * fireNetwork.ts — shared tunables + deterministic geometry for the fire
 * network prototype (branch `fire-network`).
 *
 * Two lit campfires (hearth + hidden/satellite pits; not torches, not
 * monuments, not lava) within NETWORK_LINK_RANGE_M that are neighbours in
 * the relative-neighbourhood graph (RNG) of the currently lit fires, and
 * that have a walkable terrain route within the detour budget, link. The
 * route is A* on the 16 m terrain grid (same level walking, 8-way where
 * both orthogonal cells agree, ladders both ways), string-pulled into
 * straight runs, then rasterised to 1 m snow cells NETWORK_PATH_WIDTH_M wide.
 *
 * Both server (melts / protects the cells) and client (draws the glow)
 * call routeFireLink with the same inputs, so only fire ids and positions
 * go over the wire.
 */

import { TERRAIN_GRID_H, TERRAIN_GRID_W, isMountainLevel } from 'src/shared/settings'
import { CLIFF_HALF_TAPER_M, LADDER_FOOT_M, LADDER_LAND_M } from 'src/shared/terrain/terrainMap'
import { cellCenterWorld as snowCellCenter, forEachCellInDisc } from 'src/shared/snowGrid'
import {
	LANDFORM_LAVA,
	TerrainMap,
	cellCenterWorld,
	cellOfWorld,
	inGrid,
	levelAtWorld,
} from 'src/shared/terrain/terrainMap'


// MARK: Tunables
/** Straight-line range (m) for two lit fires to consider linking. */
export const NETWORK_LINK_RANGE_M      = 140
/** Route may be at most this many times the straight distance. */
export const NETWORK_DETOUR_MAX        = 1.6
/** Hard cap on route length (m). */
export const NETWORK_MAX_ROUTE_M       = 260
/** Cleared path width (m). */
export const NETWORK_PATH_WIDTH_M      = 4
/** Seconds for the melt to run from both fires to the middle. */
export const NETWORK_MELT_S            = 6
/** Seconds for protection to retreat along a broken link (from the dead end). Snow then regrows at the normal weather rate. */
export const NETWORK_REFREEZE_S        = 20
/** Extra A* cost (in 16 m cell steps) for using a ladder. */
export const NETWORK_LADDER_COST       = 3
/** Hidden-fire / hearth burn multiplier while a fire is linked. 1 = off. */
export const NETWORK_BURN_MUL          = 1.0
/** Server re-evaluates the graph this often (s). */
export const NETWORK_TICK_S            = 1
/** Glow strip: width (m), height above ground (m), fade time (s), max draw distance (m). */
export const NETWORK_GLOW_WIDTH_M      = 0.5
export const NETWORK_GLOW_LIFT_M       = 0.04
export const NETWORK_GLOW_FADE_S       = 3
export const NETWORK_GLOW_DRAW_DIST_M  = 260
/** Glow look: 'tiles' = raised glowing snow-grid squares on the path centreline; 'line' = old thin strip. */
export const NETWORK_GLOW_STYLE: 'tiles' | 'line' = 'tiles'
/** Tiles: band half-width (m) around the centreline (0.75 = 1-2 cells wide). */
export const NETWORK_TILE_BAND_M       = 0.75
/** Tiles: gap (m) left between neighbouring squares so the grid reads. */
export const NETWORK_TILE_INSET_M      = 0.12
/** Tiles: lift above the ground (m) and box thickness (m). */
export const NETWORK_TILE_LIFT_M       = 0.07
export const NETWORK_TILE_THICK_M      = 0.04
/** Tiles: merge up to this many contiguous cells in a row/column into one box (fewer entities; 1 = every square its own box). */
export const NETWORK_TILE_MERGE_MAX    = 1
/** Tiles: no glow tiles within this radius (m) of either endpoint fire's centre (log pile / pit footprint ~2 m). */
export const NETWORK_TILE_FIRE_CLEAR_M = 1.35 // Fireplace_base.glb: �0.79 � �0.86 m (0.01 node scale) ? 0.86 m half-extent + 0.5 m tile half
/** Tiles: per-tile scale-in / scale-out time (s), ease-out, from the tile centre. */
export const NETWORK_TILE_SCALE_S      = 0.35
/** Heat path: standing on a shown path tile warms like the weakest (Ember) campfire. */
export const NETWORK_PATH_WARM_ENABLED = true
/** Heat path: counts as "on the path" within this distance (m) of a shown path cell. */
export const NETWORK_PATH_WARM_RADIUS_M = 1
/** Heat path: fuel value whose tier sets the warmth (60 = top of Ember, tier 1). Ember never loses to the cold, so frost recovers slowly day and night. */
export const NETWORK_PATH_WARM_FUEL    = 30
/** Debug: log graph + candidate links on the server and client. */
export const FIRE_NETWORK_DEBUG        = false
/** Node id of the hearth. Hidden fire i is i + 1. */
export const NETWORK_HEARTH_ID         = 0


// MARK: Types
export interface FireNode { id: number; x: number; z: number }
export interface LinkRun {
	/** Level of this straight-run polyline (no cliffs inside a run). */
	level : number
	pts   : { x: number; z: number }[]
}
export interface FireLinkRoute {
	/** Straight polylines, split at ladders. */
	runs   : LinkRun[]
	/** Total route length (m). */
	lengthM: number
	/** Snow cell keys to clear, with t = distance (m) from fire A along the route. */
	cells  : { key: number; t: number }[]
}

export function linkKey(a: number, b: number): string {
	return a < b ? `${a}-${b}` : `${b}-${a}`
}


// MARK: pickLinks
/**
 * Relative-neighbourhood graph on straight distance, limited to
 * NETWORK_LINK_RANGE_M: A–B links unless some lit C is closer to both.
 * Avoids spaghetti (no long edge across a triangle) but keeps the
 * network connected wherever it can be.
 */
export function pickLinkPairs(nodes: FireNode[]): [FireNode, FireNode][] {
	const out: [FireNode, FireNode][] = []
	const r2 = NETWORK_LINK_RANGE_M * NETWORK_LINK_RANGE_M
	const d2 = (p: FireNode, q: FireNode) => (p.x - q.x) ** 2 + (p.z - q.z) ** 2
	for (let i = 0; i < nodes.length; i++) {
		for (let j = i + 1; j < nodes.length; j++) {
			const a = nodes[i], b = nodes[j]
			const ab = d2(a, b)
			if (ab > r2) continue
			let blocked = false
			for (let k = 0; k < nodes.length && !blocked; k++) {
				if (k === i || k === j) continue
				const c = nodes[k]
				if (Math.max(d2(a, c), d2(b, c)) < ab) blocked = true
			}
			if (!blocked) out.push([a, b])
		}
	}
	return out
}


// MARK: routeFireLink
const W = TERRAIN_GRID_W, H = TERRAIN_GRID_H

function walkable(map: TerrainMap, i: number): boolean {
	return !isMountainLevel(map.levels[i]) && map.landforms[i] !== LANDFORM_LAVA
}

/** A* + string-pull + rasterise. Null when no route fits the budget. */
export function routeFireLink(map: TerrainMap, a: FireNode, b: FireNode): FireLinkRoute | null {
	const ca = cellOfWorld(a.x, a.z), cb = cellOfWorld(b.x, b.z)
	if (!inGrid(ca.cx, ca.cz) || !inGrid(cb.cx, cb.cz)) return null
	const start = ca.cz * W + ca.cx, goal = cb.cz * W + cb.cx
	const straight = Math.hypot(a.x - b.x, a.z - b.z)
	const budget = Math.min(NETWORK_MAX_ROUTE_M, Math.max(straight * NETWORK_DETOUR_MAX, 24))
	const cellM = 16
	const budgetSteps = budget / cellM + 2

	const ladderAt = new Map<number, { j: number; foot: { x: number; z: number }; head: { x: number; z: number } }[]>()
	for (const l of map.ladders) {
		const lo = l.lowCz * W + l.lowCx, hi = l.highCz * W + l.highCx
		if (!ladderAt.has(lo)) ladderAt.set(lo, [])
		if (!ladderAt.has(hi)) ladderAt.set(hi, [])
		ladderAt.get(lo)!.push({ j: hi, foot: l.bottom, head: l.top })
		ladderAt.get(hi)!.push({ j: lo, foot: l.top, head: l.bottom })
	}

	const g = new Float32Array(W * H).fill(Infinity)
	const came = new Int32Array(W * H).fill(-1)
	const viaLadder = new Uint8Array(W * H)
	const open: number[] = [start]
	g[start] = 0
	const hfn = (i: number) => { const x = i % W, z = (i - x) / W; return Math.hypot(x - cb.cx, z - cb.cz) }
	const closed = new Uint8Array(W * H)
	while (open.length) {
		let bi = 0, bf = Infinity
		for (let k = 0; k < open.length; k++) { const f = g[open[k]] + hfn(open[k]); if (f < bf) { bf = f; bi = k } }
		const i = open[bi]; open[bi] = open[open.length - 1]; open.pop()
		if (closed[i]) continue
		closed[i] = 1
		if (i === goal) break
		if (g[i] > budgetSteps) continue
		const x = i % W, z = (i - x) / W, lv = map.levels[i]
		const relax = (j: number, c: number, lad: boolean) => {
			if (closed[j] || g[i] + c >= g[j]) return
			g[j] = g[i] + c; came[j] = i; viaLadder[j] = lad ? 1 : 0; open.push(j)
		}
		for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
			if (!dx && !dz) continue
			const nx = x + dx, nz = z + dz
			if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue
			const j = nz * W + nx
			if (!walkable(map, j) || map.levels[j] !== lv) continue
			if (dx && dz) {
				const o1 = z * W + nx, o2 = nz * W + x
				if (map.levels[o1] !== lv || map.levels[o2] !== lv || !walkable(map, o1) || !walkable(map, o2)) continue
			}
			relax(j, dx && dz ? Math.SQRT2 : 1, false)
		}
		for (const l of ladderAt.get(i) ?? []) relax(l.j, NETWORK_LADDER_COST, true)
	}
	if (!Number.isFinite(g[goal])) return null

	// Cell chain start..goal.
	const chain: number[] = []
	for (let i = goal; i !== -1; i = came[i]) chain.push(i)
	chain.reverse()

	// Split into same-level runs at ladders; string-pull each run.
	const runs: LinkRun[] = []
	let run: { x: number; z: number }[] = [{ x: a.x, z: a.z }]
	let runLevel = map.levels[start]
	for (let k = 1; k < chain.length; k++) {
		const j = chain[k], i = chain[k - 1]
		if (viaLadder[j]) {
			const lad = (ladderAt.get(i) ?? []).find((l) => l.j === j)!
			// Run right up to the cliff base / lip (the foot/head points sit
			// LADDER_FOOT_M / LADDER_LAND_M off the edge, leaving unmelted snow).
			const ux0 = lad.head.x - lad.foot.x, uz0 = lad.head.z - lad.foot.z
			const uL = Math.hypot(ux0, uz0) || 1, ux = ux0 / uL, uz = uz0 / uL
			const sgn = map.levels[j] > map.levels[i] ? 1 : -1 // climbing: foot is the low side
			const edgeX = lad.foot.x + ux * (sgn > 0 ? LADDER_FOOT_M : LADDER_LAND_M)
			const edgeZ = lad.foot.z + uz * (sgn > 0 ? LADDER_FOOT_M : LADDER_LAND_M)
			const nearM = CLIFF_HALF_TAPER_M - 0.25
			run.push({ x: lad.foot.x, z: lad.foot.z })
			run.push({ x: edgeX - ux * nearM, z: edgeZ - uz * nearM })
			runs.push({ level: runLevel, pts: run })
			run = [{ x: edgeX + ux * nearM, z: edgeZ + uz * nearM }, { x: lad.head.x, z: lad.head.z }]
			runLevel = map.levels[j]
			continue
		}
		const c = cellCenterWorld(j % W, (j - (j % W)) / W)
		run.push(c)
	}
	run.push({ x: b.x, z: b.z })
	runs.push({ level: runLevel, pts: run })
	for (const r of runs) r.pts = stringPull(map, r.level, r.pts)

	let lengthM = 0
	for (const r of runs) for (let k = 1; k < r.pts.length; k++) lengthM += Math.hypot(r.pts[k].x - r.pts[k - 1].x, r.pts[k].z - r.pts[k - 1].z)
	if (lengthM > budget) return null

	return { runs, lengthM, cells: rasterizeRuns(map, runs, NETWORK_PATH_WIDTH_M / 2) }
}


// MARK: rasterizeRuns
/** Snow cells within `radiusM` of the run polylines (same level only), with t = distance from fire A. */
export function rasterizeRuns(map: TerrainMap, runs: LinkRun[], radiusM: number): { key: number; t: number }[] {
	const seen = new Map<number, number>()
	let t0 = 0
	for (const r of runs) {
		for (let k = 1; k < r.pts.length; k++) {
			const p = r.pts[k - 1], q = r.pts[k]
			const L = Math.hypot(q.x - p.x, q.z - p.z)
			const n = Math.max(1, Math.ceil(L * 2))
			for (let s = 0; s <= n; s++) {
				const u = s / n
				const x = p.x + (q.x - p.x) * u, z = p.z + (q.z - p.z) * u
				const t = t0 + L * u
				forEachCellInDisc(x, z, radiusM, (key) => {
					if (seen.has(key)) return
					// No clearing up a cliff face or onto the plateau above.
					const c = snowCellCenter(key)
					if (levelAtWorld(map, c.x, c.z) !== r.level) return
					seen.set(key, t)
				})
			}
			t0 += L
		}
	}
	const cells: { key: number; t: number }[] = []
	for (const [key, t] of seen) cells.push({ key, t })
	return cells
}

/** Keep only points needed so each straight hop stays on `level` walkable cells. */
function stringPull(map: TerrainMap, level: number, pts: { x: number; z: number }[]): { x: number; z: number }[] {
	if (pts.length <= 2) return pts
	const out = [pts[0]]
	let i = 0
	while (i < pts.length - 1) {
		let j = pts.length - 1
		while (j > i + 1 && !clearLine(map, level, pts[i], pts[j])) j--
		out.push(pts[j])
		i = j
	}
	return out
}

function clearLine(map: TerrainMap, level: number, p: { x: number; z: number }, q: { x: number; z: number }): boolean {
	const L = Math.hypot(q.x - p.x, q.z - p.z)
	const n = Math.max(1, Math.ceil(L / 1))
	const half = NETWORK_PATH_WIDTH_M / 2 + 0.5
	const nx = -(q.z - p.z) / (L || 1), nz = (q.x - p.x) / (L || 1)
	for (let s = 0; s <= n; s++) {
		const u = s / n
		const x = p.x + (q.x - p.x) * u, z = p.z + (q.z - p.z) * u
		for (const o of [-half, 0, half]) {
			const wx = x + nx * o, wz = z + nz * o
			if (levelAtWorld(map, wx, wz) !== level) return false
			const c = cellOfWorld(wx, wz)
			if (map.landforms[c.cz * W + c.cx] === LANDFORM_LAVA) return false
		}
	}
	return true
}
