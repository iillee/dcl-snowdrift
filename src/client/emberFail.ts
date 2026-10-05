/**
 * emberFail.ts — client game-over cards when the last fire dies.
 *
 * Black first, then three title cards (the flame goes out → centuries
 * → a new hearth), with a beat of black between them. The last card
 * fades out with the black. Dawn has already started under the cards.
 */

import { InputModifier, engine } from '@dcl/sdk/ecs'

import {
	EMBER_FAIL_FADE_IN_S,
	EMBER_FAIL_FADE_OUT_S,
	EMBER_FAIL_GAP_1_S,
	EMBER_FAIL_GAP_2_S,
	EMBER_FAIL_LINE_FADE_S,
	EMBER_FAIL_LINE_HOLD_S,
	emberFailLine1,
	emberFailLine2,
	emberFailLine3,
} from 'src/shared/emberFail'
import { room } from 'src/shared/messages'

import { onCycleSeedChange } from 'src/client/cycle'
import { getTerrainGeneration, hasTerrainSpawned, isTerrainReady } from 'src/client/terrain/terrainRenderer'
import { isSnowRebuilding, snowRenderStats } from 'src/client/snow/snowRenderer'
import { isTopDownActive, toggleTopDownCamera } from 'src/client/topDownCamera'


// MARK: FSM
enum Phase {
	IDLE       = 0,
	FADE_OUT   = 1,
	LINE1_IN   = 2,
	LINE1_HOLD = 3,
	LINE1_OUT  = 4,
	LINE1_GAP  = 5,
	LINE2_IN   = 6,
	LINE2_HOLD = 7,
	LINE2_OUT  = 8,
	LINE2_GAP  = 9,
	LINE3_IN   = 10,
	LINE3_HOLD = 11,
	WORLD_IN   = 12,
}

let phase        = Phase.IDLE
let phaseTimer   = 0
let worldOpacity = 0
let textOpacity  = 0
let daysLived       = 0
let rebuilt         = false
let terrainGenAtFail  = 0
let installed       = false

/** If the new world never reports ready, do not pin the cards forever. */
const READY_FALLBACK_S = 15


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
		return emberFailLine1(daysLived)
	}
	if (phase >= Phase.LINE2_IN && phase <= Phase.LINE2_OUT) {
		return emberFailLine2()
	}
	if (phase >= Phase.LINE3_IN && phase <= Phase.WORLD_IN) {
		return emberFailLine3()
	}
	return ''
}


// MARK: getEmberFailPhaseName

/** Current fail-cinematic step, e.g. "LINE2_HOLD". "IDLE" when not failing. */
export function getEmberFailPhaseName(): string {
	return Phase[phase]
}


// MARK: isEmberFailing
/** True while the fail cinematic owns the screen. */
export function isEmberFailing(): boolean {
	return phase !== Phase.IDLE
}


// MARK: isNewWorldReady

/**
 * Seed landed, the new cliff ring spawned and loaded, and no snow roots
 * are left to draw. The snow pass often finishes inside one frame, so
 * readiness is read from state, never from having seen it in progress.
 */
function isNewWorldReady(): boolean {
	if (!rebuilt) return false
	if (getTerrainGeneration() <= terrainGenAtFail) return false
	if (!hasTerrainSpawned()) return false
	if (!isTerrainReady()) return false
	if (isSnowRebuilding()) return false
	if (snowRenderStats().pendingRoots > 0) return false
	return true
}


// MARK: finishFail

function finishFail(): void {
	worldOpacity   = 0
	textOpacity    = 0
	phase          = Phase.IDLE
	phaseTimer     = 0
	rebuilt        = false
	unlockPlayer()
	console.log('emberFail: cards complete — new fire')
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
function beginFail(days: number): void {
	if (phase !== Phase.IDLE) return
	console.log(`emberFail: beginFail: last fire out on day ${days}`)
	if (isTopDownActive()) toggleTopDownCamera()
	phase        = Phase.FADE_OUT
	phaseTimer   = 0
	worldOpacity = 0
	textOpacity  = 0
	daysLived      = days
	rebuilt        = false
	terrainGenAtFail = getTerrainGeneration()
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

	room.onMessage('emberFail', ({ days }) => {
		beginFail(days)
	})

	onCycleSeedChange(() => {
		if (phase === Phase.IDLE) return
		rebuilt = true
		console.log('emberFail: new seed arrived during fail cinematic')
	})

	engine.addSystem((dt: number) => {
		if (phase === Phase.IDLE) return
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
			phase       = Phase.LINE1_GAP
			phaseTimer  = 0
			textOpacity = 0
			return
		}

		if (phase === Phase.LINE1_GAP) {
			textOpacity = 0
			if (phaseTimer < EMBER_FAIL_GAP_1_S) return
			phase      = Phase.LINE2_IN
			phaseTimer = 0
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
			phase       = Phase.LINE2_GAP
			phaseTimer  = 0
			textOpacity = 0
			return
		}

		if (phase === Phase.LINE2_GAP) {
			textOpacity = 0
			if (phaseTimer < EMBER_FAIL_GAP_2_S) return
			phase      = Phase.LINE3_IN
			phaseTimer = 0
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
			const ready    = isNewWorldReady()
			const fallback = rebuilt && phaseTimer >= READY_FALLBACK_S
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
