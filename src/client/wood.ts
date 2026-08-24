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
 *     spawns GLBs for each active idx.
 *   - Trickle respawn: server broadcasts woodChunkActive { seed, idx }
 *     -> client spawns one GLB.
 *   - Pickup: proximity poll sends woodPickupRequest; server confirms
 *     with woodChunkRemoved -> client despawns.
 *
 * Local pickup effect: reuses pickupLogs() so the F slot fills the
 * same way it does for a hearth pile. Two systems (scatter chunks +
 * dropped piles) share one carry state; the player just carries "a
 * log".
 */

import { Billboard, BillboardMode, GltfContainer, Material, MaterialTransparencyMode, MeshRenderer, Transform, engine, Entity } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 }                                                                                  from '@dcl/sdk/math'

import { LOGS_PICKUP_RADIUS_SQ, LOGS_PILE_WORLD_Y } from 'src/shared/logs'
import { computeWoodScatter, WoodChunk }            from 'src/shared/woodScatter'
import { hasLogs, pickupLogs }                      from 'src/client/logsInventory'
import { spawnLogsBounce }                          from 'src/client/logsPickupFx'
import { room }                                     from 'src/shared/messages'
import { getPlayer }                                from '@dcl/sdk/players'


/**
 * Reuses the hearth-pile GLB as a placeholder for a single chunk. Feels
 * oversized for a chunk-in-the-snow but keeps the asset bill tiny; swap
 * to a dedicated single-log GLB when we have one.
 */
const WOOD_CHUNK_MODEL = 'assets/models/logs_pickup.glb'
/** Uniform scale applied to the chunk GLB. Currently 1.0 (full pile
 *  size) for tuning visibility - shrink once we know players can spot
 *  them across the field. */
const WOOD_CHUNK_SCALE = 1.0

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
	/** False right after spawn; becomes true once the local player has
	 *  been outside the pickup radius. Prevents instant re-grab after a
	 *  trickle respawn near a stationary player. */
	armed : boolean
}

let currentSeed         = 0
let scatter             : WoodChunk[] = []
const chunkEntities     = new Map<number, ChunkRec>()

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
		// Despawn any previously spawned chunk not in the new active set;
		// spawn any active idx not currently rendered. Handles both
		// hydration (empty -> full) and cycle roll (old set -> new set)
		// in one code path.
		const activeSet = new Set<number>(indices)
		for (const idx of chunkEntities.keys()) {
			if (!activeSet.has(idx)) despawnChunk(idx)
		}
		for (const idx of activeSet) {
			if (!chunkEntities.has(idx)) spawnChunk(idx, /* armed */ true)
		}
		console.log(`wood: activeSet applied seed=${seed} active=${activeSet.size}`)
	})

	room.onMessage('woodChunkActive', ({ seed, idx }) => {
		if (seed !== currentSeed) {
			console.log(`wood: chunkActive stale seed ${seed} vs ${currentSeed}, ignoring`)
			return
		}
		// Fresh spawns start unarmed - the local player might be standing
		// right on top of the reactivated chunk.
		spawnChunk(idx, /* armed */ false)
	})

	room.onMessage('woodChunkRemoved', ({ seed, idx, pickerId }) => {
		if (seed !== currentSeed) return
		despawnChunk(idx)
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
		spawnLogsBounce(pickerId)
	})

	engine.addSystem(proximityPollSystem)
	console.log('wood: setupWoodClient: handlers + proximity poll installed')
}


// MARK: rebuildForSeed
function rebuildForSeed(seed: number): void {
	if (seed === currentSeed && scatter.length > 0) return
	currentSeed = seed
	scatter     = computeWoodScatter(seed)
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
	Transform.create(entity, {
		position: Vector3.create(c.worldX, LOGS_PILE_WORLD_Y, c.worldZ),
		rotation: Quaternion.fromEulerDegrees(0, (idx * 37) % 360, 0),
		scale   : Vector3.create(WOOD_CHUNK_SCALE, WOOD_CHUNK_SCALE, WOOD_CHUNK_SCALE),
	})
	// Colliders disabled: chunks should never block player movement or
	// physics rays — players walk over them to pick them up.
	GltfContainer.create(entity, {
		src                          : WOOD_CHUNK_MODEL,
		visibleMeshesCollisionMask   : 0,
		invisibleMeshesCollisionMask : 0,
	})

	let beacon: Entity | null = null
	if (DEV_BEACON_ENABLED) beacon = spawnBeacon(c.worldX, c.worldZ)

	chunkEntities.set(idx, { entity, beacon, x: c.worldX, z: c.worldZ, armed })
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


// MARK: proximityPollSystem
let accum = 0
function proximityPollSystem(dt: number): void {
	accum += dt
	if (accum < POLL_INTERVAL_S) return
	accum = 0

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

		// Optimistically fill the F slot + hide the entity, then ask the
		// server to make it authoritative. Confirmation arrives as
		// woodChunkRemoved, which destroys the entity.
		pickupLogs()
		despawnChunk(idx)
		room.send('woodPickupRequest', { seed: currentSeed, idx })
		console.log(`wood: pickup request sent idx=${idx}`)
		break // one pickup per poll
	}
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
