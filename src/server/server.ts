/**
 * server.ts — Snow Drift authoritative server entry point.
 *
 * Thin orchestrator. Runs in the headless SDK server process
 * (hammurabi-server). No 3D, no ~system/RestrictedActions — pure state
 * + WS message handling.
 *
 * Current responsibilities: roster/team assignment, authoritative paint
 * state (chunked PaintTile CRDT + palette), coverage CRDT publish.
 *
 * Paint *state* syncs via CRDT; paintTick is the client→server command
 * channel.
 */

import { engine } from '@dcl/sdk/ecs'
import { myProfile } from '@dcl/sdk/network'

import { room } from 'src/shared/messages'
import { paintGridCapacity } from 'src/shared/paintGrid'
import { flushDirtyPaintTiles, initPaintSync, paintedCellCount, paintTileEntityCount, relinkPaintSync } from 'src/shared/paintSync'
import {
	PAINT_COVERAGE_PUBLISH_HZ,
	PAINT_TICK_MAX_IDS,
} from 'src/shared/settings'

import {
	applyPaint,
	coverage,
	clearAll as clearPaintState,
	seedTeamPalette,
	isCoverageDirty,
	markProtected,
	publishCoverage,
	tickRegrowth,
} from 'src/server/paintState'
import { assignTeam, rosterSize, getTeam } from 'src/server/roster'
import { initServerStats, startServerStatsTick } from 'src/server/serverStats'
import { getCurrentWeatherLevel, sendCurrentWeatherTo, setupWeather } from 'src/server/weather'
import { sendHiddenCampfireStateTo, setupHiddenCampfireServer } from 'src/server/hiddenCampfire'
import { Team } from 'src/shared/team'
import {
	MAZE_GRID_HEIGHT,
	MAZE_GRID_WIDTH,
	MAZE_ORIGIN_OFFSET_METERS,
	MAZE_TILE_WORLD_METERS,
	PAINT_CELL_SIZE_METERS,
	PAINT_CELLS_PER_TILE_AXIS,
} from 'src/shared/settings'
import {
	CAMPFIRE_MELT_DIAMETER_M,
	CAMPFIRE_MELT_RADIUS_M,
	CAMPFIRE_MELT_RADIUS_SQ_M,
	CAMPFIRE_WORLD_X,
	CAMPFIRE_WORLD_Z,
} from 'src/shared/campfire'

const HEARTBEAT_INTERVAL_S     = 5
const PAINT_SUMMARY_INTERVAL_S = 5


// MARK: seedStartingArea

/**
 * Pre-paint a circular ring around the campfire at scene center so the
 * canvas isn't empty on first load and the warm zone reads as "fire's
 * reach". Iterates the bounding-square of paint cells intersecting the
 * circle and paints those whose center falls within the radius.
 *
 * Cell world-center for (tx, tz, col, row) is
 *   ( tx*TILE + (col+0.5)*CELL , tz*TILE + (row+0.5)*CELL )
 * matching src/shared/maze/generator.ts tile placement (SW pivot,
 * MAZE_ORIGIN_OFFSET_METERS = 0 on the flat canvas).
 */
function seedStartingArea(): void {
	const cx = CAMPFIRE_WORLD_X
	const cz = CAMPFIRE_WORLD_Z
	const r  = CAMPFIRE_MELT_RADIUS_M
	const r2 = CAMPFIRE_MELT_RADIUS_SQ_M

	// Convert the fire's WORLD position back to the interior playfield's
	// grid space by subtracting the playfield origin offset. Every cell
	// coord below is playfield-local; wx/wz below adds the offset back.
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
			// Mark BEFORE painting so the first regrowth tick that races us
			// already sees the cell as heat-protected. When the fire
			// eventually gets low / dies, unmarkProtected() will release
			// these back to normal regrowth.
			markProtected(id)
			if (applyPaint(id, Team.Blue)) painted++
		}
	}
	if (painted > 0) {
		console.log(
			`[Server] seedStartingArea: painted ${painted} cells in a ` +
			`${CAMPFIRE_MELT_DIAMETER_M}m ring at (${cx.toFixed(1)}, ${cz.toFixed(1)})`
		)
	}
}


// MARK: setupServer

/** Boot roster, paint CRDT, stats, and room handlers for the auth server. */
export async function setupServer(): Promise<void> {
	console.log('[Server] Starting Snow Drift server...')

	const paintCap = paintGridCapacity()
	console.log(
		`[Server] paint grid: ${paintCap.cellCapacity} cell slots ` +
		`(${paintCap.paintCellsPerTileAxis}×${paintCap.paintCellsPerTileAxis}/tile × ` +
		`${paintCap.tiles} tiles × ${paintCap.levels} levels); ` +
		`PaintTile networkIds ${paintCap.tileNetBase}+`
	)
	initPaintSync()
	seedTeamPalette()
	seedStartingArea()

	initServerStats()
	startServerStatsTick(() => coverage().total)
	setupWeather()
	setupHiddenCampfireServer()

	// PaintTick summary accumulators (coalesced log every few seconds).
	let paintTicks       = 0
	let paintIdsIn       = 0
	let paintApplied     = 0
	let paintDroppedCap  = 0
	let paintDroppedTeam = 0
	let paintSummaryClock = 0

	// Roster handler — assign or look up a player's team.
	// Client sends joinRoster once on boot; we reply teamAssigned to that sender only.
	// Idempotent: repeated calls for the same userId return the same team.
	// Trust model: userId comes from context.from (authenticated by hammurabi),
	// NOT from the payload's userId field — payload is redundant but useful
	// for logging early-connect diagnostics.
	room.onMessage('joinRoster', ({ userId }, context) => {
		const from = context?.from
		if (!from) {
			console.log(`[Server] joinRoster rejected: no context.from (payload userId=${userId})`)
			return
		}
		// Dev-friendly: wipe canvas + reseed on every client join so a browser
		// refresh gives a clean slate. TODO: remove or gate behind a flag
		// once persistent multi-player sessions matter.
		console.log(`[Server] joinRoster from ${from}: clearing paint + reseeding`)
		clearPaintState()
		seedStartingArea()
		if (from !== userId) {
			// Not an error — client may not have context.from's exact address casing.
			// We ignore the payload and use context.from as authoritative.
			console.log(`[Server] joinRoster payload/from mismatch (payload=${userId}, from=${from}) — using from`)
		}
		const team = assignTeam(from)
		console.log(`[Server] joinRoster ${from} → team ${team === 1 ? 'RED' : 'BLUE'} (roster size ${rosterSize()})`)
		room.send('teamAssigned', { team }, { to: [from] })
		// Hydrate the joiner with the current weather so their sky matches
		// everyone else's from the first frame.
		sendCurrentWeatherTo(from)
		// Same for the hidden campfire — latecomers that arrive after
		// somebody already lit it should see smoke + hear crackle from
		// the first frame instead of a cold pit.
		sendHiddenCampfireStateTo(from)
	})

	// Paint ingest — client-authored cell ids, attributed to sender's team.
	// Server writes palette indexes into per-cell PaintCell CRDT; clients
	// observe via sync. If sender hasn't joined the roster yet, drop silently.
	room.onMessage('paintTick', ({ ids, targetStage }, context) => {
		const from = context?.from
		if (!from) return
		const team = getTeam(from)
		if (team === null) {
			paintDroppedTeam++
			return
		}
		if (ids.length > PAINT_TICK_MAX_IDS) {
			paintDroppedCap++
			console.log(`[Server] paintTick from ${from} dropped: ${ids.length} ids > cap ${PAINT_TICK_MAX_IDS}`)
			return
		}
		// Clamp targetStage defensively — only 0 (melt) and 1 (stomp) are
		// valid; anything else falls back to full melt to preserve legacy
		// message behavior.
		const stage: 0 | 1 = targetStage === 1 ? 1 : 0
		let gained = 0
		for (const id of ids) {
			if (applyPaint(id, team, stage)) gained++
		}
		paintTicks++
		paintIdsIn   += ids.length
		paintApplied += gained
	})

	// Campfire ring refresh: the seed area must never degrade. Re-run the
	// circular fill a few times per second so any blue paint a player drops
	// inside the ring snaps back to red. applyPaint short-circuits on
	// already-red cells so the steady-state cost is a Map lookup per cell.
	const RING_REFRESH_HZ = 4
	const RING_INTERVAL   = 1 / RING_REFRESH_HZ
	let   ringClock       = 0
	engine.addSystem((dt: number) => {
		ringClock += dt
		if (ringClock < RING_INTERVAL) return
		ringClock = 0
		seedStartingArea()
	})

	// Snow regrowth tick — server-authoritative. Cadence matches the
	// active precipitation's stage interval (LIGHT 15 s, MEDIUM 10 s,
	// HEAVY 5 s) so every cell that has crossed a stage threshold in
	// the same window advances together on the same tick. This is what
	// gives the snowfield its synchronized "batch exhale" look instead
	// of a rolling per-cell wave. CLEAR pauses ticking entirely.
	const REGROWTH_CADENCE_MS: Record<number, number | null> = {
		0: null,   // CLEAR:  no ticks
		1: 15000,  // LIGHT
		2: 10000,  // MEDIUM
		3:  5000,  // HEAVY
	}
	let regrowthClockMs = 0
	engine.addSystem((dt: number) => {
		const level     = getCurrentWeatherLevel()
		const cadenceMs = REGROWTH_CADENCE_MS[level]
		if (cadenceMs === null) {
			// CLEAR: freeze the tick but keep the accumulator so a return
			// to precipitation lands on the next scheduled boundary rather
			// than firing instantly.
			return
		}
		regrowthClockMs += dt * 1000
		if (regrowthClockMs < cadenceMs) return
		const elapsedMs = regrowthClockMs
		regrowthClockMs = 0
		tickRegrowth(elapsedMs, level)
	})

	// Dirty-tile flush — runs every engine tick, after all applyPaint /
	// tickRegrowth / ring-refresh mutations have queued their byte writes.
	// One CRDT publish per touched tile per frame, instead of one per cell.
	engine.addSystem(() => {
		flushDirtyPaintTiles()
	})

	// Coverage publish tick. Coalesces cell mutations into a single
	// PaintCoverage CRDT write — not a room broadcast.
	const COVERAGE_INTERVAL = 1 / PAINT_COVERAGE_PUBLISH_HZ
	let coverageClock = 0
	engine.addSystem((dt: number) => {
		coverageClock += dt
		if (coverageClock < COVERAGE_INTERVAL) return
		coverageClock = 0
		relinkPaintSync()
		if (!isCoverageDirty()) return
		publishCoverage()
	})

	// Heartbeat + paintTick summary. Always logs so a live idle server is
	// obvious; silence means the process died.
	let heartbeatClock = 0
	engine.addSystem((dt: number) => {
		heartbeatClock += dt
		paintSummaryClock += dt

		if (paintSummaryClock >= PAINT_SUMMARY_INTERVAL_S) {
			paintSummaryClock = 0
			if (paintTicks > 0 || paintDroppedCap > 0 || paintDroppedTeam > 0) {
				console.log(
					`[Server] paintTick ${PAINT_SUMMARY_INTERVAL_S}s: ` +
					`ticks=${paintTicks} ids=${paintIdsIn} applied=${paintApplied} ` +
					`droppedCap=${paintDroppedCap} droppedTeam=${paintDroppedTeam} ` +
					`paintCells=${paintedCellCount()} tiles=${paintTileEntityCount()}`
				)
				paintTicks       = 0
				paintIdsIn       = 0
				paintApplied     = 0
				paintDroppedCap  = 0
				paintDroppedTeam = 0
			}
		}

		if (heartbeatClock < HEARTBEAT_INTERVAL_S) return
		heartbeatClock = 0
		const c = coverage()
		console.log(
			`[Server] alive roster=${rosterSize()} cells=${paintedCellCount()} tiles=${paintTileEntityCount()} ` +
			`coverage=red=${c.red}/blue=${c.blue}/total=${c.total} ` +
			`profileReady=${!!myProfile?.networkId}`
		)
	})

	console.log(
		'[Server] Ready — listening for joinRoster, paintTick; ' +
		'paint state via chunked PaintTile CRDT. ' +
		`heartbeat every ${HEARTBEAT_INTERVAL_S}s.`
	)
}
