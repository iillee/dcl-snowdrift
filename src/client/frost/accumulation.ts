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
 * Your lit torch stops ALL frost gain, day and night, in or out of a
 * fire ring; it never removes frost (only fires do). Night is harder
 * through the torchless night rate and faster torch drain.
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
	FROST_MAX,
	FROST_SAMPLE_INTERVAL_S,
	RESCUE_WARMTH_FRAC,
	WAKE_WARMTH_FRAC,
	FROST_TIME_BASELINE_S,
	FROST_TIME_SNOW_STAGE_S,
} from 'src/shared/frost/tuning'
import { EMBER_MIN_NET_WARMTH_FRAC, TIER_WARMTH_PER_S, hearthTierFromFuel, hearthWarmthPerSec } from 'src/shared/hearthFuel'
import { DAILY_PHASES, ambientFreezeSec, type PhaseConfig } from 'src/shared/phase'

import { playHealChunkSfx, playFrostChunkSfx } from 'src/client/audio'
import { DEV_DISABLE_FROST } from 'src/client/devFlags'
import { getMainFireFuel, getMainFireMeltRadiusSq } from 'src/client/hearthFuel'
import { getHiddenCampfireWarmthPositions, isHiddenCampfireLit } from 'src/client/hiddenCampfire'
import { getLitMonumentWarmthPositions } from 'src/client/stationMarkers'
import { getLivePhaseConfig } from 'src/client/phase'
import { thawHeatAt } from 'src/client/worldThaw'
import { getSnowStageAtWorld } from 'src/client/snow/snowQuery'
import { isTorchProtecting } from 'src/client/torch'
import { clampTorchFuelToCap, setTorchCapProvider } from 'src/client/torchEquip'
import { FROST_REDUCES_TORCH_CAPACITY } from 'src/shared/frost/tuning'
import { activeGroundYAt, activeIsLavaAt, activeTerrain } from 'src/shared/terrain/terrainCache'
import { SNOW_STAGE_HEIGHT_M } from 'src/shared/snowGrid'
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
// Cue grid only: the frost SFX and the blue screen flash fire each time
// frost crosses another tenth. The bar itself is continuous now.
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
	const snowTopY = activeGroundYAt(x, z) + SNOW_STAGE_HEIGHT_M[stage]
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
	if (FROST_REDUCES_TORCH_CAPACITY) setTorchCapProvider(() => 1 - frost / FROST_MAX)

	engine.addSystem((dt: number) => {
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
			return
		}

		// Frozen in place: the bar holds until a thaw or a fire wake.
		const held = FrostDeath.getOrNull(engine.PlayerEntity)
		if (held !== null && !held.awake) return

		const t = Transform.getOrNull(engine.PlayerEntity)
		if (t === null) return
		const { x, y, z } = t.position

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
		// Lit monuments: eternal Warm campfires (no fuel decay).
		for (const mp of getLitMonumentWarmthPositions()) {
			const mdx = x - mp.x
			const mdz = z - mp.z
			if (mdx * mdx + mdz * mdz > mp.radiusSq) continue
			const w = hearthWarmthPerSec(mp.fuel)
			if (w <= warmthPerSec) continue
			warmthPerSec = w
			warmthFuel   = mp.fuel
		}
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
		if (warmthPerSec > 0) {
			// Every tier nets its warmth against the cold. Ember (the
			// strongest ring here is tier 1) never loses: whatever the
			// phase, snow or torch, frost falls at least the ember floor.
			// The torch does not add heat inside a ring.
			const ember = hearthTierFromFuel(warmthFuel) === 1
			{
				const before = frost
				let net = ambientCold + snowColdPerSec(x, y, z, phase) - warmthPerSec
				if (ember) net = Math.min(net, -emberMinNetWarmthPerSec())
				// A lit torch never lets frost grow. Recovery is the
				// fire's normal net rate (the torch adds no heat).
				if (isTorchProtecting() && net > 0) net = 0
				frost += net * step
				if (frost < 0) frost = 0
				if (frost > FROST_MAX) frost = FROST_MAX
				warmingByFire = net < 0 && frost > 0
				thawedByFire  = net < 0 && frost < before
			}
		} else {
			warmingByFire = false
			// Ambient + snow, torchless only. A lit torch blocks every
			// frost source in every phase (no night leak, no snow chill).
			let ratePerSec = 0
			const inTorchWarmth = isTorchProtecting()

			if (!inTorchWarmth) {
				// Day rule: torchless and not touching snow = no frost at all.
				const snowOnly = SNOW_CONTACT_ONLY_PHASES.includes(phase.name)
				const touching = snowOnly ? isTouchingSnow(x, y, z) : true
				if (touching) ratePerSec += ambientCold + snowColdPerSec(x, y, z, phase)
			}

			if (ratePerSec > 0) {
				frost += ratePerSec * step
				if (frost > FROST_MAX) frost = FROST_MAX
			}
		}
		// Play the frost SFX only when the bar grows a new blue segment.
		// Same count the bar draws, so each visible step gets a cue.
		// Shallow snow that never fills a segment stays silent. Thaw
		// shrinks the count; we only fire on the upward edge.
		const coldSegments = visibleColdSegments(frost)
		if (coldSegments > lastColdSegments) playFrostChunkSfx()
		else if (thawedByFire && coldSegments < lastColdSegments) playHealChunkSfx()
		lastColdSegments = coldSegments

		// Frost sets the torch cap; stored fuel above it is lost.
		if (FROST_REDUCES_TORCH_CAPACITY) clampTorchFuelToCap()

		// Debounced CRDT write.
		if (Math.abs(frost - lastWrittenFrost) >= FROST_WRITE_EPSILON) {
			FrostLevel.createOrReplace(engine.PlayerEntity, { value: frost })
			lastWrittenFrost = frost
		}
	})
}


// MARK: resetFrostLocal
/**
 * Zero the local accumulator AND the synced component. Called by the
 * death FSM on wake, and by world reset, so the heat bar starts full
 * warmth instead of carrying frost into the new run.
 */
export function resetFrostLocal(): void {
	frost             = 0
	lastWrittenFrost  = 0
	lastColdSegments  = 0
	warmingByFire     = false
	FrostLevel.createOrReplace(engine.PlayerEntity, { value: 0 })
}


// MARK: seedWarmth
/**
 * Leave `warmthFrac` (0..1) of warmth on the heat bar, i.e. frost at
 * (1 - warmthFrac) of max. Shared by fire-wake and rescue thaw.
 */
function seedWarmth(warmthFrac: number, label: string): void {
	const w          = Math.max(0.01, Math.min(1, warmthFrac))
	const value      = Math.round(FROST_MAX * (1 - w) * 100) / 100
	frost            = value
	lastWrittenFrost = value
	lastColdSegments = visibleColdSegments(value)
	warmingByFire    = false
	FrostLevel.createOrReplace(engine.PlayerEntity, { value })
	console.log(`frost/accumulation: ${label}: frost ${value} (warmth ${(w * 100).toFixed(0)}%)`)
}


// MARK: seedWakeWarmth
/**
 * Leave 21% warmth (the old three segments). A fire wake uses this
 * so there is time to stand and feed an ember at night. The
 * cold-segment count is primed so the seed itself does not chirp.
 */
export function seedWakeWarmth(): void {
	seedWarmth(WAKE_WARMTH_FRAC, 'seedWakeWarmth')
}


// MARK: seedRescueWarmth
/**
 * Leave 41% warmth (the old five segments) after a torch thaw. Full warmth on rescue
 * made freeze→thaw a free heat refill; half a bar keeps the player
 * standing but still hungry for fire.
 */
export function seedRescueWarmth(): void {
	seedWarmth(RESCUE_WARMTH_FRAC, 'seedRescueWarmth')
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
 * Tenths of frost crossed, for the frost SFX and the cold flash cue
 * (the bar itself is continuous). The first sliver returns 0; only a
 * full bar returns every step.
 */
export function visibleColdSegments(value: number): number {
	if (value <= 0) return 0
	if (value >= FROST_MAX) return FROST_BAR_SEGMENTS
	const warmthPct  = 1 - value / FROST_MAX
	const warmBlocks = Math.max(1, Math.ceil(warmthPct * FROST_BAR_SEGMENTS))
	return FROST_BAR_SEGMENTS - warmBlocks
}
