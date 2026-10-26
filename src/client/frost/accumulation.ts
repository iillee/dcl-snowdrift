/**
 * accumulation.ts — per-player frost accumulation + warmth recovery.
 *
 * Samples the local player's position at FROST_SAMPLE_INTERVAL_S,
 * reads the snow depth beneath them via src/client/snow/snowQuery's
 * getSnowStageAtWorld(), and pushes FrostLevel up or down accordingly.
 * Heat is a visible fire, the volcano crater (Warm), or YOUR lit torch. Standing near another
 * player does nothing. A campfire removes frost at its tier's rate,
 * and the cold still applies. Ember holds the bar still through the
 * day and loses from dusk onward. Warm and above still clear you.
 * Your lit torch blocks ambient
 * during day and leaks at night, but only outside a fire. Snow
 * always chills. By day with the torch out and off snow, the reserve
 * drains slowly, then frost creeps up slowly (FROST_DAY_IDLE_FILL_S).
 *
 * Writes are debounced by FROST_WRITE_EPSILON so the CRDT doesn't
 * chatter every frame with sub-percent changes.
 *
 * No death handling here — this module only owns the number. While
 * FrostDeath is set the bar holds still. The FSM that locks, thaws,
 * and wakes lives in src/client/frost/death.ts.
 */

import { engine, Transform } from '@dcl/sdk/ecs'

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { FrostDeath, FrostLevel } from 'src/shared/frost/components'
import {
	FROST_DAY_IDLE_FILL_S,
	FROST_MAX,
	FROST_SAMPLE_INTERVAL_S,
	FROST_TIME_BASELINE_S,
	FROST_TIME_SNOW_STAGE_S,
	WARMTH_DAY_IDLE_DRAIN_S,
	WARMTH_DRAIN_S,
	WARMTH_REFILL_DELAY_S,
	WARMTH_REFILL_S,
} from 'src/shared/frost/tuning'
import { EMBER_MIN_NET_WARMTH_FRAC, TIER_WARMTH_PER_S, hearthTierFromFuel, hearthWarmthPerSec } from 'src/shared/hearthFuel'
import { DAILY_PHASES, ambientFreezeSec, torchLeakFreezeSec, type PhaseConfig } from 'src/shared/phase'

import { fadeOutFrostSfx, playHealChunkSfx, playFrostChunkSfx } from 'src/client/audio'
import { DEV_DISABLE_FROST } from 'src/client/devFlags'
import { getMainFireFuel, getMainFireMeltRadiusSq } from 'src/client/hearthFuel'
import { getHiddenCampfireWarmthPositions, isHiddenCampfireLit } from 'src/client/hiddenCampfire'
import { isOnHeatPath } from 'src/client/fireNetworkGlow'
import { NETWORK_PATH_WARM_FUEL } from 'src/shared/fireNetwork'
import { getLivePhaseConfig } from 'src/client/phase'
import { isSurvivalPausedByCinematic } from 'src/client/monumentCinematic'
import { thawHeatAt } from 'src/client/worldThaw'
import { getSnowStageAtWorld } from 'src/client/snow/snowQuery'
import { isTorchProtecting } from 'src/client/torch'
import { activeGroundYAt, activeIsLavaAt, activeTerrain } from 'src/shared/terrain/terrainCache'
import { SNOW_STAGE_HEIGHT_M, worldToCellKey } from 'src/shared/snowGrid'
import { getSnowCellLiftM } from 'src/client/snow/snowRenderer'
import {
	CRATER_HEAT_FUEL,
	CRATER_HEAT_RADIUS_SQ_M,
	volcanoCraterHeatCenter,
} from 'src/shared/terrain/volcanoCraterHeat'


// MARK: Module state
// Local accumulator (float). We mirror it into the synced FrostLevel
// component whenever it drifts past FROST_WRITE_EPSILON to keep CRDT
// traffic quiet.
let sampleAccum      = 0
let frost            = 0
let lastWrittenFrost = 0
/** True while a fire is actively thawing remaining frost. */
let warmingByFire    = false
/**
 * Warmth reserve (frost points). 0..FROST_MAX - frost. Cold drains it
 * before frost can grow; a lit torch (with no cold on it) or a fire
 * ring refills it. Client-side, display + gating only.
 */
let warmth           = FROST_MAX


/** Seconds continuously safe (no cold applied); gates the refill. */
let safeFor = 0


// MARK: Frost-rising state
/**
 * "Taking frost damage" = the blue grew on the last sample (the reserve
 * is empty and cold is landing on frost). The screen tint and the
 * freeze cue key off this, not off the 10% bar segments, so they start
 * on the very first sliver of blue.
 *
 * Hysteresis: a gain re-arms FROST_RISING_HOLD_S of "still rising", so
 * a sample that lands exactly on the empty-reserve boundary (or one
 * skipped by a 0-gain frame) does not flicker the effect. Any warming
 * sample (reserve refilling or frost falling) clears it at once.
 */
const FROST_RISING_HOLD_S = 0.5
let frostRisingHoldS = 0
let frostRising      = false


// MARK: applyCold
/**
 * Exposed for `step` s to `ratePerSec` of cold. The reserve drains at a
 * fixed rate (full bar in WARMTH_DRAIN_S); the rest of the step, once
 * it is empty, adds frost at main's rate.
 */
function applyCold(ratePerSec: number, step: number): void {
	if (ratePerSec <= 0) return
	safeFor = 0
	const drainPerSec = FROST_MAX / WARMTH_DRAIN_S
	const tEmpty = warmth / drainPerSec
	if (tEmpty >= step) {
		warmth -= drainPerSec * step
		return
	}
	warmth = 0
	frost += ratePerSec * (step - tEmpty)
	if (frost > FROST_MAX) frost = FROST_MAX
}


// MARK: applyDayIdleCold
/**
 * Day/dawn, torch out, no fire ring, off snow, for `step` s. The
 * reserve drains slowly (full bar in WARMTH_DAY_IDLE_DRAIN_S) and never
 * refills; once it is empty, the rest of the step adds frost at the
 * slow creep (0 -> full in FROST_DAY_IDLE_FILL_S). Frost grows through
 * the same `frost` accumulator as applyCold, so the rising cue, CRDT
 * write and the freeze at FROST_MAX all behave normally.
 */
function applyDayIdleCold(step: number): void {
	safeFor = 0
	const drainPerSec = FROST_MAX / WARMTH_DAY_IDLE_DRAIN_S
	const tEmpty = warmth / drainPerSec
	if (tEmpty >= step) {
		warmth -= drainPerSec * step
		return
	}
	warmth = 0
	frost += (FROST_MAX / FROST_DAY_IDLE_FILL_S) * (step - tEmpty)
	if (frost > FROST_MAX) frost = FROST_MAX
}


// MARK: refillWarmth
/**
 * Safe / warming for `step` s. The reserve refills to full
 * (FROST_MAX - frost) FIRST, at a full bar per WARMTH_REFILL_S, after
 * WARMTH_REFILL_DELAY_S of continuous safety. Only the time left once
 * it is full lowers frost at `recoverPerSec` (fire rings only; a lit
 * torch passes 0), with W tracking the rising cap so it stays full.
 */
function refillWarmth(step: number, recoverPerSec = 0): void {
	const prevSafe = safeFor
	safeFor += step
	let t = step
	if (warmth < FROST_MAX - frost) {
		// Delay portion of this sample: nothing happens yet.
		const d = Math.min(t, Math.max(0, WARMTH_REFILL_DELAY_S - prevSafe))
		t -= d
		if (t <= 0) return
		const ratePerSec = FROST_MAX / WARMTH_REFILL_S
		const tFill = (FROST_MAX - frost - warmth) / ratePerSec
		if (tFill >= t) {
			warmth += ratePerSec * t
			return
		}
		t -= tFill
	}
	// Full: the rest of the sample recovers frost; W follows the cap.
	if (recoverPerSec > 0) {
		frost -= recoverPerSec * t
		if (frost < 0) frost = 0
	}
	warmth = FROST_MAX - frost
}
// Layout width of the frost bar. The bar and the cold flash both read
// this so a step on screen, the blue flash, and the freeze cue share
// one grid. Kept here (not in the UI layer) so the accumulator does
// not depend downward on a layer.
export const FROST_BAR_SEGMENTS = 10
let lastColdSegments = 0

// Any change bigger than this triggers a CRDT write. 0.5% chosen so a
// full 0->100 sweep produces ~200 writes over minutes, not thousands.
const FROST_WRITE_EPSILON = 0.5


// MARK: Day snow-contact rule
/**
 * Phases where a torchless player only freezes while touching snow:
 * grounded AND on an uncleared cell. Airborne or on cleared ground the
 * bar pauses (no gain; existing recovery rules unchanged). Dusk and
 * night keep full open-air cold.
 */
const SNOW_CONTACT_ONLY_PHASES: readonly string[] = ['DAWN', 'DAY']
/** Feet may sit this far above the snow top (m) and still count as grounded. */
const SNOW_CONTACT_GROUNDED_TOL_M = 0.15


// MARK: isTouchingSnow
/** Grounded on the terrain (within tolerance of the snow top) on a snow-covered cell. */
function isTouchingSnow(x: number, y: number, z: number): boolean {
	const stage = getSnowStageAtWorld(x, y, z)
	if (stage === 0) return false
	// Snow lying on monument ice sits higher by the ice height.
	const key = worldToCellKey(x, z)
	const lift = key === null ? 0 : getSnowCellLiftM(key)
	const snowTopY = activeGroundYAt(x, z) + lift + SNOW_STAGE_HEIGHT_M[stage]
	return y <= snowTopY + SNOW_CONTACT_GROUNDED_TOL_M
}


// MARK: ambientColdPerSec
/**
 * Frost points per second from the open air, with no torch. Day and
 * dawn use the 30s baseline. Dusk and night share the night freeze
 * time, about 21s to a full bar on bare ground.
 */
function ambientColdPerSec(phase: PhaseConfig): number {
	const ttf = ambientFreezeSec(phase, phase.durationSec, FROST_TIME_BASELINE_S)
	return FROST_MAX / ttf
}


// MARK: emberMinNetWarmthPerSec
/**
 * Minimum frost points per second an Ember ring removes, net of all
 * cold: EMBER_MIN_NET_WARMTH_FRAC of the Low tier's night recovery
 * (Low warmth minus bare night cold). Constant per build.
 */
let emberMinNetCache = -1
function emberMinNetWarmthPerSec(): number {
	if (emberMinNetCache >= 0) return emberMinNetCache
	const night = DAILY_PHASES.find(p => p.name === 'NIGHT')
	const nightCold = night
		? FROST_MAX / ambientFreezeSec(night, night.durationSec, FROST_TIME_BASELINE_S)
		: 0
	const lowNightNet = Math.max(0, TIER_WARMTH_PER_S[1] - nightCold)
	emberMinNetCache = lowNightNet * EMBER_MIN_NET_WARMTH_FRAC
	console.log(`frost/accumulation: ember floor ${emberMinNetCache.toFixed(3)} frost/s (Low night net ${lowNightNet.toFixed(2)}/s)`)
	return emberMinNetCache
}


// MARK: snowColdPerSec
/**
 * Frost points per second from the snow under (x, y, z). Melted
 * ground adds nothing.
 */
function snowColdPerSec(
	x    : number,
	y    : number,
	z    : number,
	phase: PhaseConfig,
): number {
	const stage    = getSnowStageAtWorld(x, y, z) as 0 | 1 | 2 | 3
	const stageTtf = FROST_TIME_SNOW_STAGE_S[stage]
	if (stageTtf === Number.POSITIVE_INFINITY) return 0
	return (FROST_MAX / stageTtf) * phase.snowFrostMul
}


// MARK: initFrostAccumulation
/**
 * Register the per-player frost accumulation system. Idempotent — call
 * once during client bootstrap. Creates the FrostLevel component on the
 * local player entity if missing.
 */
export function initFrostAccumulation(): void {
	if (!FrostLevel.has(engine.PlayerEntity)) {
		FrostLevel.create(engine.PlayerEntity, { value: 0 })
	}
	frost = 0
	lastWrittenFrost = 0
	sampleAccum = 0

	engine.addSystem((dt: number) => {
		// Watching the local ignition cinematic: frost, warmth reserve and
		// day-idle drain all hold exactly (time is dropped, not banked), and
		// the rising state clears so no tint / flash / freeze cue runs.
		if (isSurvivalPausedByCinematic()) {
			sampleAccum = 0
			if (frostRising) setFrostRising(false)
			return
		}
		sampleAccum += dt
		if (sampleAccum < FROST_SAMPLE_INTERVAL_S) return
		const step = sampleAccum
		sampleAccum = 0

		if (DEV_DISABLE_FROST) {
			if (frost !== 0 || lastWrittenFrost !== 0) {
				frost            = 0
				lastWrittenFrost = 0
				lastColdSegments = 0
				warmingByFire    = false
				FrostLevel.createOrReplace(engine.PlayerEntity, { value: 0 })
			}
			warmth = FROST_MAX
			setFrostRising(false)
			return
		}

		// Frozen in place: the bar holds until a thaw or a fire wake.
		const held = FrostDeath.getOrNull(engine.PlayerEntity)
		if (held !== null && !held.awake) { warmth = 0; setFrostRising(false); return }

		const t = Transform.getOrNull(engine.PlayerEntity)
		if (t === null) return
		const { x, y, z } = t.position
		const frostBefore  = frost
		const warmthBefore = warmth

		// Strongest fire ring the player is standing in. A dead hearth
		// reports radius 0. Overlapping rings keep the hotter tier.
		const phase = getLivePhaseConfig()
		const dx    = x - CAMPFIRE_WORLD_X
		const dz    = z - CAMPFIRE_WORLD_Z
		const mainMeltRSq = getMainFireMeltRadiusSq()
		let warmthPerSec = 0
		let warmthFuel   = 0
		let thawedByFire = false
		// Post-thaw volcano campfire: 0..1 inside the thaw zone (soft
		// edge). Blocks open-air / night cold in proportion and warms
		// like a Warm campfire. Outside the zone (0) winter is normal.
		const thawHeat = thawHeatAt(x, z)
		const ambientCold = ambientColdPerSec(phase) * (1 - thawHeat)
		if (mainMeltRSq > 0 && dx * dx + dz * dz <= mainMeltRSq) {
			warmthFuel   = getMainFireFuel()
			warmthPerSec = hearthWarmthPerSec(warmthFuel)
		}
		// Volcano crater: always Warm heat (even at 0/3 stations).
		{
			const map = activeTerrain()
			const centre = map ? volcanoCraterHeatCenter(map) : null
			let inCrater = activeIsLavaAt(x, z)
			if (!inCrater && centre) {
				const cdx = x - centre.x
				const cdz = z - centre.z
				inCrater = cdx * cdx + cdz * cdz <= CRATER_HEAT_RADIUS_SQ_M
			}
			if (inCrater) {
				const craterWarmth = hearthWarmthPerSec(CRATER_HEAT_FUEL)
				if (craterWarmth > warmthPerSec) {
					warmthPerSec = craterWarmth
					warmthFuel   = CRATER_HEAT_FUEL
				}
			}
		}
		// Post-thaw volcano campfire zone (Warm, faded at the edge).
		if (thawHeat > 0) {
			const w = hearthWarmthPerSec(CRATER_HEAT_FUEL) * thawHeat
			if (w > warmthPerSec) {
				warmthPerSec = w
				warmthFuel   = CRATER_HEAT_FUEL
			}
		}
		// Lit monuments give no heat and melt no snow (visual only).
		if (isHiddenCampfireLit()) {
			for (const hp of getHiddenCampfireWarmthPositions()) {
				if (hp.radiusSq <= 0) continue
				const hdx = x - hp.x
				const hdz = z - hp.z
				if (hdx * hdx + hdz * hdz > hp.radiusSq) continue
				const pit = hearthWarmthPerSec(hp.fuel)
				if (pit <= warmthPerSec) continue
				warmthPerSec = pit
				warmthFuel   = hp.fuel
			}
		}
		// Fire-network heat path: a small (Low tier) campfire while you stand on a glowing path cell.
		if (warmthPerSec <= 0 && isOnHeatPath(x, z)) {
			warmthPerSec = hearthWarmthPerSec(NETWORK_PATH_WARM_FUEL)
			warmthFuel   = NETWORK_PATH_WARM_FUEL
		}
		if (warmthPerSec > 0) {
			// Every tier nets its warmth against the cold. Ember (the
			// strongest ring here is tier 1) never loses: whatever the
			// phase or snow, frost falls at least the ember floor.
			// The torch does not add or cancel inside a ring.
			const ember = hearthTierFromFuel(warmthFuel) === 1
			{
				const before = frost
				let net = ambientCold + snowColdPerSec(x, y, z, phase) - warmthPerSec
				if (ember) net = Math.min(net, -emberMinNetWarmthPerSec())
				if (net > 0) {
					// A ring that loses to the cold drains the reserve first.
					applyCold(net, step)
				} else {
					// Warming or holding ring: the reserve refills to full
					// first, then the rest of the sample recovers frost.
					refillWarmth(step, -net)
				}
				warmingByFire = net < 0 && frost > 0
				thawedByFire  = net < 0 && frost < before
			}
		} else {
			warmingByFire = false
			// Ambient + snow. A lit torch blocks ambient only when
			// torchLeakPhases is null (day). At dusk and night it leaks.
			let ratePerSec = 0
			const inTorchWarmth = isTorchProtecting()

			// Day rule: torchless and not touching snow = no ambient/snow
			// cold; only the slow day-idle drain + creep below.
			const snowOnly = !inTorchWarmth && SNOW_CONTACT_ONLY_PHASES.includes(phase.name)
			const touching = snowOnly ? isTouchingSnow(x, y, z) : true

			if (!inTorchWarmth) {
				if (touching) ratePerSec += ambientCold
			} else {
				const leak = torchLeakFreezeSec(phase, phase.durationSec)
				if (leak !== null) ratePerSec += (FROST_MAX / leak) * (1 - thawHeat)
			}

			if (touching) ratePerSec += snowColdPerSec(x, y, z, phase)

			if (ratePerSec > 0) {
				// Cold (incl. the night torch leak and snow under a lit
				// torch) drains the reserve first, then adds frost.
				applyCold(ratePerSec, step)
			} else if (snowOnly && !touching) {
				// Day idle: torchless, off snow, no ring. W drains slowly and
				// does not refill; once empty, frost creeps up slowly.
				applyDayIdleCold(step)
			} else if (inTorchWarmth) {
				// Lit torch and nothing chilling you: the reserve refills.
				refillWarmth(step)
			}
		}
		// Reserve never exceeds the non-frost share of the bar.
		if (warmth > FROST_MAX - frost) warmth = FROST_MAX - frost
		if (warmth < 0) warmth = 0

		// Frost-rising onset / release (see Frost-rising state).
		const wasRising = frostRising
		if (frost > frostBefore + 1e-6) {
			frostRisingHoldS = FROST_RISING_HOLD_S
		} else if (frost < frostBefore - 1e-6 || warmth > warmthBefore + 1e-6) {
			frostRisingHoldS = 0
		} else {
			frostRisingHoldS = Math.max(0, frostRisingHoldS - step)
		}
		setFrostRising(frostRisingHoldS > 0)
		const onset = frostRising && !wasRising

		// Freeze cue: once the moment blue starts growing, then again on
		// each new blue segment while it keeps growing (the bar's own
		// count, so each visible step still gets a hit). The onset cue
		// covers a segment that lands on the same sample. Thaw shrinks
		// the count; we only fire on the upward edge.
		const coldSegments = visibleColdSegments(frost)
		if (onset) playFrostChunkSfx()
		else if (coldSegments > lastColdSegments) playFrostChunkSfx()
		else if (thawedByFire && coldSegments < lastColdSegments) playHealChunkSfx()
		lastColdSegments = coldSegments

		// Debounced CRDT write.
		if (Math.abs(frost - lastWrittenFrost) >= FROST_WRITE_EPSILON) {
			FrostLevel.createOrReplace(engine.PlayerEntity, { value: frost })
			lastWrittenFrost = frost
		}
	})
}


// MARK: setFrostRising
/** Flip the rising flag; fades the freeze cue out on the falling edge. */
function setFrostRising(next: boolean): void {
	if (!next) frostRisingHoldS = 0
	if (frostRising && !next) fadeOutFrostSfx()
	frostRising = next
}


// MARK: isFrostRising
/**
 * True while the player is actively taking frost damage (blue growing,
 * with a short hold so it does not flicker). Drives the frost tint.
 */
export function isFrostRising(): boolean {
	return frostRising
}


// MARK: resetFrostLocal
/**
 * Zero the local accumulator AND the synced component. Called by the
 * death FSM on wake, and by world reset, so the heat bar starts full
 * warmth instead of carrying frost into the new run.
 */
export function resetFrostLocal(): void {
	warmth            = FROST_MAX
	frost             = 0
	lastWrittenFrost  = 0
	lastColdSegments  = 0
	warmingByFire     = false
	setFrostRising(false)
	FrostLevel.createOrReplace(engine.PlayerEntity, { value: 0 })
}


// Gold segments left after waking at a fire. Cold end of that bucket.
const WAKE_WARM_SEGMENTS = 3
/** Gold segments left after a teammate melts you out of ice. */
const RESCUE_WARM_SEGMENTS = 5


// MARK: seedWarmSegments
/**
 * Leave `warmSegments` gold blocks on the heat bar. Shared by fire-wake
 * and rescue thaw so both use the same edge-bucket math.
 */
function seedWarmSegments(warmSegments: number, label: string): void {
	const clamped    = Math.max(1, Math.min(FROST_BAR_SEGMENTS, warmSegments | 0))
	const edge       = FROST_MAX * (1 - (clamped - 1) / FROST_BAR_SEGMENTS)
	const value      = edge - 1
	frost            = value
	// Wake / rescue: the warmth left is all reserve (reads warm).
	warmth           = FROST_MAX - value
	lastWrittenFrost = value
	lastColdSegments = visibleColdSegments(value)
	warmingByFire    = false
	setFrostRising(false)
	FrostLevel.createOrReplace(engine.PlayerEntity, { value })
	console.log(`frost/accumulation: ${label}: bar at ${value}, ${clamped} gold`)
}


// MARK: seedWakeWarmth
/**
 * Leave three gold segments on the heat bar. A fire wake uses this
 * so there is time to stand and feed an ember at night. The
 * cold-segment count is primed so the seed itself does not chirp.
 */
export function seedWakeWarmth(): void {
	seedWarmSegments(WAKE_WARM_SEGMENTS, 'seedWakeWarmth')
}


// MARK: seedRescueWarmth
/**
 * Leave five gold segments after a torch thaw. Full warmth on rescue
 * made freeze→thaw a free heat refill; half a bar keeps the player
 * standing but still hungry for fire.
 */
export function seedRescueWarmth(): void {
	seedWarmSegments(RESCUE_WARM_SEGMENTS, 'seedRescueWarmth')
}


// MARK: getWarmthLocal
/** Warmth reserve in frost points (0..FROST_MAX - frost). Heat bar yellow. */
export function getWarmthLocal(): number {
	return warmth
}


// MARK: getFrostLocal
/**
 * Read the local accumulator directly. Faster than a CRDT round-trip
 * and useful for the HUD, which repaints every frame.
 */
export function getFrostLocal(): number {
	return frost
}


// MARK: visibleColdSegments
/**
 * Blue segments the frost bar is showing for this frost value.
 * Warmth rounds up, so the first sliver of frost still reads as a
 * full warm bar and this returns 0. Only a full bar returns every
 * segment. The freeze cue and the cold flash both use this count.
 */
export function visibleColdSegments(value: number): number {
	if (value <= 0) return 0
	if (value >= FROST_MAX) return FROST_BAR_SEGMENTS
	const warmthPct  = 1 - value / FROST_MAX
	const warmBlocks = Math.max(1, Math.ceil(warmthPct * FROST_BAR_SEGMENTS))
	return FROST_BAR_SEGMENTS - warmBlocks
}
