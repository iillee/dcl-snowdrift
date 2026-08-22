/**
 * frostFlash.ts — brief full-screen blue flash each time the frost bar
 * grows a new blue segment.
 *
 * Modelled on flagtag's hitFlashState.ts (red flash on hit): a global
 * alpha value that decays linearly toward zero over a fixed duration.
 * layer.frostFlash.tsx renders a full-screen overlay driven by that
 * alpha; the segment-detection system below polls getFrostLocal each
 * frame and calls triggerFrostFlash whenever the "blue block count"
 * (ceil(frost/FROST_MAX * SEGMENT_COUNT)) increases.
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
let lastBlueCount = 0


// MARK: coldBlocks
// Same math the frost bar uses to decide how many cold blocks to draw.
// Ceiling so the very first sliver of frost already reads as "1 blue".
function coldBlocks(frost: number): number {
	if (frost <= 0)         return 0
	if (frost >= FROST_MAX) return SEGMENT_COUNT
	const frac = frost / FROST_MAX
	return Math.min(SEGMENT_COUNT, Math.max(1, Math.ceil(frac * SEGMENT_COUNT)))
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

		// Segment gain detection. We only flash on crossings UPWARD:
		// warming back down past a boundary must not fire a flash, or
		// standing next to the fire would strobe blue as frost thaws.
		const now = coldBlocks(getFrostLocal())
		if (now > lastBlueCount) triggerFrostFlash()
		lastBlueCount = now
	})

	console.log('frostFlash: initFrostFlash: segment-gain flash armed')
}
