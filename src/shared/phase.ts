/**
 * phase.ts — shared day/night phase table and helpers.
 *
 * The server owns the clock. Clients interpolate from the last
 * `phaseState` snapshot. Sky ranges live here so the client skybox
 * and the HUD share one table. Worlds may ignore SkyboxTime.fixedTime;
 * the component still locks the player's time slider.
 *
 * Daily loop is DAY → DUSK → NIGHT. SOLSTICE_WARN / SOLSTICE / GRACE
 * are scaffolded for the later seasonal clock and are not entered yet.
 */


// MARK: Types

export type PhaseName =
	| 'DAY'
	| 'DUSK'
	| 'NIGHT'
	| 'SOLSTICE_WARN'
	| 'SOLSTICE'
	| 'GRACE'

export interface PhaseConfig {
	name        : PhaseName
	durationSec : number
	drainMul    : number
	skyFrom     : number
	skyTo       : number
	/**
	 * Torchless ambient freeze time as a multiple of this phase's
	 * duration. `null` uses the day baseline in frost/tuning
	 * (absolute seconds, not scaled).
	 */
	ambientFreezePhases : number | null
	/**
	 * Ambient freeze time WITH a lit torch, as a multiple of this
	 * phase's duration. `null` means the torch fully blocks ambient
	 * (day). Campfire warmth still cancels everything.
	 */
	torchLeakPhases     : number | null
	snowFrostMul        : number
	torchDrainMul       : number
	/** 0..1 chance a weather step moves toward HEAVY. */
	weatherHeavyBias    : number
	/** 1 = normal weather cadence; 2 = changes twice as often. */
	weatherSpeedMul     : number
	/** Lowest weather level this phase will sit at (0=CLEAR..3=HEAVY). */
	weatherFloor        : number
	/**
	 * Level to snap up to when this phase begins. `null` leaves the
	 * current weather alone. Night snaps to HEAVY, then may step down.
	 */
	weatherEnterLevel   : number | null
	/**
	 * Odd cell-count cap on the torch melt brush. `null` keeps the
	 * cluster size (3 / 5). Night is 1 — a one-tile goat path.
	 */
	meltBrushCap        : number | null
	/** Flame size/emissive multiplier. Night is 0.65 — a weaker glow. */
	torchFlameMul       : number
}

/** Skybox seconds in a full day. 0 = midnight, 43200 = noon. */
export const SKYBOX_DAY_SEC = 86400
/** 07:00 — day start / night end. */
export const SKY_07 = 7 * 3600
/** 17:00 — dusk start. */
export const SKY_17 = 17 * 3600
/** 19:00 — night start. */
export const SKY_19 = 19 * 3600
/** 21:00 — solstice-warn end. */
export const SKY_21 = 21 * 3600
/** 03:00 — solstice end / grace start. */
export const SKY_03 = 3 * 3600


// MARK: Daily table

/**
 * Playtest cadence: 1 min day, 1 min night. Dusk is a 10 s sky blend.
 * Night pressure (frost, torch pinch, drain, weather) starts at dusk
 * — sunset — so every debuff hits together. Freeze times still scale
 * off the NIGHT row length, not the 10 s blend.
 */
export const DAILY_PHASES: readonly PhaseConfig[] = [
	{
		name: 'DAY', durationSec: 60, drainMul: 0.5,
		skyFrom: SKY_07, skyTo: SKY_17,
		ambientFreezePhases: null, torchLeakPhases: null,
		snowFrostMul: 1.0, torchDrainMul: 1.0,
		weatherHeavyBias: 0.30, weatherSpeedMul: 1.0,
		weatherFloor: 0, weatherEnterLevel: null,
		meltBrushCap: null, torchFlameMul: 1.0,
	},
	{
		name: 'DUSK', durationSec: 10, drainMul: 2.0,
		skyFrom: SKY_17, skyTo: SKY_19,
		ambientFreezePhases: 0.35, torchLeakPhases: 0.85,
		snowFrostMul: 1.6, torchDrainMul: 1.0,
		weatherHeavyBias: 0.40, weatherSpeedMul: 1.6,
		weatherFloor: 1, weatherEnterLevel: 3,
		meltBrushCap: 1, torchFlameMul: 0.65,
	},
	{
		name: 'NIGHT', durationSec: 60, drainMul: 2.0,
		skyFrom: SKY_19, skyTo: SKY_07,
		ambientFreezePhases: 0.35, torchLeakPhases: 0.85,
		snowFrostMul: 1.6, torchDrainMul: 1.0,
		weatherHeavyBias: 0.40, weatherSpeedMul: 1.6,
		weatherFloor: 1, weatherEnterLevel: 3,
		meltBrushCap: 1, torchFlameMul: 0.65,
	},
]

/**
 * Solstice sequence. Not in the daily loop. Kept here so later season
 * work can swap the active table without inventing new names.
 */
export const SOLSTICE_PHASES: readonly PhaseConfig[] = [
	{
		name: 'SOLSTICE_WARN', durationSec: 120, drainMul: 2.0,
		skyFrom: SKY_19, skyTo: SKY_21,
		ambientFreezePhases: 0.40, torchLeakPhases: 0.90,
		snowFrostMul: 1.6, torchDrainMul: 1.0,
		weatherHeavyBias: 0.40, weatherSpeedMul: 1.6,
		weatherFloor: 2, weatherEnterLevel: 3,
		meltBrushCap: 1, torchFlameMul: 0.65,
	},
	{
		name: 'SOLSTICE', durationSec: 360, drainMul: 3.0,
		skyFrom: SKY_21, skyTo: SKY_03,
		ambientFreezePhases: 0.30, torchLeakPhases: 0.70,
		snowFrostMul: 2.0, torchDrainMul: 1.0,
		weatherHeavyBias: 0.50, weatherSpeedMul: 2.0,
		weatherFloor: 2, weatherEnterLevel: 3,
		meltBrushCap: 1, torchFlameMul: 0.65,
	},
	{
		name: 'GRACE', durationSec: 60, drainMul: 0.5,
		skyFrom: SKY_03, skyTo: SKY_07,
		ambientFreezePhases: null, torchLeakPhases: null,
		snowFrostMul: 1.0, torchDrainMul: 1.0,
		weatherHeavyBias: 0.30, weatherSpeedMul: 1.0,
		weatherFloor: 0, weatherEnterLevel: null,
		meltBrushCap: null, torchFlameMul: 1.0,
	},
]


// MARK: dailyPhaseAt

/** Phase config at `index`, wrapping the daily table. */
export function dailyPhaseAt(index: number): PhaseConfig {
	const n = DAILY_PHASES.length
	const i = ((index % n) + n) % n
	return DAILY_PHASES[i]
}


// MARK: nextDailyIndex

/** Next daily-table index after `index`. */
export function nextDailyIndex(index: number): number {
	return (index + 1) % DAILY_PHASES.length
}


// MARK: phaseElapsedSec

/** Seconds elapsed in the current phase, clamped to [0, duration]. */
export function phaseElapsedSec(
	phaseStartedAtMs: number,
	phaseDurationSec: number,
	nowMs           : number = Date.now(),
): number {
	if (phaseDurationSec <= 0) return 0
	const elapsed = (nowMs - phaseStartedAtMs) / 1000
	if (elapsed < 0) return 0
	if (elapsed > phaseDurationSec) return phaseDurationSec
	return elapsed
}


// MARK: phaseRemainingSec

/** Seconds left in the current phase, clamped to [0, duration]. */
export function phaseRemainingSec(
	phaseStartedAtMs: number,
	phaseDurationSec: number,
	nowMs           : number = Date.now(),
): number {
	return phaseDurationSec - phaseElapsedSec(phaseStartedAtMs, phaseDurationSec, nowMs)
}


// MARK: clamp01

export function clamp01(t: number): number {
	if (t < 0) return 0
	if (t > 1) return 1
	return t
}


// MARK: phaseT01

/** 0..1 progress through the current phase. */
export function phaseT01(
	phaseStartedAtMs: number,
	phaseDurationSec: number,
	nowMs           : number = Date.now(),
): number {
	if (phaseDurationSec <= 0) return 1
	return clamp01(phaseElapsedSec(phaseStartedAtMs, phaseDurationSec, nowMs) / phaseDurationSec)
}


// MARK: lerpSkyboxSeconds

/**
 * Interpolate skybox seconds from `from` to `to` by t01, always
 * travelling forward so night can wrap midnight (19:00 → 07:00).
 */
export function lerpSkyboxSeconds(
	from: number,
	to  : number,
	t01 : number,
): number {
	let delta = to - from
	if (delta < 0) delta += SKYBOX_DAY_SEC
	return (from + delta * clamp01(t01)) % SKYBOX_DAY_SEC
}


// MARK: phaseSkyboxSeconds

/** Skybox seconds for a phase snapshot at `nowMs`. */
export function phaseSkyboxSeconds(
	skyFrom         : number,
	skyTo           : number,
	phaseStartedAtMs: number,
	phaseDurationSec: number,
	nowMs           : number = Date.now(),
): number {
	return lerpSkyboxSeconds(skyFrom, skyTo, phaseT01(phaseStartedAtMs, phaseDurationSec, nowMs))
}


// MARK: ambientFreezeSec

/**
 * Seconds to fill the frost bar from ambient cold without a torch.
 * Scales with the live phase duration when ambientFreezePhases is set.
 */
export function ambientFreezeSec(
	cfg         : PhaseConfig,
	durationSec : number,
	baselineSec : number,
): number {
	if (cfg.ambientFreezePhases === null) return baselineSec
	return Math.max(1, phaseFreezeDurationSec(cfg, durationSec)) * cfg.ambientFreezePhases
}


// MARK: torchLeakFreezeSec

/**
 * Seconds to fill the frost bar from ambient cold WITH a lit torch.
 * `null` means the torch fully blocks ambient.
 */
export function torchLeakFreezeSec(
	cfg        : PhaseConfig,
	durationSec: number,
): number | null {
	if (cfg.torchLeakPhases === null) return null
	return Math.max(1, phaseFreezeDurationSec(cfg, durationSec)) * cfg.torchLeakPhases
}


// MARK: phaseMeltBrushCells

/**
 * Torch melt footprint in odd cell counts. Night caps at one tile
 * regardless of cluster size; day keeps the cluster brush.
 */
export function phaseMeltBrushCells(
	cfg          : PhaseConfig,
	clusterCells : number,
): number {
	const raw = cfg.meltBrushCap === null
		? clusterCells
		: Math.min(clusterCells, cfg.meltBrushCap)
	const n = Math.max(1, raw)
	return n % 2 === 0 ? n - 1 : n
}


// MARK: phaseFreezeDurationSec

/**
 * Duration used for freeze-time math. Dusk is a short sky blend but
 * night pressure starts there, so it borrows the NIGHT row length
 * (and solstice-warn borrows SOLSTICE) instead of its own 10 s.
 */
export function phaseFreezeDurationSec(
	cfg        : PhaseConfig,
	durationSec: number,
): number {
	if (cfg.name === 'DUSK') {
		for (const row of DAILY_PHASES) {
			if (row.name === 'NIGHT') return Math.max(1, row.durationSec)
		}
	}
	if (cfg.name === 'SOLSTICE_WARN') {
		for (const row of SOLSTICE_PHASES) {
			if (row.name === 'SOLSTICE') return Math.max(1, row.durationSec)
		}
	}
	return Math.max(1, durationSec)
}


// MARK: formatPhaseCountdown

/** Format remaining seconds as `M:SS`. */
export function formatPhaseCountdown(remainingSec: number): string {
	const total = Math.max(0, Math.floor(remainingSec))
	const m     = Math.floor(total / 60)
	const s     = total % 60
	return `${m}:${s < 10 ? '0' : ''}${s}`
}
