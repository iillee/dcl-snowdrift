/**
 * daySplash.ts — "Day X" title card at each sunrise.
 *
 * Driven by phase.ts when the clock wraps into DAY. Join hydration
 * does not splash. Ember-fail owns the screen, so we skip there.
 */

import { engine } from '@dcl/sdk/ecs'

import { isEmberFailing } from 'src/client/emberFail'


// MARK: Timing
const FADE_S = 0.7
const HOLD_S = 2.2


// MARK: FSM
enum Phase {
	IDLE     = 0,
	FADE_IN  = 1,
	HOLD     = 2,
	FADE_OUT = 3,
}

let phase      = Phase.IDLE
let phaseTimer = 0
let opacity    = 0
let dayNumber  = 1
let installed  = false


// MARK: getDaySplashOpacity

/** 0..1 title alpha. Idle is 0 so the layer can hide. */
export function getDaySplashOpacity(): number {
	return opacity
}


// MARK: getDaySplashText

/** Current sunrise line, or empty when hidden. */
export function getDaySplashText(): string {
	if (phase === Phase.IDLE) return ''
	return `Day ${dayNumber}`
}


// MARK: beginDaySplash

/**
 * Play the sunrise card for `day`. Restarts if a splash is already up.
 * No-op during ember-fail so game-over cards stay alone on black.
 */
export function beginDaySplash(day: number): void {
	if (isEmberFailing()) {
		console.log(`daySplash: beginDaySplash: skip day ${day}, ember-fail owns the screen`)
		return
	}
	dayNumber  = day < 1 ? 1 : day
	phase      = Phase.FADE_IN
	phaseTimer = 0
	opacity    = 0
	console.log(`daySplash: beginDaySplash: Day ${dayNumber}`)
}


// MARK: setupDaySplash

/** Register the splash ticker. Idempotent — call once from setupClient. */
export function setupDaySplash(): void {
	if (installed) {
		console.log('daySplash: setupDaySplash: already installed, skipping')
		return
	}
	installed = true

	engine.addSystem((dt: number) => {
		if (phase === Phase.IDLE) return
		if (isEmberFailing()) {
			phase      = Phase.IDLE
			phaseTimer = 0
			opacity    = 0
			return
		}
		phaseTimer += dt

		if (phase === Phase.FADE_IN) {
			opacity = Math.min(1, phaseTimer / FADE_S)
			if (phaseTimer < FADE_S) return
			phase      = Phase.HOLD
			phaseTimer = 0
			opacity    = 1
			return
		}

		if (phase === Phase.HOLD) {
			opacity = 1
			if (phaseTimer < HOLD_S) return
			phase      = Phase.FADE_OUT
			phaseTimer = 0
			return
		}

		if (phase === Phase.FADE_OUT) {
			opacity = Math.max(0, 1 - phaseTimer / FADE_S)
			if (phaseTimer < FADE_S) return
			phase      = Phase.IDLE
			phaseTimer = 0
			opacity    = 0
		}
	})

	console.log('daySplash: setupDaySplash: installed')
}
