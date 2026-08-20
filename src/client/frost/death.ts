/**
 * death.ts — frost death sequence FSM.
 *
 * Fires when the local FrostLevel reaches FROST_MAX. Plays a sleep
 * emote in place, fades to black, teleports the player back to the
 * campfire, holds black while the "stuck emote" workaround runs
 * (double-teleport → clear InputModifier → re-apply → fire emote),
 * fades back in with the player collapsed, then wakes on the first
 * movement input.
 *
 * Emote + teleport ordering copied wholesale from flagtag's
 * cinematicSystem.ts + ghostSystem.ts. The stuck-emote workaround is
 * ugly but proven — see phases TELEPORT / SETTLE / CLEAR_MOD / EMOTE.
 *
 * Corpse sync (rendering slumped bodies for OTHER players who died) is
 * deliberately NOT in v1 — FrostDeath component is defined for it, but
 * we're getting the local sequence bulletproof first.
 */

import {
	InputAction,
	InputModifier,
	engine,
	inputSystem,
} from '@dcl/sdk/ecs'
import { movePlayerTo, triggerEmote } from '~system/RestrictedActions'

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Y, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { FROST_MAX }                                             from 'src/shared/frost/tuning'
import { getFrostLocal, resetFrostLocal }                        from 'src/client/frost/accumulation'
import { extinguishTorch }                                       from 'src/client/torchEquip'


// MARK: Tuning
/** Sleep / death emote — same URN flagtag uses for ghost / lightning / water death. */
const DEATH_EMOTE = 'urn:decentraland:matic:collections-v2:0x7bdc37ff3e8dca2d69f01a3dc34f3ad82e2e1870:0'

/** Seconds the player lies collapsed at the death spot before the screen fades. */
const COLLAPSE_HOLD_S = 2.0
/** Fade-to-black duration. */
const FADE_OUT_S = 0.6
/** Fade-from-black duration. */
const FADE_IN_S  = 1.0
/** Hold fully black while the teleport + stuck-emote workaround completes. */
const BLACK_HOLD_MIN_S = 1.5

/** Stuck-emote fix: how long to wait for the player Y to settle after a teleport. */
const SETTLE_TIME_S     = 0.35
/** Beat between clearing InputModifier and re-applying + firing the emote. */
const CLEAR_MOD_BEAT_S  = 0.5

/**
 * Spawn point after death — a couple of meters north of the fire so
 * the player wakes up looking at it rather than standing on it. Y kept
 * near ground level; movePlayerTo will settle the avatar onto whatever
 * geometry is beneath.
 */
const RESPAWN_POS = { x: CAMPFIRE_WORLD_X, y: CAMPFIRE_WORLD_Y + 0.5, z: CAMPFIRE_WORLD_Z + 3 }


// MARK: FSM state
enum Phase {
	IDLE          = 0,
	COLLAPSE      = 1,  // emote fired at death spot, waiting COLLAPSE_HOLD_S
	FADE_OUT      = 2,  // screen fading to black
	TELEPORT      = 3,  // first movePlayerTo → wait SETTLE_TIME_S
	SETTLE        = 4,  // second (same-spot) movePlayerTo → wait SETTLE_TIME_S
	CLEAR_MOD     = 5,  // InputModifier removed → wait CLEAR_MOD_BEAT_S
	EMOTE         = 6,  // InputModifier re-applied + emote fired → hold black for BLACK_HOLD_MIN_S
	FADE_IN       = 7,  // screen fading back in, player collapsed at fire
	WAKE_WAIT     = 8,  // wait for first movement input, then release lock
}

let phase        = Phase.IDLE
let phaseTimer   = 0
let fadeOpacity  = 0 // 0 = clear, 1 = fully black
let installed    = false


// MARK: getDeathFadeOpacity
/**
 * Public accessor for the fade overlay. Consumed by the UI layer each
 * frame. Returns 0 in the idle state so the overlay renders as a
 * zero-alpha no-op.
 */
export function getDeathFadeOpacity(): number {
	return fadeOpacity
}


// MARK: isFrostDying
/** True whenever the death FSM is running (any non-IDLE phase). */
export function isFrostDying(): boolean {
	return phase !== Phase.IDLE
}


// MARK: lockPlayer
function lockPlayer(): void {
	InputModifier.createOrReplace(engine.PlayerEntity, {
		mode: InputModifier.Mode.Standard({
			disableAll: true,
		}),
	})
}


// MARK: unlockPlayer
function unlockPlayer(): void {
	if (InputModifier.has(engine.PlayerEntity)) {
		InputModifier.deleteFrom(engine.PlayerEntity)
	}
}


// MARK: fireDeathEmote
function fireDeathEmote(): void {
	void triggerEmote({ predefinedEmote: DEATH_EMOTE }).catch(err => {
		console.log('frost/death: triggerEmote failed:', err)
	})
}


// MARK: enterDying
/**
 * Kick off the death sequence. Idempotent — a second call while already
 * dying is ignored so a jittering frost value can't restart the FSM.
 */
function enterDying(): void {
	if (phase !== Phase.IDLE) return
	console.log('frost/death: enterDying: player frozen, starting sequence')
	phase      = Phase.COLLAPSE
	phaseTimer = 0
	lockPlayer()
	fireDeathEmote()
}


// MARK: setupFrostDeath
/**
 * Register the death FSM system. Idempotent. Watches FrostLevel each
 * frame and drives the phase machine.
 */
export function setupFrostDeath(): void {
	if (installed) {
		console.log('frost/death: setupFrostDeath: already installed, skipping')
		return
	}
	installed = true

	engine.addSystem((dt: number) => {
		// ── IDLE: watch for freeze ─────────────────────────────
		if (phase === Phase.IDLE) {
			// Read the local accumulator, not the synced FrostLevel. The
			// accumulator debounces CRDT writes at a 0.5 epsilon so the
			// synced value can lag the actual float by that much — enough
			// to never quite hit FROST_MAX in the component.
			if (getFrostLocal() >= FROST_MAX) enterDying()
			return
		}

		phaseTimer += dt

		// ── COLLAPSE: hold death emote in place ─────────────────
		if (phase === Phase.COLLAPSE) {
			if (phaseTimer >= COLLAPSE_HOLD_S) {
				phase      = Phase.FADE_OUT
				phaseTimer = 0
			}
			return
		}

		// ── FADE_OUT: 0 → 1 opacity ─────────────────────────────
		if (phase === Phase.FADE_OUT) {
			fadeOpacity = Math.min(1, phaseTimer / FADE_OUT_S)
			if (phaseTimer >= FADE_OUT_S) {
				fadeOpacity = 1
				// Screen fully black — safe to teleport now.
				void movePlayerTo({ newRelativePosition: RESPAWN_POS })
				phase      = Phase.TELEPORT
				phaseTimer = 0
			}
			return
		}

		// ── TELEPORT: wait for first teleport to settle ─────────
		if (phase === Phase.TELEPORT) {
			fadeOpacity = 1
			if (phaseTimer >= SETTLE_TIME_S) {
				// Second same-spot teleport clears the stuck-emote /
				// mid-animation state that mid-emote teleports leave
				// behind. Flagtag pattern.
				void movePlayerTo({ newRelativePosition: RESPAWN_POS })
				phase      = Phase.SETTLE
				phaseTimer = 0
			}
			return
		}

		// ── SETTLE: after second teleport ──────────────────────
		if (phase === Phase.SETTLE) {
			fadeOpacity = 1
			if (phaseTimer >= SETTLE_TIME_S) {
				// Remove InputModifier to unstick the animation state,
				// then re-apply after a short beat.
				unlockPlayer()
				phase      = Phase.CLEAR_MOD
				phaseTimer = 0
			}
			return
		}

		// ── CLEAR_MOD: beat, then re-lock + fire emote ─────────
		if (phase === Phase.CLEAR_MOD) {
			fadeOpacity = 1
			if (phaseTimer >= CLEAR_MOD_BEAT_S) {
				lockPlayer()
				fireDeathEmote()
				// Reset BOTH the local accumulator and the CRDT component.
				// Resetting just the component leaves accumulation.ts's
				// internal float at ~100, which writes back next tick and
				// re-freezes you instantly.
				resetFrostLocal()
				// Torch always extinguishes on death — you dropped it when
				// you fell. Fuel is left alone; press E at the fire to relight.
				extinguishTorch()
				phase      = Phase.EMOTE
				phaseTimer = 0
			}
			return
		}

		// ── EMOTE: hold black briefly so emote registers ───────
		if (phase === Phase.EMOTE) {
			fadeOpacity = 1
			if (phaseTimer >= BLACK_HOLD_MIN_S) {
				phase      = Phase.FADE_IN
				phaseTimer = 0
			}
			return
		}

		// ── FADE_IN: 1 → 0 opacity, player collapsed at fire ────
		if (phase === Phase.FADE_IN) {
			fadeOpacity = Math.max(0, 1 - (phaseTimer / FADE_IN_S))
			if (phaseTimer >= FADE_IN_S) {
				fadeOpacity = 0
				phase       = Phase.WAKE_WAIT
				phaseTimer  = 0
			}
			return
		}

		// ── WAKE_WAIT: first movement input wakes the player ────
		if (phase === Phase.WAKE_WAIT) {
			fadeOpacity = 0
			// Any locomotion input counts. IA_JUMP included so the mobile
			// jump button also works.
			const woke =
				inputSystem.isPressed(InputAction.IA_FORWARD)  ||
				inputSystem.isPressed(InputAction.IA_BACKWARD) ||
				inputSystem.isPressed(InputAction.IA_LEFT)     ||
				inputSystem.isPressed(InputAction.IA_RIGHT)    ||
				inputSystem.isPressed(InputAction.IA_JUMP)     ||
				inputSystem.isPressed(InputAction.IA_PRIMARY)  ||
				inputSystem.isPressed(InputAction.IA_SECONDARY)
			if (woke) {
				unlockPlayer()
				console.log('frost/death: player woke')
				phase      = Phase.IDLE
				phaseTimer = 0
			}
			return
		}
	})

	console.log('frost/death: setupFrostDeath: FSM installed')
}
