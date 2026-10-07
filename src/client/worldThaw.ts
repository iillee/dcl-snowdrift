/**
 * worldThaw.ts — client reaction to the server 3/3 station thaw.
 *
 * Server clears snow + forces CLEAR weather and broadcasts
 * worldThawState. This module reveals lava, shows the victory card,
 * and arms local snowfall stop (weatherState also arrives).
 */

import { beginVolcanoThaw } from 'src/client/volcanoCrown'
import { beginThawSplash, setupThawSplash } from 'src/client/thawSplash'
import { PrecipitationLevel, setPrecipitation } from 'src/client/snowfall'
import { onCycleSeedChange, getCurrentCycleSeed } from 'src/client/cycle'
import { cycleSeedsEqual } from 'src/shared/cycleMazeSeed'
import { room } from 'src/shared/messages'


let thawed = false
/** Server day number of the thaw (0 = unknown / not thawed). */
let thawDay = 0
let currentSeed = 0
let installed = false


export function isWorldThawed(): boolean {
	return thawed
}


/**
 * Days of warmth left on the given day (3, 2, 1), or 0 outside the post-win
 * countdown (not thawed, or still on the thaw day itself).
 */
export function winterDaysLeft(day: number): number {
	if (!thawed || thawDay <= 0) return 0
	const left = thawDay + 4 - day
	return left >= 1 && left <= 3 ? left : 0
}


function applyThaw(fromHydrate: boolean): void {
	if (thawed) {
		// Late join / duplicate: still ensure lava is up.
		beginVolcanoThaw()
		return
	}
	thawed = true
	console.log(
		`worldThaw: applyThaw seed=${currentSeed}` +
		`${fromHydrate ? ' (hydrate)' : ''}`,
	)
	beginVolcanoThaw()
	setPrecipitation(PrecipitationLevel.CLEAR)
	if (!fromHydrate) beginThawSplash()
	else beginThawSplash() // show card for late joiners too so they know
}


function resetForSeed(seed: number): void {
	if (cycleSeedsEqual(seed, currentSeed) && currentSeed !== 0) return
	currentSeed = seed
	thawed = false
	thawDay = 0
}


export function setupWorldThaw(): void {
	if (installed) return
	installed = true
	currentSeed = getCurrentCycleSeed()
	setupThawSplash()

	room.onMessage('worldThawState', ({ seed, thawed: flag, thawDay: day }) => {
		if (!cycleSeedsEqual(seed, currentSeed) && currentSeed !== 0) {
			// Adopt seed if we somehow missed the cycle packet.
			if (flag === 1) currentSeed = seed
			else {
				console.log(
					`worldThaw: ignore worldThawState seed=${seed} (have ${currentSeed})`,
				)
				return
			}
		}
		thawDay = flag === 1 ? day : 0
		if (flag === 1) {
			// Never let a thaw-side error escape into the message pump.
			try { applyThaw(false) } catch (err) { console.error('worldThaw: applyThaw failed:', err) }
		}
		else {
			thawed = false
		}
	})

	onCycleSeedChange(({ newSeed }) => {
		resetForSeed(newSeed)
	})

	console.log('worldThaw: setupWorldThaw: installed')
}
