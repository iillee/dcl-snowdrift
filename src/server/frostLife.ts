/**
 * frostLife.ts — who is frozen, and when that ends the run.
 *
 * A freeze is client-authoritative (same trust as feed and spark).
 * Presence is a heartbeat, not the team roster: the roster never
 * forgets a leaver, and a disconnected player must not block extinction.
 *
 * The last people still in the scene, all frozen, end the run only
 * when every fire is dark. A lit fire — main hearth or hidden pit —
 * lets them wake beside it on their own client. That check is not
 * only at the moment of the freeze: while anyone is still in a cube,
 * a fire going dark is enough to end the run.
 */

import { engine } from '@dcl/sdk/ecs'

import { ICE_REGROW_S, ICE_THAW_S } from 'src/shared/frost/tuning'
import { room } from 'src/shared/messages'

import { onCycleRoll } from 'src/server/cycle'
import { beginExtinction, isEmberFailing } from 'src/server/emberFail'
import { getMainFireFuel, onMainFireRelit } from 'src/server/hearthFuel'
import { isAnyHiddenFireLit, onHiddenFireRelit } from 'src/server/hiddenCampfire'


/** Drop a player who has not checked in for this long. */
const STALE_MS = 20000

/**
 * After joinRoster, keep the wallet in the living set this long even
 * without a frostPresence heartbeat. Heavy hydrate can take longer
 * than STALE_MS; dropping them mid-load lets extinction fire under them.
 */
const JOIN_GRACE_MS = 60000

/**
 * After every living player is frozen with no fire, wait this long
 * before ending the run. A torch spark in that window can still save it.
 */
const EXTINCT_DELAY_MS = 2500

/** Drop a melt hold whose torch stopped checking in. */
const MELT_HOLD_STALE_MS = 1000

const lastSeen       = new Map<string, number>()
const joinGraceUntil = new Map<string, number>()
const heartbeated    = new Set<string>()
const frozen         = new Set<string>()
const frozenAt       = new Map<string, { x: number, z: number }>()

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
let loggedFireSaves      = false
let extinctPendingAtMs   = 0
let extinctPendingReason = ''


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


// MARK: noteFireRelit
/**
 * A dead fire just came back (main spark or hidden ignite). Cancel any
 * pending extinction so the spark wins the race against a freeze packet.
 */
export function noteFireRelit(): void {
	cancelPendingExtinct('a fire relit')
	loggedFireSaves = false
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
function anyLivingFire(): boolean {
	return getMainFireFuel() > 0 || isAnyHiddenFireLit()
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


// MARK: cancelPendingExtinct
function cancelPendingExtinct(reason: string): void {
	if (extinctPendingAtMs === 0) return
	extinctPendingAtMs   = 0
	extinctPendingReason = ''
	console.log(`[Server] frostLife: pending extinction cancelled — ${reason}`)
}


// MARK: flushPendingExtinct
function flushPendingExtinct(): void {
	if (extinctPendingAtMs === 0) return
	if (Date.now() < extinctPendingAtMs) return
	const reason = extinctPendingReason || 'pending extinction'
	extinctPendingAtMs   = 0
	extinctPendingReason = ''
	// Re-check — a spark or thaw may have landed in the delay window.
	maybeExtinctNow(reason)
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


// MARK: maybeExtinctNow
/**
 * End the run immediately when every living player is frozen and
 * every fire is dark. Prefer maybeExtinct so a spark can still win.
 */
function maybeExtinctNow(trigger: string): void {
	if (isEmberFailing()) return
	const living = livingIds()
	if (living.length === 0) {
		loggedFireSaves = false
		cancelPendingExtinct('nobody left in the scene')
		return
	}
	for (const id of living) {
		if (!frozen.has(id)) {
			loggedFireSaves = false
			cancelPendingExtinct('a living player is not frozen')
			return
		}
	}
	if (anyLivingFire()) {
		cancelPendingExtinct('a fire still burns')
		if (!loggedFireSaves) {
			loggedFireSaves = true
			console.log(
				`[Server] frostLife: ${trigger} — every player is frozen and a fire still burns, they wake at the fire`,
			)
		}
		return
	}
	loggedFireSaves = false
	beginExtinction(`${trigger}: every connected player is frozen and every fire is dark`)
}


// MARK: maybeExtinct
/**
 * Schedule extinction after a short delay so a torch spark that races
 * the freeze packet can still relight the world.
 */
function maybeExtinct(trigger: string): void {
	if (isEmberFailing()) return
	const living = livingIds()
	if (living.length === 0) {
		loggedFireSaves = false
		cancelPendingExtinct('nobody left in the scene')
		return
	}
	for (const id of living) {
		if (!frozen.has(id)) {
			loggedFireSaves = false
			cancelPendingExtinct('a living player is not frozen')
			return
		}
	}
	if (anyLivingFire()) {
		cancelPendingExtinct('a fire still burns')
		if (!loggedFireSaves) {
			loggedFireSaves = true
			console.log(
				`[Server] frostLife: ${trigger} — every player is frozen and a fire still burns, they wake at the fire`,
			)
		}
		return
	}
	if (extinctPendingAtMs === 0) {
		extinctPendingAtMs   = Date.now() + EXTINCT_DELAY_MS
		extinctPendingReason = trigger
		console.log(
			`[Server] frostLife: extinction pending in ${EXTINCT_DELAY_MS}ms (${trigger})`,
		)
	}
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

	onMainFireRelit(noteFireRelit)
	onHiddenFireRelit(noteFireRelit)

	onCycleRoll(() => {
		const ids = Array.from(frozen)
		for (const id of ids) clearFrozen(id)
		cancelPendingExtinct('cycle roll')
		loggedFireSaves = false
		console.log('[Server] frostLife: cycle roll cleared the frozen set')
	})

	engine.addSystem((dt: number) => {
		tickMelt(dt)
		sweepAccum += dt
		flushPendingExtinct()
		if (sweepAccum < 1) return
		sweepAccum = 0
		const before = lastSeen.size
		livingIds()
		const someoneLeft = lastSeen.size !== before
		// A fire can die after the freeze. Recheck while anyone is still
		// in a cube so that death ends the run instead of leaving them locked.
		if (someoneLeft || frozen.size > 0) {
			maybeExtinct(someoneLeft ? 'a player went quiet' : 'a fire went dark')
		}
	})

	room.onMessage('frostPresence', ({ userId }, context) => {
		const from = senderId(context?.from, userId, 'frostPresence')
		if (!from) return
		notePlayerPresent(from)
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
		maybeExtinct(`${from} froze`)
	})

	room.onMessage('frostThaw', ({ userId }, context) => {
		const from = senderId(context?.from, userId, 'frostThaw')
		if (!from) return
		notePlayerPresent(from)
		if (!frozen.has(from)) return
		console.log(`[Server] frostLife: ${from} is up`)
		clearFrozen(from)
		cancelPendingExtinct(`${from} thawed`)
	})

	room.onMessage('frostMeltRequest', ({ userId, step, live }, context) => {
		const from   = context?.from?.toLowerCase()
		const target = userId.toLowerCase()
		if (!from || !target || from === target) return
		if (frozen.has(from)) {
			console.log(`[Server] frostLife: ${from} is frozen and cannot melt ${target}`)
			return
		}
		if (!frozen.has(target)) {
			console.log(`[Server] frostLife: melt ignored, ${target} is not frozen`)
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
		const target = userId.toLowerCase()
		if (!from || !target) {
			console.log('[Server] frostLife: frostRescue ignored, missing id')
			return
		}
		if (from === target) {
			console.log(`[Server] frostLife: ${from} cannot thaw themselves`)
			return
		}
		if (frozen.has(from)) {
			console.log(`[Server] frostLife: ${from} is frozen and cannot thaw ${target}`)
			return
		}
		if (!frozen.has(target)) {
			console.log(`[Server] frostLife: rescue ignored, ${target} is not frozen`)
			return
		}
		clearFrozen(target)
		cancelPendingExtinct(`${target} rescued`)
		room.send('frostRescued', { userId: target })
		console.log(`[Server] frostLife: ${from} thawed ${target}`)
	})

	console.log('[Server] frostLife: installed')
}
