/**
 * frostLife.ts — who is frozen, and who is still in the scene.
 *
 * A freeze is client-authoritative (same trust as feed and spark).
 * Presence is a heartbeat, not the team roster: the roster never
 * forgets a leaver, and a disconnected player's torch must not keep
 * the world alive (worldFlame.ts reads livingPlayerIds()).
 *
 * Freezing no longer ends the run: the world ends when all flame is out
 * (worldFlame.ts). A frozen player wakes at a lit fire (main hearth,
 * hidden pit, or stage 1+ volcano lava) after the ice timeout or a give
 * up, a lit torch can thaw them, and with no flame at all the world end
 * takes everyone to the new winter.
 */

import { engine } from '@dcl/sdk/ecs'

import { ICE_REGROW_S, ICE_THAW_S } from 'src/shared/frost/tuning'
import { room } from 'src/shared/messages'

import { onCycleRoll } from 'src/server/cycle'
import { isEmberFailing } from 'src/server/emberFail'
import { getMainFireFuel } from 'src/server/hearthFuel'
import { isAnyHiddenFireLit } from 'src/server/hiddenCampfire'
import { isVolcanoLavaLit } from 'src/server/stations'


/** Drop a player who has not checked in for this long. */
const STALE_MS = 20000

/**
 * After joinRoster, keep the wallet in the living set this long even
 * without a frostPresence heartbeat. Heavy hydrate can take longer
 * than STALE_MS; dropping them mid-load lets extinction fire under them.
 */
const JOIN_GRACE_MS = 60000

/** Drop a melt hold whose torch stopped checking in. */
const MELT_HOLD_STALE_MS = 1000

const lastSeen       = new Map<string, number>()
const joinGraceUntil = new Map<string, number>()
const heartbeated    = new Set<string>()
const frozen         = new Set<string>()
const frozenAt       = new Map<string, { x: number, z: number }>()
/** 1 = mobile Explorer for that wallet. Used for remote ice Y nudge. */
const mobileClient   = new Map<string, number>()

type MeltHold = {
	step    : number
	live    : boolean
	regrow  : number
	by      : Map<string, number>
	sentStep: number
	sentLive: boolean
	sent    : boolean
}

const meltHold = new Map<string, MeltHold>()

let installed            = false
let sweepAccum           = 0


// MARK: logReject
/**
 * Why a melt / rescue was refused (the freeze-other-player diagnostics). frostMeltRequest repeats every ~0.35 s while a rescuer holds a
 * torch on a cube, so each (kind, reason, rescuer, target) is logged at most once per REJECT_LOG_EVERY_MS with a count of the repeats.
 */
const REJECT_LOG_EVERY_MS = 10_000
const rejectSeen = new Map<string, { at: number; n: number }>()
function logReject(kind: string, reason: string, from: string, target: string): void {
	const key = `${kind}|${reason}|${from}|${target}`
	const now = Date.now()
	const s   = rejectSeen.get(key)
	if (s && now - s.at < REJECT_LOG_EVERY_MS) { s.n++; return }
	if (rejectSeen.size > 200) rejectSeen.clear()
	rejectSeen.set(key, { at: now, n: 0 })
	console.log(`[Server] frostLife: ${kind} REJECTED (${reason}) rescuer=${from || '?'} target=${target || '?'}${s && s.n > 0 ? ` (+${s.n} repeats suppressed)` : ''}`)
}


// MARK: isPlayerFrozen
/** True while this wallet is locked in an ice cube. */
export function isPlayerFrozen(userId: string): boolean {
	return frozen.has(userId.toLowerCase())
}


// MARK: notePlayerJoined
/**
 * Mark a wallet as in the scene from joinRoster. Starts a longer
 * stale grace until their first frostPresence heartbeat lands.
 */
export function notePlayerJoined(userId: string): void {
	const id = userId.toLowerCase()
	if (!id) return
	const now = Date.now()
	lastSeen.set(id, now)
	if (!heartbeated.has(id)) {
		joinGraceUntil.set(id, now + JOIN_GRACE_MS)
	}
}


// MARK: notePlayerPresent
/**
 * Mark a wallet as in the scene from a heartbeat, freeze, or thaw.
 * Ends join grace — they are fully live in the scene now.
 */
export function notePlayerPresent(userId: string): void {
	const id = userId.toLowerCase()
	if (!id) return
	lastSeen.set(id, Date.now())
	heartbeated.add(id)
	joinGraceUntil.delete(id)
}


// MARK: tellPlatform
function tellPlatform(
	id    : string,
	mobile: number,
	toUser?: string,
): void {
	const msg = { userId: id, mobile: mobile ? 1 : 0 }
	if (toUser) room.send('playerPlatform', msg, { to: [toUser] })
	else room.send('playerPlatform', msg)
}


// MARK: notePlayerPlatform
/**
 * Remember a wallet's Explorer platform and broadcast when it changes.
 */
function notePlayerPlatform(
	userId: string,
	mobile: number,
): void {
	const id  = userId.toLowerCase()
	const bit = mobile ? 1 : 0
	if (!id) return
	if (mobileClient.get(id) === bit) return
	mobileClient.set(id, bit)
	tellPlatform(id, bit)
}


// MARK: tellFrozen
function tellFrozen(
	id    : string,
	x     : number,
	z     : number,
	on    : boolean,
	toUser?: string,
	cue    = false,
): void {
	const msg = { userId: id, x, z, frozen: on ? 1 : 0, cue: cue ? 1 : 0 }
	if (toUser) room.send('frostFrozen', msg, { to: [toUser] })
	else room.send('frostFrozen', msg)
}


// MARK: tellMelt
function tellMelt(
	id    : string,
	step  : number,
	live  : boolean,
	toUser?: string,
): void {
	const msg = { userId: id, step, live: live ? 1 : 0 }
	if (toUser) room.send('frostMelt', msg, { to: [toUser] })
	else room.send('frostMelt', msg)
}


// MARK: syncMelt
function syncMelt(id: string, hold: MeltHold): void {
	const live = hold.by.size > 0
	hold.live = live
	if (hold.sent && hold.sentStep === hold.step && hold.sentLive === live) return
	hold.sent     = true
	hold.sentStep = hold.step
	hold.sentLive = live
	tellMelt(id, hold.step, live)
	if (hold.step === 0 && !live) meltHold.delete(id)
}


// MARK: tickMelt
function tickMelt(dt: number): void {
	const now = Date.now()
	for (const [id, hold] of meltHold) {
		for (const [rescuer, seen] of hold.by) {
			if (now - seen > MELT_HOLD_STALE_MS) hold.by.delete(rescuer)
		}
		if (hold.by.size > 0) {
			hold.regrow = 0
		} else if (hold.step > 0) {
			hold.regrow += dt
			if (hold.regrow >= ICE_REGROW_S) {
				hold.regrow -= ICE_REGROW_S
				hold.step   -= 1
				console.log(`[Server] frostLife: ${id} regrew to step ${hold.step}`)
			}
		}
		syncMelt(id, hold)
	}
}


// MARK: sendFrostBodiesTo
/**
 * Tell a joiner about every ice cube already in the world. The cube
 * is not a synced mesh, so a late client would otherwise see a bare avatar.
 */
export function sendFrostBodiesTo(userId: string): void {
	for (const [id, body] of frozenAt) {
		tellFrozen(id, body.x, body.z, true, userId)
		const hold = meltHold.get(id)
		if (hold && (hold.step > 0 || hold.by.size > 0)) {
			tellMelt(id, hold.step, hold.by.size > 0, userId)
		}
	}
	for (const [id, mobile] of mobileClient) {
		tellPlatform(id, mobile, userId)
	}
	if (frozenAt.size > 0) {
		console.log(`[Server] frostLife: hydrated ${frozenAt.size} ice cube(s) to ${userId}`)
	}
}


// MARK: clearFrozen
function clearFrozen(id: string): void {
	const body = frozenAt.get(id)
	const was  = frozen.delete(id)
	frozenAt.delete(id)
	meltHold.delete(id)
	if (!was && body === undefined) return
	tellFrozen(id, body?.x ?? 0, body?.z ?? 0, false)
}


// MARK: anyLivingFire
/** A fire a frozen player can wake at: lit hearth, lit hidden pit, or stage 1+ lava (a released obelisk's socket lava is NOT a fire: it only relights torches). */
function anyLivingFire(): boolean {
	return getMainFireFuel() > 0 || isAnyHiddenFireLit() || isVolcanoLavaLit()
}


// MARK: livingPlayerIds
/** Wallets still in the scene (heartbeat or join grace). Sweeps stale ones. */
export function livingPlayerIds(): string[] {
	return livingIds()
}


// MARK: presentPlayerIds
/** Living wallets that have sent at least one heartbeat (fully loaded). */
export function presentPlayerIds(): string[] {
	return livingIds().filter((id) => heartbeated.has(id))
}


// MARK: livingIds
function livingIds(): string[] {
	const now = Date.now()
	const ids: string[] = []
	const stale: string[] = []
	for (const [id, seen] of lastSeen) {
		const graceUntil = joinGraceUntil.get(id) ?? 0
		const inJoinGrace = !heartbeated.has(id) && now < graceUntil
		if (now - seen > STALE_MS && !inJoinGrace) stale.push(id)
		else ids.push(id)
	}
	for (const id of stale) {
		lastSeen.delete(id)
		joinGraceUntil.delete(id)
		heartbeated.delete(id)
		console.log(`[Server] frostLife: ${id} went quiet — no longer in the scene`)
		clearFrozen(id)
	}
	return ids
}


// MARK: senderId
/**
 * Authenticated sender when the transport provides one. The preview
 * omits it on some messages, so the payload wallet is the fallback.
 */
function senderId(
	contextFrom: string | undefined,
	payloadId  : string | undefined,
	label      : string,
): string {
	const from = contextFrom || payloadId || ''
	if (!from) {
		console.log(`[Server] frostLife: ${label} ignored, no sender`)
		return ''
	}
	if (!contextFrom) {
		console.log(`[Server] frostLife: ${label} has no context.from, using payload ${from}`)
	}
	return from.toLowerCase()
}


// MARK: setupFrostLifeServer
/**
 * Track freezes, thaws, and torch rescues. Idempotent. Call once from
 * setupServer after the ember-fail handler is installed.
 */
export function setupFrostLifeServer(): void {
	if (installed) {
		console.log('[Server] frostLife: setupFrostLifeServer already installed, skipping')
		return
	}
	installed = true

	onCycleRoll(() => {
		const ids = Array.from(frozen)
		for (const id of ids) clearFrozen(id)
		console.log('[Server] frostLife: cycle roll cleared the frozen set')
	})

	engine.addSystem((dt: number) => {
		tickMelt(dt)
		sweepAccum += dt
		if (sweepAccum < 1) return
		sweepAccum = 0
		// Drop players who went quiet (and their ice cubes).
		livingIds()
	})

	room.onMessage('frostPresence', ({ userId, mobile }, context) => {
		const from = senderId(context?.from, userId, 'frostPresence')
		if (!from) return
		notePlayerPresent(from)
		notePlayerPlatform(from, mobile ?? 0)
	})

	room.onMessage('frostFreeze', ({ userId, x, z }, context) => {
		const from = senderId(context?.from, userId, 'frostFreeze')
		if (!from) return
		notePlayerPresent(from)
		frozenAt.set(from, { x, z })
		if (frozen.has(from)) return
		frozen.add(from)
		tellFrozen(from, x, z, true, undefined, true)
		console.log(`[Server] frostLife: ${from} froze at ${x.toFixed(1)}, ${z.toFixed(1)} (${frozen.size} frozen)`)
	})

	room.onMessage('frostThaw', ({ userId }, context) => {
		const from = senderId(context?.from, userId, 'frostThaw')
		if (!from) return
		notePlayerPresent(from)
		if (!frozen.has(from)) return
		console.log(`[Server] frostLife: ${from} is up`)
		clearFrozen(from)
	})

	room.onMessage('frostMeltRequest', ({ userId, step, live }, context) => {
		const from   = context?.from?.toLowerCase()
		const target = (userId ?? '').toLowerCase()
		if (!from)   { logReject('frostMeltRequest', 'no context.from: sender unknown', '', target); return }
		if (!target) { logReject('frostMeltRequest', 'missing target id', from, ''); return }
		if (from === target) { logReject('frostMeltRequest', 'rescuer is the target', from, target); return }
		if (frozen.has(from)) {
			logReject('frostMeltRequest', 'rescuer is frozen', from, target)
			return
		}
		if (!frozen.has(target)) {
			logReject('frostMeltRequest', `target not frozen (${frozen.size} frozen: ${[...frozen].join(',') || 'none'})`, from, target)
			return
		}
		let hold = meltHold.get(target)
		if (!hold) {
			hold = {
				step    : 0,
				live    : false,
				regrow  : 0,
				by      : new Map(),
				sentStep: 0,
				sentLive: false,
				sent    : false,
			}
			meltHold.set(target, hold)
		}
		if (live) {
			hold.by.set(from, Date.now())
			const partial = Math.floor(ICE_THAW_S) - 1
			const next    = Math.max(0, Math.min(partial, step))
			if (next > hold.step) {
				hold.step   = next
				hold.regrow = 0
				console.log(`[Server] frostLife: ${from} melted ${target} to step ${next}`)
			}
		} else {
			hold.by.delete(from)
			console.log(`[Server] frostLife: ${from} stopped melting ${target}`)
		}
		syncMelt(target, hold)
	})

	room.onMessage('frostRescue', ({ userId }, context) => {
		const from   = context?.from?.toLowerCase()
		const target = (userId ?? '').toLowerCase()
		if (!from)   { logReject('frostRescue', 'no context.from: sender unknown', '', target); return }
		if (!target) { logReject('frostRescue', 'missing target id', from, ''); return }
		if (from === target) { logReject('frostRescue', 'rescuer is the target', from, target); return }
		if (frozen.has(from)) {
			logReject('frostRescue', 'rescuer is frozen', from, target)
			return
		}
		if (!frozen.has(target)) {
			logReject('frostRescue', `target not frozen (${frozen.size} frozen: ${[...frozen].join(',') || 'none'})`, from, target)
			return
		}
		clearFrozen(target)
		room.send('frostRescued', { userId: target })
		console.log(`[Server] frostLife: ${from} thawed ${target}`)
	})

	room.onMessage('frostGiveUp', ({ userId }, context) => {
		const from = senderId(context?.from, userId, 'frostGiveUp')
		if (!from) return
		notePlayerPresent(from)
		let reason = ''
		if (isEmberFailing())        reason = 'run is ending'
		else if (!frozen.has(from))  reason = 'not frozen'
		else if (!anyLivingFire())   reason = 'no lit fire'
		const ok = reason === ''
		room.send('frostGiveUpResult', { userId: from, ok: ok ? 1 : 0, reason }, { to: [from] })
		// Same path as the ice timeout: the client fades out, then its
		// frostThaw clears it from the frozen set. Nothing else changes.
		console.log(`[Server] frostLife: ${from} give up ${ok ? 'accepted' : `refused (${reason})`}`)
	})

	console.log('[Server] frostLife: installed')
}
