/**
 * scatter.ts — pure, seeded prop placement.
 *
 * Given a maze seed and the current reserved-cell set, produce a
 * deterministic list of PropPlacement records — one per instance to
 * spawn. No engine imports, no side effects; safe from tests.
 *
 * Determinism contract: same (seed, reservedCells, PROP_CATALOG) →
 * identical PropPlacement[]. That guarantee is what lets every client
 * spawn identical props without any network sync.
 *
 * Placement phases after reserving props:
 *   1. Hearth tree ring (catalog radiiM)
 *   2. Low destination grove (hearth-like spacing)
 *   3. Sparse wilderness deadwood across walkable levels
 *
 * Uses a local mulberry32 RNG instance rather than the shared maze
 * rng.ts so we never perturb the maze generator's RNG state.
 */

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { GroveParams, listGroveSitesForMazeSeed } from 'src/shared/grove'
import { PROP_CATALOG, PropDef } from 'src/shared/props/catalog'
import {
	MAZE_GRID_HEIGHT,
	MAZE_GRID_WIDTH,
	MAZE_ORIGIN_OFFSET_METERS,
	MAZE_TILE_WORLD_METERS,
} from 'src/shared/settings'
import {
	getTerrain,
	impassableCellsForMazeSeed,
} from 'src/shared/terrain/terrainCache'
import {
	cellCenterWorld,
	TerrainDestination,
} from 'src/shared/terrain/terrainMap'


/**
 * Base metres from a destination centroid — mirrors hearth tree radii,
 * then scaled per-grove by GroveParams.radiusScale.
 */
const DEST_GROVE_RADII_M: readonly number[] = [64, 96, 144, 88, 168, 104, 120, 80]

/** Sparse wilderness deadwood across the walkable map (not mountain rim). */
const WILD_TREE_COUNT = 18
/** Min trunk spacing between wilderness trees (and vs hearth/grove trunks). */
const WILD_MIN_SEP_M = 140
/** Keep wilderness trees outside the outer hearth ring. */
const WILD_HEARTH_KEEP_M = 200


// MARK: PropPlacement
/**
 * One instance to spawn. World-space X/Z already resolved (cell centre
 * + jitter); Y is prop.yOffset (spawner adds ground level if needed).
 */
export interface PropPlacement {
	propId : string
	worldX : number
	worldY : number
	worldZ : number
	yawDeg : number
	scale  : number
	/** Grid cell the prop sits on — useful for reservation bookkeeping. */
	tx     : number
	tz     : number
}


// MARK: Local RNG
// Mulberry32, isolated per scatter run. Do NOT swap for the shared
// maze rng — that would couple the maze's output to prop count.
function makeRng(seed: number): () => number {
	let s = seed | 0
	return () => {
		s |= 0
		s = (s + 0x6D2B79F5) | 0
		let t = s
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}


// MARK: getPropReservations
/**
 * Cells that must be added to the maze generator's reserved set BEFORE
 * generate() runs, so structural props (reserves=true) have the maze
 * flow around them. Non-reserving props (trees, NPCs) don't contribute.
 *
 * NOTE: currently returns [] because no cataloged prop reserves. The
 * function exists so wiring is ready for hut-style props later.
 */
export function getPropReservations(
	seed             : number,
	existingReserved : ReadonlySet<string>,
): Array<{ tx: number; tz: number }> {
	const reserving = PROP_CATALOG.filter(p => p.reserves)
	if (reserving.length === 0) return []

	const rng = makeRng((seed | 0) ^ 0x50524F50) // 'PROP' salt, phase 1
	const out : Array<{ tx: number; tz: number }> = []
	const claimed = new Set<string>(existingReserved)

	for (const def of reserving) {
		for (let i = 0; i < def.count; i++) {
			const cell = pickCell(rng, def, claimed)
			if (cell === null) {
				console.log(`scatter: getPropReservations: ${def.id}: could not place instance ${i + 1}/${def.count}`)
				break
			}
			claimed.add(cellKey(cell.tx, cell.tz))
			out.push(cell)
		}
	}
	return out
}


// MARK: scatterProps
/**
 * Produce the full PropPlacement list for the given seed. Callers pass
 * the final reserved-cell set (post-getPropReservations, post-perimeter)
 * so scatter can avoid stepping on any of them.
 *
 * Runs deterministically in PROP_CATALOG order. Reserving props place
 * on the same cells they claimed in phase 1 (getPropReservations); we
 * re-derive by using the same salted RNG stream.
 */
export function scatterProps(
	seed         : number,
	reservedSet  : ReadonlySet<string>,
): PropPlacement[] {
	const out : PropPlacement[] = []

	// ── Phase 1 rerun (reserving props) ──────────────────────────
	// Same salt + iteration order as getPropReservations, so the same
	// cells come out. Placements are added to `out` with jitter+yaw
	// from the second RNG stream below.
	const phase1Rng    = makeRng((seed | 0) ^ 0x50524F50)
	const phase1Claims = new Set<string>()
	const phase1Cells  : Array<{ def: PropDef; tx: number; tz: number; worldX?: number; worldZ?: number }> = []
	for (const def of PROP_CATALOG.filter(p => p.reserves)) {
		for (let i = 0; i < def.count; i++) {
			const cell = pickCell(phase1Rng, def, mergeSets(reservedSet, phase1Claims))
			if (cell === null) break
			phase1Claims.add(cellKey(cell.tx, cell.tz))
			phase1Cells.push({ def, tx: cell.tx, tz: cell.tz })
		}
	}

	// ── Phase 2: non-reserving props ─────────────────────────────
	const phase2Rng   = makeRng((seed | 0) ^ 0x53434154) // 'SCAT'
	const usedCells   = new Set<string>(phase1Claims) // don't double-up
	const phase2Cells : Array<{ def: PropDef; tx: number; tz: number; worldX?: number; worldZ?: number }> = []
	for (const def of PROP_CATALOG.filter(p => !p.reserves)) {
		if (def.radiiM !== undefined && def.radiiM.length > 0) {
			const ring = placeRing(phase2Rng, def, mergeSets(reservedSet, usedCells))
			for (const p of ring) {
				usedCells.add(cellKey(p.tx, p.tz))
				phase2Cells.push(p)
			}
			continue
		}
		for (let i = 0; i < def.count; i++) {
			const cell = pickCell(phase2Rng, def, mergeSets(reservedSet, usedCells))
			if (cell === null) {
				console.log(`scatter: scatterProps: ${def.id}: could not place instance ${i + 1}/${def.count}`)
				break
			}
			usedCells.add(cellKey(cell.tx, cell.tz))
			phase2Cells.push({ def, tx: cell.tx, tz: cell.tz })
		}
	}

	// ── Phase 3: major grove at each green destination ───────────
	const treeDef = PROP_CATALOG.find(p => p.id === 'tree_4')
	if (treeDef !== undefined) {
		const sites = listGroveSitesForMazeSeed(seed)
		for (const site of sites) {
			const groveRng = makeRng(
				(seed | 0) ^ 0x47524F56 ^ (site.params.destIndex * 0x9E3779B9),
			)
			const grove = placeDestinationGrove(
				groveRng,
				treeDef,
				seed,
				usedCells,
				site.dest,
				site.params,
			)
			for (const p of grove) {
				usedCells.add(cellKey(p.tx, p.tz))
				phase2Cells.push(p)
			}
		}
	}

	// ── Phase 4: sparse wilderness deadwood ──────────────────────
	if (treeDef !== undefined) {
		const wildRng = makeRng((seed | 0) ^ 0x57494C44) // 'WILD'
		const placed  = phase2Cells.filter(p => p.worldX !== undefined)
		const wild    = placeWildernessTrees(wildRng, treeDef, seed, usedCells, placed)
		for (const p of wild) {
			usedCells.add(cellKey(p.tx, p.tz))
			phase2Cells.push(p)
		}
	}

	// ── Jitter + yaw pass (shared RNG for both phases) ───────────
	const jitterRng = makeRng((seed | 0) ^ 0x4A495454) // 'JITT'
	for (const c of [...phase1Cells, ...phase2Cells]) {
		out.push(materialize(c.def, c.tx, c.tz, jitterRng, c.worldX, c.worldZ))
	}
	return out
}


// MARK: trunkDiscs
/**
 * Trunk discs for the scattered trees. Radius is the scaled shaft,
 * the same keep-out the ring uses against cliffs.
 */
export function trunkDiscs(
	seed    : number,
	reserved: ReadonlySet<string>,
): Array<{ x: number; z: number; radius: number }> {
	return scatterProps(seed, reserved)
		.filter(p => p.propId === 'tree_4')
		.map(p => ({
			x     : p.worldX,
			z     : p.worldZ,
			radius: p.scale * TREE_TRUNK_RADIUS_M,
		}))
}


// MARK: Internal helpers

const cellKey = (tx: number, tz: number): string => `${tx},${tz},0`

// Unscaled tree_4 trunk, metres. The shaft stays under 0.4; the canopy
// reaches ~2.9 and is allowed to cross a cliff. Max scale is
// scale * (1 + scaleJitter), so the ring keeps that trunk off cliffs.
const TREE_TRUNK_RADIUS_M = 0.4


// MARK: reachesBlocked
/**
 * True when a disc at (worldX, worldZ) touches a blocked cell.
 * Distance is to the cell rectangle, so a trunk just outside the
 * cell still counts when the scaled trunk would intersect it.
 */
function reachesBlocked(
	worldX : number,
	worldZ : number,
	blocked: ReadonlySet<string>,
	reach  : number,
): boolean {
	const C    = MAZE_TILE_WORLD_METERS
	const O    = MAZE_ORIGIN_OFFSET_METERS
	const reachSq = reach * reach
	for (const key of blocked) {
		const [tx, tz] = key.split(',').map(Number)
		const x0 = O + tx * C
		const z0 = O + tz * C
		const x1 = x0 + C
		const z1 = z0 + C
		const dx = Math.max(x0 - worldX, 0, worldX - x1)
		const dz = Math.max(z0 - worldZ, 0, worldZ - z1)
		if (dx * dx + dz * dz < reachSq) return true
	}
	return false
}

function mergeSets(a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> {
	const out = new Set<string>(a)
	for (const k of b) out.add(k)
	return out
}

const CENTER_TX = Math.floor(MAZE_GRID_WIDTH  / 2)
const CENTER_TZ = Math.floor(MAZE_GRID_HEIGHT / 2)

// MARK: ringBearings

/**
 * Bearings around the hearth. Each tree keeps its catalog radius.
 * The gaps are random weights around the circle, with a floor so two
 * trunks do not share a spoke, then the whole set turns with the seed.
 */
function ringBearings(
	rng  : () => number,
	count: number,
): number[] {
	// Weight span [0.35, 1.75]. After normalising, a quiet seed stays
	// near even, and a loud one clusters a pair or opens a wide gap.
	const GAP_FLOOR = 0.35
	const weights : number[] = []
	let sum = 0
	for (let i = 0; i < count; i++) {
		const w = GAP_FLOOR + rng() * 1.4
		weights.push(w)
		sum += w
	}
	const out : number[] = []
	let ang = rng() * Math.PI * 2
	for (let i = 0; i < count; i++) {
		out.push(ang)
		ang += (weights[i] / sum) * Math.PI * 2
	}
	return out
}


// MARK: placeWildernessTrees

/**
 * Sparse deadwood across all walkable levels. High min separation so
 * a lone tree feels significant; mountain rim and the dest grove
 * region are excluded. Spacing is also enforced against already-placed
 * hearth and grove trunks.
 */
function placeWildernessTrees(
	rng     : () => number,
	def     : PropDef,
	mazeSeed: number,
	used    : ReadonlySet<string>,
	placed  : ReadonlyArray<{ worldX?: number; worldZ?: number }>,
): Array<{ def: PropDef; tx: number; tz: number; worldX: number; worldZ: number }> {
	const map  = getTerrain(mazeSeed)
	const groveRegions = new Set(map.destinations.map(d => d.region))
	const blocked = mergeSets(impassableCellsForMazeSeed(mazeSeed), used)
	const reach   = def.scale * (1 + (def.scaleJitter ?? 0)) * TREE_TRUNK_RADIUS_M
	const out     : Array<{ def: PropDef; tx: number; tz: number; worldX: number; worldZ: number }> = []
	const minSepSq = WILD_MIN_SEP_M * WILD_MIN_SEP_M
	const hearthKeepSq = WILD_HEARTH_KEEP_M * WILD_HEARTH_KEEP_M
	const prior: Array<{ x: number; z: number }> = []
	for (const p of placed) {
		if (p.worldX === undefined || p.worldZ === undefined) continue
		prior.push({ x: p.worldX, z: p.worldZ })
	}

	const candidates: Array<{ tx: number; tz: number }> = []
	for (let cz = 0; cz < map.h; cz++) {
		for (let cx = 0; cx < map.w; cx++) {
			const i = cz * map.w + cx
			if (map.routeDist[i] < 0) continue
			if (groveRegions.has(map.regions[i])) continue
			const key = cellKey(cx, cz)
			if (blocked.has(key)) continue
			candidates.push({ tx: cx, tz: cz })
		}
	}
	for (let i = candidates.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1))
		const t = candidates[i]
		candidates[i] = candidates[j]
		candidates[j] = t
	}

	const tooClose = (x: number, z: number): boolean => {
		const hdx = x - CAMPFIRE_WORLD_X
		const hdz = z - CAMPFIRE_WORLD_Z
		if (hdx * hdx + hdz * hdz < hearthKeepSq) return true
		for (const p of prior) {
			const dx = x - p.x
			const dz = z - p.z
			if (dx * dx + dz * dz < minSepSq) return true
		}
		for (const p of out) {
			const dx = x - p.worldX
			const dz = z - p.worldZ
			if (dx * dx + dz * dz < minSepSq) return true
		}
		return false
	}

	for (const cell of candidates) {
		if (out.length >= WILD_TREE_COUNT) break
		const worldX = MAZE_ORIGIN_OFFSET_METERS + (cell.tx + 0.3 + rng() * 0.4) * MAZE_TILE_WORLD_METERS
		const worldZ = MAZE_ORIGIN_OFFSET_METERS + (cell.tz + 0.3 + rng() * 0.4) * MAZE_TILE_WORLD_METERS
		if (tooClose(worldX, worldZ)) continue
		if (reachesBlocked(worldX, worldZ, blocked, reach)) continue
		out.push({ def, tx: cell.tx, tz: cell.tz, worldX, worldZ })
	}

	console.log(
		`scatter: placeWildernessTrees: placed ${out.length}/${WILD_TREE_COUNT} ` +
		`from ${candidates.length} walkable candidates`,
	)
	return out
}


// MARK: placeDestinationGrove

/**
 * Living-tree grove inside one destination region. Tree count, radius
 * scale, and min separation come from GroveParams so each socket can
 * feel dense, scattered, or rich without bespoke per-level code.
 */
function placeDestinationGrove(
	rng     : () => number,
	def     : PropDef,
	mazeSeed: number,
	used    : ReadonlySet<string>,
	dest    : TerrainDestination,
	params  : GroveParams,
): Array<{ def: PropDef; tx: number; tz: number; worldX: number; worldZ: number }> {
	const map = getTerrain(mazeSeed)
	const regionKeys = new Set<string>()
	const regionCells: Array<{ tx: number; tz: number }> = []
	for (let cz = 0; cz < map.h; cz++) {
		for (let cx = 0; cx < map.w; cx++) {
			if (map.regions[cz * map.w + cx] !== dest.region) continue
			regionKeys.add(cellKey(cx, cz))
			regionCells.push({ tx: cx, tz: cz })
		}
	}
	if (regionCells.length === 0) {
		console.log(
			`scatter: placeDestinationGrove: destination region ${dest.region} has no cells`,
		)
		return []
	}
	const blocked = mergeSets(impassableCellsForMazeSeed(mazeSeed), used)
	const reach   = def.scale * (1 + (def.scaleJitter ?? 0)) * TREE_TRUNK_RADIUS_M
	const out     : Array<{ def: PropDef; tx: number; tz: number; worldX: number; worldZ: number }> = []
	const claimed = new Set<string>()
	const centre  = cellCenterWorld(dest.cx, dest.cz)
	const count   = Math.min(params.treeCount, DEST_GROVE_RADII_M.length)
	const bearings = ringBearings(rng, count)
	const NUDGES   = 180
	const delta    = (Math.PI * 2) / NUDGES
	const minSepSq = params.minSepM * params.minSepM

	const accept = (
		worldX: number,
		worldZ: number,
	): { tx: number; tz: number } | null => {
		const tx = Math.floor((worldX - MAZE_ORIGIN_OFFSET_METERS) / MAZE_TILE_WORLD_METERS)
		const tz = Math.floor((worldZ - MAZE_ORIGIN_OFFSET_METERS) / MAZE_TILE_WORLD_METERS)
		if (tx < 0 || tz < 0 || tx >= MAZE_GRID_WIDTH || tz >= MAZE_GRID_HEIGHT) return null
		const key = cellKey(tx, tz)
		if (!regionKeys.has(key) || blocked.has(key) || claimed.has(key)) return null
		if (reachesBlocked(worldX, worldZ, blocked, reach)) return null
		for (const p of out) {
			const dx = worldX - p.worldX
			const dz = worldZ - p.worldZ
			if (dx * dx + dz * dz < minSepSq) return null
		}
		return { tx, tz }
	}

	for (let i = 0; i < count; i++) {
		const radius = DEST_GROVE_RADII_M[i] * params.radiusScale
		let placed = false
		for (let n = 0; n < NUDGES; n++) {
			const side = n === 0 ? 0 : (n % 2 === 1 ? 1 : -1) * Math.ceil(n / 2)
			const ang  = bearings[i] + side * delta
			const worldX = centre.x + Math.sin(ang) * radius
			const worldZ = centre.z + Math.cos(ang) * radius
			const cell = accept(worldX, worldZ)
			if (cell === null) continue
			claimed.add(cellKey(cell.tx, cell.tz))
			out.push({ def, tx: cell.tx, tz: cell.tz, worldX, worldZ })
			placed = true
			break
		}
		if (!placed) {
			console.log(
				`scatter: placeDestinationGrove: ring slot ${i + 1}/${count} ` +
				`r=${radius.toFixed(0)}m lv=${dest.level} missed — sparse fill`,
			)
		}
	}

	if (out.length < count) {
		for (let i = regionCells.length - 1; i > 0; i--) {
			const j = Math.floor(rng() * (i + 1))
			const t = regionCells[i]
			regionCells[i] = regionCells[j]
			regionCells[j] = t
		}
		for (const cell of regionCells) {
			if (out.length >= count) break
			const worldX = MAZE_ORIGIN_OFFSET_METERS + (cell.tx + 0.35 + rng() * 0.3) * MAZE_TILE_WORLD_METERS
			const worldZ = MAZE_ORIGIN_OFFSET_METERS + (cell.tz + 0.35 + rng() * 0.3) * MAZE_TILE_WORLD_METERS
			const ok = accept(worldX, worldZ)
			if (ok === null) continue
			claimed.add(cellKey(ok.tx, ok.tz))
			out.push({ def, tx: ok.tx, tz: ok.tz, worldX, worldZ })
		}
	}

	console.log(
		`scatter: placeDestinationGrove: placed ${out.length}/${count} ` +
		`lv=${dest.level} region=${dest.region} at (${dest.cx},${dest.cz}) ` +
		`scale=${params.radiusScale.toFixed(2)}`,
	)
	return out
}


// MARK: placeRing

/**
 * Copies around the hearth, each at its own radius, on the bearings
 * from ringBearings. A slot on a cliff, or close enough that the
 * scaled trunk would intersect it, is refused. The tree then walks
 * that same circle in small steps and takes the nearest angle where
 * the trunk is clear. If the whole circle is blocked, the tree is
 * skipped.
 */
function placeRing(
	rng    : () => number,
	def    : PropDef,
	blocked: ReadonlySet<string>,
): Array<{ def: PropDef; tx: number; tz: number; worldX: number; worldZ: number }> {
	const radii    = def.radiiM ?? []
	const count    = Math.min(def.count, radii.length)
	const bearings = ringBearings(rng, count)
	const reach    = def.scale * (1 + (def.scaleJitter ?? 0)) * TREE_TRUNK_RADIUS_M
	const out      : Array<{ def: PropDef; tx: number; tz: number; worldX: number; worldZ: number }> = []
	const claimed  = new Set<string>()
	// 2° steps. Coarse steps on the outer rings jumped well past the
	// first angle whose trunk cleared the cliff.
	const NUDGES   = 180
	const delta    = (Math.PI * 2) / NUDGES
	for (let i = 0; i < count; i++) {
		const radius = radii[i]
		let placed = false
		for (let n = 0; n < NUDGES; n++) {
			const side   = n === 0 ? 0 : (n % 2 === 1 ? 1 : -1) * Math.ceil(n / 2)
			const ang    = bearings[i] + side * delta
			const worldX = CAMPFIRE_WORLD_X + Math.sin(ang) * radius
			const worldZ = CAMPFIRE_WORLD_Z + Math.cos(ang) * radius
			const tx     = Math.floor((worldX - MAZE_ORIGIN_OFFSET_METERS) / MAZE_TILE_WORLD_METERS)
			const tz     = Math.floor((worldZ - MAZE_ORIGIN_OFFSET_METERS) / MAZE_TILE_WORLD_METERS)
			if (tx < 0 || tz < 0 || tx >= MAZE_GRID_WIDTH || tz >= MAZE_GRID_HEIGHT) continue
			const key = cellKey(tx, tz)
			if (blocked.has(key) || claimed.has(key)) continue
			if (reachesBlocked(worldX, worldZ, blocked, reach)) continue
			claimed.add(key)
			out.push({ def, tx, tz, worldX, worldZ })
			placed = true
			break
		}
		if (!placed) {
			console.log(`scatter: placeRing: ${def.id}: could not place instance ${i + 1}/${count}`)
		}
	}
	return out
}


function pickCell(
	rng     : () => number,
	def     : PropDef,
	blocked : ReadonlySet<string>,
): { tx: number; tz: number } | null {
	const minDist = def.minCellsFromCampfire ?? 0
	const MAX_ATTEMPTS = 200
	for (let a = 0; a < MAX_ATTEMPTS; a++) {
		const tx = Math.floor(rng() * MAZE_GRID_WIDTH)
		const tz = Math.floor(rng() * MAZE_GRID_HEIGHT)
		if (blocked.has(cellKey(tx, tz))) continue
		const dx = tx - CENTER_TX
		const dz = tz - CENTER_TZ
		if (dx * dx + dz * dz < minDist * minDist) continue
		return { tx, tz }
	}
	return null
}

function materialize(
	def    : PropDef,
	tx     : number,
	tz     : number,
	rng    : () => number,
	fixedX?: number,
	fixedZ?: number,
): PropPlacement {
	// Jitter within the cell — keep a small margin so props don't cross
	// tile borders and end up half-inside a neighbor. Ring slots pass
	// a fixed point so the even spacing survives.
	const MARGIN = 0.15 // fraction of cell reserved as edge buffer
	const jx = MARGIN + rng() * (1 - 2 * MARGIN)
	const jz = MARGIN + rng() * (1 - 2 * MARGIN)
	const worldX = fixedX ?? (MAZE_ORIGIN_OFFSET_METERS + (tx + jx) * MAZE_TILE_WORLD_METERS)
	const worldZ = fixedZ ?? (MAZE_ORIGIN_OFFSET_METERS + (tz + jz) * MAZE_TILE_WORLD_METERS)
	const yawDeg = (def.randomYaw ?? true) ? rng() * 360 : 0
	const jitter = def.scaleJitter ?? 0
	const scale  = def.scale * (1 + (rng() * 2 - 1) * jitter)
	return {
		propId : def.id,
		worldX,
		worldY : def.yOffset,
		worldZ,
		yawDeg,
		scale,
		tx,
		tz,
	}
}
