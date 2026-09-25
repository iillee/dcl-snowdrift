/**
 * phase.ts — authoritative day/night clock.
 *
 * Owns the current daily phase and broadcasts `phaseState` so every
 * client agrees. Independent of the 24 h UTC rebuild clock in
 * cycle.ts: that one wipes the world; this one is the minutes-long
 * day players feel.
 *
 * Always starts at DAY. On cycle roll, resets to DAY with a fresh
 * start time so a new world begins at dawn.
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


// MARK: currentConfig

function currentConfig() {
	return dailyPhaseAt(phaseIndex)
}


// MARK: getPhaseDrainMul

/** Fuel-drain multiplier for the active phase. DAY 0.5, DUSK 1, NIGHT 2. */
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

/** Level to snap up to on phase enter, or null to leave weather alone. */
export function getPhaseWeatherEnterLevel(): number | null {
	return currentConfig().weatherEnterLevel
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
	for (const handler of phaseChangeHandlers) handler()
}


// MARK: payload

function payload() {
	const cfg = currentConfig()
	const age = Math.max(0, (Date.now() - phaseStartedAtMs) / 1000)
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
	if (cfg.name === 'DUSK') nightsThisRun++
	console.log(
		`[Server] phase: enterPhase: ${prev} → ${cfg.name} ` +
		`dur=${cfg.durationSec}s cycleId=${cycleId} (${reason})`
	)
	broadcastPhaseState()
	notifyPhaseChange()
}


// MARK: advancePhase

/** Move to the next daily phase. Used by the tick and the dev button. */
export function advancePhase(reason: string = 'tick'): void {
	enterPhase(nextDailyIndex(phaseIndex), reason)
}


// MARK: resetToDay

function resetToDay(reason: string): void {
	phaseIndex       = 0
	phaseStartedAtMs = Date.now()
	cycleId          = 0
	nightsThisRun    = 0
	console.log(`[Server] phase: resetToDay: cycleId=${cycleId} (${reason})`)
	broadcastPhaseState()
	notifyPhaseChange()
}


// MARK: setupPhaseServer

/**
 * Start the phase clock at DAY and register the cycle-roll reset.
 * Idempotent — call once from setupServer after setupCycleServer.
 */
export function setupPhaseServer(): void {
	if (installed) {
		console.log('[Server] phase: setupPhaseServer already installed, skipping')
		return
	}
	installed        = true
	phaseIndex       = 0
	phaseStartedAtMs = Date.now()
	cycleId          = 0
	nightsThisRun    = 0
	console.log(
		`[Server] phase: installed DAY ${currentConfig().durationSec}s ` +
		`table=${DAILY_PHASES.map((p) => p.name).join('→')}`
	)
	broadcastPhaseState()

	onCycleRoll(() => {
		resetToDay('cycle roll')
	})

	room.onMessage('devAdvancePhase', (_payload, context) => {
		const from = context?.from ?? 'unknown'
		console.log(`[Server] phase: devAdvancePhase from ${from}`)
		advancePhase('dev')
	})

	engine.addSystem((dt: number) => {
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
			console.log(
				`[Server] phase: tick ${prev} → ${currentConfig().name} ` +
				`cycleId=${cycleId}`
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
