/**
 * death.ts — frost death sequence FSM.
 *
 * Fires when the local FrostLevel reaches FROST_MAX. The player drops
 * their wood, the torch goes dark (fuel kept), and they stay locked
 * on their feet where they fell. The ice cube is drawn in rescue.ts.
 * Another player's lit torch can thaw them. While that torch is on
 * the cube, or the cube is still growing back, the ICE_RESOLVE_S
 * clock is paused. A partial melt grows back a third per second, and
 * the clock starts over once the cube is full again. After
 * ICE_RESOLVE_S, a lit fire fades them there with one segment of
 * warmth left. If every fire is dark, they stay frozen and a torch
 * can still thaw them.
 *
 * World reset and the cold open still use beginCollapsedAtHome, which
 * lays them on the dawn pad. Emote + teleport ordering copied from
 * flagtag. The stuck-emote workaround is phases TELEPORT / SETTLE /
 * CLEAR_MOD / EMOTE.
 */

import {
	engine,
	InputAction,
	InputModifier,
	inputSystem,
	Transform,
} from '@dcl/sdk/ecs'
import { triggerEmote } from '~system/RestrictedActions'

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { FrostDeath } from 'src/shared/frost/components'
import { FROST_MAX, ICE_RESOLVE_S } from 'src/shared/frost/tuning'
import { room } from 'src/shared/messages'

import { onCycleSeedChange } from 'src/client/cycle'
import { isEmberFailing } from 'src/client/emberFail'
import { getFrostLocal, resetFrostLocal, seedOneWarmSegment } from 'src/client/frost/accumulation'
import { getMainFireFuel } from 'src/client/hearthFuel'
import { getHiddenCampfireWarmthPositions } from 'src/client/hiddenCampfire'
import { dropLogAtPlayer } from 'src/client/logsInput'
import { clearCarriedWood } from 'src/client/logsInventory'
import { teleportHome, teleportNear } from 'src/client/player'
import { emptyTorch, extinguishTorch } from 'src/client/torchEquip'
import { isTopDownActive, toggleTopDownCamera } from 'src/client/topDownCamera'


// MARK: Tuning
/** Sleep / death emote — same URN flagtag uses for ghost / lightning / water death. */
const DEATH_EMOTE = 'urn:decentraland:matic:collections-v2:0x7bdc37ff3e8dca2d69f01a3dc34f3ad82e2e1870:0'

/** Beat after the cube is gone, before the body fades out. */
const CUBE_GONE_S = 0.4
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
/** Stand this far from a fire's centre so the wake is not inside the mesh. */
const STAND_OFF_M = 2.5


// MARK: FSM state
enum Phase {
	IDLE          = 0,
	FADE_OUT      = 2,  // screen fading to black
	TELEPORT      = 3,  // first movePlayerTo → wait SETTLE_TIME_S
	SETTLE        = 4,  // second (same-spot) movePlayerTo → wait SETTLE_TIME_S
	CLEAR_MOD     = 5,  // InputModifier removed → wait CLEAR_MOD_BEAT_S
	EMOTE         = 6,  // InputModifier re-applied + emote fired → hold black for BLACK_HOLD_MIN_S
	FADE_IN       = 7,  // screen fading back in, player collapsed at the arrival spot
	WAKE_WAIT     = 8,  // wait for first movement input, then release lock
	FROZEN        = 9,  // locked at the freeze spot, waiting on a torch or a fire
	DROP_ICE      = 10, // cube is gone, body still here, then the fade starts
}

let phase        = Phase.IDLE
let phaseTimer   = 0
let fadeOpacity  = 0 // 0 = clear, 1 = fully black
let installed    = false
/** True when ember-fail already owns the black — skip this FSM's fade. */
let coverOwned   = false
/** True once the arrival sequence has the player collapsed at the fire. */
let laidDownAtHome = false
/** True when the arrival spot is the dawn pad. False is a lit fire. */
let arrivalHome = true
let arrivalX    = 0
let arrivalZ    = 0
let lookX       = 0
let lookZ       = 0
/** Set by a server frostRescued for this player. Consumed in FROZEN. */
let rescued = false
/** Log the "no fire" hold once per freeze, not every frame. */
let loggedNoFire = false
/** Scene-relative seconds, written into FrostDeath.deathT. */
let lifeSeconds = 0
/** Torch is on this player, or the cube is still short of full. */
let meltLiveLocal = false
let meltStepLocal = 0
/** The respawn clock was held by a melt. */
let clockHeld = false
/** A third of the cube actually came off, so a full cube restarts the clock. */
let meltCut = false


// MARK: noteLocalMelt
/**
 * The server's melt broadcast for this player. A live torch, or a
 * cube that is still short, pauses the respawn clock. Called from
 * rescue.ts so the two modules do not import each other in a loop.
 */
export function noteLocalMelt(
	step: number,
	live: boolean,
): void {
	if (phase !== Phase.FROZEN) return
	meltStepLocal = Math.max(0, step)
	meltLiveLocal = live
}


// MARK: resetMeltClock
function resetMeltClock(): void {
	meltLiveLocal = false
	meltStepLocal = 0
	clockHeld     = false
	meltCut       = false
}


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


// MARK: isPlayerLaidDownAtHome

/**
 * True once the stuck-emote workaround has fired and the player is
 * collapsed at the dawn spawn. The cold-open cover waits on this.
 */
export function isPlayerLaidDownAtHome(): boolean {
	return laidDownAtHome
}


// MARK: grantFrostRescue
/**
 * A lit torch thawed this player. They stand up on the next tick,
 * still standing where they froze.
 */
export function grantFrostRescue(): void {
	if (phase !== Phase.FROZEN) {
		console.log('frost/death: grantFrostRescue: ignored, player is not frozen in place')
		return
	}
	rescued = true
	console.log('frost/death: grantFrostRescue: thaw queued')
}


// MARK: markLaidDownAtHome

function markLaidDownAtHome(): void {
	if (laidDownAtHome) return
	laidDownAtHome = true
	console.log('frost/death: markLaidDownAtHome: player is down by the fire')
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


// MARK: clearLocalDeath
function clearLocalDeath(tellServer: boolean): void {
	if (!FrostDeath.has(engine.PlayerEntity)) return
	FrostDeath.deleteFrom(engine.PlayerEntity)
	if (!tellServer) return
	room.send('frostThaw', {})
	console.log('frost/death: clearLocalDeath: told the server this player is up')
}


// MARK: teleportArrival
function teleportArrival(): void {
	if (arrivalHome) {
		teleportHome()
		return
	}
	teleportNear(arrivalX, arrivalZ, lookX, lookZ)
}


// MARK: nearestLitFire
function nearestLitFire(): { x: number, z: number } | null {
	const t  = Transform.getOrNull(engine.PlayerEntity)
	const px = t ? t.position.x : 0
	const pz = t ? t.position.z : 0
	let bestX = 0
	let bestZ = 0
	let bestD = Number.POSITIVE_INFINITY
	let found = false

	const consider = (x: number, z: number) => {
		const dx = px - x
		const dz = pz - z
		const d  = dx * dx + dz * dz
		if (d >= bestD) return
		bestD = d
		bestX = x
		bestZ = z
		found = true
	}

	if (getMainFireFuel() > 0) consider(CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z)
	for (const hp of getHiddenCampfireWarmthPositions()) {
		if (hp.fuel <= 0) continue
		consider(hp.x, hp.z)
	}
	if (!found) return null
	return { x: bestX, z: bestZ }
}


// MARK: aimAtFire
function aimAtFire(fireX: number, fireZ: number): void {
	const t  = Transform.getOrNull(engine.PlayerEntity)
	let dx   = (t ? t.position.x : fireX) - fireX
	let dz   = (t ? t.position.z : fireZ) - fireZ
	const len = Math.sqrt(dx * dx + dz * dz)
	if (len < 0.5) {
		dx = 0
		dz = 1
	} else {
		dx /= len
		dz /= len
	}
	arrivalHome = false
	arrivalX    = fireX + dx * STAND_OFF_M
	arrivalZ    = fireZ + dz * STAND_OFF_M
	lookX       = fireX
	lookZ       = fireZ
}


// MARK: publishFreeze
function publishFreeze(): void {
	const t = Transform.getOrNull(engine.PlayerEntity)
	const x = t ? t.position.x : 0
	const z = t ? t.position.z : 0
	FrostDeath.createOrReplace(engine.PlayerEntity, {
		deathT: lifeSeconds,
		deathX: x,
		deathZ: z,
		awake : false,
	})
	room.send('frostFreeze', { x, z })
	console.log(`frost/death: publishFreeze: frozen at ${x.toFixed(1)}, ${z.toFixed(1)}`)
}


// MARK: thawInPlace
function thawInPlace(): void {
	console.log('frost/death: thawInPlace: standing back up')
	clearLocalDeath(true)
	resetFrostLocal()
	resetMeltClock()
	unlockPlayer()
	rescued      = false
	fadeOpacity  = 0
	phase        = Phase.IDLE
	phaseTimer   = 0
}


// MARK: enterDying
/**
 * Kick off the freeze. Idempotent — a second call while already
 * dying is ignored so a jittering frost value can't restart the FSM.
 * A player still collapsed at a fire can freeze without standing up,
 * so an idle body cannot hold the world open after that fire goes out.
 */
function enterDying(): void {
	if (phase !== Phase.IDLE && phase !== Phase.WAKE_WAIT) return
	console.log('frost/death: enterDying: player frozen, holding in place')
	// Still standing where they froze. The pile stays there.
	dropLogAtPlayer()
	// Spectate hides the avatar the ice cube is meant to wrap.
	if (isTopDownActive()) {
		console.log('frost/death: enterDying: exiting spectate mode')
		toggleTopDownCamera()
	}
	coverOwned   = false
	rescued      = false
	loggedNoFire = false
	arrivalHome  = true
	resetMeltClock()
	phase        = Phase.FROZEN
	phaseTimer   = 0
	// Stay standing. The ice cube is the frozen state; the sleep emote
	// is only for the dawn-pad arrival later in this FSM.
	lockPlayer()
	// Dark immediately, so a frozen player is not still a heat source.
	// Fuel stays; relight at a fire after they wake.
	extinguishTorch()
	publishFreeze()
}


// MARK: beginCollapsedAtHome
/**
 * Arrive on the dawn spawn already collapsed, same pose as frost death.
 * First join and ember-fail skip this FSM's fade (splash / cards own
 * the black). A mid-run dev roll still fades through the death overlay.
 */
export function beginCollapsedAtHome(
	opts: { skipFade?: boolean } = {},
): void {
	console.log('frost/death: beginCollapsedAtHome: laying down for the new run')
	if (isTopDownActive()) {
		console.log('frost/death: beginCollapsedAtHome: exiting spectate mode')
		toggleTopDownCamera()
	}
	clearLocalDeath(true)
	rescued      = false
	loggedNoFire = false
	arrivalHome  = true
	coverOwned   = opts.skipFade === true || isEmberFailing()
	fadeOpacity  = coverOwned ? 0 : 1
	phase        = Phase.TELEPORT
	phaseTimer   = 0
	lockPlayer()
	teleportArrival()
}


// MARK: resolveFreeze
function resolveFreeze(): void {
	const fire = nearestLitFire()
	if (!fire) {
		if (!loggedNoFire) {
			loggedNoFire = true
			console.log('frost/death: resolveFreeze: no lit fire — staying frozen')
		}
		return
	}
	console.log(
		`frost/death: resolveFreeze: waking at ${fire.x.toFixed(1)}, ${fire.z.toFixed(1)}`,
	)
	aimAtFire(fire.x, fire.z)
	// Drop the cube while they are still standing here. The fade
	// waits a beat so other clients see the ice go before the body.
	clearLocalDeath(true)
	resetMeltClock()
	phase      = Phase.DROP_ICE
	phaseTimer = 0
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

	onCycleSeedChange(({ oldSeed }) => {
		if (oldSeed === null) return
		clearCarriedWood()
		emptyTorch()
		beginCollapsedAtHome()
	})

	engine.addSystem((dt: number) => {
		lifeSeconds += dt

		// ── IDLE: watch for freeze ─────────────────────────────
		if (phase === Phase.IDLE) {
			// Read the local accumulator, not the synced FrostLevel. The
			// accumulator debounces CRDT writes at a 0.5 epsilon so the
			// synced value can lag the actual float by that much — enough
			// to never quite hit FROST_MAX in the component.
			if (isEmberFailing()) return
			if (getFrostLocal() >= FROST_MAX) enterDying()
			return
		}

		phaseTimer += dt

		// ── FROZEN: hold at the death spot ──────────────────────
		if (phase === Phase.FROZEN) {
			fadeOpacity = 0
			lockPlayer()
			const melting = meltLiveLocal || meltStepLocal > 0
			if (melting) {
				phaseTimer -= dt
				clockHeld = true
				if (meltStepLocal > 0) meltCut = true
			} else if (clockHeld) {
				clockHeld = false
				if (meltCut) {
					phaseTimer   = 0
					meltCut      = false
					loggedNoFire = false
					console.log('frost/death: ice is full again, respawn timer restarted')
				}
			}
			if (rescued) {
				thawInPlace()
				return
			}
			// The fail cards own the player until the new run lays them down.
			if (isEmberFailing()) return
			if (!melting && phaseTimer >= ICE_RESOLVE_S) resolveFreeze()
			return
		}

		// ── DROP_ICE: cube off, body still at the freeze spot ──
		if (phase === Phase.DROP_ICE) {
			fadeOpacity = 0
			lockPlayer()
			if (phaseTimer >= CUBE_GONE_S) {
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
				teleportArrival()
				phase      = Phase.TELEPORT
				phaseTimer = 0
			}
			return
		}

		// ── TELEPORT: wait for first teleport to settle ─────────
		if (phase === Phase.TELEPORT) {
			if (!coverOwned) fadeOpacity = 1
			if (phaseTimer >= SETTLE_TIME_S) {
				teleportArrival()
				phase      = Phase.SETTLE
				phaseTimer = 0
			}
			return
		}

		// ── SETTLE: after second teleport ──────────────────────
		if (phase === Phase.SETTLE) {
			if (!coverOwned) fadeOpacity = 1
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
			if (!coverOwned) fadeOpacity = 1
			if (phaseTimer >= CLEAR_MOD_BEAT_S) {
				lockPlayer()
				fireDeathEmote()
				// Reset BOTH the local accumulator and the CRDT component.
				// Resetting just the component leaves accumulation.ts's
				// internal float at ~100, which writes back next tick and
				// re-freezes you instantly.
				clearLocalDeath(true)
				if (arrivalHome) resetFrostLocal()
				else seedOneWarmSegment()
				// Torch already went dark at the freeze. This covers the
				// dawn-pad arrival, which never passed through enterDying.
				extinguishTorch()
				phase      = Phase.EMOTE
				phaseTimer = 0
			}
			return
		}

		// ── EMOTE: hold black briefly so emote registers ───────
		if (phase === Phase.EMOTE) {
			if (!coverOwned) fadeOpacity = 1
			if (phaseTimer >= BLACK_HOLD_MIN_S) {
				if (coverOwned) {
					fadeOpacity = 0
					phase       = Phase.WAKE_WAIT
					phaseTimer  = 0
					markLaidDownAtHome()
				} else {
					phase      = Phase.FADE_IN
					phaseTimer = 0
				}
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
				markLaidDownAtHome()
			}
			return
		}

		// ── WAKE_WAIT: first movement input wakes the player ────
		if (phase === Phase.WAKE_WAIT) {
			fadeOpacity = 0
			lockPlayer()
			// Frost keeps climbing while they are down. Standing up is
			// what used to notice a full bar, so an idle player at a
			// dead fire never joined the frozen set and the world
			// could not end.
			if (!isEmberFailing() && getFrostLocal() >= FROST_MAX) {
				console.log('frost/death: WAKE_WAIT: frost full while collapsed, freezing')
				enterDying()
				return
			}
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
				coverOwned = false
				console.log('frost/death: player woke')
				phase      = Phase.IDLE
				phaseTimer = 0
			}
			return
		}
	})

	console.log('frost/death: setupFrostDeath: FSM installed')
}
