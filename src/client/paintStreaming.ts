/**
 * paintStreaming.ts — distance-based streaming of paint cells per tile.
 *
 * The paint system spawns one cube entity per 1 m walkable cell. At 10x10
 * tiles that is ~25k entities; at the target 4x world size we would blow
 * past DCL's entity budgets. This module wraps `spawnCellsForTile` so
 * cells only exist while a player is within `CELL_STREAM_IN_RADIUS_M` of
 * the tile centre, and are torn down again beyond `CELL_STREAM_OUT_RADIUS_M`.
 *
 * Server melt state is authoritative in the `PaintTile` CRDT byte arrays,
 * so despawn is lossless — `syncCellsFromCrdt` re-applies the current
 * stage/palette on respawn.
 *
 * Stage 1 note (2026-08-18): the distance gate is intentionally disabled
 * and every registered tile spawns immediately, so this refactor lands
 * as a pure structural change. Stage 2 wires up the real distance poll.
 *
 * ARCHITECTURE
 * - `registerTile()` — called from `spawnCellsForTile` in paint.ts. Adds
 *   the tile to the registry and (currently) spawns it immediately.
 * - `unregisterTile()` — called from `removePaintForTile` in paint.ts.
 *   Removes the registry entry so a stale tile is not resurrected by
 *   the streaming poll after teardown.
 * - Per-frame system (stage 2): walks the registry, polls all player
 *   positions, and toggles `spawnedNow` on each entry via the internal
 *   spawn/despawn callbacks passed in at register time.
 */

import { Entity } from '@dcl/sdk/ecs'


// MARK: Types

interface TileEntry {
	tileEntity: Entity
	/** World-space centre of the tile — computed once at register time. */
	centerX: number
	centerZ: number
	/** True while paint cells for this tile currently exist. */
	spawnedNow: boolean
	/** Whether this tile bypasses the distance gate and always renders. */
	alwaysSpawned: boolean
	/** Spawn callback wired by paint.ts (defers by SPAWN_DELAY_MS). */
	spawnFn:   () => void
	/** Teardown callback wired by paint.ts (removePaintForTile). */
	despawnFn: () => void
}


// MARK: Registry
const tiles = new Map<Entity, TileEntry>()


// MARK: registerTile
/**
 * Register a tile with the streaming system. `spawnFn` runs when the
 * gate decides cells should exist; `despawnFn` runs when they should
 * not. In stage 1 the gate is disabled and `spawnFn` runs immediately.
 *
 * @param tileEntity    the tile GLB entity — used as the registry key.
 * @param centerX       tile centre X in scene world coords.
 * @param centerZ       tile centre Z in scene world coords.
 * @param alwaysSpawned true for tiles that must never despawn (spawn
 *                      area, instant-spawn ring). Bypasses the gate.
 * @param spawnFn       runs when the tile should have live cells.
 * @param despawnFn     runs when the tile should not.
 */
export function registerTile(
	tileEntity:    Entity,
	centerX:       number,
	centerZ:       number,
	alwaysSpawned: boolean,
	spawnFn:       () => void,
	despawnFn:     () => void,
): void {
	const entry: TileEntry = {
		tileEntity,
		centerX,
		centerZ,
		spawnedNow: false,
		alwaysSpawned,
		spawnFn,
		despawnFn,
	}
	tiles.set(tileEntity, entry)

	// STAGE 1: gate disabled, always spawn. Stage 2 will replace this
	// with the distance-poll system below.
	entry.spawnFn()
	entry.spawnedNow = true
}


// MARK: unregisterTile
/**
 * Drop a tile from the registry. Called by `removePaintForTile` so a
 * tile that has been fully torn down (round teardown, generator reset)
 * cannot be resurrected by the streaming poll.
 *
 * Does NOT call `despawnFn` — the caller (paint.ts) is already tearing
 * down the entities and calling this to sync the registry.
 */
export function unregisterTile(tileEntity: Entity): void {
	tiles.delete(tileEntity)
}


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
