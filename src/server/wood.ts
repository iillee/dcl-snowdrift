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
 *   - reactivate the near, far, and outer subsets and every tree cluster
 *   - broadcast fresh woodActiveSet
 */

import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { room } from 'src/shared/messages'
import { STAGE_MELTED } from 'src/shared/snowGrid'
import { WOOD_KIND_BRANCH } from 'src/shared/woodKind'
import {
	computeWoodScatter,
	WoodChunk,
	WOOD_BAND_FAR,
	WOOD_BAND_NEAR,
	WOOD_BAND_OUTER,
	WOOD_BAND_TREE,
	WOOD_FAR_ACTIVE,
	WOOD_NEAR_ACTIVE,
	WOOD_OUTER_ACTIVE,
} from 'src/shared/woodScatter'

import { reservedCellsForMazeSeed } from 'src/client/perimeter'
import { getCurrentCycleSeed, onCycleRoll } from 'src/server/cycle'
import { getStageAtWorld } from 'src/server/snowState'


let currentSeed   = 0
let scatter       : WoodChunk[] = []
/** Idxes currently active in the world. */
const active      = new Set<number>()


// MARK: shuffleTake
/** Shuffle `idxs` in place and add the first `n` into `into`. */
function shuffleTake(
	idxs: number[],
	n   : number,
	into: Set<number>,
): void {
	for (let i = idxs.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1))
		const t = idxs[i]; idxs[i] = idxs[j]; idxs[j] = t
	}
	const take = Math.min(n, idxs.length)
	for (let i = 0; i < take; i++) into.add(idxs[i])
}


// MARK: rebuildScatter
/**
 * Recompute the scatter for `seed` and activate a random subset of
 * each buried band. Everything else stays unused for this cycle.
 *
 * Called at boot and on cycle roll. Does NOT broadcast - callers do.
 */
function rebuildScatter(seed: number): void {
	currentSeed = seed
	const reserved = reservedCellsForMazeSeed(cycleMazeSeed(seed))
	scatter     = computeWoodScatter(seed, reserved)
	active.clear()

	const near : number[] = []
	const far  : number[] = []
	const outer: number[] = []
	for (const c of scatter) {
		if (c.band === WOOD_BAND_NEAR) near.push(c.idx)
		else if (c.band === WOOD_BAND_FAR) far.push(c.idx)
		else if (c.band === WOOD_BAND_OUTER) outer.push(c.idx)
	}
	shuffleTake(near,  WOOD_NEAR_ACTIVE,  active)
	shuffleTake(far,   WOOD_FAR_ACTIVE,   active)
	shuffleTake(outer, WOOD_OUTER_ACTIVE, active)
	for (const c of scatter) {
		if (c.band === WOOD_BAND_TREE) active.add(c.idx)
	}

	let branches = 0
	let logs     = 0
	let nearN    = 0
	let farN     = 0
	let outerN   = 0
	let treeN    = 0
	for (const idx of active) {
		const c = scatter[idx]
		if (c.band === WOOD_BAND_NEAR) nearN++
		else if (c.band === WOOD_BAND_FAR) farN++
		else if (c.band === WOOD_BAND_OUTER) outerN++
		else if (c.band === WOOD_BAND_TREE) treeN++
		if (c.kind === WOOD_KIND_BRANCH) branches++
		else logs++
	}

	console.log(
		`[Server] wood: rebuilt scatter seed=${seed} pool=${scatter.length} ` +
		`active=${active.size} (near=${nearN} far=${farN} outer=${outerN} ` +
		`tree=${treeN} branches=${branches} logs=${logs})`
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
	// Broadcast. Addressed hydration was not reaching the preview
	// client, so no branch or log GLB was ever created.
	broadcastActiveSet()
	console.log(`[Server] wood: hydrated ${active.size}/${scatter.length} chunk(s) for ${userId}`)
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
		// Tree chops are the trunk itself, not a mesh buried in the snow.
		// Ground branches and logs still have to be melted clear.
		if (chunk.band !== WOOD_BAND_TREE && getStageAtWorld(chunk.worldX, chunk.worldZ) !== STAGE_MELTED) {
			console.log(`[Server] wood: pickup ${idx} from ${from} rejected - snow not melted`)
			return
		}
		active.delete(idx)
		console.log(
			`[Server] wood: pickup idx=${idx} kind=${chunk.kind} by ${from} ` +
			`(${active.size}/${scatter.length} remaining)`
		)
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
