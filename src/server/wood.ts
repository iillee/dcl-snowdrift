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
import {
	computeWoodScatter, WoodChunk, WOOD_ACTIVE_TARGET, WOOD_POOL_SIZE,
} from 'src/shared/woodScatter'
import { getCurrentCycleSeed, onCycleRoll } from 'src/server/cycle'


/** How often (s) the trickle tries to add a fresh chunk if the active
 *  count is below WOOD_ACTIVE_TARGET. */
const TRICKLE_INTERVAL_S = 60


let currentSeed   = 0
let scatter       : WoodChunk[] = []
/** Idxes currently visible in the world. */
const active      = new Set<number>()
/** Idxes that have been active at any point during the current cycle.
 *  Never reused - so trickle respawns always pick a fresh position.
 *  Cleared on cycle roll (fresh scatter, fresh field). */
const everSpawned = new Set<number>()
let trickleClock  = TRICKLE_INTERVAL_S


// MARK: rebuildScatter
/**
 * Recompute the scatter for `seed` and pick a random initial
 * WOOD_ACTIVE_TARGET subset of the pool to activate. Everything else
 * stays dormant until a trickle respawn promotes it. `everSpawned`
 * is initialised to the same subset so those idxes won't be picked
 * again by trickle (fresh-position invariant).
 *
 * Called at boot and on cycle roll. Does NOT broadcast - callers do.
 */
function rebuildScatter(seed: number): void {
	currentSeed = seed
	scatter     = computeWoodScatter(seed)
	active.clear()
	everSpawned.clear()

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
		everSpawned.add(pool[i])
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


// MARK: trickleSpawnFresh
/**
 * If the active count is below the target AND the pool still has
 * never-spawned idxes, pick a random fresh one, activate it, mark it
 * as spawned-this-cycle, and broadcast. Fresh-position guarantee
 * means a chunk NEVER reappears at a spot a player already grabbed
 * it from in the current cycle.
 *
 * When everSpawned fills the pool, trickle idles until the next
 * cycle roll clears the set.
 */
function trickleSpawnFresh(): void {
	if (active.size >= WOOD_ACTIVE_TARGET) return
	if (everSpawned.size >= WOOD_POOL_SIZE) {
		// Pool exhausted for this cycle; wait for cycle roll.
		return
	}
	const candidates: number[] = []
	for (const c of scatter) if (!everSpawned.has(c.idx)) candidates.push(c.idx)
	if (candidates.length === 0) return
	const pick = candidates[Math.floor(Math.random() * candidates.length)]
	active.add(pick)
	everSpawned.add(pick)
	console.log(
		`[Server] wood: trickle FRESH idx=${pick} ` +
		`(active=${active.size}/${WOOD_ACTIVE_TARGET}, everSpawned=${everSpawned.size}/${scatter.length})`
	)
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

	// Trickle respawn tick.
	engine.addSystem((dt: number) => {
		trickleClock -= dt
		if (trickleClock > 0) return
		trickleClock = TRICKLE_INTERVAL_S
		trickleSpawnFresh()
	})
}
