/**
 * snowState.ts — authoritative snow melt / regrowth state.
 *
 * Clients send cell keys via paintTick; fires melt discs around
 * themselves. Every state change is written through snowSync as a
 * PaintTile byte, and dirty tiles are flushed once per tick by server.ts.
 *
 * Cells absent from `cells` are pristine (stage 3). Fire-protected cells
 * never regrow while protected.
 */

import {
	SNOW_CELLS_X,
	SNOW_CELLS_Z,
	STAGE_PRISTINE,
	SnowStage,
	cellKey,
	forEachCellInDisc,
	isCellKeyValid,
	snowByteFromStage,
	worldToCellKey,
} from 'src/shared/snowGrid'

import { noteComponentChange } from 'src/server/serverStats'
import { publishSnowCoverage, writeSnowByte, zeroAllSnowTiles } from 'src/server/snowSync'

// changedAtMs = server clock at the last stage transition (or melt refresh).
type CellState = { stage: 0 | 1 | 2; changedAtMs: number }

const cells          = new Map<number, CellState>()
const protectedCells = new Set<number>()

let serverClockMs = 0
let coverageDirty = false

// Regrowth ms per stage, keyed by precipitation level. CLEAR (0) freezes.
const STAGE_INTERVAL_MS: Record<number, number | null> = {
	0: null,
	1: 30000,
	2: 20000,
	3: 12000,
}


// MARK: writeStage

function writeStage(
	key:   number,
	stage: SnowStage,
): void {
	if (writeSnowByte(key, snowByteFromStage(stage))) noteComponentChange(1)
}


// MARK: applyMelt

/**
 * Apply a player or fire melt to one cell.
 *   targetStage 0 = full melt (lit torch, fire ring). Always lands at stage 0;
 *                   an already-melted cell just refreshes its regrowth clock.
 *   targetStage 1 = stomp (unlit walk). Only demotes pristine or stage-2 cells.
 * Returns true when the cell's stage changed.
 */
export function applyMelt(
	key:         number,
	targetStage: 0 | 1,
): boolean {
	if (!isCellKeyValid(key)) return false
	const prev = cells.get(key)

	if (targetStage === 1) {
		const current: SnowStage = prev ? prev.stage : STAGE_PRISTINE
		if (current < 2) return false
		cells.set(key, { stage: 1, changedAtMs: serverClockMs })
		writeStage(key, 1)
		coverageDirty = true
		return true
	}

	if (prev && prev.stage === 0) {
		prev.changedAtMs = serverClockMs
		return false
	}
	cells.set(key, { stage: 0, changedAtMs: serverClockMs })
	writeStage(key, 0)
	coverageDirty = true
	return true
}


// MARK: getStageAtWorld

/**
 * Authoritative stage at world (x, z). Missing cells are pristine.
 * Off-playfield reads as pristine so callers never treat a cliff
 * pocket as melted ground.
 */
export function getStageAtWorld(
	x: number,
	z: number,
): SnowStage {
	const key = worldToCellKey(x, z)
	if (key === null) return STAGE_PRISTINE
	const state = cells.get(key)
	return state ? state.stage : STAGE_PRISTINE
}


// MARK: meltDisc

/**
 * Melt and heat-protect every cell within `radiusM` of world (cx, cz).
 * Idempotent; returns the count of cells whose stage changed.
 */
export function meltDisc(
	cx:      number,
	cz:      number,
	radiusM: number,
): number {
	let changed = 0
	forEachCellInDisc(cx, cz, radiusM, (key) => {
		protectedCells.add(key)
		if (applyMelt(key, 0)) changed++
	})
	return changed
}


// MARK: releaseDiscOutside

/**
 * Release heat protection on cells within `previousRadiusM` of (cx, cz)
 * but outside `radiusM`. Released cells keep their stage and regrow
 * naturally from now. `previousRadiusM` bounds the sweep so shrinking one
 * fire never releases another fire's ring.
 */
export function releaseDiscOutside(
	cx:              number,
	cz:              number,
	radiusM:         number,
	previousRadiusM: number,
): void {
	const r2     = radiusM * radiusM
	let released = 0
	forEachCellInDisc(cx, cz, previousRadiusM, (key, distSq) => {
		if (distSq <= r2) return
		if (protectedCells.delete(key)) released++
	})
	if (released > 0) {
		console.log(`snowState: releaseDiscOutside: ${radiusM.toFixed(1)}m (prev ${previousRadiusM.toFixed(1)}m) released ${released} cells`)
	}
}


// MARK: tickRegrowth

/**
 * Advance the server clock by `dtMs` and move every unprotected cell one
 * stage toward pristine when its elapsed time crosses the next threshold.
 */
export function tickRegrowth(
	dtMs:               number,
	precipitationLevel: number,
): void {
	serverClockMs += dtMs
	const intervalMs = STAGE_INTERVAL_MS[precipitationLevel] ?? null
	if (intervalMs === null) return

	for (const [key, state] of cells) {
		if (protectedCells.has(key)) {
			state.changedAtMs = serverClockMs
			continue
		}
		const nextStage = state.stage + 1
		if (serverClockMs - state.changedAtMs < intervalMs * nextStage) continue

		if (nextStage >= STAGE_PRISTINE) {
			cells.delete(key)
			writeStage(key, STAGE_PRISTINE)
			coverageDirty = true
			continue
		}
		state.stage = nextStage as 1 | 2
		writeStage(key, state.stage)
	}
}


// MARK: meltRandomCells

/** Dev load test: fully melt up to `count` random unprotected cells. Returns cells changed. */
export function meltRandomCells(count: number): number {
	let changed  = 0
	let attempts = 0
	const maxAttempts = count * 4
	while (changed < count && attempts < maxAttempts) {
		attempts++
		const key = cellKey(
			Math.floor(Math.random() * SNOW_CELLS_X),
			Math.floor(Math.random() * SNOW_CELLS_Z),
		)
		if (protectedCells.has(key)) continue
		if (applyMelt(key, 0)) changed++
	}
	return changed
}


// MARK: clearAllSnow

/** Cycle reset: every cell back to pristine, all protection dropped. */
export function clearAllSnow(): void {
	const cleared = cells.size
	cells.clear()
	protectedCells.clear()
	zeroAllSnowTiles()
	noteComponentChange(cleared)
	coverageDirty = true
}


// MARK: meltedCellCount

/** Cells that are melted or regrowing (not pristine). */
export function meltedCellCount(): number {
	return cells.size
}


// MARK: publishCoverageIfDirty

/** Publish PaintCoverage when the melted count may have changed. */
export function publishCoverageIfDirty(): void {
	if (!coverageDirty) return
	publishSnowCoverage(cells.size)
	coverageDirty = false
}
