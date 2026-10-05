/**
 * logsInput.ts - F-key handler for the logs inventory slot.
 *
 * F while carrying wood, standing at a fire:
 *   - the piece fits under the cap -> feed the fire
 *   - the piece would pass the cap -> nothing, the FIRE FULL chip stays
 * F while carrying wood, away from a fire -> drop it at your feet
 *
 * Drop and feed both clear the local F slot immediately. Drop also
 * sends a logDropRequest to the server; the server spawns a fresh
 * pile at the requested position and broadcasts logPileAdded so every
 * client (including us) sees the new GLB via src/client/logs.ts.
 *
 * F while not carrying chops the nearest tree, when one is in reach.
 */

import { InputAction, Transform, engine, inputSystem } from '@dcl/sdk/ecs'
import { getPlayer } from '@dcl/sdk/players'

import { room } from 'src/shared/messages'

import { revertOptimisticFeed } from 'src/client/hearthFuel'
import { spawnLogsFeed } from 'src/client/logsFeedFx'
import { dropLogs, feedFire, getCarriedKind, hasLogs, isInFeedRange, restoreRejectedFeed } from 'src/client/logsInventory'
import { tryChopWood } from 'src/client/wood'


let installed = false
let fHeldPrev = false


// MARK: dropLogAtPlayer
/**
 * Clear the local F slot and ask the server to spawn a physical pile
 * at the player's feet. Shared by the F-key handler and the mobile
 * LogsButton tap so both drop paths produce the same visible pile.
 * No-op if the player isn't carrying a log.
 */
export function dropLogAtPlayer(): void {
	if (!hasLogs()) return
	const kind = getCarriedKind()
	const t    = Transform.getOrNull(engine.PlayerEntity)
	dropLogs()
	if (t !== null) {
		room.send('logDropRequest', { x: t.position.x, z: t.position.z, kind })
		console.log(
			`logsInput: dropLogAtPlayer: logDropRequest kind=${kind} ` +
			`at (${t.position.x.toFixed(2)}, ${t.position.z.toFixed(2)})`
		)
	} else {
		console.log('logsInput: dropLogAtPlayer: no player transform, no pile spawned')
	}
}


// MARK: setupLogsInput
/**
 * Register the per-frame F-key handler. Idempotent - safe to call once
 * from client bootstrap.
 */
export function setupLogsInput(): void {
	if (installed) {
		console.log('logsInput: setupLogsInput: already installed, skipping')
		return
	}
	installed = true

	room.onMessage('feedFireRejected', ({ kind }) => {
		revertOptimisticFeed(kind)
		restoreRejectedFeed(kind)
	})

	// Remotes (and late joiners who miss the optimistic local play) see
	// wood arc into the fire. Skip our own echo — feedFire already
	// spawned the local arc.
	room.onMessage('feedFireFx', ({ userId, target, kind }) => {
		if (!userId) return
		const me = getPlayer()?.userId.toLowerCase()
		if (me && userId.toLowerCase() === me) return
		spawnLogsFeed(kind, target, userId)
	})

	engine.addSystem((_dt: number) => {
		const fHeld  = inputSystem.isPressed(InputAction.IA_SECONDARY)
		const rising = fHeld && !fHeldPrev
		fHeldPrev    = fHeld

		if (!rising) return
		if (!hasLogs()) {
			tryChopWood()
			return
		}

		if (isInFeedRange()) {
			feedFire()
			return
		}

		dropLogAtPlayer()
	})
}
