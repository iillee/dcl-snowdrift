/**
 * server.ts — Cryocene authoritative server entry point.
 *
 * Thin orchestrator. Runs in the headless SDK server process
 * (hammurabi-server). No 3D, no ~system/RestrictedActions — pure state
 * + WS message handling.
 *
 * Current responsibilities: roster, authoritative snow state (chunked
 * PaintTile CRDT), coverage CRDT publish, and the gameplay servers.
 *
 * Snow *state* syncs via CRDT; paintTick is the client→server command
 * channel.
 */

import { engine } from '@dcl/sdk/ecs'
import { myProfile } from '@dcl/sdk/network'

import { CAMPFIRE_MELT_RADIUS_M, CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { room } from 'src/shared/messages'
import {
	IS_DEV,
	PAINT_COVERAGE_PUBLISH_HZ,
	PAINT_TICK_MAX_IDS,
} from 'src/shared/settings'
import { snowGridCapacity } from 'src/shared/snowGrid'

import { loadDiscordWebhookUrl, notifyPlayerJoin } from 'src/server/analytics'
import { onCycleRoll, sendCycleStateTo, setupCycleServer } from 'src/server/cycle'
import { sendEmberFailTo, setupEmberFailServer } from 'src/server/emberFail'
import { sendHearthFuelStateTo, setupHearthFuelServer } from 'src/server/hearthFuel'
import { sendHiddenCampfireStateTo, setupHiddenCampfireServer } from 'src/server/hiddenCampfire'
import { sendLogPilesTo, setupLogsServer } from 'src/server/logs'
import { sendPhaseStateTo, setupPhaseServer } from 'src/server/phase'
import { assignTeam, getTeam, rosterSize } from 'src/server/roster'
import { initServerStats, startServerStatsTick } from 'src/server/serverStats'
import {
	applyMelt,
	clearAllSnow,
	meltDisc,
	meltedCellCount,
	meltRandomCells,
	publishCoverageIfDirty,
	tickRegrowth,
} from 'src/server/snowState'
import {
	flushDirtySnowTiles,
	initSnowSync,
	nonZeroSnowCells,
	relinkSnowSync,
	republishAllSnowTiles,
	snowTileEntityCount,
} from 'src/server/snowSync'
import { sendTorchStatesTo, setupTorchServer } from 'src/server/torch'
import { getCurrentWeatherLevel, sendCurrentWeatherTo, setupWeather } from 'src/server/weather'
import { sendWoodStateTo, setupWoodServer } from 'src/server/wood'

const HEARTBEAT_INTERVAL_S     = 5
const PAINT_SUMMARY_INTERVAL_S = 5
const DEV_MELT_BULK_MAX        = 50000


// MARK: seedStartingArea

/**
 * Melt and heat-protect the central hearth ring at `radiusM` (defaults to
 * the baseline 8 m "Warm" tier). hearthFuel calls this with the
 * fuel-derived radius on tier crossings so the ring tracks the fire.
 */
export function seedStartingArea(radiusM: number = CAMPFIRE_MELT_RADIUS_M): void {
	const changed = meltDisc(CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z, radiusM)
	if (changed > 0) {
		console.log(`server: seedStartingArea: melted ${changed} cells in a ${(radiusM * 2).toFixed(1)}m ring`)
	}
}


// MARK: setupServer

/** Boot roster, paint CRDT, stats, and room handlers for the auth server. */
export async function setupServer(): Promise<void> {
	console.log('[Server] Starting Cryocene server...')

	// Load Discord webhook URL from env (DISCORD_PLAYER_JOIN_WEBHOOK).
	// Fire-and-forget — the rest of boot doesn't depend on it, and a missing
	// env var is a supported "notifications off" state, not an error.
	loadDiscordWebhookUrl().catch(err => console.log('[Server] loadDiscordWebhookUrl error:', err))

	const snowCap = snowGridCapacity()
	console.log(
		`[Server] snow grid: ${snowCap.cellCapacity} cells ` +
		`(${snowCap.cellsPerTileAxis}×${snowCap.cellsPerTileAxis}/tile × ${snowCap.tiles} tiles)`
	)
	initSnowSync()
	seedStartingArea()
	const seededTiles = flushDirtySnowTiles()
	console.log(`server: setupServer: flushed ${seededTiles} seed tiles onto PaintTile`)

	initServerStats()
	startServerStatsTick(() => meltedCellCount())
	setupWeather()
	// Cycle clock BEFORE hiddenCampfire so both read the same authoritative
	// bucket if we ever cross-wire them.
	setupCycleServer()
	// Day/night clock after cycle so it can subscribe to onCycleRoll
	// (reset to DAY when the 24 h world wipe fires).
	setupPhaseServer()
	setupHiddenCampfireServer()
	setupLogsServer()
	setupWoodServer()
	setupTorchServer()
	// Fuel model for the main hearth. Registered late (after roster/cycle
	// so decayRate has a real player count immediately) but before the
	// joinRoster handler is invoked - hydration below needs it live.
	setupHearthFuelServer()
	setupEmberFailServer()

	// World-scale reset on cycle roll: clear the entire paint canvas
	// (virgin snow), then re-seed the central campfire's melt ring so the
	// warm zone reappears immediately. Hidden campfires reset their own
	// lit state + rings via their own onCycleRoll subscriber. Registered
	// AFTER setupHiddenCampfireServer so it runs after (order == handler
	// invocation order); doesn't matter semantically here since paint
	// clear and hidden reset are independent, but keeps the intent clear.
	onCycleRoll(() => {
		// Cycle wipes fuel-driven expansion too - baseline ring is the
		// correct visual reset. Fuel itself is reset by hearthFuel's
		// onCycleRoll handler (back to FUEL_MAIN_INITIAL).
		console.log('[Server] cycle: clearing snow + reseeding central ring')
		clearAllSnow()
		seedStartingArea()
	})

	// PaintTick summary accumulators (coalesced log every few seconds).
	let paintTicks       = 0
	let paintIdsIn       = 0
	let paintApplied     = 0
	let paintDroppedCap  = 0
	let paintDroppedTeam = 0
	let paintSummaryClock = 0

	// Per-user rate limiters. Both keyed by wallet address, both value =
	// last-event timestamp in ms since epoch. Bounded in size by roster
	// churn (only real players ever end up here); no eviction sweep
	// needed for the sessions we run.
	const lastRejoinNudgeMs: Map<string, number> = new Map()
	const lastDroppedLogMs : Map<string, number> = new Map()
	const REJOIN_NUDGE_COOLDOWN_MS = 5000
	const DROPPED_LOG_COOLDOWN_MS  = 60000

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
		// NOTE: previously wiped + reseeded the canvas on every joinRoster
		// as a "dev-friendly" browser-refresh reset. That leaked into
		// production and any join / reconnect erased every other player's
		// work — confirmed via 2026-08-28 playtest logs (10 players, 6195
		// painted cells collapsed to seed 488 when the 11th joined). Paint
		// state now hydrates via CRDT tile replication automatically; the
		// joiner-specific hydrations below cover everything else (weather,
		// wood, cycle, torches, fuel, hidden campfire).
		console.log(`[Server] joinRoster from ${from}`)
		if (from !== userId) {
			// Not an error — client may not have context.from's exact address casing.
			// We ignore the payload and use context.from as authoritative.
			console.log(`[Server] joinRoster payload/from mismatch (payload=${userId}, from=${from}) — using from`)
		}
		const isNewJoiner = getTeam(from) === null
		const team = assignTeam(from)
		console.log(`[Server] joinRoster ${from} → team ${team === 1 ? 'RED' : 'BLUE'} (roster size ${rosterSize()})`)
		// Fire Discord webhook only on the FIRST join per server lifetime —
		// idempotent joinRoster calls (browser refresh, reconnect) must not
		// re-notify. assignTeam pushes into the roster only for unseen ids,
		// so `getTeam(from) === null` immediately before it is the reliable
		// "new joiner" signal.
		if (isNewJoiner) notifyPlayerJoin(from)
		room.send('teamAssigned', { team }, { to: [from] })
		// Hydrate the joiner with the current weather so their sky matches
		// everyone else's from the first frame.
		sendCurrentWeatherTo(from)
		// Same for the hidden campfire — latecomers that arrive after
		// somebody already lit it should see smoke + hear crackle from
		// the first frame instead of a cold pit.
		sendHiddenCampfireStateTo(from)
		// Hydrate the joiner with every wood pile currently in the world so
		// they see logs another player dropped before they connected.
		sendLogPilesTo(from)
		// Same for the scattered wood chunks - the active/inactive set
		// lives on the server, positions are seed-derived on the client.
		sendWoodStateTo(from)
		// Authoritative countdown for the ClockButton popover — hydrated
		// on join so a fresh client's HUD shows a correct rebuild timer
		// from the first frame instead of trusting local Date.now().
		sendCycleStateTo(from)
		sendPhaseStateTo(from)
		// Hydrate held-torch lit states for everyone already in the room so
		// the joiner sees flames instead of dark sticks until each remote
		// player's next lit-state change.
		sendTorchStatesTo(from)
		// Current main-hearth fuel snapshot so the joiner's fire visuals
		// (radius, upcoming billboard) match the room from the first frame.
		sendHearthFuelStateTo(from)
		sendEmberFailTo(from)
		// Force a fresh PaintTile write so this joiner cannot hydrate
		// from the empty create() snapshot that syncEntity may have
		// captured before the seed flush.
		const snowTiles = republishAllSnowTiles()
		console.log(`[Server] joinRoster: republished ${snowTiles} snow tiles for ${from}`)
	})

	// Snow ingest — client-authored cell keys. Un-rostered senders (typically
	// after a server restart) are nudged to rejoin instead of applied.
	room.onMessage('paintTick', ({ cells, targetStage }, context) => {
		const from = context?.from
		if (!from) return
		if (getTeam(from) === null) {
			paintDroppedTeam++
			// Log this user at most once per minute so a mid-session
			// server restart is visible in the log without flooding it.
			const nowLog = Date.now()
			const lastLog = lastDroppedLogMs.get(from) ?? 0
			if (nowLog - lastLog >= DROPPED_LOG_COOLDOWN_MS) {
				lastDroppedLogMs.set(from, nowLog)
				console.log(`[Server] paintTick droppedTeam: ${from} not in roster (likely post-restart) — sending pleaseRejoin`)
			}
			// Nudge the client to re-issue joinRoster, at most once every
			// REJOIN_NUDGE_COOLDOWN_MS per user, so a burst of paintTicks
			// from one un-rostered client doesn't spam pleaseRejoin.
			const nowNudge = Date.now()
			const lastNudge = lastRejoinNudgeMs.get(from) ?? 0
			if (nowNudge - lastNudge >= REJOIN_NUDGE_COOLDOWN_MS) {
				lastRejoinNudgeMs.set(from, nowNudge)
				room.send('pleaseRejoin', {}, { to: [from] })
			}
			return
		}
		if (cells.length > PAINT_TICK_MAX_IDS) {
			paintDroppedCap++
			console.log(`[Server] paintTick from ${from} dropped: ${cells.length} cells > cap ${PAINT_TICK_MAX_IDS}`)
			return
		}
		// Only 0 (melt) and 1 (stomp) are valid; anything else is a full melt.
		const stage: 0 | 1 = targetStage === 1 ? 1 : 0
		let gained = 0
		for (const key of cells) {
			if (applyMelt(key, stage)) gained++
		}
		paintTicks++
		paintIdsIn   += cells.length
		paintApplied += gained
	})

	// DEV load test — melt N random cells to reproduce playtest snow load.
	room.onMessage('devMeltBulk', ({ count }, context) => {
		if (!IS_DEV) {
			console.log(`[Server] devMeltBulk from ${context?.from} ignored: not a dev build`)
			return
		}
		const n       = Math.max(0, Math.min(DEV_MELT_BULK_MAX, count | 0))
		const changed = meltRandomCells(n)
		console.log(`[Server] devMeltBulk: requested ${n}, melted ${changed} (total melted ${meltedCellCount()})`)
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
		flushDirtySnowTiles()
	})

	// Coverage publish tick. Coalesces cell mutations into a single
	// PaintCoverage CRDT write — not a room broadcast.
	const COVERAGE_INTERVAL = 1 / PAINT_COVERAGE_PUBLISH_HZ
	let coverageClock = 0
	engine.addSystem((dt: number) => {
		coverageClock += dt
		if (coverageClock < COVERAGE_INTERVAL) return
		coverageClock = 0
		relinkSnowSync()
		publishCoverageIfDirty()
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
					`snowCells=${nonZeroSnowCells()} tiles=${snowTileEntityCount()}`
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
		console.log(
			`[Server] alive roster=${rosterSize()} melted=${meltedCellCount()} tiles=${snowTileEntityCount()} ` +
			`profileReady=${!!myProfile?.networkId}`
		)
	})

	console.log(
		'[Server] Ready — listening for joinRoster, paintTick; ' +
		'paint state via chunked PaintTile CRDT. ' +
		`heartbeat every ${HEARTBEAT_INTERVAL_S}s.`
	)
}
