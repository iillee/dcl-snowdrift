/**
 * hiddenCampfire.ts — authoritative state for the buried second campfire.
 *
 * Owns:
 *   - the current cycle seed (from shared/hiddenCampfire.getHiddenCampfireSeed)
 *   - whether the cycle's hidden fire has been lit
 *   - the paint-melt ring that persists around the fire once lit, so
 *     the warm patch reads as authoritative world state and does not
 *     depend on individual clients re-melting cells.
 *
 * Message contracts:
 *   Client → Server  hiddenCampfireIgnite  { seed }
 *   Server → Client  hiddenCampfireState   { seed, lit }
 *
 * Follow-ups:
 *   - Roll cycle at bucket boundary (reset lit=false, pick new seed,
 *     stop protecting the old ring).
 *   - Multi-campfire cycle: state becomes { seed, lit[] } and the
 *     completion moment fires when every entry flips true.
 */

import { engine } from '@dcl/sdk/ecs'

import { room } from 'src/shared/messages'
import {
	getHiddenCampfireSeed,
	pickHiddenCampfireTile,
	tileToWorld,
} from 'src/shared/hiddenCampfire'
import { CAMPFIRE_MELT_RADIUS_M, CAMPFIRE_MELT_RADIUS_SQ_M } from 'src/shared/campfire'
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


// MARK: State
let currentSeed = getHiddenCampfireSeed()
let lit         = false
let worldX      = 0
let worldZ      = 0

function recomputePosition(): void {
	const { tx, tz } = pickHiddenCampfireTile(currentSeed)
	const { x, z }   = tileToWorld(tx, tz)
	worldX = x
	worldZ = z
}


// MARK: seedHiddenMeltRing
/**
 * Same shape as server.ts::seedStartingArea, but centred on the hidden
 * campfire's world position. Called on ignition and on every ring-
 * refresh tick so paint dropped inside the warm ring snaps back to the
 * warm state and never regrows into snow.
 */
function seedHiddenMeltRing(): void {
	if (!lit) return
	const cx = worldX
	const cz = worldZ
	const r  = CAMPFIRE_MELT_RADIUS_M
	const r2 = CAMPFIRE_MELT_RADIUS_SQ_M

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


// MARK: broadcast
function broadcast(): void {
	room.send('hiddenCampfireState', { seed: currentSeed, lit })
}


// MARK: sendHiddenCampfireStateTo
/**
 * Push the current state to a specific client. Called from the
 * joinRoster handler in server.ts so new joiners immediately see the
 * fire in its correct state.
 */
export function sendHiddenCampfireStateTo(userId: string): void {
	room.send('hiddenCampfireState', { seed: currentSeed, lit }, { to: [userId] })
}


// MARK: setupHiddenCampfireServer
/**
 * Register handlers + broadcast the initial state. Idempotent — call
 * once during setupServer bootstrap.
 */
export function setupHiddenCampfireServer(): void {
	recomputePosition()
	console.log(
		`[Server] hiddenCampfire: cycle seed=${currentSeed} ` +
		`pos=(${worldX.toFixed(1)}, ${worldZ.toFixed(1)}) lit=${lit}`
	)

	room.onMessage('hiddenCampfireIgnite', ({ seed }, context) => {
		const from = context?.from ?? 'unknown'
		if (seed !== currentSeed) {
			console.log(
				`[Server] hiddenCampfire: ignite rejected from ${from} ` +
				`— stale seed (got ${seed}, want ${currentSeed})`
			)
			return
		}
		if (lit) return
		lit = true
		console.log(`[Server] hiddenCampfire: ignited by ${from} (seed=${currentSeed})`)
		seedHiddenMeltRing()
		broadcast()
	})

	// Keep the melt ring authoritative. Same cadence as the central
	// campfire ring refresh in server.ts — cheap no-op after the first
	// pass since applyPaint short-circuits on cells already at the
	// target colour.
	const RING_REFRESH_HZ = 4
	const RING_INTERVAL   = 1 / RING_REFRESH_HZ
	let   ringClock       = 0
	engine.addSystem((dt: number) => {
		if (!lit) return
		ringClock += dt
		if (ringClock < RING_INTERVAL) return
		ringClock = 0
		seedHiddenMeltRing()
	})

	// Initial broadcast for any client that connected before this
	// module registered its handler.
	broadcast()
}
