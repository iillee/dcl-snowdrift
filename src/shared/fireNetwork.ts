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
 * Near monuments the links form a forest (monument -> direct fires ->
 * relay parents, see pruneMonumentTrees), not the RNG web.
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
/** Organic routes: smooth corners + gentle seeded meander (shared, so server melt == client glow). false = straight string-pulled routes. */
export const NETWORK_ORGANIC_ENABLED     = true
/** Chaikin corner-cut passes (more = wider, rounder turns). */
export const NETWORK_SMOOTH_ITERS        = 4
/** Meander: max sideways offset (m), base wavelength (m, +/-20% per link), fade-in distance from each run end (fire / ladder) (m), resample step (m). */
export const NETWORK_MEANDER_AMP_M       = 1.5
/**
 * Turn rounding fallback when the full organic curve doesn't fit: each
 * corner is replaced by a curve whose tangent points sit up to this far
 * (m) from the corner, shrinking until the centreline stays walkable on
 * its level. Never eats the last NETWORK_END_STRAIGHT_M into a fire. 0 = off.
 */
export const NETWORK_TURN_FILLET_M      = 14
export const NETWORK_MEANDER_WAVELENGTH_M = 55
export const NETWORK_MEANDER_FADE_M      = 10
export const NETWORK_ORGANIC_STEP_M      = 2
/** Cleared path width (m). */
export const NETWORK_PATH_WIDTH_M      = 4
/**
 * Terraced trench: centre fully clear, then snow steps up toward the
 * sides (stage caps 1 = 1/3 depth, 2 = 2/3 depth), then full snow.
 * false = old flat NETWORK_PATH_WIDTH_M strip with sheer walls.
 */
export const NETWORK_PATH_GRADIENT_ENABLED = false
/** Fully clear half-width (m) around the centreline (1 = ~2 m walkable). */
export const NETWORK_PATH_CLEAR_HALF_M  = 1.0
/** Width (m) of each step band outward from the clear centre: [1/3-depth band, 2/3-depth band]. */
export const NETWORK_PATH_STEP_WIDTHS_M: readonly number[] = [1.0, 1.0]
/** Snow stage cap per step band (stage 1 = 0.5 m = 1/3, stage 2 = 1.0 m = 2/3 of full 1.5 m). */
export const NETWORK_PATH_STEP_STAGES: readonly number[] = [1, 2]
/** Seconds for the melt to run from both fires to the middle. */
export const NETWORK_MELT_S            = 6
/** Seconds for protection to retreat along a broken link (from the dead end). Snow then regrows at the normal weather rate. */
export const NETWORK_REFREEZE_S        = 20
/** false (default): a broken link drops its hold at once; cells refill with normal snowfall like any cleared snow, and glow + warmth go instantly. true = old timed retreat over NETWORK_REFREEZE_S. */
export const NETWORK_PATH_REFREEZE_ENABLED = false
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
export const NETWORK_GLOW_STYLE: 'cubes' | 'tiles' | 'line' = 'cubes'
/** Cubes style mesh: 'sphere' (default) or 'box' (tilted diamond cubes). */
export const NETWORK_CUBE_SHAPE: 'sphere' | 'box' = 'sphere'
/** Cubes: scale pulse amplitude (fraction, 0.1 = +/-10%) and period (s); phase runs along the trail. 0 amp = off. Only near the player (NETWORK_CUBE_BOB_DIST_M). */
export const NETWORK_CUBE_PULSE_AMP    = 0.1
export const NETWORK_CUBE_PULSE_PERIOD_S = 1.6
/** Cubes: edge length (m), spacing along the route (m), float height above the ground (m). */
export const NETWORK_CUBE_SIZE_M       = 0.25
export const NETWORK_CUBE_SPACING_M    = 1.5
export const NETWORK_CUBE_FLOAT_M      = 0.6
/** Fire strength: orbs near a weak fire shrink toward this scale (1 = off). */
export const NETWORK_ORB_WEAK_MIN_SCALE  = 0.3
/** Fire strength: fuel (s) at or above which a fire counts as full strength (150 = Warm tier). */
export const NETWORK_ORB_FULL_FUEL_S     = 150
/** Fire strength: influence reaches this far along the trail from each fire (m), capped at 40% of the link. */
export const NETWORK_ORB_WEAK_INFLUENCE_M = 30
/** Fire strength: seconds for an orb to ease to a new strength (no popping). */
export const NETWORK_ORB_WEAK_EASE_S     = 1.5
/** Cubes: gentle bob amplitude (m) and period (s); a wave travels along the trail. 0 amp = static. */
export const NETWORK_CUBE_BOB_M        = 0.1
export const NETWORK_CUBE_BOB_PERIOD_S = 4.5
/** Cubes: bob wavelength along the trail (m): a long swell travelling fire to fire. */
export const NETWORK_CUBE_BOB_WAVELENGTH_M = 20
/** Cubes: only bob cubes within this distance (m) of the player (cheap). */
export const NETWORK_CUBE_BOB_DIST_M   = 40
/** Cubes (box shape only): each cube is turned 45 deg about the route so it reads as a diamond. */
export const NETWORK_CUBE_TILT_DEG     = 45
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
/** Glow pieces: clear radius (m) around a monument end of a charge link (the trail runs right up to the obelisk). */
export const NETWORK_TILE_MONUMENT_CLEAR_M = 0.5
/** Tiles: per-tile scale-in / scale-out time (s), ease-out, from the tile centre. */
export const NETWORK_TILE_SCALE_S      = 0.35
/** Heat path: standing on a shown path cell warms like a small (Low tier) campfire. */
export const NETWORK_PATH_WARM_ENABLED = true
/** Heat path: counts as "on the path" within this distance (m) of a shown path cell. */
export const NETWORK_PATH_WARM_RADIUS_M = 1
/** Heat path: fuel value whose tier sets the warmth. 100 = Low (tier 2, fuel 60-150): 6 frost/s, same as a small campfire (no Ember floor). */
export const NETWORK_PATH_WARM_FUEL    = 100
/** Debug: log graph + candidate links on the server and client. */
export const FIRE_NETWORK_DEBUG        = false
/** Node id of the hearth. Hidden fire i is i + 1. */
export const NETWORK_HEARTH_ID         = 0

/** Route ends: the last leg into each fire / monument end is straight for this far (m), so trails never overshoot or hook around the pit. */
export const NETWORK_END_STRAIGHT_M = 12 // >= half a 16 m cell diagonal (11.3 m)

/** Charge links (fire -> monument): a swell of orb scale races fire -> monument every PERIOD s while charging (amp = extra scale at the crest, width m = gaussian half-width). Drawn within DIST m of the player. */
export const NETWORK_CHARGE_PULSE_AMP = 0.9
export const NETWORK_CHARGE_PULSE_PERIOD_S = 1.5
export const NETWORK_CHARGE_PULSE_WIDTH_M = 2.5
export const NETWORK_CHARGE_PULSE_DIST_M = 160
/** Crystal release: one final, bigger pulse fire -> monument (amp, seconds to travel, delay after the release message). */
export const NETWORK_FINAL_PULSE_AMP = 1.8
export const NETWORK_FINAL_PULSE_S = 1.2
export const NETWORK_FINAL_PULSE_DELAY_S = 0.3
/** Legacy sine flow (unused since the travelling pulse). */
export const NETWORK_CHARGE_FLOW_AMP = 0.35
export const NETWORK_CHARGE_FLOW_PERIOD_S = 1.2
export const NETWORK_CHARGE_FLOW_WAVELENGTH_M = 6

// MARK: Link crossfade (client visual only)
/** Orbs of a removed link shrink + dim to nothing over this many seconds (server state / warmth switch at once). */
export const NETWORK_LINK_FADE_OUT_S = 2.5
/** Orbs of a new link grow from 0 over this many seconds (after the melt front reaches them). */
export const NETWORK_LINK_FADE_IN_S  = 2.5
/**
 * Seconds after a link forms until its whole trail is visibly drawn on
 * clients: the melt front covers it (fire-fire: both ends meet at L/2 in
 * NETWORK_MELT_S; charge link: one way, full L in 2 * NETWORK_MELT_S),
 * then the last orb finishes its NETWORK_LINK_FADE_IN_S grow-in. Charging
 * (direct and chain) only counts a link after this (server + client bar).
 */
export function linkFullyVisibleS(chargeLink: boolean): number {
	return (chargeLink ? 2 * NETWORK_MELT_S : NETWORK_MELT_S) + NETWORK_LINK_FADE_IN_S
}
/** Dim write cadence (s) while a link fades out (material writes are throttled). */
export const NETWORK_LINK_DIM_WRITE_S = 0.2

// MARK: Topology tunables (pruneNetwork)
/**
 * Which links the lit nodes form:
 *   'rng'     relative-neighbourhood graph (sparse, tidy; fires rarely get 3+ links)
 *   'gabriel' Gabriel graph (more meshes, fires can link 3+ neighbours)
 *   'dense'   (default) every pair in NETWORK_DENSE_RANGE_M links except near-duplicates (see
 *             topologyBlocked); the parallel-route drop still removes overlapping paths
 *   'legacy'  old behaviour: RNG + keep-every-held-link hysteresis, and
 *             every charging fire links its monument directly
 */
export const NETWORK_TOPOLOGY: 'rng' | 'gabriel' | 'dense' | 'legacy' = 'dense'
/** dense: fires farther apart than this (m) only link when needed to join two pieces (<= NETWORK_LINK_RANGE_M). */
export const NETWORK_DENSE_RANGE_M = 140
/** dense: a link is a near-duplicate (dropped) when a closer third fire leaves both ends within this angle (deg) of it. Lower = more links kept. */
export const NETWORK_DENSE_COLLINEAR_DEG = 25
/** After pruning, re-add the shortest routable link joining split components (MST-safe). */
export const NETWORK_RECONNECT_ENABLED = true
/**
 * Monument trees (floating crystals, default): near a monument the network
 * is a forest. Fires with a charge link link ONLY to the monument; relay
 * fires out of range link to exactly one parent one hop closer. See
 * pruneMonumentTrees. false = the flat RNG network below.
 */
export const NETWORK_MONUMENT_TREE_ENABLED = true
/**
 * Fire-link rule (old, only used when NETWORK_MONUMENT_TREE_ENABLED is off):
 * a fire linked to a monument always keeps at least one fire-to-fire link
 * when any routable fire candidate exists (monument-only = network of one).
 * It tangled the heat paths around monuments (every ring fire linked the
 * monument AND its neighbours), so it is off by default. false = off.
 */
export const NETWORK_FIRE_LINK_RULE_ENABLED = false
/**
 * Monument links (fire -> monument) skip the prune and the parallel drop:
 * every routable fire in MONUMENT_LINK_RANGE_M links (and so charges).
 * They still count as third nodes when pruning fire-to-fire links.
 */
export const NETWORK_MONUMENT_LINKS_KEEP_ALL = true
/** Node ids at or above this are monuments (= ruleset MONUMENT_NODE_ID_BASE; kept here to avoid an import cycle). */
export const NETWORK_MONUMENT_ID_MIN = 1000
/** Drop a link whose route mostly runs beside another kept route (never a bridge). */
export const NETWORK_PARALLEL_DROP_ENABLED = true
/** "Beside": a route sample within this distance (m) of another kept route. */
export const NETWORK_PARALLEL_NEAR_M   = 4
/** Drop when more than this fraction of the link's samples are beside another route. */
export const NETWORK_PARALLEL_FRAC     = 0.5
/**
 * Also drop the longer of two kept links whose routes cross (never a bridge, never a monument or tree link),
 * so a dense mesh does not become a tangle. Crossings next to a shared fire do not count (NETWORK_CROSS_END_SKIP_M).
 */
export const NETWORK_CROSS_DROP_ENABLED = true
/** Samples this close (m) to the link's own end nodes are ignored (paths always meet at fires). */
export const NETWORK_PARALLEL_END_SKIP_M = 6


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
	cells  : { key: number; t: number; cap: number }[]
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
	// Clean ends: the A* chain runs through 16 m cell CENTRES, and the end
	// fire sits anywhere in its cell. When string-pulling can't skip the
	// end cell's centre (e.g. a wall beside the fire fails the path-width
	// check) the route ran past the fire to that centre and hooked back:
	// orbs overshot the fire by 2-3 and wrapped around it. Drop interior
	// points within NETWORK_END_STRAIGHT_M of each fire end so the last leg
	// comes straight in (only if that leg stays on clear walkable ground).
	trimEnd(map, runs[0], true, a)
	trimEnd(map, runs[runs.length - 1], false, b)

	const runsLen = (rs: LinkRun[]) => { let L = 0; for (const r of rs) for (let k = 1; k < r.pts.length; k++) L += Math.hypot(r.pts[k].x - r.pts[k - 1].x, r.pts[k].z - r.pts[k - 1].z); return L }
	if (runsLen(runs) > budget) return null
	// Organic shape: smoothed + meandering centreline, per run, with a
	// per-run fallback to the straight route if it leaves walkable cells;
	// whole-route fallback if the curves push it past the budget.
	if (NETWORK_ORGANIC_ENABLED) {
		const lo = Math.min(a.id, b.id), hi = Math.max(a.id, b.id)
		const curved = runs.map((r, i) => ({ level: r.level, pts: organicRun(map, r, lo * 7919 + hi * 104729 + i * 31, i === 0, i === runs.length - 1) }))
		if (runsLen(curved) <= budget) for (let i = 0; i < runs.length; i++) runs[i].pts = curved[i].pts
		else runs.forEach((r, i) => { r.pts = filletRun(map, r.level, r.pts, i === 0, i === runs.length - 1) }) // rounding only shortens
	} else {
		runs.forEach((r, i) => { r.pts = filletRun(map, r.level, r.pts, i === 0, i === runs.length - 1) })
	}
	const lengthM = runsLen(runs)

	return { runs, lengthM, cells: pathCells(map, runs) }
}


// MARK: pathCells
/** Snow cells the link holds, each with its max snow stage (0 = clear). */
function pathCells(map: TerrainMap, runs: LinkRun[]): { key: number; t: number; cap: number }[] {
	if (!NETWORK_PATH_GRADIENT_ENABLED) return rasterizeRuns(map, runs, NETWORK_PATH_WIDTH_M / 2).map((c) => ({ key: c.key, t: c.t, cap: 0 }))
	let outer = NETWORK_PATH_CLEAR_HALF_M
	for (const w of NETWORK_PATH_STEP_WIDTHS_M) outer += w
	return rasterizeRuns(map, runs, outer).map((c) => {
		let edge = NETWORK_PATH_CLEAR_HALF_M, cap = 0
		if (c.d > edge) {
			cap = 3
			for (let i = 0; i < NETWORK_PATH_STEP_WIDTHS_M.length; i++) {
				edge += NETWORK_PATH_STEP_WIDTHS_M[i]
				if (c.d <= edge) { cap = NETWORK_PATH_STEP_STAGES[i] ?? 2; break }
			}
		}
		return { key: c.key, t: c.t, cap: Math.max(0, Math.min(2, cap)) }
	})
}

// MARK: rasterizeRuns
/** Snow cells within `radiusM` of the run polylines (same level only), with t = distance from fire A. */
export function rasterizeRuns(map: TerrainMap, runs: LinkRun[], radiusM: number): { key: number; t: number; d: number }[] {
	const seen = new Map<number, number>()
	const dist = new Map<number, number>()
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
					const c = snowCellCenter(key)
					const dd = Math.hypot(c.x - x, c.z - z)
					if (seen.has(key)) { if (dd < dist.get(key)!) dist.set(key, dd); return }
					// No clearing up a cliff face or onto the plateau above.
					if (levelAtWorld(map, c.x, c.z) !== r.level) return
					seen.set(key, t)
					dist.set(key, dd)
				})
			}
			t0 += L
		}
	}
	const cells: { key: number; t: number; d: number }[] = []
	for (const [key, t] of seen) cells.push({ key, t, d: dist.get(key)! })
	return cells
}

// MARK: organicRun
/** Deterministic 0..1 from an int seed. */
function hash01(n: number): number {
	let x = (n | 0) ^ 0x9e3779b9
	x = Math.imul(x ^ (x >>> 16), 0x85ebca6b); x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35); x ^= x >>> 16
	return (x >>> 0) / 4294967296
}

/** Chaikin corner-cutting, endpoints kept. */
function chaikin(pts: { x: number; z: number }[], iters: number): { x: number; z: number }[] {
	let p = pts
	for (let it = 0; it < iters && p.length > 2; it++) {
		const out = [p[0]]
		for (let k = 0; k < p.length - 1; k++) {
			const a = p[k], b = p[k + 1]
			if (k > 0) out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 })
			if (k < p.length - 2) out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 })
		}
		out.push(p[p.length - 1])
		p = out
	}
	return p
}

/** Resample to ~stepM, then push sideways by a low-frequency sine that fades to 0 at both run ends. */
function meander(pts: { x: number; z: number }[], seed: number, amp: number): { x: number; z: number }[] {
	let total = 0
	for (let k = 1; k < pts.length; k++) total += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z)
	if (total < 2 * NETWORK_MEANDER_FADE_M || amp <= 0) return pts
	const step = NETWORK_ORGANIC_STEP_M
	const n = Math.max(2, Math.ceil(total / step))
	const lambda = NETWORK_MEANDER_WAVELENGTH_M * (0.8 + 0.4 * hash01(seed + 1))
	const phase = hash01(seed + 2) * Math.PI * 2
	const out: { x: number; z: number }[] = []
	let k = 1, acc = 0
	for (let i = 0; i <= n; i++) {
		const s = (i / n) * total
		while (k < pts.length - 1 && acc + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z) < s) { acc += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z); k++ }
		const p = pts[k - 1], q = pts[k]
		const L = Math.hypot(q.x - p.x, q.z - p.z) || 1
		const u = Math.min(1, Math.max(0, (s - acc) / L))
		const x = p.x + (q.x - p.x) * u, z = p.z + (q.z - p.z) * u
		const e = Math.min(s, total - s) / NETWORK_MEANDER_FADE_M
		const fade = e >= 1 ? 1 : e * e * (3 - 2 * e)
		const off = amp * fade * Math.sin((2 * Math.PI * s) / lambda + phase)
		out.push({ x: x - ((q.z - p.z) / L) * off, z: z + ((q.x - p.x) / L) * off })
	}
	return out
}

function runIsClear(map: TerrainMap, level: number, pts: { x: number; z: number }[]): boolean {
	for (let k = 1; k < pts.length; k++) if (!clearLine(map, level, pts[k - 1], pts[k])) return false
	return true
}

/** Curvier run: smooth + meander; falls back to smooth-only, then to the straight run, if it leaves walkable cells. */
function organicRun(map: TerrainMap, r: LinkRun, seed: number, startFire = true, endFire = true): { x: number; z: number }[] {
	const smooth = chaikin(r.pts, NETWORK_SMOOTH_ITERS)
	for (const amp of [NETWORK_MEANDER_AMP_M, NETWORK_MEANDER_AMP_M / 2, 0]) {
		const pts = amp > 0 ? meander(smooth, seed, amp) : smooth
		if (runIsClear(map, r.level, pts)) return pts
	}
	return filletRun(map, r.level, r.pts, startFire, endFire)
}

/**
 * Round each interior corner with a quadratic curve (tangent distance
 * up to NETWORK_TURN_FILLET_M, halved until the centreline stays on
 * level walkable ground). End legs keep NETWORK_END_STRAIGHT_M straight.
 */
export function filletRun(map: TerrainMap, level: number, pts: { x: number; z: number }[], startFire = true, endFire = true): { x: number; z: number }[] {
	if (NETWORK_TURN_FILLET_M <= 0 || pts.length < 3) return pts
	const out: { x: number; z: number }[] = [pts[0]]
	const last = pts.length - 1
	// Tangent point consumed so far on the incoming leg (start of the next straight).
	for (let k = 1; k < last; k++) {
		const p = out[out.length - 1], c = pts[k], n = pts[k + 1]
		const l1 = Math.hypot(c.x - p.x, c.z - p.z), l2 = Math.hypot(n.x - c.x, n.z - c.z)
		if (l1 < 1e-3 || l2 < 1e-3) { out.push(c); continue }
		const u1x = (c.x - p.x) / l1, u1z = (c.z - p.z) / l1, u2x = (n.x - c.x) / l2, u2z = (n.z - c.z) / l2
		if (u1x * u2x + u1z * u2z > 0.995) { out.push(c); continue } // nearly straight
		// Room on each leg: half of it (the next corner shares the leg), minus the fire-end straight.
		// Asymmetric tangents: the quadratic stays tangent to both legs, so a
		// short fire-end leg (kept straight) still meets the curve smoothly.
		const room1 = k === 1 ? (startFire ? l1 - NETWORK_END_STRAIGHT_M : l1 * 0.9) : l1 * 0.5
		const room2 = k === last - 1 ? (endFire ? l2 - NETWORK_END_STRAIGHT_M : l2 * 0.9) : l2 * 0.5
		let t1 = Math.min(NETWORK_TURN_FILLET_M, Math.max(0, room1))
		let t2 = Math.min(NETWORK_TURN_FILLET_M, Math.max(0, room2))
		// One side may be short, but give the curve some length overall.
		if (t1 < 0.3) t1 = 0
		if (t2 < 0.3) t2 = 0
		let placed = false
		for (; t1 + t2 >= 2 && t1 >= 0.3 && t2 >= 0.3; t1 *= 0.5, t2 *= 0.5) {
			const a = { x: c.x - u1x * t1, z: c.z - u1z * t1 }, b = { x: c.x + u2x * t2, z: c.z + u2z * t2 }
			const curve: { x: number; z: number }[] = []
			const N = Math.max(4, Math.ceil((t1 + t2) / 3))
			for (let s = 0; s <= N; s++) {
				const u = s / N, w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u
				curve.push({ x: w0 * a.x + w1 * c.x + w2 * b.x, z: w0 * a.z + w1 * c.z + w2 * b.z })
			}
			let ok = straightOnLevel(map, level, p, a)
			for (let s = 1; ok && s < curve.length; s++) ok = straightOnLevel(map, level, curve[s - 1], curve[s])
			if (!ok) continue
			out.push(...curve)
			placed = true
			break
		}
		if (!placed) out.push(c)
	}
	out.push(pts[last])
	return out
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


// MARK: shared fuel
/** Shared fuel: wood fed to a linked fire is split across every lit fire in its network. */
export const NETWORK_SHARED_FUEL_ENABLED = true
/** Shared fuel: fraction of the piece the fed fire keeps. */
export const NETWORK_SHARE_KEEP          = 0.5
/** Shared fuel: the rest goes to lit fires within this many link hops (not the whole network). */
export const NETWORK_SHARE_HOPS          = 2
/** Share wave (client): a swell that runs through the existing trail spheres from the fed fire to each receiver. */
/** Travel time per link hop (s). */
export const NETWORK_SHARE_WAVE_TRAVEL_S = 1.6
/** Peak scale multiplier at the wave front (overlapping waves take the max). */
export const NETWORK_SHARE_WAVE_SCALE    = 1.8
/** Half-width (m) of the smooth swell around the front (~2 spheres either side at 1.5 m spacing). */
export const NETWORK_SHARE_WAVE_WIDTH_M  = 3
/** Pulses per share, and the gap (s) between them. */
export const NETWORK_SHARE_WAVE_COUNT    = 2
export const NETWORK_SHARE_WAVE_GAP_S    = 0.35

/**
 * Water-fill split: add `total` across fires so the lowest rise first
 * toward a common level, each capped at `cap`. Returns per-fire deltas
 * (sum = total), or null when the fires together cannot take `total`
 * (caller refuses the feed, same as the normal cap rule).
 */
export function splitFuelWaterFill(fuels: number[], cap: number, total: number): number[] | null {
	const head = fuels.reduce((s, f) => s + Math.max(0, cap - f), 0)
	if (total <= 0) return fuels.map(() => 0)
	if (head + 1e-6 < total) return null
	const fill = (lv: number) => fuels.reduce((s, f) => s + Math.max(0, Math.min(cap, lv) - f), 0)
	let lo = Math.min(...fuels), hi = cap
	for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (fill(mid) < total) lo = mid; else hi = mid }
	const out = fuels.map((f) => Math.max(0, Math.min(cap, hi) - f))
	// Fix float drift so the sum is exact (put it on the biggest share).
	const sum = out.reduce((s, d) => s + d, 0)
	let big = 0; for (let i = 1; i < out.length; i++) if (out[i] > out[big]) big = i
	out[big] = Math.max(0, out[big] + (total - sum))
	return out
}

/**
 * Keep-and-share split. Fed fire keeps `keep` of `total`; the rest is
 * water-filled into `others` (lowest first, capped). Whatever others
 * can't take goes back to the fed fire, and fed-fire overflow goes to
 * the others. Returns { fed, others[] } deltas, or null if fed + others
 * together can't take the whole piece.
 */
export function splitFuelKeepShare(fedFuel: number, others: number[], cap: number, total: number, keep: number): { fed: number; others: number[] } | null {
	const fedHead = Math.max(0, cap - fedFuel)
	const othHead = others.reduce((s, f) => s + Math.max(0, cap - f), 0)
	if (fedHead + othHead + 1e-6 < total) return null
	let toOthers = Math.min(othHead, total * (1 - Math.max(0, Math.min(1, keep))))
	let fed = total - toOthers
	if (fed > fedHead) { toOthers += fed - fedHead; fed = fedHead }
	const o = others.length ? splitFuelWaterFill(others, cap, Math.min(othHead, toOthers)) : []
	return { fed, others: o ?? others.map(() => 0) }
}


/**
 * Fuel follows heat (chain charging): like splitFuelKeepShare, but the
 * shared part (and any fed-fire overflow) first fills the others with a
 * chain hop > 0 in ascending hop order (closest to the monument first, each
 * up to the cap); what is left water-fills all others (lowest fuel first).
 * hops[k] = chain hop of others[k] (0 = not preferred).
 */
export function splitFuelChainFirst(fedFuel: number, others: number[], hops: number[], cap: number, total: number, keep: number): { fed: number; others: number[] } | null {
	const base = splitFuelKeepShare(fedFuel, others, cap, total, keep)
	if (!base) return null
	let left = base.others.reduce((s, x) => s + x, 0)
	const out = others.map(() => 0)
	const order = others.map((_, k) => k).filter((k) => hops[k] > 0).sort((p, q) => hops[p] - hops[q] || others[p] - others[q])
	for (const k of order) {
		if (left <= 1e-9) break
		const g = Math.min(left, Math.max(0, cap - others[k]))
		out[k] += g; left -= g
	}
	if (left > 1e-9) {
		const now = others.map((f, k) => f + out[k])
		const w = splitFuelWaterFill(now, cap, left)
		if (w) w.forEach((d, k) => { out[k] += d })
	}
	return { fed: base.fed, others: out }
}


// MARK: pruneNetwork
export interface NetCand { a: FireNode; b: FireNode; key: string }

function routeSamples(r: FireLinkRoute, step = 1): { x: number; z: number }[] {
	const out: { x: number; z: number }[] = []
	for (const run of r.runs) {
		for (let k = 1; k < run.pts.length; k++) {
			const p = run.pts[k - 1], q = run.pts[k]
			const L = Math.hypot(q.x - p.x, q.z - p.z)
			const n = Math.max(1, Math.ceil(L / step))
			for (let i = 0; i < n; i++) out.push({ x: p.x + ((q.x - p.x) * i) / n, z: p.z + ((q.z - p.z) * i) / n })
		}
	}
	return out
}

function segDistSq(px: number, pz: number, a: { x: number; z: number }, b: { x: number; z: number }): number {
	const dx = b.x - a.x, dz = b.z - a.z
	const L2 = dx * dx + dz * dz
	let t = L2 > 0 ? ((px - a.x) * dx + (pz - a.z) * dz) / L2 : 0
	t = Math.max(0, Math.min(1, t))
	const ex = a.x + dx * t - px, ez = a.z + dz * t - pz
	return ex * ex + ez * ez
}

/** Fraction of `r`'s samples (away from its ends) within NEAR of route `o`. */
export function parallelFraction(r: FireLinkRoute, a: FireNode, b: FireNode, o: FireLinkRoute): number {
	const near2 = NETWORK_PARALLEL_NEAR_M ** 2
	const skip2 = NETWORK_PARALLEL_END_SKIP_M ** 2
	let n = 0, hit = 0
	for (const s of routeSamples(r)) {
		if ((s.x - a.x) ** 2 + (s.z - a.z) ** 2 < skip2 || (s.x - b.x) ** 2 + (s.z - b.z) ** 2 < skip2) continue
		n++
		let close = false
		for (const run of o.runs) {
			for (let k = 1; k < run.pts.length && !close; k++) if (segDistSq(s.x, s.z, run.pts[k - 1], run.pts[k]) <= near2) close = true
			if (close) break
		}
		if (close) hit++
	}
	return n === 0 ? 0 : hit / n
}

/**
 * Streamlined network on `cands` (fire-fire pairs in range + charge
 * pairs). Deterministic for the same inputs, so the same lit set always
 * yields the same links (no flicker).
 *   1. RNG / Gabriel prune on straight distance: a-b goes if some node c
 *      with candidate edges to both is closer (blocks via a shared neighbour).
 *   2. Route the survivors; unroutable ones drop.
 *   3. Reconnect: Kruskal over all candidates (shortest first) adds any
 *      routable link that joins two split components.
 *   4. Parallel drop: longest first, a link whose route mostly runs
 *      beside another kept route goes, unless it is a bridge.
 * Returns kept candidates with their routes.
 */
export interface KeptLink { cand: NetCand; route: FireLinkRoute }
export interface PruneOptions {
	/** Monument trees on/off (default NETWORK_MONUMENT_TREE_ENABLED). */
	tree?: boolean
	/** Old fire-link rule, flat network only (default NETWORK_FIRE_LINK_RULE_ENABLED). */
	fireRule?: boolean
	/** Keys of links that are live now: preferred as a relay's parent (no re-parenting flicker when a fire is added). */
	held?: ReadonlySet<string>
	/** Monument node id + centre, for "closer to a monument" (default: mean of the link ends seen per monument). */
	monuments?: ReadonlyArray<{ id: number; x: number; z: number }>
}
export function pruneNetwork(
	cands: NetCand[],
	route: (c: NetCand) => FireLinkRoute | null,
	opts: PruneOptions = {},
): KeptLink[] {
	const tree = opts.tree ?? NETWORK_MONUMENT_TREE_ENABLED
	if (tree && cands.some((c) => c.a.id >= NETWORK_MONUMENT_ID_MIN || c.b.id >= NETWORK_MONUMENT_ID_MIN)) return pruneMonumentTrees(cands, route, opts)
	return pruneFlat(cands, route, opts.fireRule ?? NETWORK_FIRE_LINK_RULE_ENABLED)
}

/**
 * Topology prune for one fire-fire pair a-b (ab = squared length). `na` / `nb` map each
 * node's candidate neighbours to squared distance. true = the link is not kept (it may
 * still come back through the reconnect step if it is needed to join two pieces).
 *   rng / gabriel: some third fire c blocks it (lune / circle rule, see NETWORK_TOPOLOGY)
 *   dense: every pair within NETWORK_DENSE_RANGE_M links, except a near-duplicate: a third
 *     fire c closer to both ends that sits (nearly) on the way, so a-c and c-b leave the
 *     ends within NETWORK_DENSE_COLLINEAR_DEG of the a-b line (a-b would just run beside them).
 */
function topologyBlocked(
	a: FireNode, b: FireNode, ab: number,
	na: ReadonlyMap<number, number>, nb: ReadonlyMap<number, number>,
	posOf: (id: number) => FireNode | undefined,
): boolean {
	if (NETWORK_TOPOLOGY === 'dense' && ab > NETWORK_DENSE_RANGE_M ** 2) return true
	for (const [k, ac] of na) {
		if (k === b.id) continue
		const bc = nb.get(k)
		if (bc === undefined) continue
		if (NETWORK_TOPOLOGY === 'dense') {
			if (ac >= ab || bc >= ab) continue
			const c = posOf(k)
			if (!c || ac < 1e-6 || bc < 1e-6 || ab < 1e-6) continue
			const ux = b.x - a.x, uz = b.z - a.z
			const cosA = ((c.x - a.x) * ux + (c.z - a.z) * uz) / Math.sqrt(ac * ab)
			const cosB = ((c.x - b.x) * -ux + (c.z - b.z) * -uz) / Math.sqrt(bc * ab)
			const cosT = Math.cos((NETWORK_DENSE_COLLINEAR_DEG * Math.PI) / 180)
			if (cosA > cosT && cosB > cosT) return true
		} else if (NETWORK_TOPOLOGY === 'gabriel' ? ac + bc < ab : Math.max(ac, bc) < ab) return true
	}
	return false
}

function pruneFlat(	cands: NetCand[],
	route: (c: NetCand) => FireLinkRoute | null,
	fireRule: boolean,
): KeptLink[] {
	const d2 = (c: NetCand) => (c.a.x - c.b.x) ** 2 + (c.a.z - c.b.z) ** 2
	const pos = new Map<number, FireNode>()
	const adj = new Map<number, Map<number, number>>()
	for (const c of cands) {
		if (!pos.has(c.a.id)) pos.set(c.a.id, c.a)
		if (!pos.has(c.b.id)) pos.set(c.b.id, c.b)
		const w = d2(c)
		if (!adj.has(c.a.id)) adj.set(c.a.id, new Map())
		if (!adj.has(c.b.id)) adj.set(c.b.id, new Map())
		adj.get(c.a.id)!.set(c.b.id, w)
		adj.get(c.b.id)!.set(c.a.id, w)
	}
	const sorted = [...cands].sort((p, q) => d2(p) - d2(q) || (p.key < q.key ? -1 : 1))
	// 1. prune
	const pruned: NetCand[] = []
	for (const c of sorted) {
		const ab = d2(c)
		const na = adj.get(c.a.id)!, nb = adj.get(c.b.id)!
		if (NETWORK_MONUMENT_LINKS_KEEP_ALL && (c.a.id >= NETWORK_MONUMENT_ID_MIN || c.b.id >= NETWORK_MONUMENT_ID_MIN)) { pruned.push(c); continue }
		if (!topologyBlocked(c.a, c.b, ab, na, nb, (k) => pos.get(k))) pruned.push(c)
	}
	// 2. route
	const kept: KeptLink[] = []
	const keptKeys = new Set<string>()
	for (const c of pruned) { const r = route(c); if (r) { kept.push({ cand: c, route: r }); keptKeys.add(c.key) } }
	// 3. reconnect (union-find)
	const parent = new Map<number, number>()
	const find = (x: number): number => { let p = parent.get(x) ?? x; if (p !== x) { p = find(p); parent.set(x, p) } return p }
	const unite = (x: number, y: number) => parent.set(find(x), find(y))
	for (const k of kept) unite(k.cand.a.id, k.cand.b.id)
	if (NETWORK_RECONNECT_ENABLED) {
		for (const c of sorted) {
			if (keptKeys.has(c.key) || find(c.a.id) === find(c.b.id)) continue
			const r = route(c)
			if (!r) continue
			kept.push({ cand: c, route: r }); keptKeys.add(c.key)
			unite(c.a.id, c.b.id)
		}
	}
	// 3b. Fire-link rule: a fire whose only kept links go to monuments gets
	// its shortest routable fire-to-fire candidate back (a fire may be
	// monument-only only when it is a network of one). Hearth counts.
	const isMon = (id: number) => id >= NETWORK_MONUMENT_ID_MIN
	const fireLinksOf = (id: number, list: typeof kept) => list.filter((k) => (k.cand.a.id === id || k.cand.b.id === id) && !isMon(k.cand.a.id) && !isMon(k.cand.b.id)).length
	if (fireRule) {
		const ids = new Set<number>()
		for (const k of kept) for (const id of [k.cand.a.id, k.cand.b.id]) if (!isMon(id)) ids.add(id)
		for (const id of [...ids].sort((p, q) => p - q)) {
			const hasMon = kept.some((k) => (k.cand.a.id === id || k.cand.b.id === id) && (isMon(k.cand.a.id) || isMon(k.cand.b.id)))
			if (!hasMon || fireLinksOf(id, kept) > 0) continue
			for (const c of sorted) {
				if (isMon(c.a.id) || isMon(c.b.id) || (c.a.id !== id && c.b.id !== id) || keptKeys.has(c.key)) continue
				const r = route(c)
				if (!r) continue
				kept.push({ cand: c, route: r }); keptKeys.add(c.key)
				break
			}
		}
	}
	return dropParallel(kept, fireRule, new Set())
}

/** Step 4: parallel drop (bridge-safe). Links in `protect` (tree links) are never dropped. */
function dropParallel(kept: KeptLink[], fireRule: boolean, protect: ReadonlySet<string>): KeptLink[] {
	const isMon = (id: number) => id >= NETWORK_MONUMENT_ID_MIN
	const fireLinksOf = (id: number, list: typeof kept) => list.filter((k) => (k.cand.a.id === id || k.cand.b.id === id) && !isMon(k.cand.a.id) && !isMon(k.cand.b.id)).length
	if (NETWORK_PARALLEL_DROP_ENABLED && kept.length > 1) {
		const order = [...kept].sort((p, q) => q.route.lengthM - p.route.lengthM || (p.cand.key < q.cand.key ? -1 : 1))
		const alive = new Set(kept)
		const connectedWithout = (skip: typeof kept[number]): boolean => {
			const from = skip.cand.a.id, to = skip.cand.b.id
			const seen = new Set([from]); const q = [from]
			while (q.length) {
				const x = q.pop()!
				if (x === to) return true
				for (const e of alive) {
					if (e === skip) continue
					const o = e.cand.a.id === x ? e.cand.b.id : e.cand.b.id === x ? e.cand.a.id : -1
					if (o >= 0 && !seen.has(o)) { seen.add(o); q.push(o) }
				}
			}
			return false
		}
		// Never drop a fire's last fire-to-fire link while it also feeds a monument.
		const fireRuleNeeds = (e: typeof kept[number]): boolean => {
			if (!fireRule || isMon(e.cand.a.id) || isMon(e.cand.b.id)) return false
			const left = [...alive].filter((k) => k !== e)
			for (const id of [e.cand.a.id, e.cand.b.id]) {
				const hasMon = left.some((k) => (k.cand.a.id === id || k.cand.b.id === id) && (isMon(k.cand.a.id) || isMon(k.cand.b.id)))
				if (hasMon && fireLinksOf(id, left) === 0) return true
			}
			return false
		}
		const bbox = (r: FireLinkRoute) => {
			let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
			for (const run of r.runs) for (const p of run.pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z) }
			return { x0, x1, z0, z1 }
		}
		const boxes = new Map(kept.map((k) => [k, bbox(k.route)]))
		const pad = NETWORK_PARALLEL_NEAR_M
		for (const e of order) {
			if (NETWORK_MONUMENT_LINKS_KEEP_ALL && (isMon(e.cand.a.id) || isMon(e.cand.b.id))) continue
			if (protect.has(e.cand.key)) continue
			const be = boxes.get(e)!
			let worst = 0, crosses = false
			for (const o of alive) {
				if (o === e) continue
				const bo = boxes.get(o)!
				if (bo.x0 - pad > be.x1 || be.x0 - pad > bo.x1 || bo.z0 - pad > be.z1 || be.z0 - pad > bo.z1) continue
				worst = Math.max(worst, parallelFraction(e.route, e.cand.a, e.cand.b, o.route))
				if (NETWORK_CROSS_DROP_ENABLED && routesCross(e.cand, e.route, o.cand, o.route)) crosses = true
				if (worst > NETWORK_PARALLEL_FRAC || crosses) break
			}
			if ((worst > NETWORK_PARALLEL_FRAC || crosses) && connectedWithout(e) && !fireRuleNeeds(e)) alive.delete(e)
		}
		return kept.filter((k) => alive.has(k))
	}
	return kept
}

// MARK: Monument trees
/**
 * Monument trees (floating crystals). Near a monument the network is a
 * forest, never a web:
 *   hop 1  fires with a routable charge link (fire -> monument, all kept).
 *          They link ONLY to the monument: no fire-fire link to another
 *          hop-1 fire.
 *   hop 2+ a fire out of monument range links to exactly ONE parent: the
 *          nearest routable fire that is closer to a monument and keeps it
 *          within the charge chain (hop <= 1 + NETWORK_TREE_FIRE_HOPS), so
 *          its tree depth equals its chain-charging hop. RNG neighbours are
 *          tried first and a parent whose route would cross an already-kept
 *          route loses to one that does not (when one is among the nearest
 *          few). Closer-to-a-monument makes cycles impossible.
 *   rest   fires outside every tree (hearth, too far from the chain, far
 *          fires) keep the RNG + reconnect network, and join a tree only
 *          through the reconnect step (union-find: never closes a cycle).
  */
/** Fire-fire hops a tree reaches past the direct (hop 1) fires. = CHARGE_CHAIN_MAX_HOPS - 1 (kept here to avoid an import cycle; checked in topologyCheck). */
export const NETWORK_TREE_FIRE_HOPS = 2
/** Parent candidates routed (nearest first) while looking for a crossing-free one. */
export const NETWORK_TREE_PARENT_TRIES = 6
/** Crossings this close (m) to a node both routes end at are not counted (routes always meet at fires). */
export const NETWORK_CROSS_END_SKIP_M = 5
/**
 * Monument clusters (Luke: the fires that feed a monument must visibly support one another). Every fire with a charge link
 * (hop 1, within MONUMENT_LINK_RANGE_M of its monument) also links to its nearest OTHER fires of the same monument: at least 1
 * and up to NETWORK_CLUSTER_LINKS_WANT, whenever a valid route exists at all. These links skip the dense-topology near-duplicate
 * prune, the parallel drop and the cross drop (a crossing-free route is only preferred), but still use routeFireLink (walls, lava,
 * ladders, detour budget). They only join hop-1 fires, so chain hops (and charging) never change. false = trees only.
 */
export const NETWORK_CLUSTER_LINKS_ENABLED = true
export const NETWORK_CLUSTER_LINKS_WANT = 2
/** Neighbours routed (nearest first, held links first) per fire while looking for crossing-free cluster links. */
export const NETWORK_CLUSTER_TRIES = 6

function segCross(p1: { x: number; z: number }, p2: { x: number; z: number }, p3: { x: number; z: number }, p4: { x: number; z: number }): { x: number; z: number } | null {
	const d1x = p2.x - p1.x, d1z = p2.z - p1.z, d2x = p4.x - p3.x, d2z = p4.z - p3.z
	const den = d1x * d2z - d1z * d2x
	if (Math.abs(den) < 1e-9) return null
	const t = ((p3.x - p1.x) * d2z - (p3.z - p1.z) * d2x) / den
	const u = ((p3.x - p1.x) * d1z - (p3.z - p1.z) * d1x) / den
	if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null
	return { x: p1.x + d1x * t, z: p1.z + d1z * t }
}

/** True when two routes cross in plan view on the same level (ignoring crossings next to a fire both end at). */
export function routesCross(ca: NetCand, ra: FireLinkRoute, cb: NetCand, rb: FireLinkRoute): boolean {
	const shared: FireNode[] = []
	for (const p of [ca.a, ca.b]) for (const q of [cb.a, cb.b]) if (p.id === q.id && Math.hypot(p.x - q.x, p.z - q.z) < 0.5) shared.push(p)
	const skip2 = NETWORK_CROSS_END_SKIP_M ** 2
	for (const x of ra.runs) for (const y of rb.runs) {
		if (x.level !== y.level) continue
		for (let i = 1; i < x.pts.length; i++) {
			const p = x.pts[i - 1], q = x.pts[i]
			const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x), z0 = Math.min(p.z, q.z), z1 = Math.max(p.z, q.z)
			for (let j = 1; j < y.pts.length; j++) {
				const r = y.pts[j - 1], s = y.pts[j]
				if (Math.max(r.x, s.x) < x0 || Math.min(r.x, s.x) > x1 || Math.max(r.z, s.z) < z0 || Math.min(r.z, s.z) > z1) continue
				const hit = segCross(p, q, r, s)
				if (!hit) continue
				if (shared.some((n) => (n.x - hit.x) ** 2 + (n.z - hit.z) ** 2 < skip2)) continue
				return true
			}
		}
	}
	return false
}

/** Number of kept link pairs whose routes cross. */
export function countRouteCrossings(kept: ReadonlyArray<{ cand: NetCand; route: FireLinkRoute }>): number {
	let n = 0
	for (let i = 0; i < kept.length; i++) for (let j = i + 1; j < kept.length; j++) if (routesCross(kept[i].cand, kept[i].route, kept[j].cand, kept[j].route)) n++
	return n
}

function pruneMonumentTrees(
	cands: NetCand[],
	route: (c: NetCand) => FireLinkRoute | null,
	opts: PruneOptions,
): KeptLink[] {
	const held = opts.held
	const isMon = (id: number) => id >= NETWORK_MONUMENT_ID_MIN
	const d2 = (c: NetCand) => (c.a.x - c.b.x) ** 2 + (c.a.z - c.b.z) ** 2
	const sorted = [...cands].sort((p, q) => d2(p) - d2(q) || (p.key < q.key ? -1 : 1))
	const kept: KeptLink[] = []
	const keptKeys = new Set<string>()
	const protect = new Set<string>()
	const add = (c: NetCand, r: FireLinkRoute, tree: boolean) => {
		kept.push({ cand: c, route: r }); keptKeys.add(c.key)
		if (tree) protect.add(c.key)
	}

	// Monument centres: given, else the mean of the link ends seen for that monument.
	const centre = new Map<number, { x: number; z: number; n: number }>()
	for (const m of opts.monuments ?? []) centre.set(m.id, { x: m.x, z: m.z, n: 1 })
	if (!opts.monuments) {
		for (const c of cands) {
			const e = isMon(c.a.id) ? c.a : isMon(c.b.id) ? c.b : null
			if (!e) continue
			const cur = centre.get(e.id) ?? { x: 0, z: 0, n: 0 }
			centre.set(e.id, { x: cur.x + e.x, z: cur.z + e.z, n: cur.n + 1 })
		}
	}
	const dMon = (f: FireNode): number => {
		let best = Infinity
		for (const m of centre.values()) best = Math.min(best, Math.hypot(f.x - m.x / m.n, f.z - m.z / m.n))
		return best
	}

	// 1. Monument links: every routable one (hop 1).
	const hop = new Map<number, number>()
	for (const c of sorted) {
		if (!isMon(c.a.id) && !isMon(c.b.id)) continue
		const r = route(c)
		if (!r) continue
		add(c, r, true)
		hop.set(isMon(c.a.id) ? c.b.id : c.a.id, 1)
	}

	// Fire-fire candidates, adjacency and the RNG (planar, short) subset.
	const ff = sorted.filter((c) => !isMon(c.a.id) && !isMon(c.b.id))
	const nbr = new Map<number, { c: NetCand; o: FireNode }[]>()
	const adj = new Map<number, Map<number, number>>()
	const firesById = new Map<number, FireNode>()
	const push = (id: number, e: { c: NetCand; o: FireNode }) => { const l = nbr.get(id); if (l) l.push(e); else nbr.set(id, [e]) }
	for (const c of ff) {
		push(c.a.id, { c, o: c.b }); push(c.b.id, { c, o: c.a })
		firesById.set(c.a.id, c.a); firesById.set(c.b.id, c.b)
		const w = d2(c)
		if (!adj.has(c.a.id)) adj.set(c.a.id, new Map())
		if (!adj.has(c.b.id)) adj.set(c.b.id, new Map())
		adj.get(c.a.id)!.set(c.b.id, w)
		adj.get(c.b.id)!.set(c.a.id, w)
	}
	const rng = new Set<string>()
	for (const c of ff) {
		const ab = d2(c)
		const na = adj.get(c.a.id)!, nb = adj.get(c.b.id)!
		if (!topologyBlocked(c.a, c.b, ab, na, nb, (k) => firesById.get(k))) rng.add(c.key)
	}

	// 2. Relays: closest-to-the-monument first, each links ONE parent: the nearest fire
	// that is closer to a monument and still inside the chain (hop <= 1 + NETWORK_TREE_FIRE_HOPS
	// once this fire joins). Closer-than-me makes cycles impossible. Candidates on the RNG come
	// first, then the nearest crossing-free route of the first few (else the nearest).
	// The hearth never relays charge, so it is never a tree node.
	const order = [...firesById.values()].filter((f) => !hop.has(f.id) && f.id !== NETWORK_HEARTH_ID).map((f) => ({ f, d: dMon(f) })).sort((p, q) => p.d - q.d || p.f.id - q.f.id)
	const isHeld = (e: { c: NetCand }) => (held?.has(e.c.key) ? 1 : 0)
	const isRng = (e: { c: NetCand }) => (rng.has(e.c.key) ? 1 : 0)
	for (const { f, d } of order) {
		const ps = (nbr.get(f.id) ?? [])
			.filter((e) => (hop.get(e.o.id) ?? 99) <= NETWORK_TREE_FIRE_HOPS && dMon(e.o) < d)
			.sort((p, q) => isHeld(q) - isHeld(p) || isRng(q) - isRng(p) || d2(p.c) - d2(q.c) || (p.c.key < q.c.key ? -1 : 1))
		let first: { c: NetCand; r: FireLinkRoute; h: number } | null = null
		let pick: { c: NetCand; r: FireLinkRoute; h: number } | null = null
		let tried = 0
		for (const e of ps) {
			if (tried >= NETWORK_TREE_PARENT_TRIES) break
			const r = route(e.c)
			if (!r) continue
			tried++
			const cand = { c: e.c, r, h: hop.get(e.o.id)! + 1 }
			if (!first) first = cand
			if (!kept.some((k) => routesCross(k.cand, k.route, e.c, r))) { pick = cand; break }
		}
		if (!pick) pick = first
		if (pick) { add(pick.c, pick.r, true); hop.set(f.id, pick.h) }
	}

	// 3. Everything outside the trees: RNG on fire pairs (as before; tree fires still block as third nodes).
	// An RNG link that crosses a kept route waits for the reconnect step (added there only if it is needed).
	const crossesKept = (c: NetCand, r: FireLinkRoute) => kept.some((k) => routesCross(k.cand, k.route, c, r))
	for (const c of ff) {
		if (hop.has(c.a.id) || hop.has(c.b.id) || !rng.has(c.key)) continue
		const r = route(c)
		if (r && !crossesKept(c, r)) add(c, r, false)
	}
	// Reconnect split components (shortest first). Tree-to-tree joins are not made: a
	// link needs a fire outside the trees at one end, and union-find never closes a cycle.
	if (NETWORK_RECONNECT_ENABLED) {
		const parent = new Map<number, number>()
		const find = (x: number): number => { let p = parent.get(x) ?? x; if (p !== x) { p = find(p); parent.set(x, p) } return p }
		const unite = (x: number, y: number) => parent.set(find(x), find(y))
		for (const k of kept) unite(k.cand.a.id, k.cand.b.id)
		for (const allowCross of [false, true]) for (const c of ff) {
			if (keptKeys.has(c.key) || find(c.a.id) === find(c.b.id)) continue
			if (hop.has(c.a.id) && hop.has(c.b.id)) continue
			const r = route(c)
			if (!r || (!allowCross && crossesKept(c, r))) continue
			add(c, r, false)
			unite(c.a.id, c.b.id)
		}
	}
	// 4. Monument clusters: every hop-1 fire links its nearest other hop-1 fires of the same monument (>= 1, ideally 2).
	// Protected (never dropped by the forest / parallel / cross rules). Held links first so lighting a fire never re-links a working pair.
	if (NETWORK_CLUSTER_LINKS_ENABLED) {
		const groups = new Map<number, FireNode[]>()
		const fireLinks = new Map<number, number>()
		for (const k of kept) {
			const am = isMon(k.cand.a.id), bm = isMon(k.cand.b.id)
			if (am || bm) {
				const m = am ? k.cand.a : k.cand.b, f = am ? k.cand.b : k.cand.a
				const l = groups.get(m.id); if (l) l.push(f); else groups.set(m.id, [f])
			} else if (hop.get(k.cand.a.id) === 1 && hop.get(k.cand.b.id) === 1) {
				// only links between two charging fires count (a relay child does not make a ring)
				fireLinks.set(k.cand.a.id, (fireLinks.get(k.cand.a.id) ?? 0) + 1)
				fireLinks.set(k.cand.b.id, (fireLinks.get(k.cand.b.id) ?? 0) + 1)
			}
		}
		const bump = (c: NetCand) => { fireLinks.set(c.a.id, (fireLinks.get(c.a.id) ?? 0) + 1); fireLinks.set(c.b.id, (fireLinks.get(c.b.id) ?? 0) + 1) }
		for (const [mid, fires] of [...groups].sort((p, q) => p[0] - q[0])) {
			const inGroup = new Set(fires.map((f) => f.id))
			const mc = centre.get(mid)
			const dm = (f: FireNode) => (mc ? Math.hypot(f.x - mc.x / mc.n, f.z - mc.z / mc.n) : 0)
			for (const f of [...fires].sort((p, q) => dm(p) - dm(q) || p.id - q.id)) {
				let need = NETWORK_CLUSTER_LINKS_WANT - (fireLinks.get(f.id) ?? 0)
				if (need <= 0) continue
				const ps = (nbr.get(f.id) ?? [])
					.filter((e) => inGroup.has(e.o.id) && !keptKeys.has(e.c.key))
					.sort((p, q) => isHeld(q) - isHeld(p) || d2(p.c) - d2(q.c) || (p.c.key < q.c.key ? -1 : 1))
				let tried = 0
				let fallback: { c: NetCand; r: FireLinkRoute } | null = null
				for (const e of ps) {
					if (need <= 0 || tried >= NETWORK_CLUSTER_TRIES) break
					const r = route(e.c)
					if (!r) continue
					tried++
					if (crossesKept(e.c, r)) { if (!fallback) fallback = { c: e.c, r }; continue }
					add(e.c, r, true); bump(e.c); need--
				}
				// At least one fire-fire link: accept a crossing route when nothing crossing-free was found.
				if ((fireLinks.get(f.id) ?? 0) === 0 && fallback) { add(fallback.c, fallback.r, true); bump(fallback.c) }
			}
		}
	}

	// Any component that holds a monument or a tree fire is made a forest: its non-tree links
	// (RNG / reconnect, shortest first) only stay if they join two separate pieces, so a relay
	// that also sits in a loop of outside links never closes a cycle near a monument.
	const comp = new Map<number, number>()
	const cf = (x: number): number => { let p = comp.get(x) ?? x; if (p !== x) { p = cf(p); comp.set(x, p) } return p }
	for (const k of kept) comp.set(cf(k.cand.a.id), cf(k.cand.b.id))
	const treeRoots = new Set<number>()
	for (const k of kept) for (const id of [k.cand.a.id, k.cand.b.id]) if (isMon(id) || hop.has(id)) treeRoots.add(cf(id))
	const forest = new Map<number, number>()
	const ff2 = (x: number): number => { let p = forest.get(x) ?? x; if (p !== x) { p = ff2(p); forest.set(x, p) } return p }
	const out: KeptLink[] = []
	for (const k of kept) if (protect.has(k.cand.key)) { forest.set(ff2(k.cand.a.id), ff2(k.cand.b.id)); out.push(k) }
	for (const k of kept) {
		if (protect.has(k.cand.key)) continue
		if (treeRoots.has(cf(k.cand.a.id)) && ff2(k.cand.a.id) === ff2(k.cand.b.id)) continue
		forest.set(ff2(k.cand.a.id), ff2(k.cand.b.id)); out.push(k)
	}
	return dropParallel(out, false, protect)
}
// MARK: trimEnd
function trimEnd(map: TerrainMap, run: LinkRun, atStart: boolean, end: { x: number; z: number }): void {
	const pts = atStart ? [...run.pts].reverse() : run.pts.slice()
	const r2 = NETWORK_END_STRAIGHT_M * NETWORK_END_STRAIGHT_M
	// pts[last] is the end node; drop interior points near it (keep >= 2 points).
	let cut = pts.length - 1
	while (cut - 1 > 0 && (pts[cut - 1].x - end.x) ** 2 + (pts[cut - 1].z - end.z) ** 2 < r2) cut--
	if (cut === pts.length - 1) return
	const prev = pts[cut - 1]
	if (!clearLine(map, run.level, prev, end) && !straightOnLevel(map, run.level, prev, end)) return
	const out = [...pts.slice(0, cut), pts[pts.length - 1]]
	run.pts = atStart ? out.reverse() : out
}

/** Centreline-only walkable check (the full-width clearLine can fail beside a wall). */
function straightOnLevel(map: TerrainMap, level: number, p: { x: number; z: number }, q: { x: number; z: number }): boolean {
	const L = Math.hypot(q.x - p.x, q.z - p.z)
	const n = Math.max(1, Math.ceil(L))
	for (let s = 0; s <= n; s++) {
		const x = p.x + ((q.x - p.x) * s) / n, z = p.z + ((q.z - p.z) * s) / n
		if (levelAtWorld(map, x, z) !== level) return false
		const c = cellOfWorld(x, z)
		if (map.landforms[c.cz * W + c.cx] === LANDFORM_LAVA) return false
	}
	return true
}