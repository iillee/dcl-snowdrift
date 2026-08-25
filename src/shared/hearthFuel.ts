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
 *   - Hard cap      = FUEL_MAX (600 s -> 10 logs banked)
 *   - Main fire     = never below MAIN_FLOOR (150 s -> tier 3 "Warm").
 *                     Melt radius therefore never shrinks below 8 m.
 *   - Hidden fires  = no floor. Fuel -> 0 snuffs them; snow-cover
 *                     re-buries them via precipitation.
 *   - 5 tiers       = readable UI + tier-snapped flame model scale.
 *   - Radius/smoke/ = continuous interpolation between tier anchors
 *     volume          (feels alive, not steppy).
 *   - Multi-player  = decayRate = 1 + log2(playerCount). Doubling
 *                     players adds +1 log/min drain. Solo sustainable,
 *                     20-player spikes still fun (~5.3x).
 *
 * Anchor 3 (radius 8 m) is the CURRENT static melt radius, so the
 * default tier-3 state matches today's behaviour exactly - fuel just
 * lets it grow past that OR (for hidden fires) shrink below it.
 */


// MARK: Tuning constants
/** Total seconds one log adds to a fire's fuel tank. */
export const LOG_FUEL_SECONDS  = 60

/** Hard ceiling. 10 logs = one full tank. Prevents infinite hoarding
 *  from making the UI unreadable and gives Roaring a defined peak. */
export const FUEL_MAX          = 600

/** Main fire's floor. Cannot decay below tier 3 ("Warm"), so the
 *  central hearth is always at least at the default 8 m melt radius.
 *  Named MAIN_FLOOR so hidden fires (floor = 0) read as the exception. */
export const FUEL_MAIN_FLOOR   = 150

/** Hidden bonfires can burn all the way out. */
export const FUEL_HIDDEN_FLOOR = 0

/** Fuel value a hidden fire starts at when ignited. Lands in tier 3
 *  (Warm) so a fresh discovery feels like a real fire, but the ~3.3
 *  min solo drain window means players need to feed it to sustain. */
export const FUEL_HIDDEN_INITIAL = 200

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
export const TIER_NAMES: readonly string[] = ['', 'Ember', 'Low', 'Warm', 'Bright', 'Roaring'] as const

/** Melt radius (m) at each tier's LOWER bound. Continuous fuel values
 *  interpolate linearly between adjacent anchors. Anchor 3 (index 2)
 *  is 8 m so tier-3 Warm matches today's static CAMPFIRE_MELT_RADIUS_M. */
export const TIER_RADIUS_M: readonly number[] = [3, 5, 8, 12, 17] as const

/** Flame GLB uniform scale per tier. SNAPS (no interp) - a smoothly
 *  growing flame GLB reads as morphing; a punchy step-up per tier
 *  reads as an achievement. */
export const TIER_FLAME_SCALE: readonly number[] = [0.5, 0.75, 1.0, 1.35, 1.75] as const

/** Smoke column height multiplier per tier (interpolated). */
export const TIER_SMOKE_HEIGHT: readonly number[] = [0.4, 0.7, 1.0, 1.4, 1.9] as const

/** Fire ambient volume 0..1 per tier (interpolated). */
export const TIER_VOLUME: readonly number[] = [0.30, 0.50, 0.70, 0.85, 1.00] as const


// MARK: hearthTierFromFuel
/** Which tier index (1..5) a given fuel value lives in. */
export function hearthTierFromFuel(fuel: number): number {
	for (let i = 1; i <= 5; i++) {
		if (fuel < TIER_FUEL[i]) return i
	}
	return 5
}


// MARK: interpAnchor
/**
 * Linear interp between two adjacent tier anchor tables. Given a fuel
 * value and an anchor array of length 5, returns the interpolated value
 * for that fuel position on the piecewise-linear curve.
 *
 * The anchor at index i corresponds to fuel = TIER_FUEL[i], i.e. the
 * LOWER bound of tier (i+1). So anchor[0]=fuel 0, anchor[4]=fuel 450.
 * Fuel above 450 continues extrapolating linearly toward FUEL_MAX
 * using the last segment's slope (so overfill past 450 keeps ramping
 * up to the anchor[4] value at FUEL_MAX rather than clamping early).
 */
function interpAnchor(fuel: number, anchors: readonly number[]): number {
	if (fuel <= TIER_FUEL[0]) return anchors[0]
	if (fuel >= TIER_FUEL[5]) return anchors[4]
	// Find the segment that contains this fuel value.
	for (let i = 0; i < 4; i++) {
		const lo = TIER_FUEL[i]
		const hi = TIER_FUEL[i + 1]
		if (fuel >= lo && fuel < hi) {
			const t = (fuel - lo) / (hi - lo)
			return anchors[i] + (anchors[i + 1] - anchors[i]) * t
		}
	}
	// Segment 4 covers TIER_FUEL[4]..TIER_FUEL[5]; extend anchor[4] flat.
	return anchors[4]
}


// MARK: hearthRadiusFromFuel
/** Melt radius (m) as a continuous function of fuel. */
export function hearthRadiusFromFuel(fuel: number): number {
	return interpAnchor(fuel, TIER_RADIUS_M)
}


// MARK: hearthSmokeHeightFromFuel
export function hearthSmokeHeightFromFuel(fuel: number): number {
	return interpAnchor(fuel, TIER_SMOKE_HEIGHT)
}


// MARK: hearthVolumeFromFuel
export function hearthVolumeFromFuel(fuel: number): number {
	return interpAnchor(fuel, TIER_VOLUME)
}


// MARK: hearthFlameScaleFromFuel
/** Flame scale SNAPS to the active tier (no interp). */
export function hearthFlameScaleFromFuel(fuel: number): number {
	return TIER_FLAME_SCALE[hearthTierFromFuel(fuel) - 1]
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
