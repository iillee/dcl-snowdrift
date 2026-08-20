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
 * Uses a local mulberry32 RNG instance rather than the shared maze
 * rng.ts so we never perturb the maze generator's RNG state.
 */

import {
	MAZE_GRID_HEIGHT,
	MAZE_GRID_WIDTH,
	MAZE_ORIGIN_OFFSET_METERS,
	MAZE_TILE_WORLD_METERS,
} from 'src/shared/settings'

import { PROP_CATALOG, PropDef } from 'src/shared/props/catalog'


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
	const phase1Cells  : Array<{ def: PropDef; tx: number; tz: number }> = []
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
	const phase2Cells : Array<{ def: PropDef; tx: number; tz: number }> = []
	for (const def of PROP_CATALOG.filter(p => !p.reserves)) {
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

	// ── Jitter + yaw pass (shared RNG for both phases) ───────────
	const jitterRng = makeRng((seed | 0) ^ 0x4A495454) // 'JITT'
	for (const c of [...phase1Cells, ...phase2Cells]) {
		out.push(materialize(c.def, c.tx, c.tz, jitterRng))
	}
	return out
}


// MARK: Internal helpers

const cellKey = (tx: number, tz: number): string => `${tx},${tz},0`

function mergeSets(a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> {
	const out = new Set<string>(a)
	for (const k of b) out.add(k)
	return out
}

const CENTER_TX = Math.floor(MAZE_GRID_WIDTH  / 2)
const CENTER_TZ = Math.floor(MAZE_GRID_HEIGHT / 2)

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
	def : PropDef,
	tx  : number,
	tz  : number,
	rng : () => number,
): PropPlacement {
	// Jitter within the cell — keep a small margin so props don't cross
	// tile borders and end up half-inside a neighbor.
	const MARGIN = 0.15 // fraction of cell reserved as edge buffer
	const jx = MARGIN + rng() * (1 - 2 * MARGIN)
	const jz = MARGIN + rng() * (1 - 2 * MARGIN)
	const worldX = MAZE_ORIGIN_OFFSET_METERS + (tx + jx) * MAZE_TILE_WORLD_METERS
	const worldZ = MAZE_ORIGIN_OFFSET_METERS + (tz + jz) * MAZE_TILE_WORLD_METERS
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
