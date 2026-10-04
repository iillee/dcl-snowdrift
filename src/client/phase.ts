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
/** Day number the armed card should show. */
let dawnSplashDay    = 0
/**
 * True when this card is a sunrise (wait for DAWN). False for a mid-day
 * join that should show as soon as the cover lifts.
 */
let dawnSplashSunrise = false
/** Bumps once per world reset so a new Day 1 is not the boot Day 1. */
let dawnRun          = 0
/** Wall time of the last bump. The phase packet and the local dawn land together. */
let dawnRunAtMs      = 0
/** Day number already played for the current dawnRun. */
let splashShownDay   = -1
/** Run id whose sunrise card has already started for splashShownDay. */
let splashShownRun   = -1
/** Throttle "waiting on cover" logs so catch-up does not flood. */
let coverWaitLogAtMs = 0
/** Throttle "waiting for DAWN" logs. */
let dawnWaitLogAtMs  = 0


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
		// Mid-day join shows immediately once the cover lifts. A join
		// that lands in DAWN waits for that stage like a normal sunrise.
		requestDawnSplash(true, phaseName === 'DAWN')
	} else if (msg.cycleId < prevCycle) {
		// World reset (ember-fail / cycle roll) — fresh Day 1.
		console.log(
			`phase: applyPhaseState: new run cycleId ${prevCycle} -> ${cycleId}, ` +
			`${phaseName} remaining=${formatPhaseCountdown(getPhaseRemainingSec())}`
		)
		noteDawnRun()
		requestDawnSplash(true, true)
	} else if (msg.cycleId > prevCycle) {
		// Sunrise wrap. Server may land on DAY if DAWN was stepped in
		// the same tick — still arm so Day 2+ is not skipped.
		console.log(
			`phase: applyPhaseState: sunrise cycleId ${prevCycle} -> ${cycleId}, ` +
			`now ${phaseName}`
		)
		requestDawnSplash(true, true)
	} else if (changed) {
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
	const prevName  = phaseName
	const prevCycle = cycleId
	let stepped = 0
	let sawDawn = false
	while (stepped < DAILY_PHASES.length + 1) {
		const durMs = Math.max(1, phaseDurationSec) * 1000
		if (Date.now() - phaseStartedAtMs < durMs) break
		phaseStartedAtMs += durMs
		phaseIndex       = nextDailyIndex(phaseIndex)
		const cfg        = dailyPhaseAt(phaseIndex)
		phaseName        = cfg.name
		phaseDurationSec = cfg.durationSec
		if (phaseName === 'DAWN') sawDawn = true
		if (phaseIndex === 0) cycleId++
		stepped++
	}
	if (stepped > 0) {
		console.log(
			`phase: catchUpLocal: now ${phaseName} remaining=` +
			`${formatPhaseCountdown(getPhaseRemainingSec())}` +
			`${sawDawn || cycleId > prevCycle ? ' (sunrise)' : ''}`
		)
		// Arm on any sunrise wrap, even when this tick also left DAWN
		// for DAY (server hitch / late snapshot).
		if (sawDawn || cycleId > prevCycle) requestDawnSplash(true, true)
		else maybeAnnounceDawn(prevName)
	}
}


// MARK: noteDawnRun

/** Count a world reset once, whether the phase packet or the local dawn lands first. */
function noteDawnRun(): void {
	const now = Date.now()
	if (now - dawnRunAtMs < 3000) return
	dawnRunAtMs = now
	dawnRun++
	splashShownDay = -1
}


// MARK: requestDawnSplash

/**
 * Arm the day card. `sunrise` waits for the DAWN stage when possible;
 * a mid-day join passes false so the card shows once the cover lifts.
 */
function requestDawnSplash(
	live   : boolean,
	sunrise: boolean,
): void {
	const day = getDayNumber()
	if (splashShownRun === dawnRun && splashShownDay === day) return
	if (
		dawnSplashArmed &&
		dawnSplashDay === day &&
		(dawnSplashLive || !live) &&
		(dawnSplashSunrise || !sunrise)
	) return
	dawnSplashDay     = day
	dawnSplashArmed   = true
	dawnSplashSunrise = sunrise
	if (live) dawnSplashLive = true
	console.log(
		`phase: requestDawnSplash: Day ${day} run=${dawnRun} ` +
		`live=${dawnSplashLive} sunrise=${dawnSplashSunrise}`
	)
}


// MARK: maybeAnnounceDawn

/** Arm the sunrise title once per wrap into DAWN. */
function maybeAnnounceDawn(prevName: string): void {
	if (prevName === 'DAWN') return
	if (phaseName !== 'DAWN') return
	requestDawnSplash(true, true)
}


// MARK: tryDawnSplash

/**
 * Play the armed day card once the world is visible. Sunrise cards
 * wait for DAWN. If DAWN was skipped (late cover or a multi-step tick),
 * show on the first uncovered frame so Day N is not lost.
 */
function tryDawnSplash(): void {
	if (!dawnSplashArmed || !dawnSplashLive) return
	if (isWorldCovered()) {
		const now = Date.now()
		if (now - coverWaitLogAtMs > 2000) {
			coverWaitLogAtMs = now
			console.log(
				`phase: tryDawnSplash: Day ${dawnSplashDay} armed, waiting on world cover`,
			)
		}
		return
	}
	if (dawnSplashSunrise && phaseName !== 'DAWN') {
		// Sunrise card: wait for DAWN. If the clock already left DAWN
		// (cover held, or a skipped packet), show on this uncover so
		// Day N is not lost.
		const pastDawn =
			phaseIndex > 0 ||
			phaseName === 'DAY' ||
			phaseName === 'DUSK' ||
			phaseName === 'NIGHT'
		if (!pastDawn) return
		const now = Date.now()
		if (now - dawnWaitLogAtMs > 2000) {
			dawnWaitLogAtMs = now
			console.log(
				`phase: tryDawnSplash: Day ${dawnSplashDay} missed DAWN ` +
				`(now ${phaseName}) — showing anyway`,
			)
		}
	}
	if (splashShownRun === dawnRun && splashShownDay === dawnSplashDay) {
		dawnSplashArmed = false
		dawnSplashLive  = false
		return
	}
	dawnSplashArmed = false
	dawnSplashLive  = false
	splashShownRun  = dawnRun
	splashShownDay  = dawnSplashDay
	const sunrise = dawnSplashSunrise
	console.log(
		`phase: tryDawnSplash: showing Day ${dawnSplashDay} ` +
		`during ${phaseName}${sunrise ? ' (sunrise)' : ' (join)'}`
	)
	beginDaySplash(dawnSplashDay, sunrise)
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
	// Boot is a placeholder until the server snapshot. A cycle roll
	// is already the new run's sunrise, but the phase packet may have
	// armed that same Day 1 already.
	if (reason !== 'boot') noteDawnRun()
	requestDawnSplash(reason !== 'boot', true)
	console.log(`phase: resetPhaseToDawn: ${cfg.name} ${cfg.durationSec}s (${reason})`)
}
