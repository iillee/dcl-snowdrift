/**
 * frostFlash.ts — brief full-screen blue flash each time the frost bar
 * grows a new blue segment.
 *
 * Modelled on flagtag's hitFlashState.ts (red flash on hit): a global
 * alpha value that decays linearly toward zero over a fixed duration.
 * layer.frostFlash.tsx renders a full-screen overlay driven by that
 * alpha; the segment-detection system below polls getFrostLocal each
 * frame and calls triggerFrostFlash whenever the blue block count
 * increases.
 *
 * Segment count comes from visibleColdSegments() in accumulation.ts,
 * the same count the frost bar draws, so the flash lands on the
 * steps the player actually sees.
 */

import { engine } from '@dcl/sdk/ecs'

import { getFrostLocal, visibleColdSegments } from 'src/client/frost/accumulation'


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


// MARK: State
let flashAlpha    = 0
let flashElapsed  = 0
let lastBlueCount = 0


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
 * Register the per-frame system that fades the cold flash and
 * retriggers it when a new blue segment appears. Call once from
 * client bootstrap after initFrostAccumulation.
 */
export function initFrostFlash(): void {
	lastBlueCount = visibleColdSegments(getFrostLocal())

	engine.addSystem((dt: number) => {
		if (flashAlpha > 0) {
			flashElapsed += dt
			const t = Math.min(1, flashElapsed / FLASH_DURATION_S)
			flashAlpha = FLASH_PEAK_ALPHA * (1 - t)
			if (flashAlpha < 0.001) flashAlpha = 0
		}

		const cold = visibleColdSegments(getFrostLocal())
		if (cold > lastBlueCount) triggerFrostFlash()
		lastBlueCount = cold
	})

	console.log('frostFlash: initFrostFlash: cold flash armed')
}
