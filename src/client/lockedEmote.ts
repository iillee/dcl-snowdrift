/**
 * lockedEmote.ts - play a custom scene emote on the local player while the player can't walk / run / jump.
 *
 * Shared by the campfire emote (campfireEmote.ts) and the torch-light emote (torchLightEmote.ts). While one plays, the
 * movementLock flag is set (locomotion folds it into the InputModifier profile; camera look still works). The lock is
 * released when the clip's time is up (a wall-clock timer, which is also the failsafe: it cannot hang), when the
 * emote trigger errors, or at once via stopLockedEmote (e.g. the server refused the action).
 *
 * Needs ALLOW_TO_TRIGGER_AVATAR_EMOTE in scene.json (already declared).
 */

import { engine } from '@dcl/sdk/ecs'
import { stopEmote, triggerSceneEmote } from '~system/RestrictedActions'

import { reapplyLocomotionProfile } from 'src/client/locomotion'
import { setMovementLocked } from 'src/client/movementLock'


let playingUntil  = 0
/** Emote waiting to be triggered (a short delay lets a same-spot turn land first). */
let pending: { src: string; at: number } | null = null
let lockInstalled = false


// MARK: lock
function lockMovement(): void {
	setMovementLocked(true)
	reapplyLocomotionProfile()
	if (!lockInstalled) {
		lockInstalled = true
		engine.addSystem(lockSystem, 0, 'lockedEmoteLock')
	}
}

function releaseMovement(): void {
	playingUntil = 0
	pending = null
	setMovementLocked(false)
	reapplyLocomotionProfile()
}

/** Releases the lock once the clip's time is up (failsafe included). */
function lockSystem(): void {
	if (pending !== null && Date.now() >= pending.at) { const src = pending.src; pending = null; trigger(src) }
	if (playingUntil !== 0 && Date.now() >= playingUntil) releaseMovement()
}


// MARK: playLockedEmote
function trigger(src: string): void {
	void triggerSceneEmote({ src, loop: false }).catch(err => {
		console.log('lockedEmote: triggerSceneEmote failed:', src, err)
		releaseMovement()
	})
}

/** Play the one-shot scene emote `src` and lock movement for `durationMs` (clip length plus a hair), starting after `delayMs`. */
export function playLockedEmote(src: string, durationMs: number, delayMs = 0): void {
	playingUntil = Date.now() + delayMs + durationMs
	lockMovement()
	if (delayMs > 0) pending = { src, at: Date.now() + delayMs }
	else trigger(src)
}


// MARK: stopLockedEmote
/** Cancel the emote - only while one could still be playing. Also frees movement. */
export function stopLockedEmote(): void {
	if (Date.now() >= playingUntil) return
	releaseMovement()
	void stopEmote({}).catch(err => {
		console.log('lockedEmote: stopEmote failed:', err)
	})
}