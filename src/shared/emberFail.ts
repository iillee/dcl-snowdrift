/**
 * emberFail.ts — shared timing for the world-end cards.
 *
 * Cards play on black (the flame goes out → centuries → a new fire
 * → don't let the fire die). The server reseeds as soon as black is
 * up, on the fade-out clock, so the new dawn is not waiting on the
 * cards. Clients hold the last line until that load finishes, then
 * fade the world in.
 *
 * A fire burning out no longer starts this. The dev snuff still does,
 * until extinction moves to the last player freezing.
 */


// MARK: Timing
// When the new world is already ready, the cover lifts near the end
// of the 12 s dawn. Dawn starts at the reseed (0.9 s in), not when
// the cards finish. Cards 1–3 are shorter than a four-second beat so
// the fourth line is up while the sun is still rising:
// fade 0.9 + three cards of 2.9 + blacks 0.3+0.35+0.3 + card in 0.75
// + fade in 1.4 = 12.7 s from the fail. Dawn ends at 12.9 s.

/** Seconds to fade the world to black after the last fire dies. */
export const EMBER_FAIL_FADE_OUT_S = 0.9

/** Fade in / out for each title card. */
export const EMBER_FAIL_LINE_FADE_S = 0.75

/**
 * How long cards 1–3 sit fully visible. Shorter than the old 2.5 s
 * so the fourth card still fades the world in during dawn.
 */
export const EMBER_FAIL_LINE_HOLD_S = 1.4

/** Black between card 1 and card 2. */
export const EMBER_FAIL_GAP_1_S = 0.3

/** Black between card 2 and card 3. */
export const EMBER_FAIL_GAP_2_S = 0.35

/** Black between card 3 and card 4. */
export const EMBER_FAIL_GAP_3_S = 0.3

/**
 * Reseed as soon as the fade-to-black has finished so the new seed
 * generates under the title cards. This stays tied to the fade, not
 * the card holds, so a longer cinematic does not push dawn back.
 */
export const EMBER_FAIL_REBUILD_DELAY_S = EMBER_FAIL_FADE_OUT_S

/** Seconds to fade the new winter in under the last line. */
export const EMBER_FAIL_FADE_IN_S = 1.4


// MARK: emberFailLine1

/**
 * Opening card. `days` is the day counter for this run (Day 1 at
 * the first dawn). Always a numeral, matching the HUD.
 */
export function emberFailLine1(days: number): string {
	const n    = days < 1 ? 1 : Math.floor(days)
	const unit = n === 1 ? 'day' : 'days'
	return `After ${n} ${unit}, the world's flame goes out.`
}


// MARK: emberFailLine2

/** Time-skip card between the death and the new winter. */
export function emberFailLine2(): string {
	return 'Centuries pass in the cold.'
}


// MARK: emberFailLine3

/** The new winter is lit. Timed like cards 1 and 2. */
export function emberFailLine3(): string {
	return 'A new fire is kindled.'
}


// MARK: COLD_OPEN_LINE

/** Same line as the cold-open black. Card 4 holds it over the fade-in. */
export const COLD_OPEN_LINE = "Don't let the fire die"


// MARK: emberFailLine4

/** Last card. Held until the new world is ready, then fades with it. */
export function emberFailLine4(): string {
	return COLD_OPEN_LINE
}
