/**
 * buildFire.ts - Build Your Own Fire lighting (src/shared/ruleset.ts).
 *
 * Carrying a log with a lit torch (away from fires): the TORCH tooltip
 * reads LIGHT CAMPFIRE (or a short reason) and E / the torch button
 * lights the carried log at your feet. A refused carried log is returned.
 *
 * Dropped logs (F) are ordinary wood and never light.
 */

import { Transform, engine } from '@dcl/sdk/ecs'

import { CAMPFIRE_RELIGHT_RADIUS_SQ_M, CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { room } from 'src/shared/messages'
import {
	BUILT_FIRE_COST_KIND,
	BuildFireVerdict,
	buildVerdictText,
	isBuildYourOwnFire,
	validateBuiltFireSpot,
} from 'src/shared/ruleset'
import { activeGroundYAt, activeTerrain } from 'src/shared/terrain/terrainCache'

import { playSurgeSfxLocal } from 'src/client/audio'
import { isItemInputBlocked } from 'src/client/frost/frozenState'
import {
	getCurrentHiddenSeed,
	getPlacedFireCount,
	getPlacedFirePositions,
	isInHiddenRelightRange,
	isReadyToIgniteHidden,
} from 'src/client/hiddenCampfire'
import { consumeCarriedForBuild, getCarriedKind, hasLogs, restoreRejectedFeed } from 'src/client/logsInventory'
import { getSnowStageAtWorld } from 'src/client/snow/snowQuery'
import { isReadyToIgniteMonument } from 'src/client/stationMarkers'
import { isTorchEquipped, isTorchLit } from 'src/client/torchEquip'


/** How long (ms) a server refusal reason stays in the prompt. */
const REJECT_TEXT_MS     = 2500
/** Give up waiting for the server echo after this (ms). */
const PENDING_TIMEOUT_MS = 4000

/** True when the target is the carried log (lit at the player's feet). */
let carriedMode  = false
let carriedX     = 0
let carriedZ     = 0
let verdict      : BuildFireVerdict | null = null
let pendingUntil = 0
let rejectText   = ''
let rejectUntil  = 0


// MARK: evaluate
/** Pick the dropped pile in reach and judge its spot. */
function evaluate(): void {
	carriedMode = false
	verdict     = null
	if (!isBuildYourOwnFire()) return
	if (!isTorchEquipped() || !isTorchLit() || isItemInputBlocked()) return
	if (Date.now() < pendingUntil) return
	// At a fire E keeps its old meaning (relight / ignite / monument).
	if (isReadyToIgniteHidden() || isReadyToIgniteMonument() || isInHiddenRelightRange()) return
	const t = Transform.getOrNull(engine.PlayerEntity)
	const map = activeTerrain()
	if (t === null || map === null) return
	const hx = t.position.x - CAMPFIRE_WORLD_X
	const hz = t.position.z - CAMPFIRE_WORLD_Z
	if (hx * hx + hz * hz <= CAMPFIRE_RELIGHT_RADIUS_SQ_M) return
	const stageAt = (x: number, z: number) => getSnowStageAtWorld(x, activeGroundYAt(x, z), z)
	// Carrying a log: the torch tooltip offers to light it right here.
	if (!hasLogs() || getCarriedKind() !== BUILT_FIRE_COST_KIND) return
	carriedMode = true
	carriedX    = t.position.x
	carriedZ    = t.position.z
	verdict = validateBuiltFireSpot(map, carriedX, carriedZ, getPlacedFirePositions(), stageAt, getPlacedFireCount())
	// Too close to a fire: no tooltip at all (Luke's call).
	if (verdict === 'spacing') verdict = null
}


// MARK: getBuildPromptText
/** Prompt label next to a dropped log (or a fresh refusal), else null. */
export function getBuildPromptText(): string | null {
	if (!isBuildYourOwnFire()) return null
	if (Date.now() < rejectUntil) return rejectText
	if (verdict === null) return null
	return buildVerdictText(verdict)
}


// MARK: isBuildReady
/** True when E would light the nearby dropped log right now. */
export function isBuildReady(): boolean {
	return verdict === 'ok' && carriedMode
}


// MARK: tryBuildFire
/** Ask the server to light the nearby log. Returns true if sent. */
export function tryBuildFire(): boolean {
	if (!isBuildReady()) return false
	const kind = consumeCarriedForBuild()
	if (kind < 0) return false
	room.send('builtFireCarriedRequest', { seed: getCurrentHiddenSeed(), x: carriedX, z: carriedZ, kind })
	console.log(`buildFire: light carried log at (${carriedX.toFixed(1)}, ${carriedZ.toFixed(1)})`)
	pendingUntil = Date.now() + PENDING_TIMEOUT_MS
	playSurgeSfxLocal()
	carriedMode = false
	verdict    = null
	return true
}


// MARK: setupBuildFire
let installed = false
export function setupBuildFire(): void {
	if (installed || !isBuildYourOwnFire()) return
	installed = true

	room.onMessage('builtFirePlaced', () => { pendingUntil = 0 })
	room.onMessage('builtFireRejected', ({ kind, reason, carried }) => {
		pendingUntil = 0
		if (carried === 1) restoreRejectedFeed(kind)
		// Too close to a fire: log back, no tooltip.
		if (reason === 'spacing') return
		// Non-verdict reasons (stale seed, ember fail, pile gone) -> generic.
		rejectText  = buildVerdictText(reason as BuildFireVerdict) || "CAN'T LIGHT HERE"
		rejectUntil = Date.now() + REJECT_TEXT_MS
		console.log(`buildFire: server refused (${reason}), log stays on the ground`)
	})

	engine.addSystem(evaluate)
	console.log('buildFire: setupBuildFire: light-a-dropped-log active (Build Your Own Fire)')
}