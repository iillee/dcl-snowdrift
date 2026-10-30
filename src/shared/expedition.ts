/**
 * expedition.ts - the NEW EXPEDITION reset (pure, shared by the server, the client and scripts/expeditionCheck).
 *
 * After the ending ("The world begins to thaw") the restored world stays playable for good: nothing brings winter back by itself.
 * Any connected player can then press BEGIN NEW EXPEDITION (Help panel, opened with the ? button). The SERVER validates, starts ONE shared countdown
 * (NEW_EXPEDITION_COUNTDOWN_S) and rolls the world to a fresh seed, Day 1, when it ends. Only the player who started it can cancel it.
 *
 * Time: the server keeps one deadline in its own clock. A message carries `remainingMs` at send time (epoch milliseconds do not fit the
 * wire numbers); the client turns that into a LOCAL deadline once and derives the display from it every frame, so there is no drift
 * (no per-second decrement). A late joiner gets the same message hydrated from the server deadline.
 */

import { cycleSeedsEqual } from 'src/shared/cycleMazeSeed'
import { finaleRestoredS } from 'src/shared/finale'

/** Seconds of the shared countdown between the request and the new world. */
export const NEW_EXPEDITION_COUNTDOWN_S = 60

/** Server-side state: deadlineMs 0 = no countdown running. `initiator` = lowercase wallet of the player who started it. */
export interface ExpeditionCountdown {
	deadlineMs: number
	initiator : string
}

export function newExpeditionCountdown(): ExpeditionCountdown {
	return { deadlineMs: 0, initiator: '' }
}

export function expeditionActive(st: ExpeditionCountdown): boolean {
	return st.deadlineMs > 0
}

/**
 * True once the expedition is complete AND the world is restored: the ending started (`finaleStartMs` > 0, server epoch ms) and its
 * permafrost / earth / plant opening has finished. Pure function of the finale start, so the server decides it alone.
 */
export function isExpeditionComplete(finaleStartMs: number, nowMs: number): boolean {
	return finaleStartMs > 0 && nowMs >= finaleStartMs + finaleRestoredS() * 1000
}

export type BeginResult = 'started' | 'already_running' | 'not_complete' | 'no_sender'

/** A player asks for a new expedition. Starts the single shared countdown only when the expedition is complete and none runs. */
export function beginExpedition(st: ExpeditionCountdown, from: string, nowMs: number, complete: boolean): BeginResult {
	const who = from.trim().toLowerCase()
	if (who === '' || who === 'unknown') return 'no_sender'
	if (!complete) return 'not_complete'
	if (expeditionActive(st)) return 'already_running' // repeated presses never restart or duplicate it
	st.deadlineMs = nowMs + NEW_EXPEDITION_COUNTDOWN_S * 1000
	st.initiator = who
	return 'started'
}

export type CancelResult = 'cancelled' | 'not_initiator' | 'none'

/** Only the initiator can cancel a running countdown. */
export function cancelExpedition(st: ExpeditionCountdown, from: string): CancelResult {
	if (!expeditionActive(st)) return 'none'
	if (from.trim().toLowerCase() !== st.initiator) return 'not_initiator'
	st.deadlineMs = 0
	st.initiator = ''
	return 'cancelled'
}

/** ms left on the server deadline (0 when none / over). */
export function expeditionRemainingMs(st: ExpeditionCountdown, nowMs: number): number {
	return expeditionActive(st) ? Math.max(0, st.deadlineMs - nowMs) : 0
}

/** The countdown reached zero: the world must roll now. */
export function expeditionDue(st: ExpeditionCountdown, nowMs: number): boolean {
	return expeditionActive(st) && nowMs >= st.deadlineMs
}

/** What the server tells the clients (broadcast on every change + hydrated to joiners). */
export interface ExpeditionWire {
	seed       : number
	ready      : number
	active     : number
	remainingMs: number
	initiator  : string
}

export function expeditionWire(st: ExpeditionCountdown, nowMs: number, ready: boolean, seed: number): ExpeditionWire {
	const active = expeditionActive(st)
	return {
		seed,
		ready      : ready || active ? 1 : 0,
		active     : active ? 1 : 0,
		remainingMs: Math.min(2_000_000_000, Math.round(expeditionRemainingMs(st, nowMs))),
		initiator  : active ? st.initiator : '',
	}
}

/** Client: the local epoch ms the countdown ends at, from the message's remaining time (computed ONCE per message). */
export function expeditionLocalDeadline(remainingMs: number, localNowMs: number): number {
	return localNowMs + Math.max(0, remainingMs)
}

/** Client: whole seconds left, rounded UP so the clock shows the full countdown at the start and 0:00 only at the end. */
export function expeditionSecondsLeft(localDeadlineMs: number, localNowMs: number): number {
	return Math.max(0, Math.ceil((localDeadlineMs - localNowMs) / 1000))
}

/** m:ss for the HUD / Help panel (no zero-padding on minutes). */
export function formatExpeditionClock(seconds: number): string {
	const s = Math.max(0, Math.floor(seconds))
	return `${Math.floor(s / 60)}:${(s % 60 < 10 ? '0' : '') + (s % 60)}`
}
// MARK: ExpeditionServerCore
/** What the server core needs from its host (the real server wires these to the room / cycle / stations; the check fakes them). */
export interface ExpeditionHost {
	nowMs         : () => number
	seed          : () => number
	/** Server epoch ms the ending started (0 = not this world). */
	finaleStartMs : () => number
	/** Roll the world to a fresh seed + Day 1 (cycle.rollCycle). The host calls onRolled() for every roll, this one included. */
	roll          : () => void
	/** Send the wire state to everyone (to undefined) or to one player. */
	send          : (p: ExpeditionWire, to?: string) => void
}

/**
 * The whole server-side behaviour (validation, ONE shared countdown, initiator-only cancel, deadline broadcast, hydration, the roll at
 * zero) with no engine imports, so scripts/expeditionCheck.mjs runs the very code the server runs.
 */
export class ExpeditionServerCore {
	private st: ExpeditionCountdown = newExpeditionCountdown()
	private sentReady = false

	constructor(private readonly host: ExpeditionHost, private readonly enabled: boolean = true) {}

	countdown(): Readonly<ExpeditionCountdown> { return this.st }

	ready(): boolean {
		return this.enabled && isExpeditionComplete(this.host.finaleStartMs(), this.host.nowMs())
	}

	private wire(): ExpeditionWire {
		return expeditionWire(this.st, this.host.nowMs(), this.ready(), this.host.seed())
	}

	private broadcast(): void {
		const p = this.wire()
		this.sentReady = p.ready === 1
		this.host.send(p)
	}

	private resync(to: string): void {
		if (to !== '' && to !== 'unknown') this.host.send(this.wire(), to)
	}

	/** Joiner hydration. */
	hydrate(userId: string): void {
		if (this.enabled) this.host.send(this.wire(), userId)
	}

	/** newExpeditionRequest from `from` for world `seed`. */
	request(from: string, seed: number): BeginResult | 'stale' {
		const who = from.toLowerCase()
		if (!cycleSeedsEqual(seed, this.host.seed())) { this.resync(who); return 'stale' }
		const r = beginExpedition(this.st, who, this.host.nowMs(), this.ready())
		if (r === 'started') this.broadcast()
		else this.resync(who) // refused / duplicate: just resync the sender (nobody else hears about it)
		return r
	}

	/** newExpeditionCancel from `from` for world `seed`. */
	cancel(from: string, seed: number): CancelResult | 'stale' {
		const who = from.toLowerCase()
		if (!cycleSeedsEqual(seed, this.host.seed())) { this.resync(who); return 'stale' }
		const r = cancelExpedition(this.st, who)
		if (r === 'cancelled') this.broadcast()
		else this.resync(who)
		return r
	}

	/** Every cycle roll (this countdown's, the dev roll, a fail) ends the old expedition: no countdown, no button until the next ending. */
	onRolled(): void {
		this.st = newExpeditionCountdown()
		this.broadcast()
	}

	/** Server tick: roll at zero; announce the button when the world has just finished restoring. Returns true when it rolled. */
	tick(): boolean {
		if (!this.enabled) return false
		if (expeditionDue(this.st, this.host.nowMs())) {
			this.st = newExpeditionCountdown()
			this.host.roll() // host -> onRolled()
			return true
		}
		if (!expeditionActive(this.st) && this.ready() !== this.sentReady) this.broadcast()
		return false
	}
}