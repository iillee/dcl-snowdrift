/**
 * logsInput.ts - F-key handler for the logs inventory slot.
 *
 * F while carrying a log:
 *   - inside the campfire feed radius -> feed the fire (consume the log)
 *   - outside the feed radius         -> drop the log at player feet
 *
 * Drop and feed both clear the local F slot immediately. Drop also
 * sends a logDropRequest to the server; the server spawns a fresh
 * pile at the requested position and broadcasts logPileAdded so every
 * client (including us) sees the new GLB via src/client/logs.ts.
 *
 * F while not carrying chops the nearest tree, when one is in reach.
 */

import { InputAction, Transform, engine, inputSystem } from '@dcl/sdk/ecs'

import { room } from 'src/shared/messages'

import { dropLogs, feedFire, getCarriedKind, hasLogs, isInFeedRange } from 'src/client/logsInventory'
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
