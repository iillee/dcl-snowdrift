/**
 * torchChain.ts — torch-to-torch chain lighting.
 *
 * Every ~150 ms, if the local player's torch is lit AND has enough
 * fuel to donate, scans every remote player with an attached torch.
 * If any remote is unlit AND within CHAIN_LIGHT_RADIUS_M of the local
 * player, sends a `chainLightRequest` to the server. The server
 * verifies sender-is-lit + target-is-unlit and rebroadcasts the
 * standard `torchLitFrom` — every client (including the target)
 * reacts through the existing torch-lit pipe.
 *
 * Design notes (locked 2026-08-24):
 *   - AUTO-FIRE on proximity (no key press). Keeps the interaction
 *     mobile-friendly and reads as "the flame jumps between torches"
 *     rather than a coordinated button press. A future tap-to-confirm
 *     variant will add the ritual layer once we've validated tuning.
 *   - PURE DUPLICATION. Giver's fuel is unaffected. Parallel drain
 *     timers are already the self-limiting economy — see the design
 *     review with ile in the chain-lighting branch discussion.
 *   - PER-PAIR COOLDOWN prevents SFX spam when two players walk
 *     side-by-side within the trigger radius.
 *   - FUEL GATE prevents a near-dead torch from acting as a battery
 *     for others while its owner runs on fumes.
 *
 * Proximity is measured player-position to player-position, not
 * flame-tip to flame-tip. The torch offset from the body is small
 * compared to the trigger radius, and player transforms are cheap +
 * reliable to read — remote flame entities are AvatarAttach children
 * whose world position we can't cheaply resolve from local Transform
 * state alone.
 */

import { PlayerIdentityData, Transform, engine } from '@dcl/sdk/ecs'
import { getPlayer } from '@dcl/sdk/players'
import { Vector3 } from '@dcl/sdk/math'

import { room } from 'src/shared/messages'

import { playSurgeSfxAt, playTorchSfxLocal }          from 'src/client/audio'
import { getRemoteTorchUserIds, isRemoteTorchLit }     from 'src/client/remoteTorches'
import {
	TORCH_FUEL_MAX_S,
	isTorchEquipped,
	isTorchLit,
	relightTorchPartial,
} from 'src/client/torchEquip'


// MARK: Tuning
// Trigger distance in meters between the two player positions. 2 m is
// "torches genuinely have to meet" — an intentional face-to-face moment
// rather than an accidental drive-by ignition. Bump to 3–4 m if playtest
// shows this is finicky on mobile.
const CHAIN_LIGHT_RADIUS_M    = 2
const CHAIN_LIGHT_RADIUS_SQ_M = CHAIN_LIGHT_RADIUS_M * CHAIN_LIGHT_RADIUS_M
// Poll cadence. Matches the wood/logs proximity polls elsewhere in the
// project — cheap enough to run continuously, responsive enough that a
// two-player meeting fires within one visible frame.
const POLL_INTERVAL_S         = 0.15
// Fuel gifted to the receiver on a successful chain-light. Duplication,
// not transfer — the giver's fuel is untouched, keeping the gesture
// generous with no reason NOT to help a partner. Set to half a full
// tank so a chain-lit torch has half the exploration leash of a
// campfire-lit one — the central hearth remains the true fuel source
// (design vision §4 / §12.5), and cascading chains still eventually
// force the group back to the fire.
//
// No giver fuel gate: the rule is deliberately "lit torch touches
// unlit torch = ignition, always", learnable from a single observation.
// A silent fuel threshold would make the mechanic feel unreliable
// ("why did it work last time but not now?").
const CHAIN_TRANSFER_S        = TORCH_FUEL_MAX_S * 0.5
// Per-pair cooldown. After a successful (or attempted) chain-light to
// a given remote, we suppress further sends to that remote for this
// window regardless of whether they light. Prevents the whoosh SFX
// from re-triggering every poll while two players stand next to each
// other with mismatched lit states (target's client might be lagging).
const PAIR_COOLDOWN_MS        = 3000


// MARK: Module state
let installed        = false
let pollClock        = 0
let localUserIdLower = ''
// Map from remote userId (lowercased) -> wall-clock ms when the pair
// cooldown expires. Entries are lazily pruned on next check; the map
// stays small (bounded by concurrent nearby-player count).
const cooldownUntil  = new Map<string, number>()


// MARK: resolveLocalUserId
function resolveLocalUserId(): string {
	if (localUserIdLower !== '') return localUserIdLower
	const id = getPlayer()?.userId
	if (!id) return ''
	localUserIdLower = id.toLowerCase()
	return localUserIdLower
}


// MARK: getRemotePlayerPosition
// Look up the world Transform of the given remote player. Remote
// avatars are represented by entities carrying PlayerIdentityData;
// their Transform is written by the engine and readable directly.
// Returns null if the player has left or we can't find their entity.
function getRemotePlayerPosition(userIdLower: string): Vector3 | null {
	for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
		if (identity.address?.toLowerCase() !== userIdLower) continue
		const t = Transform.getOrNull(entity)
		if (t === null) return null
		return t.position
	}
	return null
}


// MARK: tryChainLightRemotes
function tryChainLightRemotes(): void {
	if (!isTorchLit()) return

	const localT = Transform.getOrNull(engine.PlayerEntity)
	if (localT === null) return
	const lx = localT.position.x
	const lz = localT.position.z

	const nowMs   = Date.now()
	const localId = resolveLocalUserId()

	for (const remoteId of getRemoteTorchUserIds()) {
		if (remoteId === localId)          continue
		if (isRemoteTorchLit(remoteId))    continue

		const until = cooldownUntil.get(remoteId) ?? 0
		if (nowMs < until)                 continue

		const rp = getRemotePlayerPosition(remoteId)
		if (rp === null)                   continue

		const dx = rp.x - lx
		const dz = rp.z - lz
		if (dx * dx + dz * dz > CHAIN_LIGHT_RADIUS_SQ_M) continue

		// Fire. Giver's fuel is untouched — chain-light is pure
		// duplication. The receiver applies its own +CHAIN_TRANSFER_S
		// in the torchLitFrom handler below.
		cooldownUntil.set(remoteId, nowMs + PAIR_COOLDOWN_MS)
		room.send('chainLightRequest', { targetUserId: remoteId })
		// Local audible feedback at the remote's position so the giver
		// hears the whoosh in 3D. The receiving client will hear the
		// same cue via the standard torchLitFrom relay path IF we ever
		// add "surge on remote flame-on"; today the receiver just sees
		// their flame turn on (they should be within earshot anyway
		// since they're 2 m away).
		playSurgeSfxAt(Vector3.create(rp.x, rp.y + 1.2, rp.z))
		console.log(`torchChain: sent chainLightRequest to ${remoteId} (dist=${Math.sqrt(dx * dx + dz * dz).toFixed(2)}m)`)
	}
}


// MARK: setupTorchChain
/**
 * Install the chain-lighting proximity poller. Idempotent — safe to
 * call once from client bootstrap. Depends on setupRemoteTorches()
 * having run so getRemoteTorchUserIds() has entries to iterate.
 */
export function setupTorchChain(): void {
	if (installed) {
		console.log('torchChain: setupTorchChain: already installed, skipping')
		return
	}
	installed = true

	// Receive path: another client's chain-lightRequest was accepted by
	// the server and rebroadcast as torchLitFrom targeting US. The
	// existing self-echo filter in remoteTorches.ts drops these, so we
	// listen here too and only act when the incoming lit=1 disagrees
	// with our current local state (i.e. it wasn't our own transition
	// bouncing back). Extinguish edges are ignored — server never sends
	// lit=0 unsolicited today; if that ever changes, add symmetric
	// handling for extinguishTorch().
	room.onMessage('torchLitFrom', ({ userId, lit }) => {
		if (!userId) return
		if (userId.toLowerCase() !== resolveLocalUserId()) return
		if (lit !== 1) return
		if (!isTorchEquipped()) return
		if (isTorchLit()) return  // our own echo, or already lit
		relightTorchPartial(CHAIN_TRANSFER_S)
		playTorchSfxLocal()
		console.log(`torchChain: local torch lit by remote chain-light (+${CHAIN_TRANSFER_S.toFixed(1)}s)`)
	})

	engine.addSystem((dt: number) => {
		pollClock += dt
		if (pollClock < POLL_INTERVAL_S) return
		pollClock = 0
		tryChainLightRemotes()
	})

	console.log('torchChain: setupTorchChain: proximity poll active (radius=' +
		CHAIN_LIGHT_RADIUS_M + 'm, cooldown=' + PAIR_COOLDOWN_MS + 'ms)')
}
