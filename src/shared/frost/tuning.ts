/**
 * tuning.ts — knob values for the frost / warmth survival loop.
 *
 * All timings expressed in seconds of continuous exposure needed to
 * fill the frost bar from 0% -> 100%. Everything else in the frost
 * package derives from these two constants + the campfire heat radius
 * imported from src/shared/campfire.ts.
 *
 * Kept in its own file (no engine imports) so tests and both the
 * client-side accumulation system and the future server-side revive
 * mechanic can pull the same numbers.
 */


// MARK: Frost scale
/** Full bar value. Frost accumulates from 0 (safe) to this (dead). */
export const FROST_MAX = 100


// MARK: Baseline (ambient cold)
/**
 * Seconds-to-freeze from ambient cold alone, when the player is
 * outdoors, torchless, and standing on a bare (melted) path. This is
 * Day: a lit torch cancels this term. Night: ambient still leaks
 * through the torch (see PhaseConfig.torchLeakPhases). Only campfire
 * heat fully stops it.
 */
export const FROST_TIME_BASELINE_S = 30 // 30s from baseline alone — punishing to make the torch a hard dependency


// MARK: Snow-depth contribution
/**
 * Snow depth is exposed by src/client/snow/snowQuery.ts via getSnowStageAtWorld()
 * as a 0..3 integer:
 *   0 — no snow / melted path            (safe, no snow contribution)
 *   1 — dusting                          (mild)
 *   2 — mid depth                        (dangerous)
 *   3 — full untouched snow              (very dangerous)
 *
 * Values are seconds-to-freeze from 0% while standing in that depth,
 * counting the snow term ALONE. Torch does not halt this term — wading
 * through snow always chills you regardless of what's in your hand.
 * Stage 0 is Infinity so bare paths add no snow-based frost.
 *
 * Effective time-to-freeze combines rates additively:
 *   day, torchless: (1 / BASELINE) + (1 / SNOW_STAGE[stage])
 *   day, torch:     snow term only
 *   night, torch:   (1 / leak) + snow * snowFrostMul
 *   at fire:        -(1 / THAW)
 */
export const FROST_TIME_SNOW_STAGE_S: Record<0 | 1 | 2 | 3, number> = {
	0: Number.POSITIVE_INFINITY,
	1: 600, // shallow snow adds a slow drip
	2: 300, // mid snow adds a meaningful chill
	3: 180, // deep snow adds serious chill
}


// MARK: Warmth recovery
/**
 * Seconds the Warm tier takes to clear a full bar at night on bare
 * ground. The live rate is TIER_WARMTH_PER_S in hearthFuel.ts, which
 * nets against the cold instead of cancelling it. Kept so that 45s
 * target stays next to the freeze times it was chosen against.
 */
export const FROST_TIME_TO_THAW_S = 45


// MARK: Sampling cadence
/**
 * How often the accumulation system polls player position + snow depth.
 * 5 Hz is plenty for a 2-3 minute survival timer and keeps the per-frame
 * cost off the render loop.
 */
export const FROST_SAMPLE_INTERVAL_S = 0.2


// MARK: Warmth reserve
/**
 * Warmth reserve W (frost points, 0..FROST_MAX - frost), shown yellow
 * on the heat bar: a safe / vulnerable indicator, not a buffer.
 * Whenever main's model would add frost, W drains at a fixed rate (a
 * full bar in WARMTH_DRAIN_S, whatever the cold); frost then grows at
 * main's normal rate once W is 0. Freeze times = main's + <= 7 s.
 * A lit torch with no cold on it, or a fire ring that is warming or
 * holding, refills W (after WARMTH_REFILL_DELAY_S of being safe).
 */
export const WARMTH_DRAIN_S = 7
/** Seconds to refill an empty reserve to a full bar (100 points). */
export const WARMTH_REFILL_S = 3
/**
 * Day/dawn, torch out, no fire ring, NOT on snow: W drains slowly
 * (full bar in this many s). Once it is empty, frost creeps up at
 * FROST_DAY_IDLE_FILL_S. On snow the normal fast drain + cold apply.
 */
export const WARMTH_DAY_IDLE_DRAIN_S = 60
/**
 * Same day-idle case, once W is empty: seconds from 0 to full frost
 * (100) at this slow creep. Reaching 100 freezes you as normal.
 */
export const FROST_DAY_IDLE_FILL_S = 180
/** Safe this long (continuous) before W starts refilling: no flicker at snow edges. */
export const WARMTH_REFILL_DELAY_S = 0.5


// MARK: Freeze resolve
/** How long a frozen player waits before the freeze resolves on its own. */
export const ICE_RESOLVE_S = 15
/** How long a lit torch must be held against a frozen player to thaw them. */
export const ICE_THAW_S = 3
/** Seconds to restore one third of a cube after the torch leaves. */
export const ICE_REGROW_S = 1
/** Meters from a frozen player at which a lit torch starts the thaw. */
export const ICE_RESCUE_RADIUS_M = 3
