/**
 * frostFlash.ts — full-screen frost tint while the player is taking
 * frost damage, plus a brief blue flash at onset and on each new blue
 * segment.
 *
 * Two parts, composited into one alpha:
 *   - Pulse: FLASH_PEAK_ALPHA, fades over FLASH_DURATION_S. Fires the
 *     moment frost starts rising (isFrostRising() false -> true) and on
 *     each new visible blue segment.
 *   - Sustain: while frost is rising, a steady tint of at least
 *     SUSTAIN_MIN_ALPHA that grows with frost toward SUSTAIN_MAX_ALPHA.
 *     Eases in over SUSTAIN_ATTACK_S and out over SUSTAIN_RELEASE_S once
 *     frost stops rising (warmed, or off the snow), so the boundary
 *     does not flicker. accumulation.ts already holds "rising" for a
 *     short window after the last gain.
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

import { getFrostLocal, isFrostRising, visibleColdSegments } from 'src/client/frost/accumulation'
import { FROST_MAX } from 'src/shared/frost/tuning'


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
// Steady tint while frost is rising: floor at the first sliver of
// blue, rising linearly with frost to the max at a full bar.
const SUSTAIN_MIN_ALPHA = 0.10
const SUSTAIN_MAX_ALPHA = 0.22
// Ease times for the steady tint (seconds to cover the full range).
const SUSTAIN_ATTACK_S  = 0.15
const SUSTAIN_RELEASE_S = 0.6


// MARK: State
let flashAlpha    = 0
let flashElapsed  = 0
let lastBlueCount = 0
let sustainAlpha  = 0
let wasRising     = false


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
/** Current overlay alpha (pulse over steady tint). Zero = don't draw. */
export function getFrostFlashAlpha(): number {
	const a = 1 - (1 - flashAlpha) * (1 - sustainAlpha)
	return a < 0.001 ? 0 : a
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

		const frost  = getFrostLocal()
		const rising = isFrostRising()
		const cold   = visibleColdSegments(frost)
		if ((rising && !wasRising) || cold > lastBlueCount) triggerFrostFlash()
		lastBlueCount = cold
		wasRising     = rising

		const frac   = Math.max(0, Math.min(1, frost / FROST_MAX))
		const target = rising
			? SUSTAIN_MIN_ALPHA + (SUSTAIN_MAX_ALPHA - SUSTAIN_MIN_ALPHA) * frac
			: 0
		if (sustainAlpha < target) {
			sustainAlpha = Math.min(target, sustainAlpha + (SUSTAIN_MAX_ALPHA / SUSTAIN_ATTACK_S) * dt)
		} else if (sustainAlpha > target) {
			sustainAlpha = Math.max(target, sustainAlpha - (SUSTAIN_MAX_ALPHA / SUSTAIN_RELEASE_S) * dt)
		}
	})

	console.log('frostFlash: initFrostFlash: cold flash armed')
}
