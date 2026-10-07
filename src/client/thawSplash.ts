/**
 * thawSplash.ts — "WORLD THAWED" title when all three stations fire.
 *
 * Same fade/hold card pattern as daySplash. Driven by worldThaw.ts on
 * the server broadcast (and late-join hydrate). Ember-fail owns the
 * screen, so we skip there.
 */

import { engine } from '@dcl/sdk/ecs'

import { isEmberFailing } from 'src/client/emberFail'


const FADE_S = 0.8
const HOLD_S = 3.0
const TITLE  = 'WORLD THAWED'

enum Phase {
	IDLE     = 0,
	FADE_IN  = 1,
	HOLD     = 2,
	FADE_OUT = 3,
}

let phase      = Phase.IDLE
let phaseTimer = 0
let opacity    = 0
let installed  = false


export function getThawSplashOpacity(): number {
	return opacity
}

export function getThawSplashText(): string {
	if (phase === Phase.IDLE) return ''
	return TITLE
}

/** Play the victory card. Idempotent while already showing. */
export function beginThawSplash(): void {
	if (isEmberFailing()) {
		console.log('thawSplash: beginThawSplash: skip, ember-fail owns the screen')
		return
	}
	if (phase !== Phase.IDLE) {
		console.log('thawSplash: beginThawSplash: already showing')
		return
	}
	phase      = Phase.FADE_IN
	phaseTimer = 0
	opacity    = 0
	console.log('thawSplash: beginThawSplash: WORLD THAWED')
}

export function setupThawSplash(): void {
	if (installed) return
	installed = true
	engine.addSystem((dt: number) => {
		if (phase === Phase.IDLE) return
		if (isEmberFailing()) {
			phase = Phase.IDLE
			phaseTimer = 0
			opacity = 0
			return
		}
		phaseTimer += dt
		if (phase === Phase.FADE_IN) {
			opacity = Math.min(1, phaseTimer / FADE_S)
			if (phaseTimer < FADE_S) return
			phase = Phase.HOLD
			phaseTimer = 0
			opacity = 1
			return
		}
		if (phase === Phase.HOLD) {
			opacity = 1
			if (phaseTimer < HOLD_S) return
			phase = Phase.FADE_OUT
			phaseTimer = 0
			return
		}
		if (phase === Phase.FADE_OUT) {
			opacity = Math.max(0, 1 - phaseTimer / FADE_S)
			if (phaseTimer < FADE_S) return
			phase = Phase.IDLE
			phaseTimer = 0
			opacity = 0
		}
	})
	console.log('thawSplash: setupThawSplash: installed')
}
