/**
 * volcanoStages.ts — every tunable for the staged volcano, in one place.
 *
 * Stage = activated obelisks (0..3). The server owns the stage (thaw
 * radius / heat / snow); clients drive lava + smoke from the count of
 * obelisks whose volcano beam has landed (same number once each beam
 * lands), so the volcano reacts on screen when the beam arrives.
 *
 * Each table is indexed by stage [0, 1, 2, 3]. Pure; client + server.
 */


// MARK: Thaw zone (server-authoritative; heat radius = thaw radius)
/**
 * Thaw / heat radius per stage, metres from the crater tile centre.
 * Stage 3 is the victory thaw and is never smaller than the per-map area
 * radius (THAW_AREA_FRACTION x THAW_RADIUS_SCALE in thawWave.ts: 191-220 m
 * on the 52x52 map, 354-440 m on the 100x100 profile).
 */
export const THAW_STAGE_RADIUS_M: readonly number[] = [0, 40, 80, 260]
/**
 * Seconds for a stage's wave to travel from the previous stage radius to
 * its own (scaled by the distance actually left, capped at 1.5x).
 */
export const THAW_STAGE_WAVE_S: readonly number[] = [0, 10, 12, 45]
/**
 * Delay from the server accepting an activation to that stage's wave
 * starting: the volcano beam landing on the igniting player's screen.
 * OBELISK_RISE_S 10 + CINE_SETTLE_S 0.6 + CINE_VOLCANO_DRAW_S 1.8 = 12.4 s
 * (non-cinematic viewers: 10 + 0.6 + 1.2 + 1.5 = 13.3 s).
 */
export const THAW_STAGE_START_DELAY_S = 12.5
/**
 * Soft heat edge: warmth / cold-block fade over this many metres inside
 * the wave edge, capped at THAW_EDGE_BAND_FRAC of the radius so the small
 * stage 1 zone is still fully warm in its middle.
 */
export const THAW_EDGE_BAND_M    = 16
export const THAW_EDGE_BAND_FRAC = 0.25


// MARK: Lava lake (client; in the crater, grows out from the centre)
/**
 * Share of the lava lake covered, by distance from the lake centre
 * (0..1 of the farthest lava cell). The centre cell is always covered.
 */
export const LAVA_COVER_BY_STAGE: readonly number[] = [0, 0.4, 0.72, 1]
/**
 * Lava lid top above the rim floor (m). Small on purpose: the summit map
 * table's plinth top is rim + 0.5 m and must stay above the lava.
 */
export const LAVA_TOP_BY_STAGE: readonly number[] = [0, 0.06, 0.11, 0.15]
/** Emissive intensity (desktop PBR). Stage 3 = the eruption look. */
export const LAVA_EMISSIVE_BY_STAGE: readonly number[] = [0, 0.8, 1.7, 3]
/** Albedo / basic colour blend 0 = dark crust, 1 = bright eruption orange. */
export const LAVA_HEAT_BY_STAGE: readonly number[] = [0, 0.25, 0.6, 1]
/** Seconds to blend lava height / glow / spread to a new stage. */
export const LAVA_STAGE_BLEND_S = 4
/** Soft edge of the spreading lava front (fraction of the lake radius). */
export const LAVA_EDGE_SOFT = 0.12


/**
 * Torch relight from lava (stage 1+): horizontal reach from the edge of
 * a lit lava cell (m), and how far above the lava top the torch may be
 * (crown lip is 10-14 m above the crater floor, so the rim counts).
 */
export const LAVA_RELIGHT_REACH_M  = 4
export const LAVA_RELIGHT_ABOVE_M  = 15
/** A lava cell counts as lit (relight / wake) once this far spread in (0..1). */
export const LAVA_LIT_MIN_PRESENCE = 0.5


// MARK: Smoke plume (client)
/** Puffs per second. 0 = dormant (no plume, as before). */
export const SMOKE_RATE_BY_STAGE: readonly number[] = [0, 2.5, 6, 14]
/** Puff size multiplier (volume). */
export const SMOKE_SIZE_BY_STAGE: readonly number[] = [0, 0.55, 0.85, 1.3]
/** Launch speed multiplier (height; plume top also capped by the scene limit). */
export const SMOKE_SPEED_BY_STAGE: readonly number[] = [0, 0.55, 0.8, 1]
/** Buoyancy multiplier on the plume's negative gravity (height). */
export const SMOKE_LIFT_BY_STAGE: readonly number[] = [0, 0.5, 0.75, 1]
/** Puff opacity multiplier (density). */
export const SMOKE_ALPHA_BY_STAGE: readonly number[] = [0, 0.5, 0.75, 1]
/** Seconds to blend the plume to a new stage. */
export const SMOKE_STAGE_BLEND_S = 4


/** Clamp any count to a valid stage index 0..3. */
export function volcanoStageIndex(n: number): number {
	return Math.max(0, Math.min(3, Math.floor(n)))
}
