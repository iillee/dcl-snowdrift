/**
 * hearthFuel.ts - shared fuel model for campfires.
 *
 * One number (fuelSeconds, 0..MAX) drives everything the fire looks
 * and does: melt radius, flame scale, smoke height, ambient volume.
 * Server owns the number, ticks decay, broadcasts on change. Client
 * lerps between broadcasts and reads it for visuals + gameplay
 * (frost accumulation).
 *
 * Design (see PLAN.md v2.14 / this session's design chat):
 *   - 1 log         = LOG_FUEL_SECONDS (+60 s)
 *   - 1 branch      = BRANCH_FUEL_SECONDS (+30 s)
 *   - Hard cap      = FUEL_MAX (600 s -> 10 logs banked)
 *   - Main fire     = starts at MAIN_INITIAL (150 s -> tier 3 "Warm")
 *                     and can burn to 0. A lit torch sparks it back
 *                     to the same 30 s Ember a hidden pit starts at.
 *                     The world does not end when it goes out.
 *   - Hidden fires  = no floor. Fuel -> 0 snuffs them; snow-cover
 *                     re-buries them via precipitation.
 *   - 5 tiers       = flame, smoke height, smoke density, light
 *                     range, crackle, melt ring, and warmth step
 *                     together. Warmth is a rate, not a full cancel:
 *                     a tier only clears frost when it beats the cold.
 *   - The fuel bar  = hidden. The fire itself is the health readout.
 *   - Multi-player  = decayRate = 1 + log2(playerCount). Doubling
 *                     players adds +1 log/min drain. Solo sustainable,
 *                     20-player spikes still fun (~5.3x).
 *
 * Warm is the opening fire: flame 1, smoke 1, melt ring 8 m, light
 * 8 m. The other tiers step off that. A full tank still bursts the
 * ring out to FUEL_MAX_BURST_RADIUS_M.
 */

import { WOOD_KIND_BRANCH } from 'src/shared/woodKind'


// MARK: Tuning constants
/** Total seconds one log adds to a fire's fuel tank. */
export const LOG_FUEL_SECONDS    = 60
/** Kindling. Half a log so a near-ring trip still matters. */
export const BRANCH_FUEL_SECONDS = 30

/** Hard ceiling. 10 logs = one full tank. Prevents infinite hoarding
 *  from making the UI unreadable and gives Roaring a defined peak. */
export const FUEL_MAX          = 600

/** Main fire's decay floor. Zero so the spawn hearth can go out. */
export const FUEL_MAIN_FLOOR   = 0

/** Fuel the spawn hearth starts (and rebuilds) at. Warm / 8 m ring. */
export const FUEL_MAIN_INITIAL = 150

/** Hidden bonfires can burn all the way out. */
export const FUEL_HIDDEN_FLOOR = 0

/** Fuel a hidden fire starts at when first ignited. Ember (tier 1),
 *  just into the lowest bar — a spark, not a camp. Solo drain is
 *  ~1 s/s, so this is a short window to feed it or it dies. */
export const FUEL_HIDDEN_INITIAL = 30

/** Melt radius (m) for the one-shot "you filled the fire" burst that
 *  fires when fuel first reaches FUEL_MAX. Bigger than the tier-5
 *  Roaring anchor (17 m) so hitting full feels like an event, not
 *  just "one more tier". Ring stays at this size through the rest of
 *  the Roaring tier and shrinks to the Bright anchor when fuel
 *  eventually decays below 450 s. */
export const FUEL_MAX_BURST_RADIUS_M = 22


// MARK: Tier anchors
/**
 * Fuel value at which each tier BEGINS. Tier index is 1..5 (matches
 * the UI naming). Tier N is active when fuel is in [TIER_FUEL[N-1],
 * TIER_FUEL[N]).
 */
export const TIER_FUEL: readonly number[] = [0, 60, 150, 300, 450, FUEL_MAX] as const

/** Human-readable tier names (index 0 unused; tiers are 1..5). */
export const TIER_NAMES: readonly string[] = ['Out', 'Ember', 'Low', 'Warm', 'Bright', 'Roaring'] as const

/**
 * Melt radius (m) for the whole tier. Warm stays 8 m so the opening
 * ring matches CAMPFIRE_MELT_RADIUS_M. Low and Ember sit inside that
 * so a weakening fire pulls the circle in.
 */
export const TIER_RADIUS_M: readonly number[] = [4, 6, 8, 12, 17] as const

/**
 * Flame GLB uniform scale for the whole tier. Warm stays 1. A smooth
 * grow reads as morphing; the step is the state change.
 */
export const TIER_FLAME_SCALE: readonly number[] = [0.45, 0.70, 1.00, 1.50, 2.00] as const

/**
 * Smoke column multiplier for the whole tier. Warm stays 1. Launch
 * speed and lifetime both take this, so the plume height steps harder
 * than the number.
 */
export const TIER_SMOKE_HEIGHT: readonly number[] = [0.40, 0.70, 1.00, 1.40, 1.90] as const

/**
 * Smoke emission multiplier for the whole tier. Warm stays 1, which
 * is the authored puff rate. Lower tiers thin the column. Higher
 * tiers thicken it without scaling puff size.
 */
export const TIER_SMOKE_DENSITY: readonly number[] = [0.40, 0.70, 1.00, 1.35, 1.65] as const

/**
 * Point-light range (m) for the whole tier. Warm stays 8 m, the same
 * pool the melt ring used to define. The glow now steps on its own,
 * tighter than the ring when the fire is weak and wider when it is strong.
 */
export const TIER_LIGHT_RANGE_M: readonly number[] = [3.5, 5.5, 8, 14, 20] as const

/**
 * Crackle multiplier for the whole tier. Warm stays 0.70, the volume
 * the opening fire already played. Heard loudness is the campfire
 * clip times this.
 */
export const TIER_VOLUME: readonly number[] = [0.25, 0.45, 0.70, 0.90, 1.00] as const

/**
 * Frost points removed per second inside this tier's ring. The cold
 * is still applied, so the bar only falls when this wins.
 *
 * Day bare cold is ~3.3/s. Dusk and night share one bare cold, ~4.8/s.
 *
 *   Ember    4    holds the bar through dawn and day (the cold is
 *                 not applied). Loses to dusk/night: a 60s night on
 *                 bare ground fills about half the bar from warm,
 *                 instead of freezing you in ~21s outside.
 *   Low      6    beats dusk/night. A full bar clears in ~80s.
 *   Warm     7    the opening fire. Night recovery matches the old
 *                 45s thaw.
 *   Bright   9.5  night recovery ~21s.
 *   Roaring  13   night recovery ~12s.
 */
export const TIER_WARMTH_PER_S: readonly number[] = [4, 6, 7, 9.5, 13] as const


// MARK: fuelSecondsForKind
/** Seconds a carried piece adds when fed to a fire. */
export function fuelSecondsForKind(kind: number): number {
	return kind === WOOD_KIND_BRANCH ? BRANCH_FUEL_SECONDS : LOG_FUEL_SECONDS
}


// MARK: hearthIsLit
/** True when a fire still has fuel in the tank. */
export function hearthIsLit(fuel: number): boolean {
	return fuel > 0
}


// MARK: hearthTierFromFuel
/** Which tier index (1..5) a given fuel value lives in. 0 = out. */
export function hearthTierFromFuel(fuel: number): number {
	if (fuel <= 0) return 0
	for (let i = 1; i <= 5; i++) {
		if (fuel < TIER_FUEL[i]) return i
	}
	return 5
}


// MARK: tierAnchor

/**
 * The anchor for whichever tier `fuel` is in. Dead fire is 0.
 * Flame, smoke, light, crackle, and the melt ring share this so they
 * change together.
 */
function tierAnchor(fuel: number, anchors: readonly number[]): number {
	const tier = hearthTierFromFuel(fuel)
	if (tier <= 0) return 0
	return anchors[tier - 1]
}


// MARK: hearthRadiusFromFuel
/** Melt radius (m) for the active tier. Dead fire = 0. */
export function hearthRadiusFromFuel(fuel: number): number {
	return tierAnchor(fuel, TIER_RADIUS_M)
}


// MARK: hearthSmokeHeightFromFuel
/** Smoke-column multiplier for the active tier. Dead fire = 0. */
export function hearthSmokeHeightFromFuel(fuel: number): number {
	return tierAnchor(fuel, TIER_SMOKE_HEIGHT)
}


// MARK: hearthSmokeDensityFromFuel
/** Smoke emission multiplier for the active tier. Dead fire = 0. */
export function hearthSmokeDensityFromFuel(fuel: number): number {
	return tierAnchor(fuel, TIER_SMOKE_DENSITY)
}


// MARK: hearthLightRangeFromFuel
/** Point-light range (m) for the active tier. Dead fire = 0. */
export function hearthLightRangeFromFuel(fuel: number): number {
	return tierAnchor(fuel, TIER_LIGHT_RANGE_M)
}


// MARK: hearthVolumeFromFuel
/** Crackle multiplier for the active tier. Dead fire = 0. */
export function hearthVolumeFromFuel(fuel: number): number {
	return tierAnchor(fuel, TIER_VOLUME)
}


// MARK: hearthWarmthPerSec
/**
 * Frost points per second this fire removes while you stand in its
 * ring. Dead fire is 0. The cold around you is subtracted by the
 * caller, so a weak tier can still lose.
 */
export function hearthWarmthPerSec(fuel: number): number {
	return tierAnchor(fuel, TIER_WARMTH_PER_S)
}


// MARK: feedFitsFire

/**
 * True when feeding `kind` would land on or under the cap. A piece
 * that would pass FUEL_MAX is refused whole. The fire does not take
 * a partial log.
 */
export function feedFitsFire(
	fuel : number,
	kind : number,
): boolean {
	return fuel + fuelSecondsForKind(kind) <= FUEL_MAX
}


// MARK: hearthFlameScaleFromFuel
/** Flame scale for the active tier. Out = 0. */
export function hearthFlameScaleFromFuel(fuel: number): number {
	return tierAnchor(fuel, TIER_FLAME_SCALE)
}


// MARK: hearthDecayRate
/**
 * Fuel-seconds burned per real second, given how many players are
 * currently in the scene. Formula: 1 + log2(max(1, playerCount)).
 *
 *   1p ->  1.0x   (1 log/min holds Warm)
 *   2p ->  2.0x
 *   4p ->  3.0x
 *   8p ->  4.0x
 *  16p ->  5.0x
 *  20p -> ~5.3x
 *
 * Doubling the crowd adds exactly +1 log/min of drain, which is easy
 * to teach in-game via the "xN" chip on the fuel bar.
 */
export function hearthDecayRate(playerCount: number): number {
	const n = Math.max(1, playerCount | 0)
	return 1 + Math.log2(n)
}
