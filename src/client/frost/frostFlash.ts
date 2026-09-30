/**
 * frostFlash.ts — brief full-screen blue flash each time the frost bar
 * grows a new blue segment.
 *
 * Modelled on flagtag's hitFlashState.ts (red flash on hit): a global
 * alpha value that decays linearly toward zero over a fixed duration.
 * layer.frostFlash.tsx renders a full-screen overlay driven by that
 * alpha; the segment-detection system below polls getFrostLocal each
 * frame and calls triggerFrostFlash whenever the blue block count
 * increases. While a fire is thawing remaining frost, a separate gold
 * overlay breathes once per bar segment, in step with the refill,
 * then fades out once the bar reads full.
 *
 * Segment count comes from visibleColdSegments() in accumulation.ts,
 * the same count the frost bar draws, so the flash lands on the
 * steps the player actually sees.
 */

import { engine } from '@dcl/sdk/ecs'

import { FROST_MAX } from 'src/shared/frost/tuning'

import { FROST_BAR_SEGMENTS, getFrostLocal, isPlayerWarming, visibleColdSegments } from 'src/client/frost/accumulation'


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
// One gold breath per heat-bar segment. The phase is the segment
// currently refilling, so the pulse tracks the thaw instead of a
// fixed timer. Peak stays under the cold flash.
const WARM_PULSE_PEAK = 0.14
// How fast the wash can rise when you step into a fire mid-segment,
// so it does not pop to full strength.
const WARM_ENTER_S    = 0.45
// Leaving the fire, or the bar reading full, eases the current wash
// out instead of cutting it off.
const WARM_FADE_OUT_S = 0.8


// MARK: State
let flashAlpha    = 0
let flashElapsed  = 0
let warmAlpha     = 0
let warmBlend     = 0
let wasWarming    = false
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


// MARK: getWarmFlashAlpha

/** Current warm-overlay alpha in [0, WARM_PULSE_PEAK]. Zero = don't draw. */
export function getWarmFlashAlpha(): number {
	return warmAlpha
}


// MARK: initFrostFlash
/**
 * Register the per-frame system that fades the cold flash, breathes
 * the warm overlay while a fire is thawing frost, and retriggers the
 * cold flash when a new blue segment appears. Call once from client
 * bootstrap after initFrostAccumulation.
 */
export function initFrostFlash(): void {
	lastBlueCount = visibleColdSegments(getFrostLocal())

	engine.addSystem((dt: number) => {
		// Fade.
		if (flashAlpha > 0) {
			flashElapsed += dt
			const t = Math.min(1, flashElapsed / FLASH_DURATION_S)
			flashAlpha = FLASH_PEAK_ALPHA * (1 - t)
			if (flashAlpha < 0.001) flashAlpha = 0
		}
		// One breath per segment still refilling. The bar reads full
		// before frost hits exactly 0, and the wash stops on that
		// read: fade whatever is up, then stay clear.
		const frost   = getFrostLocal()
		const cold    = visibleColdSegments(frost)
		const warming = isPlayerWarming() && cold > 0
		if (warming) {
			if (!wasWarming) warmBlend = 0
			warmBlend = Math.min(1, warmBlend + dt / WARM_ENTER_S)
			const warmthPct = 1 - frost / FROST_MAX
			const into      = warmthPct * FROST_BAR_SEGMENTS
			const frac      = into - Math.floor(into)
			const pulse     = WARM_PULSE_PEAK * Math.sin(Math.PI * frac)
			warmAlpha = pulse * warmBlend
			wasWarming = true
		} else {
			wasWarming = false
			warmBlend  = 0
			if (warmAlpha > 0) {
				warmAlpha -= (WARM_PULSE_PEAK / WARM_FADE_OUT_S) * dt
				if (warmAlpha < 0.001) warmAlpha = 0
			}
		}

		if (cold > lastBlueCount) triggerFrostFlash()
		lastBlueCount = cold
	})

	console.log('frostFlash: initFrostFlash: cold flash and warm pulse armed')
}
