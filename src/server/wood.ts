/**
 * wood.ts - authoritative state for scattered wood chunks.
 *
 * Owns:
 *   - currentSeed : which cycle's scatter is live
 *   - active      : Set<idx> of chunks not yet picked up
 *   - scatter     : cached WoodChunk[] for currentSeed
 *
 * Message contracts:
 *   Client -> Server  woodPickupRequest  { seed, idx }
 *   Server -> Client  woodActiveSet      { seed, indices }
 *   Server -> Client  woodChunkActive    { seed, idx }
 *   Server -> Client  woodChunkRemoved   { seed, idx }
 *
 * No in-run trickle. Picked chunks stay gone until the 24 h cycle
 * roll rebuilds the scatter. Pickup is rejected unless the snow at
 * that cell is fully melted (stage 0).
 *
 * Cycle roll (subscribed to onCycleRoll):
 *   - recompute scatter for the new seed
 *   - reactivate the initial subset
 *   - broadcast fresh woodActiveSet
 */

import { room } from 'src/shared/messages'
import { STAGE_MELTED } from 'src/shared/snowGrid'
import {
	computeWoodScatter, WoodChunk, WOOD_ACTIVE_TARGET,
} from 'src/shared/woodScatter'
import { getCurrentCycleSeed, onCycleRoll } from 'src/server/cycle'
import { getStageAtWorld } from 'src/server/snowState'


let currentSeed   = 0
let scatter       : WoodChunk[] = []
/** Idxes currently active in the world. */
const active      = new Set<number>()


// MARK: rebuildScatter
/**
 * Recompute the scatter for `seed` and pick a random initial
 * WOOD_ACTIVE_TARGET subset of the pool to activate. Everything else
 * stays unused for this cycle.
 *
 * Called at boot and on cycle roll. Does NOT broadcast - callers do.
 */
function rebuildScatter(seed: number): void {
	currentSeed = seed
	scatter     = computeWoodScatter(seed)
	active.clear()

	// Fisher-Yates a shuffle of pool idxes, then take the first N as
	// the initial active set. Random.random is fine here - positions
	// are broadcast, so determinism between server restarts doesn't
	// matter for this pick.
	const pool = scatter.map(c => c.idx)
	for (let i = pool.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1))
		const t = pool[i]; pool[i] = pool[j]; pool[j] = t
	}
	const initialCount = Math.min(WOOD_ACTIVE_TARGET, pool.length)
	for (let i = 0; i < initialCount; i++) {
		active.add(pool[i])
	}

	console.log(
		`[Server] wood: rebuilt scatter seed=${seed} pool=${scatter.length} ` +
		`active=${active.size}/${WOOD_ACTIVE_TARGET}`
	)
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


// MARK: setupWoodServer
/**
 * Register handlers and compute the initial scatter. Idempotent —
 * call once from setupServer after setupCycleServer so we adopt its
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
		const chunk = scatter[idx]
		if (!chunk) {
			console.log(`[Server] wood: pickup ${idx} from ${from} - no scatter row`)
			return
		}
		if (getStageAtWorld(chunk.worldX, chunk.worldZ) !== STAGE_MELTED) {
			console.log(`[Server] wood: pickup ${idx} from ${from} rejected - snow not melted`)
			return
		}
		active.delete(idx)
		console.log(`[Server] wood: pickup idx=${idx} by ${from} (${active.size}/${scatter.length} remaining)`)
		// pickerId is echoed so clients can play the head-bounce FX over
		// the correct avatar. Lowercased to match getPlayer().userId on
		// the client.
		room.send('woodChunkRemoved', {
			seed    : currentSeed,
			idx,
			pickerId: from.toLowerCase(),
		})
	})

	onCycleRoll(({ newSeed }) => {
		console.log(`[Server] wood: cycle roll -> rebuilding scatter for seed ${newSeed}`)
		rebuildScatter(newSeed)
		broadcastActiveSet()
	})
}
