/**
 * logsInventory.ts - client-local state for the F-slot wood carry.
 *
 * Single item: a branch (kindling, 30 s) or a log (60 s). Pickup,
 * drop, and feed all keep the kind so the matching GLB and fuel
 * amount round-trip through the server.
 */


import { Transform, engine } from '@dcl/sdk/ecs'

import { CAMPFIRE_RELIGHT_RADIUS_SQ_M, CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { feedFitsFire } from 'src/shared/hearthFuel'
import { clampWoodKind, WOOD_KIND_LOG } from 'src/shared/woodKind'

import { playDropSfx, playPickupSfx, playSurgeSfxLocal } from 'src/client/audio'
import { getHiddenFireFuel, getMainFireFuel, requestFeedFire } from 'src/client/hearthFuel'
import { getLitHiddenFires, isInHiddenRelightRange } from 'src/client/hiddenCampfire'
import { spawnLogsBounce } from 'src/client/logsPickupFx'


/**
 * Radius (m^2) inside which F feeds the fire instead of dropping the log.
 * Reuses the torch relight radius (3m) so "stand at the fire" means the
 * same thing for both feed and relight, and there's plenty of room in
 * the wider melt ring to drop a log without accidentally feeding.
 */
const FEED_RADIUS_SQ = CAMPFIRE_RELIGHT_RADIUS_SQ_M

let _hasLogs = false
let _kind    = WOOD_KIND_LOG


// MARK: hasLogs
/** True when the local player is carrying wood in the F-slot. */
export function hasLogs(): boolean {
	return _hasLogs
}


// MARK: getCarriedKind
/** WOOD_KIND_BRANCH or WOOD_KIND_LOG for the current (or last) carry. */
export function getCarriedKind(): number {
	return _kind
}


// MARK: pickupLogs
/**
 * Mark the local player as carrying `kind`. No-op if already carrying;
 * the F slot is single-item for now.
 */
export function pickupLogs(kind: number = WOOD_KIND_LOG): void {
	if (_hasLogs) return
	_hasLogs = true
	_kind    = clampWoodKind(kind)
	playPickupSfx()
	// Cosmetic bounce over the local player's head. Head-bounce FX for
	// OTHER players' pickups is triggered from the server-confirmed
	// pickup message handlers (see wood.ts). Pass NO playerId so
	// AvatarAttach auto-binds to the local avatar (passing an explicit
	// avatarId here fails silently and orphans the rig at (0,0,0) -
	// looks like a teleport).
	spawnLogsBounce(undefined, _kind)
	console.log(`logsInventory: pickupLogs: F slot now holds kind=${_kind}`)
}


// MARK: dropLogs
/**
 * Clear the F slot. Called when the player drops the piece on the
 * ground or loses it on death (future).
 */
export function dropLogs(): void {
	if (!_hasLogs) return
	_hasLogs = false
	playDropSfx()
	console.log('logsInventory: dropLogs: F slot cleared')
}


// MARK: clearCarriedWood

/**
 * Drop the F slot with no sound and no ground pile. Used when the
 * world dies and the new run starts empty-handed.
 */
export function clearCarriedWood(): void {
	if (!_hasLogs) return
	_hasLogs = false
	console.log('logsInventory: clearCarriedWood: F slot cleared on world reset')
}


// MARK: isInFeedRange
/**
 * True when the local player is inside the feed radius of ANY fire -
 * central campfire OR any currently-lit hidden bonfire. Same 3m radius
 * as relight (see FEED_RADIUS_SQ), so "stand at the fire" means the
 * same thing whether you're at the hearth or a discovered pit.
 */
export function isInFeedRange(): boolean {
	const t = Transform.getOrNull(engine.PlayerEntity)
	if (t === null) return false
	const dx = t.position.x - CAMPFIRE_WORLD_X
	const dz = t.position.z - CAMPFIRE_WORLD_Z
	if (dx * dx + dz * dz <= FEED_RADIUS_SQ) return true
	// Hidden pits are only feed-able while lit. isInHiddenRelightRange
	// already enforces both the lit check and the same 3m radius, so we
	// piggy-back on it here.
	return isInHiddenRelightRange()
}


// MARK: isCarriedFeedBlocked

/**
 * True when the carried piece would push the fire you are standing at
 * past the cap. The prompt says the fire is full, and F does nothing.
 */
export function isCarriedFeedBlocked(): boolean {
	if (!_hasLogs) return false
	if (!isInFeedRange()) return false
	const target = pickFeedTarget()
	const fuel   = target < 0 ? getMainFireFuel() : getHiddenFireFuel(target)
	return !feedFitsFire(fuel, _kind)
}


// MARK: restoreRejectedFeed

/**
 * Put a refused piece back in the F slot. No-op if the slot was filled
 * again before the refusal arrived.
 */
export function restoreRejectedFeed(kind: number): void {
	if (_hasLogs) {
		console.log('logsInventory: restoreRejectedFeed: slot already full, wood not restored')
		return
	}
	_hasLogs = true
	_kind    = clampWoodKind(kind)
	console.log(`logsInventory: restoreRejectedFeed: kind=${_kind} back in the F slot`)
}


// MARK: feedFire
/**
 * Consume the carried piece and ask the server to add its fuel to the
 * nearest lit fire in range. A piece that would pass the cap stays put.
 */
export function feedFire(): void {
	if (!_hasLogs) return
	if (isCarriedFeedBlocked()) {
		console.log('logsInventory: feedFire: refused, piece would pass the cap')
		return
	}
	const kind = _kind
	_hasLogs   = false
	// Ignition surge is the whoosh on placement. Replaces the earlier
	// drop-sfx placeholder — stacking both createOrReplaces on the
	// shared SFX entity in the same frame caused audible glitches on
	// the fire's looping crackle. Local-global because the player is
	// standing right at the fire, so the feedback should be loud +
	// reliable.
	playSurgeSfxLocal()
	// Route to the nearest lit fire the player is standing at.
	// Preference: hidden > main. Rationale: hidden fires require
	// deliberate discovery + relight, so a player standing at one
	// almost certainly means to feed IT, not the distant central
	// hearth. Falls back to -1 (main) when no hidden fire is in range.
	const target = pickFeedTarget()
	requestFeedFire(target, kind)
	console.log(`logsInventory: feedFire: kind=${kind} consumed, target=${target}`)
}


// MARK: pickFeedTarget
/**
 * Determine which fire this feed goes to. Hidden fires win if the
 * player is inside any of their feed radii (uses the same 3 m circle
 * as isInFeedRange for consistency). Otherwise the main hearth.
 */
function pickFeedTarget(): number {
	const t = Transform.getOrNull(engine.PlayerEntity)
	if (t === null) return -1
	const px = t.position.x
	const pz = t.position.z

	// Nearest lit hidden fire within the feed radius.
	const hidden = getLitHiddenFires()
	let bestIdx  = -1
	let bestDsq  = FEED_RADIUS_SQ
	for (const hf of hidden) {
		const dx  = px - hf.x
		const dz  = pz - hf.z
		const dsq = dx * dx + dz * dz
		if (dsq <= bestDsq) {
			bestDsq = dsq
			bestIdx = hf.index
		}
	}
	return bestIdx  // -1 falls through to main hearth
}
