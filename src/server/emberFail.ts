/**
 * emberFail.ts — last-fire-out is game over.
 *
 * When the spawn hearth and every hidden fire are dark, broadcast
 * emberFail, hold so clients can fade to black, then roll the world
 * onto a new seed. The spawn hearth is reset by hearthFuel's
 * onCycleRoll handler during that roll.
 */

import { engine } from '@dcl/sdk/ecs'

import { EMBER_FAIL_REBUILD_DELAY_S } from 'src/shared/emberFail'
import { room } from 'src/shared/messages'

import { rollCycle } from 'src/server/cycle'
import { getMainFireFuel, snuffMainFire } from 'src/server/hearthFuel'
import { isAnyHiddenFireLit, snuffAllHiddenFires } from 'src/server/hiddenCampfire'
import { getNightsThisRun } from 'src/server/phase'


let failing       = false
let rebuildClock  = 0
let installed     = false


// MARK: isEmberFailing
/** True while the fail cinematic is running (feeds are rejected). */
export function isEmberFailing(): boolean {
	return failing
}


// MARK: sendEmberFailTo
/** Hydrate a late joiner who arrived during the blackout. */
export function sendEmberFailTo(userId: string): void {
	if (!failing) return
	room.send('emberFail', { nights: getNightsThisRun() }, { to: [userId] })
	console.log(`[Server] emberFail: hydrated fail state to ${userId}`)
}


// MARK: checkEmberFail
/**
 * Call after any fire snuffs. Starts the fail sequence once, the
 * moment no fire in the world still has fuel.
 */
export function checkEmberFail(): void {
	if (failing) return
	if (getMainFireFuel() > 0) return
	if (isAnyHiddenFireLit()) return
	beginFail()
}


// MARK: beginFail
function beginFail(): void {
	failing      = true
	rebuildClock = EMBER_FAIL_REBUILD_DELAY_S
	const nights = getNightsThisRun()
	room.send('emberFail', { nights })
	console.log(
		`[Server] emberFail: last fire out after ${nights} night(s) — ` +
		`rebuild in ${EMBER_FAIL_REBUILD_DELAY_S.toFixed(1)}s`,
	)
}


// MARK: finishFail
function finishFail(): void {
	const nextSeed = ((Date.now() ^ 0xA5A5A5A5) >>> 0) || 1
	console.log(`[Server] emberFail: reseeding world seed=${nextSeed}`)
	rollCycle({ newSeed: nextSeed })
	failing      = false
	rebuildClock = 0
}


// MARK: setupEmberFailServer
/**
 * Start the rebuild timer and the dev snuff handler. Idempotent —
 * call once from setupServer after hearth + hidden fires are live.
 */
export function setupEmberFailServer(): void {
	if (installed) {
		console.log('[Server] emberFail: setupEmberFailServer already installed, skipping')
		return
	}
	installed = true

	engine.addSystem((dt: number) => {
		if (!failing) return
		rebuildClock -= dt
		if (rebuildClock > 0) return
		finishFail()
	})

	room.onMessage('devSnuffFires', (_payload, context) => {
		const from = context?.from ?? 'unknown'
		console.log(`[Server] emberFail: devSnuffFires from ${from}`)
		snuffAllHiddenFires()
		snuffMainFire()
		checkEmberFail()
	})

	console.log('[Server] emberFail: installed')
}
