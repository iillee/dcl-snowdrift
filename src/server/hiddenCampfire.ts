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
import { CAMPFIRE_MELT_RADIUS_M } from 'src/shared/campfire'
import {
	MAZE_GRID_HEIGHT,
	MAZE_GRID_WIDTH,
	MAZE_ORIGIN_OFFSET_METERS,
	MAZE_TILE_WORLD_METERS,
	PAINT_CELL_SIZE_METERS,
	PAINT_CELLS_PER_TILE_AXIS,
} from 'src/shared/settings'
import { Team } from 'src/shared/team'

import { applyPaint, markProtected } from 'src/server/paintState'


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


// MARK: recomputePositions
function recomputePositions(): void {
	const tiles = pickHiddenCampfireTiles(currentSeed)
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
		const { x, z } = tileToWorld(tiles[i].tx, tiles[i].tz)
		worldX[i] = x
		worldZ[i] = z
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
	// Linear grow from 0 to the central campfire's full melt radius over
	// MELT_GROWTH_DURATION_S. Once we hit the cap, later ticks re-paint
	// the same full disc — cheap because applyPaint short-circuits on
	// cells already at the target colour.
	const growth = Math.min(1, secondsSinceIgnite[index] / MELT_GROWTH_DURATION_S)
	const r      = CAMPFIRE_MELT_RADIUS_M * growth
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


// MARK: sendHiddenCampfireStateTo
/**
 * Push the full lit tuple to a specific client. Called from the
 * joinRoster handler in server.ts so new joiners immediately see
 * every fire in its correct state (one message per fire).
 */
export function sendHiddenCampfireStateTo(userId: string): void {
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
		room.send(
			'hiddenCampfireState',
			{ seed: currentSeed, index: i, lit: lit[i] ? 1 : 0 },
			{ to: [userId] },
		)
	}
}


// MARK: setupHiddenCampfireServer
/**
 * Register handlers + broadcast the initial state. Idempotent — call
 * once during setupServer bootstrap.
 */
export function setupHiddenCampfireServer(): void {
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
		console.log(`[Server] hiddenCampfire[${index}]: ignited by ${from} (seed=${currentSeed}) — broadcasting`)
		// Broadcast BEFORE the paint pass so a ring-seeding failure can't
		// silently swallow the state flip. Clients need the lit=true message
		// to spawn smoke / crackle / warmth even if the melt ring lags. The
		// ring itself grows in over MELT_GROWTH_DURATION_S on the tick below
		// — no seed pass here, so the first frame reads as "just ignited,
		// snow still there" and melts outward from centre.
		broadcastOne(index)
	})

	// Keep every lit ring authoritative. Same cadence as the central
	// campfire ring refresh in server.ts — cheap no-op after the first
	// pass since applyPaint short-circuits on cells already at the
	// target colour.
	const RING_REFRESH_HZ = 4
	const RING_INTERVAL   = 1 / RING_REFRESH_HZ
	let   ringClock       = 0
	engine.addSystem((dt: number) => {
		let anyLit = false
		for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
			if (lit[i]) {
				secondsSinceIgnite[i] += dt
				anyLit = true
			}
		}
		if (!anyLit) return
		ringClock += dt
		if (ringClock < RING_INTERVAL) return
		ringClock = 0
		for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
			if (lit[i]) seedHiddenMeltRing(i)
		}
	})

	// Initial broadcast for any client that connected before this
	// module registered its handler.
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) broadcastOne(i)
}
