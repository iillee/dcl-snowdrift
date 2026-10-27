/**
 * buildFire.ts - Build Your Own Fire lighting (src/shared/ruleset.ts).
 *
 * Carrying a log with a lit torch (away from fires): the TORCH tooltip
 * reads LIGHT CAMPFIRE only when the server would accept it (no refusal reasons) and E / the torch button
 * lights the carried log at your feet. A refused carried log is returned.
 *
 * Dropped logs (F) are ordinary wood and never light.
 */

import { Transform, engine } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

import { CAMPFIRE_RELIGHT_RADIUS_SQ_M, CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { room } from 'src/shared/messages'
import {
	canBuildWithKind,
	BUILT_FIRE_MAX,
	BuildFireVerdict,
	builtFireFrontSpot,
	isBuildYourOwnFire,
	validateBuiltFireSpot,
} from 'src/shared/ruleset'
import { activeGroundYAt, activeTerrain } from 'src/shared/terrain/terrainCache'

import { playSurgeSfxLocal } from 'src/client/audio'
import { playCampfireEmote, stopCampfireEmote } from 'src/client/campfireEmote'
import { isItemInputBlocked } from 'src/client/frost/frozenState'
import {
	getCurrentHiddenSeed,
	getPlacedFireCount,
	getPlacedFirePositions,
	getRecycleNextPos,
	isInHiddenRelightRange,
	isReadyToIgniteHidden,
} from 'src/client/hiddenCampfire'
import { consumeCarriedForBuild, getCarriedKind, hasLogs, restoreRejectedFeed } from 'src/client/logsInventory'
import { getSnowStageAtWorld } from 'src/client/snow/snowQuery'
import { isEmberFailing } from 'src/client/emberFail'
import { HIDDEN_CAMPFIRE_COUNT } from 'src/shared/hiddenCampfire'
import { isReadyToIgniteMonument } from 'src/client/stationMarkers'
import { isTorchEquipped, isTorchLit } from 'src/client/torchEquip'


/** Give up waiting for the server echo after this (ms). */
const PENDING_TIMEOUT_MS = 4000

/** True when the target is the carried log (lit at the player's feet). */
let carriedMode  = false
/** Where the fire would go: BUILT_FIRE_FRONT_M in front of the player (their facing). */
let carriedX     = 0
let carriedZ     = 0
/** The player's feet + facing yaw at evaluate time (what the server request carries; it derives the same front spot). */
let playerX      = 0
let playerZ      = 0
let playerYaw    = 0
let verdict      : BuildFireVerdict | null = null
let pendingUntil = 0


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
	if (!hasLogs() || !canBuildWithKind(getCarriedKind())) return
	carriedMode = true
	const fwd   = Vector3.rotate(Vector3.Forward(), t.rotation)
	playerX     = t.position.x
	playerZ     = t.position.z
	playerYaw   = Math.atan2(fwd.x, fwd.z)
	const spot  = builtFireFrontSpot(playerX, playerZ, playerYaw)
	carriedX    = spot.x
	carriedZ    = spot.z
	// Mirror the server: at the cap the oldest dead built fire is
	// recycled (no dead one = unavailable); it never blocks spacing.
	const count = getPlacedFireCount()
	const full  = count >= Math.min(BUILT_FIRE_MAX, HIDDEN_CAMPFIRE_COUNT)
	const rec   = full ? getRecycleNextPos() : null
	if (full && !rec) return
	const fires = rec ? getPlacedFirePositions().filter((p) => p.x !== rec.x || p.z !== rec.z) : getPlacedFirePositions()
	verdict = validateBuiltFireSpot(map, carriedX, carriedZ, fires, stageAt, rec ? count - 1 : count)
	// Ember fail gate as on the server, then positives only.
	if (verdict === 'ok' && isEmberFailing()) verdict = null
	if (verdict !== 'ok') verdict = null
}


// MARK: getBuildPromptText
/** Prompt label next to a dropped log (or a fresh refusal), else null. */
export function getBuildPromptText(): string | null {
	if (!isBuildYourOwnFire()) return null
	return verdict === 'ok' && carriedMode ? 'BUILD CAMPFIRE' : null
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
	room.send('builtFireCarriedRequest', { seed: getCurrentHiddenSeed(), x: playerX, z: playerZ, yaw: playerYaw, kind })
	console.log(`buildFire: light carried log in front of player at (${carriedX.toFixed(1)}, ${carriedZ.toFixed(1)})`)
	pendingUntil = Date.now() + PENDING_TIMEOUT_MS
	playSurgeSfxLocal()
	playCampfireEmote()
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
		if (carried === 1) stopCampfireEmote()
		if (carried === 1) restoreRejectedFeed(kind)
		// Refused: log back, no message (positive tooltips only).
		console.log(`buildFire: server refused (${reason}), log stays on the ground`)
	})

	engine.addSystem(evaluate)
	console.log('buildFire: setupBuildFire: light-a-dropped-log active (Build Your Own Fire)')
}