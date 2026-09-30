/**
 * frostFlash.ts — brief full-screen blue flash each time the frost bar
 * grows a new blue segment.
 *
 * Modelled on flagtag's hitFlashState.ts (red flash on hit): a global
 * alpha value that decays linearly toward zero over a fixed duration.
 * layer.frostFlash.tsx renders a full-screen overlay driven by that
 * alpha; the segment-detection system below polls getFrostLocal each
 * frame and calls triggerFrostFlash whenever the blue block count
 * increases. A thaw at a fire does the inverse: each blue block that
 * turns back to gold flashes the screen the heat bar's yellow.
 *
 * Segment math is duplicated from layer.frostBar.tsx on purpose so
 * the flash tracks what the player actually SEES, not the raw frost
 * value. If the bar's segmentation changes, mirror it here.
 */

import { engine } from '@dcl/sdk/ecs'

import { getFrostLocal } from 'src/client/frost/accumulation'
import { FROST_MAX }     from 'src/shared/frost/tuning'


// MARK: Tuning
// Peak overlay alpha at the moment a new segment appears. Kept below
// the red hit-flash's 0.35 because gaining a frost segment is a slow
// atmospheric beat, not a combat hit — should read as an ambient chill
// pulse, not an alarm.
const FLASH_PEAK_ALPHA = 0.28
// Full fade duration in seconds. Short enough that back-to-back segment
// gains produce distinct pulses; long enough to actually register on
// mobile where the eye may miss a sub-200 ms flicker.
const FLASH_DURATION_S = 0.6
// Segment resolution — must match SEGMENT_COUNT in layer.frostBar.tsx.
// Duplicated rather than imported to keep this module free of any UI
// layer dependency (the layer imports us, not the other way round).
const SEGMENT_COUNT    = 10


// MARK: State
let flashAlpha    = 0
let flashElapsed  = 0
let warmAlpha     = 0
let warmElapsed   = 0
let lastBlueCount = 0


// MARK: coldBlocks
// Mirror of the warm-block math in layer.frostBar.tsx, then subtracted
// from SEGMENT_COUNT to get the number of visible blue blocks. The bar
// rounds warmth UP (Math.max(1, Math.ceil(warmthPct * SEGMENT_COUNT)))
// so the last sliver of warmth still shows a full warm block — which
// means the FIRST sliver of frost shows ZERO blue blocks. Earlier
// versions of this file ceil-ed on frost directly, so the flash fired
// on first entry into snow while the bar still looked fully warm.
function coldBlocks(frost: number): number {
	if (frost <= 0)         return 0
	if (frost >= FROST_MAX) return SEGMENT_COUNT
	const warmthPct  = 1 - frost / FROST_MAX
	const warmBlocks = Math.max(1, Math.ceil(warmthPct * SEGMENT_COUNT))
	return SEGMENT_COUNT - warmBlocks
}


// MARK: triggerFrostFlash
/**
 * Kick a fresh flash. Called by the segment-detection system when the
 * blue block count crosses upward; also safe to call from tests. Uses
 * `max` so a mid-fade retrigger doesn't visibly dip.
 */
export function triggerFrostFlash(): void {
	flashAlpha   = Math.max(flashAlpha, FLASH_PEAK_ALPHA)
	flashElapsed = 0
}


// MARK: getFrostFlashAlpha
/** Current overlay alpha in [0, FLASH_PEAK_ALPHA]. Zero = don't draw. */
export function getFrostFlashAlpha(): number {
	return flashAlpha
}


// MARK: triggerWarmFlash

/**
 * Kick the heat-bar gold flash. Fires when a blue segment thaws back
 * to gold, which only happens inside a fire's warm ring.
 */
export function triggerWarmFlash(): void {
	warmAlpha   = Math.max(warmAlpha, FLASH_PEAK_ALPHA)
	warmElapsed = 0
}


// MARK: getWarmFlashAlpha

/** Current warm-overlay alpha in [0, FLASH_PEAK_ALPHA]. Zero = don't draw. */
export function getWarmFlashAlpha(): number {
	return warmAlpha
}


// MARK: initFrostFlash
/**
 * Register the per-frame system that (a) fades the flash toward zero
 * and (b) watches for new blue segments and retriggers the flash. Call
 * once from client bootstrap after initFrostAccumulation.
 */
export function initFrostFlash(): void {
	lastBlueCount = coldBlocks(getFrostLocal())

	engine.addSystem((dt: number) => {
		// Fade.
		if (flashAlpha > 0) {
			flashElapsed += dt
			const t = Math.min(1, flashElapsed / FLASH_DURATION_S)
			flashAlpha = FLASH_PEAK_ALPHA * (1 - t)
			if (flashAlpha < 0.001) flashAlpha = 0
		}
		if (warmAlpha > 0) {
			warmElapsed += dt
			const t = Math.min(1, warmElapsed / FLASH_DURATION_S)
			warmAlpha = FLASH_PEAK_ALPHA * (1 - t)
			if (warmAlpha < 0.001) warmAlpha = 0
		}

		// Blue on the way up, gold on the way down. Thaw only happens
		// inside a fire, so a lost blue segment is the warm pulse.
		const now = coldBlocks(getFrostLocal())
		if (now > lastBlueCount) triggerFrostFlash()
		else if (now < lastBlueCount) triggerWarmFlash()
		lastBlueCount = now
	})

	console.log('frostFlash: initFrostFlash: segment-gain flash armed')
}
