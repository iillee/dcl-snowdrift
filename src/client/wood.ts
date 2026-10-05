/**
 * wood.ts - client rendering + proximity poll for scattered wood chunks.
 *
 * Positions are deterministic per cycle seed - both client and server
 * derive them from computeWoodScatter(seed). Only the active/inactive
 * state travels over the wire (see src/server/wood.ts).
 *
 * Lifecycle:
 *   - On cycle-state hydration: server broadcasts woodActiveSet with
 *     the current seed and active indices. Client rebuilds scatter,
 *     then reveals a GLB only where snow is melted.
 *   - Reveal: a chunk GLB only exists while the snow cell under it is
 *     fully melted. Regrowth hides it again; the active set stays.
 *   - Pickup: proximity poll sends woodPickupRequest; server confirms
 *     with woodChunkRemoved -> client despawns. Server also rejects
 *     pickups on unmelted cells.
 *
 * Local pickup effect: reuses pickupLogs(kind) so the F slot fills
 * the same way it does for a dropped pile. Two systems (scatter
 * chunks + dropped piles) share one carry state; the player carries
 * either a branch or a log.
 *
 * Trees are not piles of meshes. Each trunk holds four logs. Standing
 * close with an empty F slot offers Chop, and each chop spends one
 * and shrinks the model.
 */

import { Billboard, BillboardMode, Material, MaterialTransparencyMode, MeshRenderer, Transform, engine, Entity } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'

import { cycleMazeSeed, cycleSeedsEqual } from 'src/shared/cycleMazeSeed'
import { LOGS_PICKUP_RADIUS_SQ, LOGS_PILE_WORLD_Y } from 'src/shared/logs'
import { room } from 'src/shared/messages'
import { STAGE_MELTED, worldToCellKey } from 'src/shared/snowGrid'
import {
	computeWoodScatter,
	treeChopRadiusSq,
	treeSitesFromProps,
	WoodChunk,
	WoodTreeSite,
	WOOD_BAND_TREE,
} from 'src/shared/woodScatter'

import { hasLogs, pickupLogs } from 'src/client/logsInventory'
import { spawnLogsBounce } from 'src/client/logsPickupFx'
import { offHearthCellsForMazeSeed } from 'src/shared/terrain/terrainCache'
import { onPropTreesSpawned, syncTreeScales } from 'src/client/props/spawn'
import { getDisplayedStage } from 'src/client/snow/snowModel'
import { attachWoodModel } from 'src/client/woodVisual'


// MARK: Dev beacon
// Temporary locator marker over each wood chunk so testers can find them
// while we tune scatter density + eventually add snow-hiding. Same visual
// language as the hidden-campfire beacons but shorter + slimmer + a warm
// wood-brown so they don't compete with the hidden-fire gold when both
// are enabled at once. Flip DEV_BEACON_ENABLED to false to ship.
const DEV_BEACON_ENABLED   = false
const BEACON_GRADIENT_TEX  = 'assets/images/beacon-gradient.png'
const BEACON_ALPHA_TEX     = 'assets/images/beacon-alpha.png'
const BEACON_HEIGHT_M      = 30
const BEACON_Y_OFFSET_M    = 1.5
const BEACON_WIDTH_M       = 0.4
const BEACON_ALPHA         = 0.75
const BEACON_EMISSIVE      = 3.0
const BEACON_COLOR         = { r: 0.85, g: 0.55, b: 0.20 } // warm wood brown

/** Proximity poll cadence (s). Matches other polls (150 ms) so we
 *  amortise cost across the frame budget. */
const POLL_INTERVAL_S = 0.15


interface ChunkRec {
	entity: Entity
	/** Beacon plane parented to entity. null when DEV_BEACON_ENABLED=false. */
	beacon: Entity | null
	x     : number
	z     : number
	kind  : number
	/** False right after spawn; becomes true once the local player has
	 *  been outside the pickup radius. Prevents instant re-grab after a
	 *  trickle respawn near a stationary player. */
	armed : boolean
}

let currentSeed         = 0
let scatter             : WoodChunk[] = []
let treeSites           : WoodTreeSite[] = []
const activeIdx         = new Set<number>()
/** False until the server's first woodActiveSet lands. */
let hasActiveSet        = false
const chunkEntities     = new Map<number, ChunkRec>()
/** Idx -> Date.now() when the local player grabbed it. Reveal must
 *  not put the GLB back while this is set, or the head pop plays over
 *  a chunk that is still sitting on the snow. Cleared on the server
 *  confirm, or after PENDING_PICKUP_MS if the confirm never comes. */
const pendingPickup     = new Map<number, number>()
const PENDING_PICKUP_MS = 3000

let installed = false


// MARK: setupWoodClient
/**
 * Register the network handlers + start the proximity poll. Idempotent.
 * Must be called BEFORE initClientHandler so the joinRoster hydration
 * broadcast (woodActiveSet) is caught.
 */
export function setupWoodClient(): void {
	if (installed) {
		console.log('wood: setupWoodClient: already installed, skipping')
		return
	}
	installed = true

	room.onMessage('woodActiveSet', ({ seed, indices }) => {
		rebuildForSeed(seed)
		activeIdx.clear()
		hasActiveSet = true
		for (const idx of indices) activeIdx.add(idx)
		// A full set can arrive while our own pickup is still in flight
		// (join hydration). Drop claims the server has already removed,
		// and keep the rest so reveal does not respawn them.
		for (const idx of pendingPickup.keys()) {
			if (!activeIdx.has(idx)) pendingPickup.delete(idx)
		}
		for (const idx of chunkEntities.keys()) {
			if (!activeIdx.has(idx) || pendingPickup.has(idx)) despawnChunk(idx)
		}
		syncWoodReveal()
		syncTreeWoodScale()
		console.log(`wood: activeSet applied seed=${seed} active=${activeIdx.size}`)
	})

	room.onMessage('woodChunkActive', ({ seed, idx }) => {
		if (!cycleSeedsEqual(seed, currentSeed)) {
			console.log(`wood: chunkActive stale seed ${seed} vs ${currentSeed}, ignoring`)
			return
		}
		activeIdx.add(idx)
		syncWoodReveal()
		syncTreeWoodScale()
	})

	room.onMessage('woodChunkRemoved', ({ seed, idx, pickerId }) => {
		if (!cycleSeedsEqual(seed, currentSeed)) return
		pendingPickup.delete(idx)
		activeIdx.delete(idx)
		despawnChunk(idx)
		syncTreeWoodScale()
		// Remote FX: local player already got their bounce optimistically
		// in pickupLogs(), so only play here when someone ELSE grabbed it.
		// If we can't identify ourselves (getPlayer() null on early frames),
		// skip the FX rather than risk spawning a remote-style bounce for
		// our own pickup — that mis-attach orphans the rig at (0,0,0)
		// and reads as a teleport bug (see logsPickupFx normalisation).
		const me = getPlayer()?.userId.toLowerCase()
		if (!me)                                    return
		if (!pickerId)                              return
		if (pickerId.toLowerCase() === me)          return
		spawnLogsBounce(pickerId, scatter[idx]?.kind)
	})

	onPropTreesSpawned(syncTreeWoodScale)
	engine.addSystem(proximityPollSystem)
	console.log('wood: setupWoodClient: handlers + proximity poll installed')
}


// MARK: syncTreeWoodScale

/** Shrink each tree to the share of its four logs that are still there. */
function syncTreeWoodScale(): void {
	// Before the first woodActiveSet every chunk reads as taken, which
	// would scale all six trees to zero and silently empty the map.
	// Trees spawn at full size and wait for the real counts.
	if (!hasActiveSet) {
		console.log('wood: syncTreeWoodScale: no woodActiveSet yet, leaving trees at full scale')
		return
	}
	const remaining: number[] = []
	for (const c of scatter) {
		if (c.treeIndex === undefined) continue
		if (remaining[c.treeIndex] === undefined) remaining[c.treeIndex] = 0
		if (activeIdx.has(c.idx)) remaining[c.treeIndex]++
	}
	syncTreeScales(remaining)
}


// MARK: rebuildForSeed
function rebuildForSeed(seed: number): void {
	if (cycleSeedsEqual(seed, currentSeed) && scatter.length > 0) return
	currentSeed = seed
	const reserved = offHearthCellsForMazeSeed(cycleMazeSeed(seed))
	scatter        = computeWoodScatter(seed, reserved)
	treeSites      = treeSitesFromProps(cycleMazeSeed(seed), reserved)
	console.log(`wood: rebuildForSeed seed=${seed} count=${scatter.length}`)
}


// MARK: spawnChunk
function spawnChunk(idx: number, armed: boolean): void {
	if (chunkEntities.has(idx)) return
	const c = scatter[idx]
	if (!c) {
		console.log(`wood: spawnChunk: no scatter for idx=${idx} (seed ${currentSeed})`)
		return
	}
	const entity = engine.addEntity()
	attachWoodModel(entity, c.kind, c.worldX, c.worldZ, (idx * 37) % 360)

	let beacon: Entity | null = null
	if (DEV_BEACON_ENABLED) beacon = spawnBeacon(c.worldX, c.worldZ)

	chunkEntities.set(idx, { entity, beacon, x: c.worldX, z: c.worldZ, kind: c.kind, armed })
}


// MARK: spawnBeacon
/**
 * Single Y-billboarded plane over a wood chunk so testers can locate
 * it from a distance. Dev-only visual aid; strip once discovery is
 * tuned and (eventually) the snow-hiding gate lands.
 */
function spawnBeacon(x: number, z: number): Entity {
	const e       = engine.addEntity()
	const yCentre = LOGS_PILE_WORLD_Y + BEACON_Y_OFFSET_M + BEACON_HEIGHT_M / 2
	Transform.create(e, {
		position: Vector3.create(x, yCentre, z),
		scale   : Vector3.create(BEACON_WIDTH_M, BEACON_HEIGHT_M, 1),
	})
	MeshRenderer.setPlane(e)
	Billboard.create(e, { billboardMode: BillboardMode.BM_Y })
	const c = BEACON_COLOR
	Material.setPbrMaterial(e, {
		texture          : Material.Texture.Common({ src: BEACON_GRADIENT_TEX }),
		alphaTexture     : Material.Texture.Common({ src: BEACON_ALPHA_TEX }),
		albedoColor      : Color4.create(c.r, c.g, c.b, BEACON_ALPHA),
		emissiveColor    : Color3.create(c.r, c.g, c.b),
		emissiveIntensity: BEACON_EMISSIVE,
		transparencyMode : MaterialTransparencyMode.MTM_AUTO,
		castShadows      : false,
	})
	return e
}


// MARK: despawnChunk
function despawnChunk(idx: number): void {
	const rec = chunkEntities.get(idx)
	if (!rec) return
	engine.removeEntity(rec.entity)
	if (rec.beacon !== null) engine.removeEntity(rec.beacon)
	chunkEntities.delete(idx)
}


// MARK: isSnowMeltedAt

/** True when the snow cell at world (x, z) is fully melted. */
function isSnowMeltedAt(
	x: number,
	z: number,
): boolean {
	const key = worldToCellKey(x, z)
	if (key === null) return false
	return getDisplayedStage(key) === STAGE_MELTED
}


// MARK: syncWoodReveal

/**
 * Spawn GLBs for active chunks on melted cells; hide them again if
 * snow has grown back. Called after every active-set change and on
 * the proximity poll so melt underfoot reveals wood without a second
 * system.
 */
function syncWoodReveal(): void {
	releaseStalePickups()
	for (const idx of activeIdx) {
		const c = scatter[idx]
		if (!c) continue
		if (c.band === WOOD_BAND_TREE) {
			if (chunkEntities.has(idx)) despawnChunk(idx)
			continue
		}
		// Local grab already hid this chunk. Spawning it again before
		// the server confirms is the flicker: the GLB pops back on the
		// snow while the head bounce is still playing.
		if (pendingPickup.has(idx)) {
			if (chunkEntities.has(idx)) despawnChunk(idx)
			continue
		}
		const melted  = isSnowMeltedAt(c.worldX, c.worldZ)
		const spawned = chunkEntities.has(idx)
		if (melted && !spawned) spawnChunk(idx, true)
		if (!melted && spawned) despawnChunk(idx)
	}
}


// MARK: claimPickup
/**
 * Hide a ground chunk the local player just grabbed, and remember it
 * so a reveal pass cannot put the GLB back before the server agrees.
 */
function claimPickup(idx: number): void {
	pendingPickup.set(idx, Date.now())
	despawnChunk(idx)
}


// MARK: releaseStalePickups
/**
 * Give up claims whose confirm never arrived, so a rejected pickup
 * (snow still covering it on the server) can show the chunk again.
 */
function releaseStalePickups(): void {
	const now = Date.now()
	for (const [idx, at] of pendingPickup) {
		if (now - at < PENDING_PICKUP_MS) continue
		pendingPickup.delete(idx)
		console.log(`wood: releaseStalePickups: idx=${idx} confirm timed out, revealing again`)
	}
}


// MARK: proximityPollSystem
let accum = 0
function proximityPollSystem(dt: number): void {
	accum += dt
	if (accum < POLL_INTERVAL_S) return
	accum = 0

	syncWoodReveal()
	if (chunkEntities.size === 0) return
	if (hasLogs()) {
		armChunksOutOfRange()
		return
	}

	const player = Transform.getOrNull(engine.PlayerEntity)
	if (!player) return
	const px = player.position.x
	const pz = player.position.z

	for (const [idx, rec] of chunkEntities) {
		const dx = px - rec.x
		const dz = pz - rec.z
		const inRange = dx * dx + dz * dz <= LOGS_PICKUP_RADIUS_SQ

		if (!rec.armed) {
			if (!inRange) rec.armed = true
			continue
		}
		if (!inRange) continue

		// Hide the ground GLB first, then fill the F slot (which plays
		// the head pop). Confirm arrives as woodChunkRemoved.
		claimPickup(idx)
		pickupLogs(rec.kind)
		room.send('woodPickupRequest', { seed: currentSeed, idx })
		console.log(`wood: pickup request sent idx=${idx} kind=${rec.kind}`)
		break // one pickup per poll
	}
}


// MARK: findChopChunk

/** Nearest trunk that still has a log, or null when F is full or none are in reach. */
function findChopChunk(): WoodChunk | null {
	if (hasLogs()) return null
	const player = Transform.getOrNull(engine.PlayerEntity)
	if (!player) return null
	const px = player.position.x
	const pz = player.position.z
	let best  : WoodChunk | null = null
	let bestD = Number.POSITIVE_INFINITY
	for (const site of treeSites) {
		const dx = px - site.worldX
		const dz = pz - site.worldZ
		const d  = dx * dx + dz * dz
		if (d > treeChopRadiusSq(site.scale)) continue
		if (d >= bestD) continue
		let chunk: WoodChunk | null = null
		for (const c of scatter) {
			if (c.treeIndex !== site.treeIndex) continue
			if (c.band !== WOOD_BAND_TREE) continue
			if (!activeIdx.has(c.idx)) continue
			chunk = c
			break
		}
		if (!chunk) continue
		best  = chunk
		bestD = d
	}
	return best
}


// MARK: canChopWood

/** True while the Chop prompt should show: empty F slot, trunk in reach, wood left. */
export function canChopWood(): boolean {
	return findChopChunk() !== null
}


// MARK: tryChopWood

/**
 * Take one log off the nearest tree into the F slot and shrink that
 * trunk. The server is told so every client agrees. No-op when the
 * slot is full or no tree is in reach.
 */
export function tryChopWood(): void {
	const chunk = findChopChunk()
	if (!chunk) return
	activeIdx.delete(chunk.idx)
	syncTreeWoodScale()
	pickupLogs(chunk.kind)
	room.send('woodPickupRequest', { seed: currentSeed, idx: chunk.idx })
	console.log(
		`wood: tryChopWood: tree ${chunk.treeIndex} idx=${chunk.idx} ` +
		`at (${chunk.worldX.toFixed(1)}, ${chunk.worldZ.toFixed(1)})`
	)
}


// MARK: armChunksOutOfRange
function armChunksOutOfRange(): void {
	const player = Transform.getOrNull(engine.PlayerEntity)
	if (!player) return
	const px = player.position.x
	const pz = player.position.z
	for (const rec of chunkEntities.values()) {
		if (rec.armed) continue
		const dx = px - rec.x
		const dz = pz - rec.z
		if (dx * dx + dz * dz > LOGS_PICKUP_RADIUS_SQ) rec.armed = true
	}
}

