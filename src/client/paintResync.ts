/**
 * paintResync.ts — periodic paint-state safety net.
 *
 * Every RESYNC_INTERVAL_S seconds after a RESYNC_STARTUP_GRACE_S grace
 * period, wipes the client's per-tile shadow map and cellApplied
 * cache (via reseedRequests) for every currently-spawned tile except
 * the one the local player is standing on. The next syncCellsFromCrdt
 * pass re-diffs every non-zero PaintTile byte from scratch and
 * re-dispatches, recovering any cell whose visual dispatch was
 * silently dropped earlier (typically: the cell entity had not yet
 * spawned when the observer ran).
 *
 * Design notes (2026-08-25):
 *   - This is a SAFETY NET, not a fix. The underlying race — the CRDT
 *     observer advancing cellApplied even when applyPaintIndex found
 *     no cell entity — still exists. See the discussion in the
 *     warmth-together branch handoff. This module bounds the visible
 *     lifetime of a stuck cell to ~RESYNC_INTERVAL_S seconds instead
 *     of "forever".
 *   - The resync is designed to be visually invisible in the common
 *     case. Correctly-rendered cells no-op via the renderedIndex
 *     short-circuit in applyPaintIndex; correctly-staged cells run a
 *     zero-delta tween that produces no visible motion. Only actually-
 *     stuck cells animate, and they animate via the normal drop/rise
 *     tween — reads as "delayed melt" rather than "glitch".
 *   - Skipping the player's current tile avoids the specific case
 *     where they just painted a cell, its drop tween is mid-flight,
 *     and a redundant re-dispatch would clobber the in-progress
 *     tween. Tiles adjacent to the player are still reseeded — the
 *     player might have painted into a neighbouring tile with their
 *     3x3/5x5 brush, but the paint outbox has typically already flushed
 *     by the resync interval so the tween is complete.
 *   - The startup grace lets the cold-open sync pass (which handles
 *     every PaintTile the joiner receives in the first few seconds)
 *     finish naturally before the first safety resync fires. Firing
 *     during the cold-open would be noisy for no gain.
 */

import { Transform, engine } from '@dcl/sdk/ecs'

import { MAZE_ORIGIN_OFFSET_METERS } from 'src/shared/settings'
import { packTileKey }               from 'src/shared/paintGrid'

import { CELL }                      from 'src/shared/maze/generator'
import { requestResyncForSpawnedTiles } from 'src/client/paintStreaming'


// MARK: Tuning
/**
 * How often the safety resync fires. Chosen so a stuck cell is
 * recovered within seconds (players notice a beat but not a session-
 * long hole), while low enough that per-tick cost is negligible \u2014
 * even a full-map resync at this cadence is cheaper than one frame of
 * the diff loop for a large-map cold-open.
 */
const RESYNC_INTERVAL_S       = 20
/**
 * Deferred first fire. Cold-open floods the sync loop with the initial
 * PaintTile hydration for the whole world; firing a resync inside that
 * window would be noise on top of the natural process. Wait until the
 * first sync passes have settled.
 */
const RESYNC_STARTUP_GRACE_S  = 5


// MARK: Module state
let installed  = false
let elapsed    = 0
let sinceLast  = 0
let started    = false


// MARK: localPlayerTileKey
// Compute the packed tile key of the tile the local player is standing
// on. Level is assumed 0 (ground) \u2014 if they are on a ramp / upper
// tile, worst case is we redundantly reseed their current cell's tile,
// which produces at most one no-op tween on the current cell. Cheap
// approximation, no lookupTile plumbing required here.
function localPlayerTileKey(): number | null {
	const t = Transform.getOrNull(engine.PlayerEntity)
	if (t === null) return null
	const tx = Math.floor((t.position.x - MAZE_ORIGIN_OFFSET_METERS) / CELL)
	const tz = Math.floor((t.position.z - MAZE_ORIGIN_OFFSET_METERS) / CELL)
	return packTileKey(tx, tz, 0)
}


// MARK: setupPaintResync
/**
 * Install the periodic resync system. Idempotent \u2014 safe to call once
 * from client bootstrap. No dependencies on team, roster, or specific
 * feature modules; the resync operates purely on the streaming
 * registry and the CRDT observer.
 */
export function setupPaintResync(): void {
	if (installed) {
		console.log('paintResync: setupPaintResync: already installed, skipping')
		return
	}
	installed = true

	engine.addSystem((dt: number) => {
		elapsed += dt
		if (!started) {
			if (elapsed < RESYNC_STARTUP_GRACE_S) return
			started    = true
			sinceLast  = 0
			return
		}
		sinceLast += dt
		if (sinceLast < RESYNC_INTERVAL_S) return
		sinceLast = 0

		const excluded = localPlayerTileKey()
		const queued   = requestResyncForSpawnedTiles(excluded)
		// Quiet log \u2014 firing every 20 s, one line each. Useful to correlate
		// against any "the world briefly rippled" playtest reports without
		// flooding the console.
		if (queued > 0) {
			console.log(`paintResync: queued ${queued} tile(s) for safety re-diff` +
				(excluded !== null ? ` (skipped player tile ${excluded})` : ''))
		}
	})

	console.log(
		'paintResync: setupPaintResync: safety resync active ' +
		`(grace=${RESYNC_STARTUP_GRACE_S}s, interval=${RESYNC_INTERVAL_S}s)`
	)
}
