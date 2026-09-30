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
	SKY_0620,
	PhaseConfig,
	dailyPhaseAt,
	formatPhaseCountdown,
	nextDailyIndex,
	phaseRemainingSec,
	phaseSkyboxSeconds,
} from 'src/shared/phase'

import { beginDaySplash } from 'src/client/daySplash'
import { isWorldCovered } from 'src/client/ui/layers/layer.loadingSplash'


// MARK: State
let phaseName        = ''
let phaseIndex       = 0
let phaseStartedAtMs = 0
let phaseDurationSec = 0
let cycleId          = 0
let hydrated         = false
let installed        = false
let serverPhaseSeen  = false
/** Sunrise card still owed. Held while a cover hides the screen. */
let dawnSplashArmed  = false
/** False for the boot placeholder until the server confirms this dawn. */
let dawnSplashLive   = false


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
 * Before hydration, returns 06:20 so the lock parks just before sunrise.
 */
export function getPhaseSkyboxSeconds(): number {
	if (!hydrated) return SKY_0620
	// Follow the HUD name, not just the index, so a stale index cannot
	// run the sun through the wrong sky range (that reads as speedup).
	const byName = DAILY_PHASES.find((row) => row.name === phaseName)
	const cfg    = byName ?? dailyPhaseAt(phaseIndex)
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
	if (hydrated && msg.cycleId === cycleId) {
		// Same run, older row: a parked/join DAWN packet after
		// catchUpLocal already stepped to DAY. Applying it freezes
		// the sun at 06:20 and the HUD on DAWN.
		if (msg.phaseIndex < phaseIndex) {
			console.log(
				`phase: applyPhaseState: ignore rewind ${msg.phaseName} idx=${msg.phaseIndex} ` +
				`(local ${phaseName} idx=${phaseIndex})`
			)
			return
		}
		// Same row, older age: joinRoster retries send age=0 and
		// pin the rise at its first frame.
		if (msg.phaseIndex === phaseIndex) {
			const incomingStarted = Date.now() - Math.max(0, msg.phaseAgeSec) * 1000
			if (incomingStarted > phaseStartedAtMs + 400) {
				return
			}
		}
	}
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
	// Boot parks the clock on DAWN before the server speaks. The first
	// snapshot is the world's real day: Day 1 for the player who
	// starts the sunrise, or whatever day is already underway for
	// everyone who joins later.
	const opening = !serverPhaseSeen
	serverPhaseSeen = true
	if (opening) {
		dawnSplashArmed = true
		dawnSplashLive  = true
	}
	// A cycleId drop is a new run (ember-fail / world roll). The
	// clock starts at DAWN; the title waits until that cover lifts.
	if (!opening && msg.cycleId < prevCycle) {
		console.log(
			`phase: applyPhaseState: new run cycleId ${prevCycle} -> ${cycleId}, ` +
			`${phaseName} remaining=${formatPhaseCountdown(getPhaseRemainingSec())}`
		)
		if (phaseName === 'DAWN') {
			dawnSplashArmed = true
			dawnSplashLive  = true
		}
	} else if (!opening && changed && msg.cycleId >= prevCycle) {
		maybeAnnounceDawn(prevName)
	}
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

/** Arm the sunrise title once per wrap into DAWN. */
function maybeAnnounceDawn(prevName: string): void {
	if (prevName === 'DAWN') return
	if (phaseName !== 'DAWN') return
	dawnSplashArmed = true
	dawnSplashLive  = true
}


// MARK: tryDawnSplash

/**
 * Play the armed day card once the world is visible. Join shows
 * the world's current day. Later sunrises show the new number.
 */
function tryDawnSplash(): void {
	if (!dawnSplashArmed || !dawnSplashLive) return
	if (isWorldCovered()) return
	dawnSplashArmed = false
	dawnSplashLive  = false
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
	// Run the rise locally even if the first phaseState is late or
	// the server is still parked. A later snapshot overwrites this.
	resetPhaseToDawn('boot')
	room.onMessage('phaseState', (msg) => {
		applyPhaseState(msg)
	})
	engine.addSystem(() => {
		catchUpLocal()
		tryDawnSplash()
	})
	console.log('phase: setupPhaseClient: listening for phaseState')
}


// MARK: resetPhaseToDawn
/**
 * Jump the local clock to the start of DAWN. Used on world reset so
 * the HUD and skybox do not wait for the next phaseState packet.
 * Server resetToDay is still authoritative and will overwrite this.
 */
export function resetPhaseToDawn(reason: string): void {
	const cfg        = dailyPhaseAt(0)
	phaseName        = cfg.name
	phaseIndex       = 0
	phaseDurationSec = cfg.durationSec
	phaseStartedAtMs = Date.now()
	cycleId          = 0
	hydrated         = true
	dawnSplashArmed  = true
	// Boot is a placeholder until the server snapshot. A cycle roll
	// is already the new run's sunrise.
	dawnSplashLive   = reason !== 'boot'
	console.log(`phase: resetPhaseToDawn: ${cfg.name} ${cfg.durationSec}s (${reason})`)
}
