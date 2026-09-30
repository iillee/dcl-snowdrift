/**
 * phase.ts — authoritative day/night clock.
 *
 * Owns the current daily phase and broadcasts `phaseState` so every
 * client agrees. Independent of the world seed in cycle.ts: that one
 * rolls the world on last-fire-out; this one is the minutes-long day
 * players feel.
 *
 * Parked at DAWN until the first player joins, then the 12 s
 * pre-sunrise window starts so load-in still plays over the rise.
 * On cycle roll, resets to DAWN with a fresh start time so ember-fail
 * cover drops on the same sunrise.
 */

import { engine } from '@dcl/sdk/ecs'

import { room } from 'src/shared/messages'
import {
	DAILY_PHASES,
	dailyPhaseAt,
	nextDailyIndex,
} from 'src/shared/phase'
import { onCycleRoll } from 'src/server/cycle'


const HEARTBEAT_S = 15


// MARK: State
let phaseIndex       = 0
let phaseStartedAtMs = 0
let cycleId          = 0
let nightsThisRun    = 0
let heartbeatClock   = 0
let installed        = false
let clockArmed       = false


// MARK: currentConfig

function currentConfig() {
	return dailyPhaseAt(phaseIndex)
}


// MARK: getPhaseDrainMul

/** Fuel-drain multiplier for the active phase. DAWN/DAY 0.5, DUSK/NIGHT 2. */
export function getPhaseDrainMul(): number {
	return currentConfig().drainMul
}


// MARK: getPhaseWeatherHeavyBias

/** 0..1 chance a weather step moves toward HEAVY. */
export function getPhaseWeatherHeavyBias(): number {
	return currentConfig().weatherHeavyBias
}


// MARK: getPhaseWeatherSpeedMul

/** Weather cadence multiplier. 1 = normal, 2 = twice as often. */
export function getPhaseWeatherSpeedMul(): number {
	return currentConfig().weatherSpeedMul
}


// MARK: getPhaseWeatherFloor

/** Lowest precipitation level the current phase will sit at. */
export function getPhaseWeatherFloor(): number {
	return currentConfig().weatherFloor
}


// MARK: getPhaseWeatherEnterLevel

/** Level to snap to on phase enter, or null to leave weather alone. */
export function getPhaseWeatherEnterLevel(): number | null {
	return currentConfig().weatherEnterLevel
}


// MARK: isPhaseClockArmed

/** True after the first joiner starts DAWN. Parked preview does not count. */
export function isPhaseClockArmed(): boolean {
	return clockArmed
}


// MARK: getDayNumber
/**
 * 1-based day of this run. Day 1 at first dawn; increments each
 * sunrise. Matches the client day counter.
 */
export function getDayNumber(): number {
	return cycleId + 1
}


// MARK: getNightsThisRun
/** Dusks entered this run. 0 if the fire died before the first sunset. */
export function getNightsThisRun(): number {
	return nightsThisRun
}


// MARK: onPhaseChange

type PhaseChangeHandler = () => void
const phaseChangeHandlers: PhaseChangeHandler[] = []

/** Register a handler for daily-phase transitions (dusk, night, dawn). */
export function onPhaseChange(handler: PhaseChangeHandler): void {
	phaseChangeHandlers.push(handler)
}


// MARK: notifyPhaseChange

function notifyPhaseChange(): void {
	for (const handler of phaseChangeHandlers) {
		try {
			handler()
		} catch (err) {
			console.log(`[Server] phase: notifyPhaseChange: handler threw: ${err}`)
		}
	}
}


// MARK: payload

function payload() {
	const cfg = currentConfig()
	const raw = clockArmed
		? Math.max(0, (Date.now() - phaseStartedAtMs) / 1000)
		: 0
	const age = Math.min(raw, cfg.durationSec)
	return {
		phaseName       : cfg.name,
		phaseIndex,
		phaseAgeSec     : age,
		phaseDurationSec: cfg.durationSec,
		cycleId,
	}
}


// MARK: broadcastPhaseState

function broadcastPhaseState(): void {
	try {
		room.send('phaseState', payload())
	} catch (err) {
		console.log(`[Server] phase: broadcastPhaseState: send failed: ${err}`)
	}
	heartbeatClock = 0
}


// MARK: sendPhaseStateTo

/**
 * Push the current phase to one client. Called from joinRoster so a
 * joiner's HUD and frost/drain consumers match the room on frame one.
 */
export function sendPhaseStateTo(userId: string): void {
	room.send('phaseState', payload(), { to: [userId] })
	console.log(
		`[Server] phase: sendPhaseStateTo: ${currentConfig().name} ` +
		`idx=${phaseIndex} to ${userId}`
	)
}


// MARK: noteEnteredPhase

/**
 * Count a dusk when the clock enters it. The live tick and enterPhase
 * both step the phase. The tick must not call enterPhase: that snaps
 * the start time to now, while a late frame has to keep the leftover
 * time.
 */
function noteEnteredPhase(name: string): void {
	if (name === 'DUSK') nightsThisRun++
}


// MARK: enterPhase

function enterPhase(
	index : number,
	reason: string,
): void {
	const prev    = currentConfig().name
	const wrapped = phaseIndex === DAILY_PHASES.length - 1 && index === 0
	if (wrapped) cycleId++
	phaseIndex       = index
	phaseStartedAtMs = Date.now()
	const cfg = currentConfig()
	noteEnteredPhase(cfg.name)
	console.log(
		`[Server] phase: enterPhase: ${prev} → ${cfg.name} ` +
		`dur=${cfg.durationSec}s cycleId=${cycleId} (${reason})`
	)
	broadcastPhaseState()
	notifyPhaseChange()
}


// MARK: advancePhase

/** Move to the next daily phase. Dev button only. The live tick steps in place. */
export function advancePhase(reason: string = 'tick'): void {
	enterPhase(nextDailyIndex(phaseIndex), reason)
}


// MARK: resetToDay

function resetToDay(reason: string): void {
	clockArmed       = true
	phaseIndex       = 0
	phaseStartedAtMs = Date.now()
	cycleId          = 0
	nightsThisRun    = 0
	console.log(`[Server] phase: resetToDay: cycleId=${cycleId} (${reason})`)
	broadcastPhaseState()
	notifyPhaseChange()
}


// MARK: armPhaseClock

/**
 * Start the DAWN window. First joinRoster of the server lifetime; later
 * joiners hydrate into whatever time the room already has.
 */
export function armPhaseClock(reason: string): void {
	if (clockArmed) return
	clockArmed       = true
	phaseIndex       = 0
	phaseStartedAtMs = Date.now()
	cycleId          = 0
	nightsThisRun    = 0
	console.log(`[Server] phase: armPhaseClock: DAWN ${currentConfig().durationSec}s (${reason})`)
	broadcastPhaseState()
	notifyPhaseChange()
}


// MARK: setupPhaseServer

/**
 * Park at DAWN (clock frozen) and register the cycle-roll reset.
 * Idempotent — call once from setupServer after setupCycleServer.
 */
export function setupPhaseServer(): void {
	if (installed) {
		console.log('[Server] phase: setupPhaseServer already installed, skipping')
		return
	}
	installed        = true
	clockArmed       = false
	phaseIndex       = 0
	phaseStartedAtMs = 0
	cycleId          = 0
	nightsThisRun    = 0
	console.log(
		`[Server] phase: installed ${currentConfig().name} ${currentConfig().durationSec}s parked ` +
		`table=${DAILY_PHASES.map((p) => p.name).join('→')}`
	)
	// Do not broadcast while parked. A boot/heartbeat DAWN age=0 lets
	// the client start its own 12 s dawn, then the 15 s heartbeat
	// rewinds it after DAY has already begun.

	onCycleRoll(() => {
		resetToDay('cycle roll')
	})

	room.onMessage('devAdvancePhase', (_payload, context) => {
		const from = context?.from ?? 'unknown'
		console.log(`[Server] phase: devAdvancePhase from ${from}`)
		advancePhase('dev')
	})

	engine.addSystem((dt: number) => {
		if (!clockArmed) return
		let stepped = 0
		while (stepped < DAILY_PHASES.length + 1) {
			const cfg = currentConfig()
			const durMs = Math.max(1, cfg.durationSec) * 1000
			if (Date.now() - phaseStartedAtMs < durMs) break
			phaseStartedAtMs += durMs
			const next = nextDailyIndex(phaseIndex)
			const wrapped = phaseIndex === DAILY_PHASES.length - 1 && next === 0
			if (wrapped) cycleId++
			const prev = currentConfig().name
			phaseIndex = next
			noteEnteredPhase(currentConfig().name)
			console.log(
				`[Server] phase: tick ${prev} → ${currentConfig().name} ` +
				`cycleId=${cycleId} nights=${nightsThisRun}`
			)
			stepped++
		}
		if (stepped > 0) {
			broadcastPhaseState()
			notifyPhaseChange()
			return
		}
		heartbeatClock += dt
		if (heartbeatClock >= HEARTBEAT_S) broadcastPhaseState()
	})
}
