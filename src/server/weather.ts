/**
 * weather.ts — server-authoritative precipitation for Cryocene.
 *
 * Owns the single source of truth for the current weather level
 * (0=CLEAR..3=HEAVY). Runs a randomised cycle that biases toward
 * ±1 step transitions for smoothness, with occasional full-random
 * jumps for surprise. Broadcasts weatherState to all clients on
 * every change, and answers weatherRequest messages so any player
 * can nudge the weather from the HUD.
 *
 * New joiners are hydrated via sendCurrentWeatherTo(userId), called
 * from the joinRoster handler in server.ts.
 */

import { engine } from '@dcl/sdk/ecs'

import { room } from 'src/shared/messages'

import {
	getPhaseWeatherEnterLevel,
	getPhaseWeatherFloor,
	getPhaseWeatherHeavyBias,
	getPhaseWeatherSpeedMul,
	onPhaseChange,
} from 'src/server/phase'


// MARK: Tuning
// Bounds of the discrete weather level. Mirrors PrecipitationLevel in
// src/client/snowfall.ts (kept as raw ints to avoid a client\u2192server
// import direction that would drag DCL SDK client symbols into the
// server bundle).
const MIN_LEVEL = 0
const MAX_LEVEL = 3

// Boot at LIGHT so first-joiners see a lived-in world.
const INITIAL_LEVEL = 1

// Interval range (seconds) between random weather changes. Random
// within [MIN, MAX] each tick so cadence itself feels organic.
const CHANGE_INTERVAL_MIN_S = 35
const CHANGE_INTERVAL_MAX_S = 75

// Probability that a random transition steps by \u00b11 rather than
// jumping to a fully random level. Higher = smoother weather arcs.
const STEP_TRANSITION_P = 0.75

// Night snaps to HEAVY at sunset, then may step down. weatherFloor
// keeps night from going fully CLEAR. Day has no floor.


// MARK: State
let currentLevel      = INITIAL_LEVEL
let nextChangeAtS     = 0
let clockS            = 0


// MARK: pickNextLevel
/**
 * Choose the next weather level. With STEP_TRANSITION_P probability,
 * step ±1 (clamped to bounds). The up-vs-down roll uses the phase
 * weatherHeavyBias so night drifts toward HEAVY. Otherwise jump to
 * any other level for occasional surprises.
 */
function pickNextLevel(): number {
	const floor = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, getPhaseWeatherFloor()))
	if (Math.random() < STEP_TRANSITION_P) {
		if (currentLevel <= floor) return Math.min(MAX_LEVEL, currentLevel + 1)
		if (currentLevel === MAX_LEVEL) return currentLevel - 1
		return currentLevel + (Math.random() < getPhaseWeatherHeavyBias() ? 1 : -1)
	}
	const span = MAX_LEVEL - floor + 1
	let next  = floor + Math.floor(Math.random() * span)
	if (next === currentLevel) {
		next = currentLevel <= floor
			? Math.min(MAX_LEVEL, currentLevel + 1)
			: currentLevel - 1
	}
	return Math.max(floor, Math.min(MAX_LEVEL, next))
}


// MARK: scheduleNextChange
/** Reset the clock and pick a new random interval to wait. */
function scheduleNextChange(): void {
	clockS = 0
	const span = CHANGE_INTERVAL_MAX_S - CHANGE_INTERVAL_MIN_S
	const raw  = CHANGE_INTERVAL_MIN_S + Math.random() * span
	nextChangeAtS = raw / Math.max(0.25, getPhaseWeatherSpeedMul())
}


// MARK: broadcastWeather
/** Push currentLevel to every connected client. */
function broadcastWeather(): void {
	room.send('weatherState', { level: currentLevel })
}


// MARK: applyLevel
/** Set the weather to `level`, broadcast, and re-schedule the next change. */
function applyLevel(level: number): void {
	const floor   = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, getPhaseWeatherFloor()))
	const clamped = Math.max(floor, Math.min(MAX_LEVEL, level | 0))
	if (clamped === currentLevel) {
		// Even a "no-op" set from a player request should still nudge the
		// timer so the auto-cycler does not immediately overwrite them.
		scheduleNextChange()
		return
	}
	console.log(`[Server] weather: ${currentLevel} \u2192 ${clamped}`)
	currentLevel = clamped
	broadcastWeather()
	scheduleNextChange()
}


// MARK: getCurrentWeatherLevel
/**
 * Read the active precipitation level (0..3). Used by the paint
 * regrowth tick so snow re-buries at the correct cadence.
 */
export function getCurrentWeatherLevel(): number {
	return currentLevel
}


// MARK: sendCurrentWeatherTo
/**
 * Send the current weather level to a specific client. Called from
 * joinRoster so new joiners immediately match the world state.
 */
export function sendCurrentWeatherTo(userId: string): void {
	room.send('weatherState', { level: currentLevel }, { to: [userId] })
}


// MARK: syncWeatherToPhase

/**
 * On dusk/night enter, snap up to weatherEnterLevel (HEAVY) so sunset
 * is immediately a storm. Never sit below weatherFloor.
 */
function syncWeatherToPhase(): void {
	const floor = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, getPhaseWeatherFloor()))
	const enter = getPhaseWeatherEnterLevel()
	let target = currentLevel
	if (enter !== null && currentLevel < enter) target = enter
	if (target < floor) target = floor
	if (target === currentLevel) return
	console.log(`[Server] weather: phase snap ${currentLevel} → ${target}`)
	applyLevel(target)
}


// MARK: setupWeather
/**
 * Boot the server's weather cycle: install the tick system, register
 * the weatherRequest handler, and broadcast the initial state so any
 * client already connected picks it up.
 */
export function setupWeather(): void {
	scheduleNextChange()
	onPhaseChange(syncWeatherToPhase)

	// Player-driven weather changes. Server accepts unconditionally \u2014
	// this is a coop scene, not competitive, so any player can steer.
	room.onMessage('weatherRequest', ({ level }, context) => {
		const from = context?.from ?? 'unknown'
		console.log(`[Server] weatherRequest from ${from}: level=${level}`)
		applyLevel(level)
	})

	// Auto-cycler.
	engine.addSystem((dt: number) => {
		clockS += dt
		if (clockS < nextChangeAtS) return
		applyLevel(pickNextLevel())
	})

	// Broadcast now in case any client was already connected before
	// setupWeather was called during setupServer bootstrap.
	broadcastWeather()

	console.log(`[Server] weather cycle started at level ${currentLevel}`)
}
