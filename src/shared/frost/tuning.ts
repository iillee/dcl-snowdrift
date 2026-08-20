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
 * the "steady drop" the held torch cancels — with a torch equipped
 * this contribution goes to zero and only the snow-depth term (below)
 * can freeze the player.
 */
export const FROST_TIME_BASELINE_S = 30 // 30s from baseline alone — punishing to make the torch a hard dependency


// MARK: Snow-depth contribution
/**
 * Snow depth is exposed by src/client/paint.ts via getSnowStageAtWorld()
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
 *   rate      = (1 / BASELINE) + (1 / SNOW_STAGE[stage])
 *   with torch: rate = 1 / SNOW_STAGE[stage]  (baseline halted)
 *   at fire:    rate = -(1 / THAW)            (active recovery)
 */
export const FROST_TIME_SNOW_STAGE_S: Record<0 | 1 | 2 | 3, number> = {
	0: Number.POSITIVE_INFINITY,
	1: 600, // shallow snow adds a slow drip
	2: 300, // mid snow adds a meaningful chill
	3: 180, // deep snow adds serious chill
}


// MARK: Warmth recovery
/**
 * Seconds to fully recover from 100% -> 0% while inside the campfire's
 * heat radius (defined in src/shared/campfire.ts as CAMPFIRE_MELT_RADIUS_M).
 * Chosen faster than the freeze rate so the fire always feels like a
 * relief, not a slow drip.
 */
export const FROST_TIME_TO_THAW_S = 45


// MARK: Sampling cadence
/**
 * How often the accumulation system polls player position + snow depth.
 * 5 Hz is plenty for a 2-3 minute survival timer and keeps the per-frame
 * cost off the render loop.
 */
export const FROST_SAMPLE_INTERVAL_S = 0.2
