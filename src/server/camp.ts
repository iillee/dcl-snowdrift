/**
 * camp.ts (server) — authoritative melt ring for the distant pilgrimage
 * camp. The visual (GLB + smoke + audio) is client-side in
 * src/client/camp.ts; this module owns the persistent painted floor
 * ring so cells inside the camp's warm radius stay melted and don't
 * regrow into snow.
 *
 * Design mirrors the CENTRAL hearth, not the hidden fires:
 *   - Camp is always "lit" — no ignite state, no fuel decay.
 *   - Ring radius is static (CAMP_MELT_RADIUS_M, cloned from the
 *     central hearth's baseline) — no fuel-driven growth/shrink.
 *   - Cells are marked Protected so normal regrowth leaves them alone.
 *   - Refreshed at 4 Hz on the same cadence as the central ring so any
 *     paint dropped inside snaps back.
 *
 * Cycle model: camp position is derived from the current cycle seed
 * (src/shared/camp.getCampWorldPosition). setupCampServer subscribes
 * to onCycleRoll so on midnight-UTC (or a dev-forced roll) the ring is
 * reseeded at the new bearing. server.ts already clears the paint
 * canvas on roll and on joinRoster — reseedCampRing() is exposed so
 * those sites can rebuild the ring alongside the central one.
 *
 * NOTE: the paint-a-circle loop below is a near-verbatim clone of
 * server/server.ts::seedStartingArea and
 * server/hiddenCampfire.ts::seedHiddenMeltRing. Three copies is one
 * too many; when we do the next round of server refactors, extract a
 * shared paintCircle(cx, cz, r, team) helper.
 */

import { engine } from '@dcl/sdk/ecs'

import { CAMP_MELT_RADIUS_M, getCampWorldPosition } from 'src/shared/camp'
import {
	MAZE_GRID_HEIGHT,
	MAZE_GRID_WIDTH,
	MAZE_ORIGIN_OFFSET_METERS,
	MAZE_TILE_WORLD_METERS,
	PAINT_CELL_SIZE_METERS,
	PAINT_CELLS_PER_TILE_AXIS,
} from 'src/shared/settings'
import { Team } from 'src/shared/team'

import { getCurrentCycleSeed, onCycleRoll } from 'src/server/cycle'
import { applyPaint, markProtected } from 'src/server/paintState'


// MARK: State
let campX = 0
let campZ = 0


// MARK: recomputeCampPosition
function recomputeCampPosition(): void {
	const pos = getCampWorldPosition(getCurrentCycleSeed())
	campX = pos.x
	campZ = pos.z
}


// MARK: getCampWorldPositionServer
/**
 * Server-side accessor for the current camp world XZ. Kept module-
 * local for now (no external consumers), exposed for future arrival-
 * detection / reward-issue work in P3.
 */
export function getCampWorldPositionServer(): { x: number; z: number } {
	return { x: campX, z: campZ }
}


// MARK: reseedCampRing
/**
 * Paint the camp's static warm ring at its current position. Safe to
 * call whenever the paint canvas has been cleared (setup, joinRoster
 * dev-wipe, cycle roll). Cells are marked Protected so subsequent
 * regrowth ticks skip them.
 */
export function reseedCampRing(): void {
	const cx = campX
	const cz = campZ
	const r  = CAMP_MELT_RADIUS_M
	const r2 = r * r

	const localCx = cx - MAZE_ORIGIN_OFFSET_METERS
	const localCz = cz - MAZE_ORIGIN_OFFSET_METERS
	const minCellsFromCenter = Math.ceil(r / PAINT_CELL_SIZE_METERS)
	const centerColFloat     = localCx / PAINT_CELL_SIZE_METERS
	const centerRowFloat     = localCz / PAINT_CELL_SIZE_METERS
	const colStart = Math.floor(centerColFloat - minCellsFromCenter)
	const colEnd   = Math.ceil (centerColFloat + minCellsFromCenter)
	const rowStart = Math.floor(centerRowFloat - minCellsFromCenter)
	const rowEnd   = Math.ceil (centerRowFloat + minCellsFromCenter)

	const ty = 0
	let painted = 0
	for (let gRow = rowStart; gRow <= rowEnd; gRow++) {
		const tz  = Math.floor(gRow / PAINT_CELLS_PER_TILE_AXIS)
		const row = gRow - tz * PAINT_CELLS_PER_TILE_AXIS
		if (tz < 0 || tz >= MAZE_GRID_HEIGHT) continue
		const wz = tz * MAZE_TILE_WORLD_METERS + (row + 0.5) * PAINT_CELL_SIZE_METERS + MAZE_ORIGIN_OFFSET_METERS
		const dz = wz - cz

		for (let gCol = colStart; gCol <= colEnd; gCol++) {
			const tx  = Math.floor(gCol / PAINT_CELLS_PER_TILE_AXIS)
			const col = gCol - tx * PAINT_CELLS_PER_TILE_AXIS
			if (tx < 0 || tx >= MAZE_GRID_WIDTH) continue
			const wx = tx * MAZE_TILE_WORLD_METERS + (col + 0.5) * PAINT_CELL_SIZE_METERS + MAZE_ORIGIN_OFFSET_METERS
			const dx = wx - cx
			if (dx * dx + dz * dz > r2) continue

			const id = `${tx},${tz},${ty}:${col},${row}`
			markProtected(id)
			if (applyPaint(id, Team.Blue)) painted++
		}
	}
	if (painted > 0) {
		console.log(
			`[Server] camp: reseedCampRing painted ${painted} cells in a ` +
			`${(r * 2).toFixed(1)}m ring at (${cx.toFixed(1)}, ${cz.toFixed(1)})`
		)
	}
}


// MARK: setupCampServer
/**
 * Adopt the cycle's current seed, seed the initial camp ring, and
 * subscribe to cycle rollover so the ring follows the camp to its new
 * bearing. Ring-refresh at 4 Hz keeps paint dropped inside the ring
 * snapping back — same cadence as the central hearth's refresh in
 * server.ts. Call once during setupServer bootstrap AFTER
 * setupCycleServer so we adopt its authoritative seed.
 */
export function setupCampServer(): void {
	recomputeCampPosition()
	console.log(
		`[Server] camp: setupCampServer seed=${getCurrentCycleSeed()} ` +
		`pos=(${campX.toFixed(1)}, ${campZ.toFixed(1)}) radius=${CAMP_MELT_RADIUS_M}m`
	)
	reseedCampRing()

	onCycleRoll(({ newSeed }) => {
		recomputeCampPosition()
		console.log(
			`[Server] camp: cycle roll seed=${newSeed} ` +
			`pos=(${campX.toFixed(1)}, ${campZ.toFixed(1)}) — reseeding ring`
		)
		// server.ts's onCycleRoll handler runs clearPaintState() +
		// seedStartingArea() for the central hearth. We piggy-back here
		// to reseed the camp at its new position. Handler registration
		// order in setupServer determines invocation order; we accept
		// either order since both paths only paint cells (idempotent).
		reseedCampRing()
	})

	// Ring-refresh tick. Matches the 4 Hz cadence of server.ts's
	// central-ring refresh so paint dropped inside the camp snaps back
	// on the same rhythm. applyPaint short-circuits on already-blue
	// cells; steady-state cost is a Map lookup per cell in the ring.
	const RING_REFRESH_HZ = 4
	const RING_INTERVAL   = 1 / RING_REFRESH_HZ
	let   ringClock       = 0
	engine.addSystem((dt: number) => {
		ringClock += dt
		if (ringClock < RING_INTERVAL) return
		ringClock = 0
		reseedCampRing()
	})
}
