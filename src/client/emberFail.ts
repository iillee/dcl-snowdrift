/**
 * emberFail.ts — client game-over cards when the last fire dies.
 *
 * Black first, then three title cards (flame out → centuries →
 * civilization). The last line and load bar fade out with the black.
 */

import { InputModifier, engine } from '@dcl/sdk/ecs'

import {
	EMBER_FAIL_FADE_IN_S,
	EMBER_FAIL_FADE_OUT_S,
	EMBER_FAIL_LINE_FADE_S,
	EMBER_FAIL_LINE_HOLD_S,
	emberFailLine1,
	emberFailLine2,
	emberFailLine3,
} from 'src/shared/emberFail'
import { room } from 'src/shared/messages'

import { onCycleSeedChange } from 'src/client/cycle'
import { arePerimeterModelsReady, hasPerimeterSpawned } from 'src/client/perimeter'
import { isSnowRebuilding } from 'src/client/snow/snowRenderer'
import { isTopDownActive, toggleTopDownCamera } from 'src/client/topDownCamera'


// MARK: FSM
enum Phase {
	IDLE       = 0,
	FADE_OUT   = 1,
	LINE1_IN   = 2,
	LINE1_HOLD = 3,
	LINE1_OUT  = 4,
	LINE2_IN   = 5,
	LINE2_HOLD = 6,
	LINE2_OUT  = 7,
	LINE3_IN   = 8,
	LINE3_HOLD = 9,
	WORLD_IN   = 10,
}

let phase        = Phase.IDLE
let phaseTimer   = 0
let worldOpacity = 0
let textOpacity  = 0
let nightsLived     = 0
let rebuilt         = false
let sawRebuildPass  = false
let installed       = false

/** If the snow pass never flags, do not pin the cards forever. */
const READY_FALLBACK_S = 48


// MARK: getEmberFailWorldOpacity
/** 0..1 black overlay. Idle is 0 so the layer can hide. */
export function getEmberFailWorldOpacity(): number {
	return worldOpacity
}


// MARK: getEmberFailTextOpacity
/** 0..1 title-card alpha. */
export function getEmberFailTextOpacity(): number {
	return textOpacity
}


// MARK: getEmberFailText
/** Current title card, or empty when nothing should draw. */
export function getEmberFailText(): string {
	if (phase >= Phase.LINE1_IN && phase <= Phase.LINE1_OUT) {
		return emberFailLine1(nightsLived)
	}
	if (phase >= Phase.LINE2_IN && phase <= Phase.LINE2_OUT) {
		return emberFailLine2()
	}
	if (phase >= Phase.LINE3_IN && phase <= Phase.WORLD_IN) {
		return emberFailLine3()
	}
	return ''
}


// MARK: isEmberFailing
/** True while the fail cinematic owns the screen. */
export function isEmberFailing(): boolean {
	return phase !== Phase.IDLE
}


// MARK: isNewWorldReady

/** Seed landed, snow full-pass finished, cliffs loaded. */
function isNewWorldReady(): boolean {
	if (!rebuilt) return false
	if (!sawRebuildPass) return false
	if (isSnowRebuilding()) return false
	if (!hasPerimeterSpawned()) return false
	if (!arePerimeterModelsReady()) return false
	return true
}


// MARK: finishFail

function finishFail(): void {
	worldOpacity   = 0
	textOpacity    = 0
	phase          = Phase.IDLE
	phaseTimer     = 0
	rebuilt        = false
	sawRebuildPass = false
	unlockPlayer()
	console.log('emberFail: cards complete — new civilization')
}


// MARK: lockPlayer
function lockPlayer(): void {
	InputModifier.createOrReplace(engine.PlayerEntity, {
		mode: InputModifier.Mode.Standard({
			disableAll: true,
		}),
	})
}


// MARK: unlockPlayer
function unlockPlayer(): void {
	if (InputModifier.has(engine.PlayerEntity)) {
		InputModifier.deleteFrom(engine.PlayerEntity)
	}
}


// MARK: beginFail
function beginFail(nights: number): void {
	if (phase !== Phase.IDLE) return
	console.log(`emberFail: beginFail: last fire out after ${nights} night(s)`)
	if (isTopDownActive()) toggleTopDownCamera()
	phase        = Phase.FADE_OUT
	phaseTimer   = 0
	worldOpacity = 0
	textOpacity  = 0
	nightsLived    = nights
	rebuilt        = false
	sawRebuildPass = false
	lockPlayer()
}


// MARK: setupEmberFailClient
/**
 * Subscribe to emberFail + cycle seed changes. Call once from
 * setupClient before initClientHandler so a late-join hydrate lands.
 */
export function setupEmberFailClient(): void {
	if (installed) {
		console.log('emberFail: setupEmberFailClient: already installed, skipping')
		return
	}
	installed = true

	room.onMessage('emberFail', ({ nights }) => {
		beginFail(nights)
	})

	onCycleSeedChange(() => {
		if (phase === Phase.IDLE) return
		rebuilt = true
		console.log('emberFail: new seed arrived during fail cinematic')
	})

	engine.addSystem((dt: number) => {
		if (phase === Phase.IDLE) return
		if (rebuilt && isSnowRebuilding()) sawRebuildPass = true
		phaseTimer += dt

		if (phase === Phase.FADE_OUT) {
			worldOpacity = Math.min(1, phaseTimer / EMBER_FAIL_FADE_OUT_S)
			textOpacity  = 0
			if (phaseTimer < EMBER_FAIL_FADE_OUT_S) return
			phase        = Phase.LINE1_IN
			phaseTimer   = 0
			worldOpacity = 1
			return
		}

		if (phase === Phase.LINE1_IN) {
			textOpacity = Math.min(1, phaseTimer / EMBER_FAIL_LINE_FADE_S)
			if (phaseTimer < EMBER_FAIL_LINE_FADE_S) return
			phase       = Phase.LINE1_HOLD
			phaseTimer  = 0
			textOpacity = 1
			return
		}

		if (phase === Phase.LINE1_HOLD) {
			if (phaseTimer < EMBER_FAIL_LINE_HOLD_S) return
			phase      = Phase.LINE1_OUT
			phaseTimer = 0
			return
		}

		if (phase === Phase.LINE1_OUT) {
			textOpacity = Math.max(0, 1 - phaseTimer / EMBER_FAIL_LINE_FADE_S)
			if (phaseTimer < EMBER_FAIL_LINE_FADE_S) return
			phase       = Phase.LINE2_IN
			phaseTimer  = 0
			textOpacity = 0
			return
		}

		if (phase === Phase.LINE2_IN) {
			textOpacity = Math.min(1, phaseTimer / EMBER_FAIL_LINE_FADE_S)
			if (phaseTimer < EMBER_FAIL_LINE_FADE_S) return
			phase       = Phase.LINE2_HOLD
			phaseTimer  = 0
			textOpacity = 1
			return
		}

		if (phase === Phase.LINE2_HOLD) {
			if (phaseTimer < EMBER_FAIL_LINE_HOLD_S) return
			phase      = Phase.LINE2_OUT
			phaseTimer = 0
			return
		}

		if (phase === Phase.LINE2_OUT) {
			textOpacity = Math.max(0, 1 - phaseTimer / EMBER_FAIL_LINE_FADE_S)
			if (phaseTimer < EMBER_FAIL_LINE_FADE_S) return
			phase       = Phase.LINE3_IN
			phaseTimer  = 0
			textOpacity = 0
			return
		}

		if (phase === Phase.LINE3_IN) {
			textOpacity = Math.min(1, phaseTimer / EMBER_FAIL_LINE_FADE_S)
			if (phaseTimer < EMBER_FAIL_LINE_FADE_S) return
			phase       = Phase.LINE3_HOLD
			phaseTimer  = 0
			textOpacity = 1
			return
		}

		if (phase === Phase.LINE3_HOLD) {
			textOpacity = 1
			if (phaseTimer < EMBER_FAIL_LINE_HOLD_S) return
			const ready    = isNewWorldReady()
			const fallback = rebuilt && phaseTimer >= EMBER_FAIL_LINE_HOLD_S + READY_FALLBACK_S
			if (!ready && !fallback) return
			if (fallback && !ready) {
				console.log('emberFail: LINE3_HOLD: load wait timed out, fading in')
			}
			phase      = Phase.WORLD_IN
			phaseTimer = 0
			return
		}

		if (phase === Phase.WORLD_IN) {
			const fade = Math.max(0, 1 - phaseTimer / EMBER_FAIL_FADE_IN_S)
			worldOpacity = fade
			textOpacity  = fade
			if (phaseTimer < EMBER_FAIL_FADE_IN_S) return
			finishFail()
		}
	})

	console.log('emberFail: setupEmberFailClient: installed')
}
