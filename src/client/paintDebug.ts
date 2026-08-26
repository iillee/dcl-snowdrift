/**
 * paintDebug.ts \u2014 diagnostic counters for the paint-sync race
 * investigation (2026-08-25).
 *
 * The paint pipeline has a suspected race where the CRDT observer
 * fires for cells whose entities have not yet spawned. When that
 * happens, applyPaintIndex silently drops the visual dispatch but
 * still advances renderedIndex (poisoning future re-dispatch
 * short-circuits), and syncCellsFromCrdt still advances cellApplied
 * (poisoning spawnCube's hydration read). Two symptoms trace to this:
 * mobile "can't see own melt" and a corner of the campfire seed ring
 * intermittently failing to melt on desktop after the center-out
 * load-in change.
 *
 * This module counts occurrences of the three most-suspected drop
 * paths and prints a rollup every 10 seconds so we can distinguish
 * "theoretical race" from "race that actually fires with playtest-
 * relevant frequency" before writing the fix (Option B in the paint-
 * sync handoff).
 *
 * Gated by SHOW_PAINT_SYNC_DEBUG in devFlags. When the flag is off,
 * every hook is a no-op single map-lookup \u2014 safe to leave in the hot
 * path for a session.
 *
 * Remove or repurpose once Option B ships and the numbers confirm the
 * fix took.
 */

import { engine } from '@dcl/sdk/ecs'

import { SHOW_PAINT_SYNC_DEBUG } from 'src/client/devFlags'


// MARK: Tuning
const ROLLUP_INTERVAL_S = 10
// Cap the retained sample id per bucket so a runaway drop stream does
// not grow an unbounded string. One id is enough to eyeball-locate a
// stuck cell in-world.
const SAMPLE_ID_LENGTH_MAX = 64


// MARK: Module state
let applyDropCount     = 0
let stageDropCount     = 0
let spawnGuardCount    = 0
let applyDropSample    = ''
let stageDropSample    = ''
let spawnGuardSample   = ''
let elapsed            = 0
let installed          = false


// MARK: recordApplyPaintDrop
/**
 * Increment the applyPaintIndex-drop counter. Called from paint.ts
 * inside the `!data` branch of applyPaintIndex \u2014 the exact spot where
 * renderedIndex has just been advanced but no visual will fire.
 */
export function recordApplyPaintDrop(id: string): void {
	if (!SHOW_PAINT_SYNC_DEBUG) return
	applyDropCount++
	if (!applyDropSample && id.length <= SAMPLE_ID_LENGTH_MAX) applyDropSample = id
}


// MARK: recordStageDrop
/**
 * Increment the advanceSnowFillStage-drop counter. Called from
 * paint.ts inside the `!data || data.kind !== 'cube'` early-return of
 * advanceSnowFillStage.
 */
export function recordStageDrop(id: string): void {
	if (!SHOW_PAINT_SYNC_DEBUG) return
	stageDropCount++
	if (!stageDropSample && id.length <= SAMPLE_ID_LENGTH_MAX) stageDropSample = id
}


// MARK: recordSpawnGuardDrop
/**
 * Increment the spawnCube-guard-drop counter. Called from paint.ts
 * inside the `paintByTile.get(tileEntity) !== tileRec` guard of both
 * spawnOne and spawnCube \u2014 the tile was despawned or respawned with
 * a fresh tileRec while the closure sat in the queue, and the closure
 * has bailed instead of creating a cell entity.
 */
export function recordSpawnGuardDrop(id: string): void {
	if (!SHOW_PAINT_SYNC_DEBUG) return
	spawnGuardCount++
	if (!spawnGuardSample && id.length <= SAMPLE_ID_LENGTH_MAX) spawnGuardSample = id
}


// MARK: setupPaintDebug
/**
 * Install the rollup system. Idempotent \u2014 safe to call once from
 * client bootstrap. Does nothing if SHOW_PAINT_SYNC_DEBUG is off.
 */
export function setupPaintDebug(): void {
	if (!SHOW_PAINT_SYNC_DEBUG) return
	if (installed) {
		console.log('paintDebug: setupPaintDebug: already installed, skipping')
		return
	}
	installed = true

	engine.addSystem((dt: number) => {
		elapsed += dt
		if (elapsed < ROLLUP_INTERVAL_S) return
		const windowS = elapsed
		elapsed = 0

		// Skip the rollup entirely when nothing happened \u2014 keeps the
		// console readable during quiet windows.
		if (applyDropCount === 0 && stageDropCount === 0 && spawnGuardCount === 0) return

		const parts: string[] = []
		parts.push(`window=${windowS.toFixed(1)}s`)
		parts.push(`applyDrops=${applyDropCount}${applyDropSample ? ` (e.g. ${applyDropSample})` : ''}`)
		parts.push(`stageDrops=${stageDropCount}${stageDropSample ? ` (e.g. ${stageDropSample})` : ''}`)
		parts.push(`spawnGuardDrops=${spawnGuardCount}${spawnGuardSample ? ` (e.g. ${spawnGuardSample})` : ''}`)
		console.log(`paintDebug: ${parts.join(' | ')}`)

		applyDropCount    = 0
		stageDropCount    = 0
		spawnGuardCount   = 0
		applyDropSample   = ''
		stageDropSample   = ''
		spawnGuardSample  = ''
	})

	console.log(`paintDebug: setupPaintDebug: rollup active (interval=${ROLLUP_INTERVAL_S}s)`)
}
