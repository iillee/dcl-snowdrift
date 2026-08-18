/**
 * weather.ts — server-authoritative precipitation for Snow Drift.
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


// MARK: State
let currentLevel      = INITIAL_LEVEL
let nextChangeAtS     = 0
let clockS            = 0


// MARK: pickNextLevel
/**
 * Choose the next weather level. With STEP_TRANSITION_P probability,
 * step \u00b11 (clamped to bounds) so intensity moves gradually. Otherwise
 * jump to any level except the current one for occasional surprises.
 */
function pickNextLevel(): number {
	if (Math.random() < STEP_TRANSITION_P) {
		// \u00b11 step. When at a bound, we must step the only direction that
		// stays in-range.
		if (currentLevel === MIN_LEVEL) return currentLevel + 1
		if (currentLevel === MAX_LEVEL) return currentLevel - 1
		return currentLevel + (Math.random() < 0.5 ? -1 : 1)
	}
	// Full-random jump excluding the current level.
	let next = Math.floor(Math.random() * (MAX_LEVEL - MIN_LEVEL))
	if (next >= currentLevel) next++
	return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, next))
}


// MARK: scheduleNextChange
/** Reset the clock and pick a new random interval to wait. */
function scheduleNextChange(): void {
	clockS = 0
	nextChangeAtS = CHANGE_INTERVAL_MIN_S +
		Math.random() * (CHANGE_INTERVAL_MAX_S - CHANGE_INTERVAL_MIN_S)
}


// MARK: broadcastWeather
/** Push currentLevel to every connected client. */
function broadcastWeather(): void {
	room.send('weatherState', { level: currentLevel })
}


// MARK: applyLevel
/** Set the weather to `level`, broadcast, and re-schedule the next change. */
function applyLevel(level: number): void {
	const clamped = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, level | 0))
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


// MARK: sendCurrentWeatherTo
/**
 * Send the current weather level to a specific client. Called from
 * joinRoster so new joiners immediately match the world state.
 */
export function sendCurrentWeatherTo(userId: string): void {
	room.send('weatherState', { level: currentLevel }, { to: [userId] })
}


// MARK: setupWeather
/**
 * Boot the server's weather cycle: install the tick system, register
 * the weatherRequest handler, and broadcast the initial state so any
 * client already connected picks it up.
 */
export function setupWeather(): void {
	scheduleNextChange()

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
