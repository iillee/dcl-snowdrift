/**
 * phase.ts — client mirror of the server's day/night clock.
 *
 * Receives `phaseState` (join, transition, 15 s heartbeat) and exposes
 * the current phase, remaining time, live PhaseConfig, and skybox
 * seconds. Sky writes live in skybox.ts.
 */

import { engine } from '@dcl/sdk/ecs'

import { room } from 'src/shared/messages'
import {
	DAILY_PHASES,
	SKY_07,
	PhaseConfig,
	dailyPhaseAt,
	formatPhaseCountdown,
	nextDailyIndex,
	phaseRemainingSec,
	phaseSkyboxSeconds,
} from 'src/shared/phase'

import { beginDaySplash } from 'src/client/daySplash'


// MARK: State
let phaseName        = ''
let phaseIndex       = 0
let phaseStartedAtMs = 0
let phaseDurationSec = 0
let cycleId          = 0
let hydrated         = false
let installed        = false


// MARK: isPhaseHydrated

/** True once the first server phaseState has arrived. */
export function isPhaseHydrated(): boolean {
	return hydrated
}


// MARK: getPhaseName

/** Current phase name, or empty string before hydration. */
export function getPhaseName(): string {
	return phaseName
}


// MARK: getPhaseRemainingSec

/** Seconds left in the current phase. 0 before hydration. */
export function getPhaseRemainingSec(): number {
	if (!hydrated) return 0
	return phaseRemainingSec(phaseStartedAtMs, phaseDurationSec)
}


// MARK: getPhaseLabel

/** HUD string: `DAY  3:42`. Empty before hydration. */
export function getPhaseLabel(): string {
	if (!hydrated) return ''
	return `${phaseName}  ${formatPhaseCountdown(getPhaseRemainingSec())}`
}


// MARK: getLivePhaseConfig

/**
 * Active phase row with the live duration from the server snapshot.
 * Seasons can later send a longer night; freeze math uses this
 * duration, not the table default.
 */
export function getLivePhaseConfig(): PhaseConfig {
	const row = dailyPhaseAt(hydrated ? phaseIndex : 0)
	if (!hydrated) return row
	return { ...row, durationSec: phaseDurationSec }
}


// MARK: getPhaseDurationSec

/** Live phase length in seconds. Table default before hydration. */
export function getPhaseDurationSec(): number {
	return getLivePhaseConfig().durationSec
}


// MARK: getPhaseCycleId

/** Full day-wrap counter from the server. */
export function getPhaseCycleId(): number {
	return cycleId
}


// MARK: getDayNumber

/** 1-based day of this run. Day 1 at first dawn; increments each sunrise. */
export function getDayNumber(): number {
	return cycleId + 1
}


// MARK: getPhaseSkyboxSeconds

/**
 * Skybox seconds (0..86400) for the current phase progress.
 * Before hydration, returns 07:00 so the lock has a stable park.
 */
export function getPhaseSkyboxSeconds(): number {
	if (!hydrated) return SKY_07
	const cfg = dailyPhaseAt(phaseIndex)
	return phaseSkyboxSeconds(
		cfg.skyFrom,
		cfg.skyTo,
		phaseStartedAtMs,
		phaseDurationSec,
	)
}


// MARK: applyPhaseState

function applyPhaseState(msg: {
	phaseName       : string
	phaseIndex      : number
	phaseAgeSec     : number
	phaseDurationSec: number
	cycleId         : number
}): void {
	const first     = !hydrated
	const prevName  = phaseName
	const prevCycle = cycleId
	const changed   = phaseName !== msg.phaseName || phaseIndex !== msg.phaseIndex
	phaseName        = msg.phaseName
	phaseIndex       = msg.phaseIndex
	phaseDurationSec = msg.phaseDurationSec
	phaseStartedAtMs = Date.now() - Math.max(0, msg.phaseAgeSec) * 1000
	cycleId          = msg.cycleId
	hydrated         = true
	if (first || changed) {
		console.log(
			`phase: applyPhaseState: ${phaseName} remaining=` +
			`${formatPhaseCountdown(getPhaseRemainingSec())} cycleId=${cycleId}` +
			`${first ? ' (hydration)' : ''}`
		)
	}
	// A cycleId drop is a new run (ember-fail / 24 h roll), not a sunrise.
	if (!first && changed && msg.cycleId >= prevCycle) maybeAnnounceDawn(prevName)
}


// MARK: catchUpLocal

/**
 * If the last server snapshot is already past its duration, step to
 * the next table row locally so the HUD and sun do not freeze waiting
 * for the next packet.
 */
function catchUpLocal(): void {
	if (!hydrated) return
	const prevName = phaseName
	let stepped = 0
	while (stepped < DAILY_PHASES.length + 1) {
		const durMs = Math.max(1, phaseDurationSec) * 1000
		if (Date.now() - phaseStartedAtMs < durMs) break
		phaseStartedAtMs += durMs
		phaseIndex       = nextDailyIndex(phaseIndex)
		const cfg        = dailyPhaseAt(phaseIndex)
		phaseName        = cfg.name
		phaseDurationSec = cfg.durationSec
		if (phaseIndex === 0) cycleId++
		stepped++
	}
	if (stepped > 0) {
		console.log(
			`phase: catchUpLocal: now ${phaseName} remaining=` +
			`${formatPhaseCountdown(getPhaseRemainingSec())}`
		)
		maybeAnnounceDawn(prevName)
	}
}


// MARK: maybeAnnounceDawn

/** Sunrise title once per wrap into DAY. Skip the join-hydration snapshot. */
function maybeAnnounceDawn(prevName: string): void {
	if (prevName === 'DAY') return
	if (phaseName !== 'DAY') return
	beginDaySplash(getDayNumber())
}


// MARK: setupPhaseClient

/**
 * Subscribe to phaseState. Must run before initClientHandler so the
 * joinRoster hydration packet is not missed.
 */
export function setupPhaseClient(): void {
	if (installed) {
		console.log('phase: setupPhaseClient: already installed, skipping')
		return
	}
	installed = true
	room.onMessage('phaseState', (msg) => {
		applyPhaseState(msg)
	})
	engine.addSystem(() => {
		catchUpLocal()
	})
	console.log('phase: setupPhaseClient: listening for phaseState')
}
