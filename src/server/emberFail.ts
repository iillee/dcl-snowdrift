/**
 * emberFail.ts — world-end cards and reseed.
 *
 * No longer started when the last fire goes out. The dev snuff still
 * broadcasts emberFail. So does every player frozen while every fire
 * is dark. A lit fire lets those players wake beside it instead.
 */

import { engine } from '@dcl/sdk/ecs'

import { clampCycleSeed } from 'src/shared/cycleMazeSeed'
import { EMBER_FAIL_REBUILD_DELAY_S } from 'src/shared/emberFail'
import { room } from 'src/shared/messages'

import { rollCycle } from 'src/server/cycle'
import { getMainFireFuel, snuffMainFire } from 'src/server/hearthFuel'
import { isAnyHiddenFireLit, snuffAllHiddenFires } from 'src/server/hiddenCampfire'
import { getDayNumber } from 'src/server/phase'


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
	room.send('emberFail', { days: getDayNumber() }, { to: [userId] })
	console.log(`[Server] emberFail: hydrated fail state to ${userId}`)
}


// MARK: checkEmberFail
/**
 * Start the fail sequence once every fire is already dark. The dev
 * snuff calls this. A fire burning out on its own does not.
 */
export function checkEmberFail(): void {
	if (failing) return
	if (getMainFireFuel() > 0) return
	if (isAnyHiddenFireLit()) return
	beginFail('every fire is dark')
}


// MARK: beginExtinction
/**
 * End the run because every player still in the scene is frozen and
 * no fire is left to wake them.
 */
export function beginExtinction(reason: string): void {
	if (failing) return
	beginFail(reason)
}


// MARK: beginFail
function beginFail(reason: string): void {
	failing      = true
	rebuildClock = EMBER_FAIL_REBUILD_DELAY_S
	const days   = getDayNumber()
	room.send('emberFail', { days })
	console.log(
		`[Server] emberFail: ${reason} on day ${days} — ` +
		`rebuild in ${EMBER_FAIL_REBUILD_DELAY_S.toFixed(1)}s`,
	)
}


// MARK: finishFail
function finishFail(): void {
	const nextSeed = clampCycleSeed(Date.now() ^ 0xA5A5A5A5)
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
