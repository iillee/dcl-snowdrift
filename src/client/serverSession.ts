/**
 * serverSession.ts - client view of the authoritative server's session.
 *
 * The platform shuts the server down after the last player leaves (and on
 * redeploys) and cold-starts a new one with fresh state. The client has
 * to notice that on its own: without this it kept the old snow, fires,
 * obelisks and log piles until a paintTick happened to bounce back as
 * pleaseRejoin (an idle client never did).
 *
 * Sources of the session id: cycleState and serverBeat messages. A change
 * (or the first value) fires the listeners. A long gap in beats counts as
 * silence, which also asks for a rejoin so the client recovers the moment
 * a server comes back. PaintTile.session lets snowModel drop tiles left
 * over from an earlier run.
 */

import { engine } from '@dcl/sdk/ecs'

import { room } from 'src/shared/messages'

/** No serverBeat for this long (s) while we had heard one = server gone. */
const SILENCE_S = 12

export type SessionChange = {
	newSession: number
	/** null on the first session ever seen by this client. */
	oldSession: number | null
	/** true = a different server run replaced one we were using. */
	restarted : boolean
}
type SessionHandler = (info: SessionChange) => void

let session     : number | null = null
let sinceBeatS  = 0
let silent      = false
let installed   = false
const handlers  : SessionHandler[] = []
const silenceHandlers: Array<() => void> = []


// MARK: getServerSession
/** Live server session id, or null before the first message. */
export function getServerSession(): number | null {
	return session
}


// MARK: isStaleSession
/** True when `tileSession` belongs to a different server run than the live one. */
export function isStaleSession(tileSession: number): boolean {
	return session !== null && tileSession !== session
}


// MARK: onServerSessionChange
/** Fires on the first session id and on every change. */
export function onServerSessionChange(handler: SessionHandler): void {
	handlers.push(handler)
}


// MARK: onServerSilence
/** Fires once when beats stop (server stopped / unreachable). */
export function onServerSilence(handler: () => void): void {
	silenceHandlers.push(handler)
}


// MARK: noteServerSession
/**
 * Record a session id seen on the wire. Returns true when it is a
 * restart (a different id than the one we were running on).
 */
export function noteServerSession(next: number): boolean {
	sinceBeatS = 0
	silent     = false
	if (session === next) return false
	const old       = session
	const restarted = old !== null
	session = next
	console.log(`serverSession: ${restarted ? 'RESTART' : 'first'} session ${old} -> ${next}`)
	for (const h of handlers) {
		try {
			h({ newSession: next, oldSession: old, restarted })
		} catch (err) {
			console.log(`serverSession: handler threw - continuing: ${err}`)
		}
	}
	return restarted
}


// MARK: setupServerSession
/** Subscribe to serverBeat + run the silence watchdog. Call before initClientHandler. */
export function setupServerSession(): void {
	if (installed) return
	installed = true
	room.onMessage('serverBeat', ({ session: s }) => {
		noteServerSession(s)
	})
	engine.addSystem((dt: number) => {
		if (session === null || silent) return
		sinceBeatS += dt
		if (sinceBeatS < SILENCE_S) return
		silent = true
		console.log(`serverSession: no beat for ${SILENCE_S}s - server stopped or unreachable`)
		for (const h of silenceHandlers) {
			try { h() } catch (err) { console.log(`serverSession: silence handler threw: ${err}`) }
		}
	})
}