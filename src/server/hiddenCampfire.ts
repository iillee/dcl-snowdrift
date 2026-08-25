/**
 * hiddenCampfire.ts — authoritative state for the three buried bonfires.
 *
 * Owns:
 *   - the current cycle seed (from shared/hiddenCampfire.getHiddenCampfireSeed)
 *   - lit[HIDDEN_CAMPFIRE_COUNT]        — per-fire ignition flag
 *   - secondsSinceIgnite[HIDDEN_...]    — per-fire growth clock for the
 *                                          expanding melt ring
 *   - worldPos[HIDDEN_...]              — cached world-space centres so
 *                                          the ring pass doesn't recompute
 *                                          tile→world every tick
 *
 * Message contracts:
 *   Client → Server  hiddenCampfireIgnite  { seed, index }
 *   Server → Client  hiddenCampfireState   { seed, index, lit }
 *
 * Broadcast granularity is per-fire — every state flip sends ONE
 * message tagged with its index. Hydration on join sends
 * HIDDEN_CAMPFIRE_COUNT messages in a row.
 *
 * Follow-ups:
 *   - Roll cycle at bucket boundary (reset lit[] to false, recompute
 *     positions, stop protecting old rings).
 *   - "All lit" completion moment — kick a celebration broadcast when
 *     every entry flips true.
 */

import { engine } from '@dcl/sdk/ecs'

import { room } from 'src/shared/messages'
import {
	getHiddenCampfireSeed,
	HIDDEN_CAMPFIRE_COUNT,
	pickHiddenCampfireTiles,
	tileToWorld,
} from 'src/shared/hiddenCampfire'
import { getCurrentCycleSeed, onCycleRoll } from 'src/server/cycle'
import { CAMPFIRE_MELT_RADIUS_M } from 'src/shared/campfire'
import {
	FUEL_HIDDEN_FLOOR,
	FUEL_HIDDEN_INITIAL,
	FUEL_MAX,
	LOG_FUEL_SECONDS,
	hearthDecayRate,
	hearthRadiusFromFuel,
	hearthTierFromFuel,
} from 'src/shared/hearthFuel'
import { rosterSize } from 'src/server/roster'
import {
	MAZE_GRID_HEIGHT,
	MAZE_GRID_WIDTH,
	MAZE_ORIGIN_OFFSET_METERS,
	MAZE_TILE_WORLD_METERS,
	PAINT_CELL_SIZE_METERS,
	PAINT_CELLS_PER_TILE_AXIS,
} from 'src/shared/settings'
import { Team } from 'src/shared/team'

import { applyPaint, markProtected, shrinkMeltRingTo } from 'src/server/paintState'


// MARK: Melt-growth tuning
// Time (seconds) from ignition until the melt ring reaches full radius.
// Slower than the central bonfire's instant seed so a fresh ignition
// visibly "thaws" outward instead of snapping to a full disc. Growth
// is linear — easy to reason about and reads well at any framerate.
const MELT_GROWTH_DURATION_S = 10


// MARK: State (per-fire arrays, all length HIDDEN_CAMPFIRE_COUNT)
let currentSeed         = getHiddenCampfireSeed()
const lit               : boolean[] = new Array(HIDDEN_CAMPFIRE_COUNT).fill(false)
const secondsSinceIgnite: number[]  = new Array(HIDDEN_CAMPFIRE_COUNT).fill(0)
const worldX            : number[]  = new Array(HIDDEN_CAMPFIRE_COUNT).fill(0)
const worldZ            : number[]  = new Array(HIDDEN_CAMPFIRE_COUNT).fill(0)
/** Live fuel per hidden fire. Zero when unlit. Set to FUEL_HIDDEN_INITIAL
 *  on ignition; drained per frame; snuffs (lit=false) at 0. */
const fuel              : number[]  = new Array(HIDDEN_CAMPFIRE_COUNT).fill(0)
/** Throttle state for hiddenHearthFuelUpdate broadcasts, per fire. */
const lastBroadcastFuel : number[]  = new Array(HIDDEN_CAMPFIRE_COUNT).fill(-999)
const lastBroadcastTier : number[]  = new Array(HIDDEN_CAMPFIRE_COUNT).fill(-1)
const heartbeatClock    : number[]  = new Array(HIDDEN_CAMPFIRE_COUNT).fill(0)

/** Same tuning as main hearth. Broadcast on fuel delta > 3s, tier
 *  change, or 2s heartbeat while lit. */
const BROADCAST_FUEL_DELTA  = 3
const BROADCAST_HEARTBEAT_S = 2


// MARK: recomputePositions
function recomputePositions(): void {
	const tiles = pickHiddenCampfireTiles(currentSeed)
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
		const { x, z } = tileToWorld(tiles[i].tx, tiles[i].tz)
		worldX[i] = x
		worldZ[i] = z
	}
}


// MARK: resetForCycle
/**
 * Wipe per-cycle state and rebroadcast a fresh unlit tuple. Called by
 * the cycle rollover in src/server/cycle.ts. The paint clear that
 * removes the old melt rings lives in server.ts's cycle handler —
 * this module only owns lit-state + positions + broadcast.
 */
function resetForCycle(newSeed: number): void {
	currentSeed = newSeed
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
		lit[i]                = false
		secondsSinceIgnite[i] = 0
		fuel[i]               = 0
		lastBroadcastFuel[i]  = -999
		lastBroadcastTier[i]  = -1
		heartbeatClock[i]     = 0
	}
	recomputePositions()
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
		console.log(
			`[Server] hiddenCampfire[${i}]: reset for cycle seed=${currentSeed} ` +
			`pos=(${worldX[i].toFixed(1)}, ${worldZ[i].toFixed(1)})`,
		)
		broadcastOne(i)
	}
}


// MARK: seedHiddenMeltRing
/**
 * Same shape as server.ts::seedStartingArea, but centred on hidden
 * bonfire `index`. Called on ignition and on every ring-refresh tick
 * so paint dropped inside a warm ring snaps back to the warm state
 * and never regrows into snow.
 */
function seedHiddenMeltRing(index: number): void {
	if (!lit[index]) return
	// Ring size follows the fuel-derived radius (matches main hearth's
	// live tier -> radius mapping) with an initial-grow-in fade on top
	// so a fresh ignition still visibly "thaws" outward from 0 to the
	// current fuel radius over MELT_GROWTH_DURATION_S. Once the fade
	// completes, the radius tracks fuel directly - grows on feed,
	// shrinks on decay.
	const grow = Math.min(1, secondsSinceIgnite[index] / MELT_GROWTH_DURATION_S)
	const r    = hearthRadiusFromFuel(fuel[index]) * grow
	if (r <= 0) return
	const r2 = r * r
	const cx = worldX[index]
	const cz = worldZ[index]

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
			// Team.Blue matches the "melted" look used by the central
			// campfire ring. A future ownership pass may attribute the
			// ring to the igniting player's team instead.
			applyPaint(id, Team.Blue)
		}
	}
}


// MARK: broadcastOne
function broadcastOne(index: number): void {
	room.send('hiddenCampfireState', {
		seed : currentSeed,
		index,
		lit  : lit[index] ? 1 : 0,
	})
}


// MARK: broadcastFuel
function broadcastFuel(index: number, userId?: string): void {
	const opts = userId ? { to: [userId] } : undefined
	room.send('hiddenHearthFuelUpdate', {
		index,
		fuel   : fuel[index],
		players: rosterSize(),
	}, opts)
	lastBroadcastFuel[index] = fuel[index]
	lastBroadcastTier[index] = hearthTierFromFuel(fuel[index])
	heartbeatClock[index]    = 0
}


// MARK: snuffFire
/**
 * Fuel hit zero. Flip lit=false, retract the melt ring to nothing,
 * broadcast the state change. Rebroadcast fuel=0 first so any client
 * that hasn't received the last fuel packet yet sees the definitive
 * "went out" moment before the lit-state flip.
 */
function snuffFire(index: number): void {
	console.log(`[Server] hiddenCampfire[${index}]: SNUFFED (fuel exhausted)`)
	fuel[index]               = 0
	secondsSinceIgnite[index] = 0
	lit[index]                = false
	broadcastFuel(index)
	// previousRadiusM = max possible so any cell this fire ever
	// painted is swept; cells owned by other fires are left alone.
	shrinkMeltRingTo(worldX[index], worldZ[index], 0, hearthRadiusFromFuel(FUEL_MAX))
	broadcastOne(index)
}


// MARK: sendHiddenCampfireStateTo
/**
 * Push the full lit tuple + fuel snapshots to a specific client.
 * Called from the joinRoster handler in server.ts so new joiners
 * immediately see every fire in its correct state.
 */
export function sendHiddenCampfireStateTo(userId: string): void {
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
		room.send(
			'hiddenCampfireState',
			{ seed: currentSeed, index: i, lit: lit[i] ? 1 : 0 },
			{ to: [userId] },
		)
		if (lit[i]) broadcastFuel(i, userId)
	}
}


// MARK: setupHiddenCampfireServer
/**
 * Register handlers + broadcast the initial state. Idempotent — call
 * once during setupServer bootstrap AFTER setupCycleServer so we adopt
 * its authoritative seed rather than sampling Date.now() a second time.
 */
export function setupHiddenCampfireServer(): void {
	currentSeed = getCurrentCycleSeed()
	recomputePositions()
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
		console.log(
			`[Server] hiddenCampfire[${i}]: cycle seed=${currentSeed} ` +
			`pos=(${worldX[i].toFixed(1)}, ${worldZ[i].toFixed(1)}) lit=${lit[i]}`
		)
	}

	room.onMessage('hiddenCampfireIgnite', ({ seed, index }, context) => {
		const from = context?.from ?? 'unknown'
		console.log(
			`[Server] hiddenCampfire: RX ignite seed=${seed} index=${index} from=${from} ` +
			`(currentSeed=${currentSeed} lit[${index}]=${lit[index] ?? '?'})`
		)
		if (seed !== currentSeed) {
			console.log(
				`[Server] hiddenCampfire: ignite rejected from ${from} ` +
				`— stale seed (got ${seed}, want ${currentSeed})`
			)
			return
		}
		if (index < 0 || index >= HIDDEN_CAMPFIRE_COUNT) {
			console.log(
				`[Server] hiddenCampfire: ignite rejected from ${from} ` +
				`— bad index ${index} (valid 0..${HIDDEN_CAMPFIRE_COUNT - 1})`
			)
			return
		}
		if (lit[index]) {
			console.log(`[Server] hiddenCampfire[${index}]: ignite from ${from} ignored — already lit`)
			return
		}
		lit[index]                = true
		secondsSinceIgnite[index] = 0
		fuel[index]               = FUEL_HIDDEN_INITIAL
		console.log(
			`[Server] hiddenCampfire[${index}]: ignited by ${from} ` +
			`(seed=${currentSeed}, fuel=${FUEL_HIDDEN_INITIAL}s tier ${hearthTierFromFuel(FUEL_HIDDEN_INITIAL)})`
		)
		// Broadcast BEFORE the paint pass so a ring-seeding failure can't
		// silently swallow the state flip. Clients need the lit=true message
		// to spawn smoke / crackle / warmth even if the melt ring lags. The
		// ring itself grows in over MELT_GROWTH_DURATION_S on the tick below
		// — no seed pass here, so the first frame reads as "just ignited,
		// snow still there" and melts outward from centre.
		broadcastOne(index)
		broadcastFuel(index)
	})

	// Fuel decay + ring refresh + broadcast throttling. Runs every
	// frame; ring refresh coalesces at 4 Hz; broadcasts fire on delta.
	const RING_REFRESH_HZ = 4
	const RING_INTERVAL   = 1 / RING_REFRESH_HZ
	let   ringClock       = 0
	engine.addSystem((dt: number) => {
		const players   = rosterSize()
		const drainRate = hearthDecayRate(players)
		let anyLit      = false

		for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
			if (!lit[i]) continue
			anyLit                 = true
			secondsSinceIgnite[i] += dt
			const prev             = fuel[i]
			const prevTier         = hearthTierFromFuel(prev)
			fuel[i]                = Math.max(FUEL_HIDDEN_FLOOR, prev - drainRate * dt)

			// Downward tier crossing on decay -> shrink the ring so it
			// visibly retracts in step with fuel loss.
			const newTier = hearthTierFromFuel(fuel[i])
			if (newTier < prevTier) {
				const r = hearthRadiusFromFuel(fuel[i])
				// Bound to this fire's max possible radius so the shrink
				// never touches cells owned by other fires.
				shrinkMeltRingTo(worldX[i], worldZ[i], r, hearthRadiusFromFuel(FUEL_MAX))
				console.log(`[Server] hiddenCampfire[${i}]: tier decay ${prevTier}->${newTier} ring->${r.toFixed(1)}m`)
			}

			// Snuff on fuel exhaustion. snuffFire handles broadcasts +
			// ring retraction to zero.
			if (fuel[i] <= 0 && prev > 0) {
				snuffFire(i)
				continue
			}

			// Throttled fuel broadcast.
			heartbeatClock[i] += dt
			const fuelDrifted = Math.abs(fuel[i] - lastBroadcastFuel[i]) >= BROADCAST_FUEL_DELTA
			const tierChanged = newTier !== lastBroadcastTier[i]
			const heartbeatDue = heartbeatClock[i] >= BROADCAST_HEARTBEAT_S
			if (fuelDrifted || tierChanged || heartbeatDue) broadcastFuel(i)
		}

		if (!anyLit) return
		ringClock += dt
		if (ringClock < RING_INTERVAL) return
		ringClock = 0
		for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
			if (lit[i]) seedHiddenMeltRing(i)
		}
	})

	// Feed handler - filter by target index. -1 means main hearth
	// (handled by src/server/hearthFuel.ts); anything in [0, N) is a
	// hidden fire slot. Ignites nothing - fire must already be lit.
	room.onMessage('feedFireRequest', ({ target }, context) => {
		if (target < 0 || target >= HIDDEN_CAMPFIRE_COUNT) return
		const from = context?.from ?? 'unknown'
		if (!lit[target]) {
			console.log(`[Server] hiddenCampfire[${target}]: feed from ${from} ignored - not lit`)
			return
		}
		const prev     = fuel[target]
		const prevTier = hearthTierFromFuel(prev)
		fuel[target]   = Math.min(FUEL_MAX, prev + LOG_FUEL_SECONDS)
		const newTier  = hearthTierFromFuel(fuel[target])
		console.log(
			`[Server] hiddenCampfire[${target}]: feed by ${from} ` +
			`${prev.toFixed(1)}s -> ${fuel[target].toFixed(1)}s (tier ${newTier})`
		)
		// Upward tier crossing -> repaint ring at the wider radius. The
		// ring-refresh tick above would eventually notice, but immediate
		// feedback on feed feels much better.
		if (newTier > prevTier) seedHiddenMeltRing(target)
		broadcastFuel(target)
	})

	// Reset on cycle boundary. Registered here (not in server.ts) so
	// this module owns its own lifecycle.
	onCycleRoll(({ newSeed }) => {
		resetForCycle(newSeed)
	})

	// Initial broadcast for any client that connected before this
	// module registered its handler.
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) broadcastOne(i)
}
