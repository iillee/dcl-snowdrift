/**
 * logsInventory.ts - client-local state for the "carrying logs" hand slot.
 *
 * Second inventory slot alongside the torch (torchEquip.ts). Currently
 * boolean-only (you're carrying a log or you're not); when the fueling
 * loop gains a stack count or log types, this becomes the natural home
 * for that state.
 *
 * Local-only for now. Once feed-fire lands, pickup/drop will need to
 * be broadcast so other players see the log GLB attach to the hand and
 * disappear from the world in sync.
 */


import { Transform, engine } from '@dcl/sdk/ecs'

import { CAMPFIRE_RELIGHT_RADIUS_SQ_M, CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { getLitHiddenFires, isInHiddenRelightRange }                        from 'src/client/hiddenCampfire'
import { playDropSfx, playPickupSfx, playSurgeSfxLocal }                    from 'src/client/audio'
import { spawnLogsBounce }                                                  from 'src/client/logsPickupFx'
import { requestFeedFire }                                                  from 'src/client/hearthFuel'


/**
 * Radius (m^2) inside which F feeds the fire instead of dropping the log.
 * Reuses the torch relight radius (3m) so "stand at the fire" means the
 * same thing for both feed and relight, and there's plenty of room in
 * the wider melt ring to drop a log without accidentally feeding.
 */
const FEED_RADIUS_SQ = CAMPFIRE_RELIGHT_RADIUS_SQ_M

let _hasLogs = false


// MARK: hasLogs
/** True when the local player is carrying a log in the F-slot. */
export function hasLogs(): boolean {
	return _hasLogs
}


// MARK: pickupLogs
/**
 * Mark the local player as carrying a log. No-op if already carrying;
 * the F slot is single-item for now.
 */
export function pickupLogs(): void {
	if (_hasLogs) return
	_hasLogs = true
	playPickupSfx()
	// Cosmetic "+1 log" bounce over the local player's head. Head-bounce
	// FX for OTHER players' pickups is triggered from the server-
	// confirmed pickup message handlers (see wood.ts). Pass NO playerId
	// so AvatarAttach auto-binds to the local avatar (passing an
	// explicit avatarId here fails silently and orphans the rig at
	// (0,0,0) - looks like a teleport).
	spawnLogsBounce()
	console.log('logsInventory: pickupLogs: F slot now holds a log')
}


// MARK: dropLogs
/**
 * Clear the F slot. Called when the player drops the log on the ground
 * (future: spawn a log entity at the player's feet) or loses it on
 * death (future).
 */
export function dropLogs(): void {
	if (!_hasLogs) return
	_hasLogs = false
	playDropSfx()
	console.log('logsInventory: dropLogs: F slot cleared')
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


// MARK: feedFire
/**
 * Consume the carried log to feed the central campfire. Currently just
 * clears the F slot with a log line — the campfire fuel state system
 * (N1 per docs/PLAN.md) lands next and will add +fuel here.
 */
export function feedFire(): void {
	if (!_hasLogs) return
	_hasLogs = false
	// Ignition surge is the whoosh on log placement. Replaces the earlier
	// drop-sfx placeholder — stacking both createOrReplaces on the shared
	// SFX entity in the same frame caused audible glitches on the fire's
	// looping crackle. Local-global because the player is standing right
	// at the fire, so the feedback should be loud + reliable.
	playSurgeSfxLocal()
	// Route to the nearest lit fire the player is standing at.
	// Preference: hidden > main. Rationale: hidden fires require
	// deliberate discovery + relight, so a player standing at one
	// almost certainly means to feed IT, not the distant central
	// hearth. Falls back to -1 (main) when no hidden fire is in range.
	const target = pickFeedTarget()
	requestFeedFire(target)
	console.log(`logsInventory: feedFire: log consumed, target=${target}`)
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
