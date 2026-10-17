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
 * A lit torch cancels ALL frost gain, day and night (ambient and
 * snow). Night is harder only through the night freeze rate when the
 * torch is out and TORCH_NIGHT_DRAIN_MULT on the torch's fuel.
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
 * counting the snow term ALONE. A lit torch halts this term too (the
 * torch blocks every frost source).
 * Stage 0 is Infinity so bare paths add no snow-based frost.
 *
 * Effective time-to-freeze combines rates additively:
 *   torchless:      ambient + snow * snowFrostMul (day: only while
 *                   touching snow, see SNOW_CONTACT_ONLY_PHASES)
 *   lit torch:      0 (any phase)
 *   at fire:        cold - warmth (never a gain while the torch is lit)
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


// MARK: Torch vs night
/**
 * Torch fuel burns this much faster in the dark phases (DUSK, NIGHT,
 * SOLSTICE_WARN, SOLSTICE). Fed into PhaseConfig.torchDrainMul. 1.75
 * turns the 30 s torch into ~17 s, which keeps a full night trek
 * (torch then open air) about as long as the old torch-leak rule.
 */
export const TORCH_NIGHT_DRAIN_MULT = 1.75

/**
 * Frost sets the torch's max fuel: cap = TORCH_FUEL_MAX_S * (1 - frost).
 * Relight / chain-light fill only to the cap, and stored fuel above a
 * falling cap is clamped (frost only rises while the torch is out).
 * A fire lowers frost, which raises the cap but adds no fuel.
 * false = old rule: full 30 s tank, frost only shrinks the yellow on
 * screen.
 */
export const FROST_REDUCES_TORCH_CAPACITY = true


// MARK: Respawn / rescue warmth
/**
 * Warmth (1 - frost fraction) left after waking at a fire. Equals the
 * old "3 gold segments" seed (frost 79 of 100).
 */
export const WAKE_WARMTH_FRAC = 0.21
/** Warmth left after a teammate's torch thaw. Old "5 segments" (frost 59). */
export const RESCUE_WARMTH_FRAC = 0.41


// MARK: Freeze resolve
/** How long a frozen player waits before the freeze resolves on its own. */
export const ICE_RESOLVE_S = 15
/** How long a lit torch must be held against a frozen player to thaw them. */
export const ICE_THAW_S = 3
/** Seconds to restore one third of a cube after the torch leaves. */
export const ICE_REGROW_S = 1
/** Meters from a frozen player at which a lit torch starts the thaw. */
export const ICE_RESCUE_RADIUS_M = 3
