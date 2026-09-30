/**
 * emberFail.ts — shared timing for the world-end cards.
 *
 * Cards play on black (flame out → centuries → civilization). The
 * server reseeds as soon as black is up so the new winter builds
 * under the cards. Clients hold the last line until that load
 * finishes, then fade the world in.
 *
 * A fire burning out no longer starts this. The dev snuff still does,
 * until extinction moves to the last player freezing.
 */


// MARK: Timing
// Whole sequence is ~7.9 s when the new world is ready in time:
// fade out 0.9 + two full cards 2 × 2.0 + last card in/hold 1.55 + fade in 1.4.

/** Seconds to fade the world to black after the last fire dies. */
export const EMBER_FAIL_FADE_OUT_S = 0.9

/** Fade in / out for each title card. */
export const EMBER_FAIL_LINE_FADE_S = 0.45

/** How long a card sits fully visible. */
export const EMBER_FAIL_LINE_HOLD_S = 1.1

/**
 * Reseed as soon as the fade-to-black has finished so the new seed
 * generates under the title cards.
 */
export const EMBER_FAIL_REBUILD_DELAY_S = EMBER_FAIL_FADE_OUT_S

/** Seconds to fade the new winter in under the last line. */
export const EMBER_FAIL_FADE_IN_S = 1.4


// MARK: emberFailLine1

/**
 * Opening card. `nights` is how many dusks this run survived
 * (0 = died before the first sunset).
 */
export function emberFailLine1(nights: number): string {
	if (nights <= 0) return "The world's flame goes out."
	if (nights === 1) return 'After one night, the flame dies.'
	return `After ${nights} nights, the flame dies.`
}


// MARK: emberFailLine2

/** Time-skip card between the death and the new winter. */
export function emberFailLine2(): string {
	return 'Centuries pass in the dark.'
}


// MARK: emberFailLine3

/** Closing card, held over the fade-in of the rebuilt world. */
export function emberFailLine3(): string {
	return 'A new civilization begins.'
}
