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
 * always chills.
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
	FROST_TIME_BASELINE_S,
	FROST_TIME_SNOW_STAGE_S,
} from 'src/shared/frost/tuning'
import { hearthTierFromFuel, hearthWarmthPerSec } from 'src/shared/hearthFuel'
import { ambientFreezeSec, torchLeakFreezeSec, type PhaseConfig } from 'src/shared/phase'

import { playHealChunkSfx, playFrostChunkSfx } from 'src/client/audio'
import { DEV_DISABLE_FROST } from 'src/client/devFlags'
import { getMainFireFuel, getMainFireMeltRadiusSq } from 'src/client/hearthFuel'
import { getHiddenCampfireWarmthPositions, isHiddenCampfireLit } from 'src/client/hiddenCampfire'
import { getLitMonumentWarmthPositions } from 'src/client/stationMarkers'
import { getLivePhaseConfig } from 'src/client/phase'
import { isWorldThawed } from 'src/client/worldThaw'
import { getSnowStageAtWorld } from 'src/client/snow/snowQuery'
import { isTorchProtecting } from 'src/client/torch'
import { activeIsLavaAt, activeTerrain } from 'src/shared/terrain/terrainCache'
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
// Layout width of the frost bar. The bar and the cold flash both read
// this so a step on screen, the blue flash, and the freeze cue share
// one grid. Kept here (not in the UI layer) so the accumulator does
// not depend downward on a layer.
export const FROST_BAR_SEGMENTS = 10
let lastColdSegments = 0

// Any change bigger than this triggers a CRDT write. 0.5% chosen so a
// full 0->100 sweep produces ~200 writes over minutes, not thousands.
const FROST_WRITE_EPSILON = 0.5


// MARK: ambientColdPerSec
/**
 * Frost points per second from the open air, with no torch. Day and
 * dawn use the 30s baseline. Dusk and night share the night freeze
 * time, about 21s to a full bar on bare ground.
 */
function ambientColdPerSec(phase: PhaseConfig): number {
	// After the world thaw there is no open-air / night cold.
	if (isWorldThawed()) return 0
	const ttf = ambientFreezeSec(phase, phase.durationSec, FROST_TIME_BASELINE_S)
	return FROST_MAX / ttf
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
			// Ember holds the bar through dawn and day: no thaw, no
			// frost gain. From dusk it loses, same as night.
			// Every stronger tier still nets against the cold. The torch
			// does not add or cancel inside a ring.
			const dayEmber = hearthTierFromFuel(warmthFuel) === 1
				&& phase.ambientFreezePhases === null
			if (dayEmber) {
				warmingByFire = false
			} else {
				const before = frost
				const net = ambientColdPerSec(phase) + snowColdPerSec(x, y, z, phase) - warmthPerSec
				frost += net * step
				if (frost < 0) frost = 0
				if (frost > FROST_MAX) frost = FROST_MAX
				warmingByFire = net < 0 && frost > 0
				thawedByFire  = net < 0 && frost < before
			}
		} else {
			warmingByFire = false
			// Ambient + snow. A lit torch blocks ambient only when
			// torchLeakPhases is null (day). At dusk and night it leaks.
			let ratePerSec = 0
			const inTorchWarmth = isTorchProtecting()

			if (!inTorchWarmth) {
				ratePerSec += ambientColdPerSec(phase)
			} else {
				const leak = torchLeakFreezeSec(phase, phase.durationSec)
				if (leak !== null && !isWorldThawed()) ratePerSec += FROST_MAX / leak
			}

			ratePerSec += snowColdPerSec(x, y, z, phase)

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
	lastWrittenFrost = value
	lastColdSegments = visibleColdSegments(value)
	warmingByFire    = false
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
