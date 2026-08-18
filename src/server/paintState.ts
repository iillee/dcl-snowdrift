/**
 * paintState.ts — authoritative paint map as chunked PaintTile CRDT + palette.
 *
 * Clients send cell ids via paintTick. Server interns the sender's team
 * Color4 into the palette, writes a packed byte into the owning tile
 * buffer (see paintSync.writeCellByte), and publishes coverage on
 * PaintCoverage. Dirty tiles are flushed once per server tick from
 * server.ts via flushDirtyPaintTiles(). No room-message state sync.
 */

import { Color4 } from '@dcl/sdk/math'

import {
	PaletteEntry,
	PaintCoverage,
} from 'src/shared/components'
import { cellIdToKey, packCellByte } from 'src/shared/paintGrid'
import {
	colorKey,
	teamColor,
	teamPaletteIndex,
	PALETTE_NONE,
	PALETTE_RED,
	PALETTE_BLUE,
	MAX_PALETTE_INDEX,
	TEAM_COLORS,
} from 'src/shared/palette'
import {
	ensurePaletteEntity,
	getPaintCoverageEntity,
	writeCellByte,
	zeroAllPaintTiles,
} from 'src/shared/paintSync'
import { Team } from 'src/shared/team'

import { noteComponentChange } from 'src/server/serverStats'

// colorKey → palette index
const colorToIndex = new Map<string, number>()
// index → Color4
const indexToColor: Color4[] = []
let nextPaletteIndex = 0

// cellId → authoritative cell state. Absent = unpainted / full snow.
// paintedAtMs is the server clock (accumulated dt × 1000) at the moment
// stage was last reset to 0 (either from a fresh paint or from a
// campfire-ring refresh). stage is the current regrowth stage 0..2.
type CellState = { index: number; paintedAtMs: number; stage: 0 | 1 | 2 }
const cellState = new Map<string, CellState>()

// Cells that are actively kept melted by an external heat source (currently
// the campfire ring). Skipped entirely by tickRegrowth so precipitation
// can never sneak a stage advance in between ring refreshes. When the fire
// gets low or goes out later, unmarkProtected() releases cells back to
// normal regrowth. See src/server/server.ts seedStartingArea for the
// producer side.
const protectedCells = new Set<string>()

// Server clock in ms, advanced by tickRegrowth(). Used to timestamp cell
// paintedAtMs values so all regrowth math is server-relative.
let serverClockMs = 0

// Coverage dirty flag — coalesced into PaintCoverage at 5 Hz by server.ts.
let coverageDirty = false

// Per-precipitation-level regrowth cadence in ms per stage. Mirrors the
// client's former SNOW_FILL_STAGE_INTERVAL constants — keep in sync if
// tuning changes. CLEAR (0) freezes regrowth.
const STAGE_INTERVAL_MS: Record<number, number | null> = {
	0: null,   // CLEAR:  frozen
	1: 15000,  // LIGHT:  15 s per stage (slow drift-back)
	2: 10000,  // MEDIUM: 10 s per stage (baseline)
	3:  5000,  // HEAVY:   5 s per stage (whiteout re-buries in 15 s)
}


// MARK: seedTeamPalette

/**
 * Seed palette indexes 0/1/2 for None/Red/Blue. Call once after initPaintSync
 * so CRDT PaletteEntry entities already exist. Indexes are deterministic.
 */
export function seedTeamPalette(): void {
	internColor(TEAM_COLORS[Team.None]) // → 0
	internColor(TEAM_COLORS[Team.Red])  // → 1
	internColor(TEAM_COLORS[Team.Blue]) // → 2
	if (colorToIndex.get(colorKey(TEAM_COLORS[Team.None])) !== PALETTE_NONE ||
		colorToIndex.get(colorKey(TEAM_COLORS[Team.Red]))  !== PALETTE_RED ||
		colorToIndex.get(colorKey(TEAM_COLORS[Team.Blue])) !== PALETTE_BLUE) {
		console.error('[PaintState] seedTeamPalette: reserved indexes mismatch')
	}
	publishCoverage()
	console.log('[PaintState] palette seeded: 0=None 1=Red 2=Blue')
}


// MARK: internColor

/**
 * Intern a Color4 into the server palette. Returns the existing index on
 * exact match; otherwise assigns the next free index and writes PaletteEntry
 * BEFORE any cell may reference it.
 */
export function internColor(color: Color4): number {
	const key = colorKey(color)
	const existing = colorToIndex.get(key)
	if (existing !== undefined) return existing

	if (nextPaletteIndex > MAX_PALETTE_INDEX) {
		console.error('[PaintState] internColor: palette full — returning PALETTE_NONE')
		return PALETTE_NONE
	}

	const index = nextPaletteIndex++
	colorToIndex.set(key, index)
	indexToColor[index] = color

	const entity = ensurePaletteEntity(index)
	PaletteEntry.createOrReplace(entity, { index, color })
	return index
}


// MARK: applyPaint

/**
 * Apply a paint from a validated sender's team. Always resets the cell's
 * regrowth stage to 0 and paintedAtMs to "now" — a re-paint of an
 * already-melted cell is a valid "kept it clear" signal from the campfire
 * ring or a player. Returns true when the CRDT actually changed (palette
 * index flipped or stage decremented from >0 back to 0). Skips writes
 * when the cell is already {sameIndex, stage=0} to keep the ring refresh
 * cheap.
 */
export function applyPaint(id: string, team: number): boolean {
	const index = teamPaletteIndex(team as Team)
	internColor(teamColor(team as Team))

	const prev = cellState.get(id)
	if (prev && prev.index === index && prev.stage === 0) {
		// Steady-state: keep paintedAtMs fresh so any regrowth tick that
		// races us still sees the melt as recent. No CRDT write needed.
		prev.paintedAtMs = serverClockMs
		return false
	}

	if (!writeCellComponent(id, index, 0)) return false
	cellState.set(id, { index, paintedAtMs: serverClockMs, stage: 0 })
	coverageDirty = true
	return true
}


// MARK: tickRegrowth

/**
 * Advance server clock by `dtMs` and, if precipitation is non-CLEAR,
 * push each active cell one regrowth stage forward when its elapsed
 * time crosses the next threshold. Cells hitting stage 3 revert to
 * PALETTE_NONE ("full snow, no paint") and are removed from cellState.
 *
 * Call this from server.ts on a fixed cadence (e.g. 4 Hz). The chosen
 * cadence only affects when transitions are observed, not their timing
 * math — elapsed vs threshold is what decides advancement.
 */
export function tickRegrowth(dtMs: number, precipitationLevel: number): void {
	serverClockMs += dtMs

	const intervalMs = STAGE_INTERVAL_MS[precipitationLevel] ?? null
	if (intervalMs === null) return  // CLEAR: frozen

	for (const [id, state] of cellState) {
		if (protectedCells.has(id)) {
			// Fire is keeping this cell melted. Slide paintedAtMs forward so
			// that when the fire eventually dies and unmarkProtected() is
			// called, regrowth starts from "now" instead of instantly
			// triggering a backlog of missed stage transitions.
			state.paintedAtMs = serverClockMs
			continue
		}
		const elapsed = serverClockMs - state.paintedAtMs
		const nextStage = state.stage + 1
		const threshold = intervalMs * nextStage
		if (elapsed < threshold) continue

		if (nextStage >= 3) {
			// Terminal: cell reverts to full snow. Publish index=NONE so
			// clients drop the paint visual, then drop server state.
			if (writeCellComponent(id, PALETTE_NONE, 0)) {
				cellState.delete(id)
				coverageDirty = true
			}
			continue
		}

		state.stage = nextStage as 1 | 2
		writeCellComponent(id, state.index, state.stage)
	}
}


// MARK: markProtected

/**
 * Mark cell `id` as actively heated (currently: inside campfire radius).
 * Protected cells are skipped by tickRegrowth so precipitation can never
 * regrow snow on them, regardless of tick cadence. Idempotent.
 */
export function markProtected(id: string): void {
	protectedCells.add(id)
}


// MARK: unmarkProtected

/**
 * Release cell `id` from heat protection. Call this when the fire's
 * radius shrinks or the fire dies. The cell's paintedAtMs was kept fresh
 * while protected, so regrowth begins cleanly from the moment of release.
 */
export function unmarkProtected(id: string): void {
	protectedCells.delete(id)
}


// MARK: writeCellComponent

function writeCellComponent(id: string, index: number, stage: number): boolean {
	const key = cellIdToKey(id)
	if (key === null) {
		// Invalid brush edge / ramp index — drop quietly (client also filters).
		return false
	}
	const byte    = packCellByte(index, stage)
	const changed = writeCellByte(key, byte)
	if (changed) noteComponentChange(1)
	return true
}


// MARK: isCoverageDirty

/** True when coverage CRDT should be republished. */
export function isCoverageDirty(): boolean {
	return coverageDirty
}


// MARK: coverage

/** Live coverage counters from the authoritative cell map. */
export function coverage(): { red: number; blue: number; total: number } {
	let red = 0, blue = 0
	for (const idx of cellState.values()) {
		if (idx.index === PALETTE_RED)       red++
		else if (idx.index === PALETTE_BLUE) blue++
	}
	return { red, blue, total: cellState.size }
}


// MARK: publishCoverage

/** Write PaintCoverage CRDT and clear the dirty flag. */
export function publishCoverage(): void {
	const entity = getPaintCoverageEntity()
	if (entity === null) {
		console.error('[PaintState] publishCoverage: PaintCoverage entity not initialized')
		return
	}
	const c = coverage()
	PaintCoverage.createOrReplace(entity, {
		red:   c.red,
		blue:  c.blue,
		total: c.total,
	})
	coverageDirty = false
}


// MARK: clearAll

/**
 * Round reset: zero every PaintCell component and clear the cell map.
 * Palette entries are kept (stable indexes across rounds).
 */
export function clearAll(): void {
	const cleared = cellState.size
	cellState.clear()
	protectedCells.clear()
	zeroAllPaintTiles()
	if (cleared > 0) noteComponentChange(cleared)
	coverageDirty = true
	publishCoverage()
}
