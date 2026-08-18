/**
 * paintStreaming.ts — distance-based streaming of paint cells per tile.
 *
 * The paint system spawns one cube entity per 1 m walkable cell. At 10x10
 * tiles that is ~25k entities; at the target 4x world size we would blow
 * past DCL's entity budgets. This module wraps `spawnCellsForTile` so
 * cells only exist while the local player is within
 * `CELL_STREAM_IN_RADIUS_M` of the tile centre, and are torn down again
 * beyond `CELL_STREAM_OUT_RADIUS_M`.
 *
 * Server melt state is authoritative in the `PaintTile` CRDT byte arrays,
 * so despawn is lossless — `syncCellsFromCrdt` re-applies the current
 * stage/palette on respawn. The `consumeReseedRequests()` API lets the
 * paint module wipe its per-tile shadow copy for respawned tiles so the
 * next diff pass re-dispatches every non-zero byte.
 *
 * Streaming is gated on the LOCAL player only. Remote players do not
 * pull cells into existence on this client — cells hydrate when the
 * local player wanders into range. Server-side paint state is unaffected.
 *
 * ARCHITECTURE
 * - `registerTile()` — called from `spawnCellsForTile` in paint.ts. Adds
 *   the tile to the registry. Tiles marked `alwaysSpawned` are spawned
 *   once at register time and never despawn.
 * - `unregisterTile()` — called from `removePaintForTile` in paint.ts.
 * - Per-frame system: throttled to `CELL_STREAM_POLL_HZ`, walks the
 *   registry, measures distance from the local player to each tile, and
 *   invokes `spawnFn` / `despawnFn` accordingly with hysteresis.
 */

import { Entity, Transform, engine } from '@dcl/sdk/ecs'

import {
	CELL_STREAM_IN_RADIUS_M,
	CELL_STREAM_OUT_RADIUS_M,
	CELL_STREAM_POLL_HZ,
} from 'src/shared/settings'


// MARK: Types

interface TileEntry {
	tileEntity: Entity
	/** Packed grid coordinate (see packTileKey). Matches the tileKey
	 *  encoded in the corresponding PaintTile CRDT entity's network id. */
	tileKey: number
	/** World-space centre of the tile — computed once at register time. */
	centerX: number
	centerZ: number
	/** True while paint cells for this tile currently exist. */
	spawnedNow: boolean
	/** Whether this tile bypasses the distance gate and always renders. */
	alwaysSpawned: boolean
	/** Spawn callback wired by paint.ts (defers by SPAWN_DELAY_MS). */
	spawnFn:   () => void
	/** Teardown callback wired by paint.ts (removePaintForTileEntitiesOnly). */
	despawnFn: () => void
}


// MARK: Registry
const tiles = new Map<Entity, TileEntry>()

/**
 * Tile keys that transitioned from despawned → spawned since the last
 * call to `consumeReseedRequests()`. The paint module drains this each
 * tick of `syncCellsFromCrdt` and clears the matching shadow bytes so
 * every non-zero PaintTile byte is re-dispatched on the freshly spawned
 * cells. Keyed by tileKey (not Entity) so paint.ts can match against
 * the PaintTile CRDT entity's network id without a second lookup.
 */
const reseedRequests = new Set<number>()


// MARK: registerTile
/**
 * Register a tile with the streaming system.
 *
 * @param tileEntity    tile GLB entity — used as the registry key.
 * @param centerX       tile centre X in scene world coords.
 * @param centerZ       tile centre Z in scene world coords.
 * @param alwaysSpawned true for tiles that must never despawn (spawn
 *                      area, instant-spawn ring). Spawned immediately
 *                      at register time.
 * @param spawnFn       runs when the tile should have live cells.
 * @param despawnFn     runs when the tile should not.
 */
export function registerTile(
	tileEntity:    Entity,
	tileKey:       number,
	centerX:       number,
	centerZ:       number,
	alwaysSpawned: boolean,
	spawnFn:       () => void,
	despawnFn:     () => void,
): void {
	const entry: TileEntry = {
		tileEntity,
		tileKey,
		centerX,
		centerZ,
		spawnedNow: false,
		alwaysSpawned,
		spawnFn,
		despawnFn,
	}
	tiles.set(tileEntity, entry)

	if (alwaysSpawned) {
		entry.spawnFn()
		entry.spawnedNow = true
		reseedRequests.add(tileKey)
	}
	// Non-always-spawned tiles wait for the streaming poll below.
}


// MARK: unregisterTile
/**
 * Drop a tile from the registry. Does NOT invoke `despawnFn` — the
 * caller (paint.ts `removePaintForTile`) is already tearing down the
 * entities and calling this to sync the registry.
 */
export function unregisterTile(tileEntity: Entity): void {
	const entry = tiles.get(tileEntity)
	if (!entry) return
	reseedRequests.delete(entry.tileKey)
	tiles.delete(tileEntity)
}


// MARK: consumeReseedRequests
/**
 * Return and clear the set of tile entities that have transitioned
 * despawned → spawned since the last call. Consumed by paint.ts's
 * `syncCellsFromCrdt` to wipe the shadow copy so the next diff
 * re-dispatches every non-zero PaintTile byte onto the fresh cells.
 */
export function consumeReseedRequests(): Set<number> {
	if (reseedRequests.size === 0) return EMPTY_SET
	const out = new Set(reseedRequests)
	reseedRequests.clear()
	return out
}
const EMPTY_SET: Set<number> = new Set()


// MARK: Poll system
//
// Throttled per-frame walk over the registry. Local player position is
// the only reference — cells stream in/out relative to where the local
// player stands, regardless of where remote players are (their cells
// hydrate when the local player wanders over).

const POLL_INTERVAL_S    = 1 / CELL_STREAM_POLL_HZ
const IN_RADIUS_SQ       = CELL_STREAM_IN_RADIUS_M  * CELL_STREAM_IN_RADIUS_M
const OUT_RADIUS_SQ      = CELL_STREAM_OUT_RADIUS_M * CELL_STREAM_OUT_RADIUS_M

let pollAccum = 0

engine.addSystem((dt: number) => {
	pollAccum += dt
	if (pollAccum < POLL_INTERVAL_S) return
	pollAccum = 0

	const t = Transform.getOrNull(engine.PlayerEntity)
	if (!t) return
	const px = t.position.x
	const pz = t.position.z

	for (const entry of tiles.values()) {
		if (entry.alwaysSpawned) continue

		const dx = entry.centerX - px
		const dz = entry.centerZ - pz
		const distSq = dx * dx + dz * dz

		if (!entry.spawnedNow && distSq <= IN_RADIUS_SQ) {
			entry.spawnFn()
			entry.spawnedNow = true
			reseedRequests.add(entry.tileKey)
		} else if (entry.spawnedNow && distSq >= OUT_RADIUS_SQ) {
			entry.despawnFn()
			entry.spawnedNow = false
		}
	}
})


// MARK: registeredTileCount
/** Diagnostic — total tiles known to the streaming system. */
export function registeredTileCount(): number {
	return tiles.size
}


// MARK: spawnedTileCount
/** Diagnostic — subset of registered tiles that currently have live cells. */
export function spawnedTileCount(): number {
	let n = 0
	for (const t of tiles.values()) if (t.spawnedNow) n++
	return n
}
