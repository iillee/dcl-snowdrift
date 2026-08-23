/**
 * wood.ts - authoritative state for scattered wood chunks.
 *
 * Owns:
 *   - currentSeed : which cycle's scatter is live
 *   - active      : Set<idx> of chunks not yet picked up
 *   - scatter     : cached WoodChunk[] for currentSeed
 *   - trickleClock: seconds until the next respawn tick
 *
 * Message contracts:
 *   Client -> Server  woodPickupRequest  { seed, idx }
 *   Server -> Client  woodActiveSet      { seed, indices }
 *   Server -> Client  woodChunkActive    { seed, idx }
 *   Server -> Client  woodChunkRemoved   { seed, idx }
 *
 * Trickle respawn: every TRICKLE_INTERVAL_S seconds, if any chunks
 * are inactive, one is randomly reactivated. Keeps the field
 * refilling without requiring a full cycle roll.
 *
 * Cycle roll (subscribed to onCycleRoll):
 *   - recompute scatter for the new seed
 *   - reactivate every chunk
 *   - broadcast fresh woodActiveSet
 */

import { engine } from '@dcl/sdk/ecs'

import { room } from 'src/shared/messages'
import { computeWoodScatter, WoodChunk } from 'src/shared/woodScatter'
import { getCurrentCycleSeed, onCycleRoll } from 'src/server/cycle'


/** How often (s) a random inactive chunk is reactivated. */
const TRICKLE_INTERVAL_S = 60


let currentSeed  = 0
let scatter      : WoodChunk[] = []
const active     = new Set<number>()
let trickleClock = TRICKLE_INTERVAL_S


// MARK: rebuildScatter
/**
 * Recompute the scatter for `seed` and mark every chunk active.
 * Called at boot and on cycle roll. Does NOT broadcast - callers do.
 */
function rebuildScatter(seed: number): void {
	currentSeed = seed
	scatter     = computeWoodScatter(seed)
	active.clear()
	for (const c of scatter) active.add(c.idx)
	console.log(`[Server] wood: rebuilt scatter seed=${seed} count=${scatter.length}`)
	// Dev aid: dump the first few chunk positions so a tester can walk
	// straight to one instead of hunting blind. Remove once the loop is
	// tuned.
	for (let i = 0; i < Math.min(5, scatter.length); i++) {
		const c = scatter[i]
		console.log(`[Server] wood: chunk[${i}] at (${c.worldX.toFixed(1)}, ${c.worldZ.toFixed(1)})`)
	}
}


// MARK: broadcastActiveSet
function broadcastActiveSet(userId?: string): void {
	const indices = Array.from(active).sort((a, b) => a - b)
	const opts    = userId ? { to: [userId] } : undefined
	room.send('woodActiveSet', { seed: currentSeed, indices }, opts)
}


// MARK: sendWoodStateTo
/**
 * Push the full active set to a specific client. Called from the
 * joinRoster handler so latecomers see the same wood field everyone
 * else does.
 */
export function sendWoodStateTo(userId: string): void {
	broadcastActiveSet(userId)
	console.log(`[Server] wood: hydrated ${active.size}/${scatter.length} chunk(s) to ${userId}`)
}


// MARK: trickleReactivate
/**
 * Pick a random currently-inactive chunk and mark it active. No-op if
 * every chunk is already active. Broadcasts the single reactivation.
 */
function trickleReactivate(): void {
	if (active.size >= scatter.length) return
	// Build the inactive list (small map, this is cheap).
	const inactive: number[] = []
	for (const c of scatter) if (!active.has(c.idx)) inactive.push(c.idx)
	if (inactive.length === 0) return
	const pick = inactive[Math.floor(Math.random() * inactive.length)]
	active.add(pick)
	console.log(`[Server] wood: trickle reactivate idx=${pick} (${active.size}/${scatter.length})`)
	room.send('woodChunkActive', { seed: currentSeed, idx: pick })
}


// MARK: setupWoodServer
/**
 * Register handlers, compute the initial scatter, and start the
 * trickle tick. Idempotent - safe to call once from setupServer
 * bootstrap. Register AFTER setupCycleServer so we adopt its
 * authoritative seed.
 */
export function setupWoodServer(): void {
	rebuildScatter(getCurrentCycleSeed())

	room.onMessage('woodPickupRequest', ({ seed, idx }, context) => {
		const from = context?.from ?? 'unknown'
		if (seed !== currentSeed) {
			console.log(`[Server] wood: pickup rejected from ${from} - stale seed (${seed} vs ${currentSeed})`)
			return
		}
		if (!active.has(idx)) {
			// Silent under normal race conditions; log because a genuine
			// bug here would be worth catching.
			console.log(`[Server] wood: pickup ${idx} from ${from} - already inactive (race?)`)
			return
		}
		active.delete(idx)
		console.log(`[Server] wood: pickup idx=${idx} by ${from} (${active.size}/${scatter.length} remaining)`)
		room.send('woodChunkRemoved', { seed: currentSeed, idx })
	})

	onCycleRoll(({ newSeed }) => {
		console.log(`[Server] wood: cycle roll -> rebuilding scatter for seed ${newSeed}`)
		rebuildScatter(newSeed)
		broadcastActiveSet()
	})

	// Trickle respawn tick.
	engine.addSystem((dt: number) => {
		trickleClock -= dt
		if (trickleClock > 0) return
		trickleClock = TRICKLE_INTERVAL_S
		trickleReactivate()
	})
}
