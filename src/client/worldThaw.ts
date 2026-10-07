/**
 * worldThaw.ts — client reaction to the server 3/3 station thaw.
 *
 * Server clears snow + forces CLEAR weather and broadcasts
 * worldThawState. This module reveals lava, shows the victory card,
 * and arms local snowfall stop (weatherState also arrives).
 */

import { beginVolcanoThaw } from 'src/client/volcanoCrown'
import { beginThawSplash, setupThawSplash } from 'src/client/thawSplash'
import { onCycleSeedChange, getCurrentCycleSeed } from 'src/client/cycle'
import { cycleSeedsEqual } from 'src/shared/cycleMazeSeed'
import { room } from 'src/shared/messages'
import { activeTerrain } from 'src/shared/terrain/terrainCache'
import {
	ThawWaveCentre,
	thawHeatFactor,
	thawTileDistAt,
	thawWaveCentre,
	thawWaveRadiusTiles,
	POST_THAW_DAYS,
} from 'src/shared/terrain/thawWave'


let thawed = false
/** Server day number of the thaw (0 = unknown / not thawed). */
let thawDay = 0
let currentSeed = 0
/** Local Date.now() equivalent of the server's thaw start. */
let waveStartLocalMs = 0
let waveCentre: ThawWaveCentre | null = null
let waveCentreMap: unknown = null
let installed = false


export function isWorldThawed(): boolean {
	return thawed
}


/**
 * Days of warmth left on the given day (POST_THAW_DAYS..1), or 0 outside the post-win
 * countdown (not thawed, or still on the thaw day itself).
 */
function centre(): ThawWaveCentre {
	const map = activeTerrain()
	if (waveCentre === null || waveCentreMap !== map) {
		waveCentre    = thawWaveCentre(map)
		waveCentreMap = map
	}
	return waveCentre
}


/** Current melt-wave radius in tiles, or -1 when not thawed. */
function waveRadius(): number {
	if (!thawed) return -1
	return thawWaveRadiusTiles(Date.now() - waveStartLocalMs, centre().radius)
}


/** True once the thaw melt wave has reached world (x, z). */
export function thawWaveReachedAt(x: number, z: number): boolean {
	const r = waveRadius()
	if (r < 0) return false
	return thawTileDistAt(centre(), x, z) <= r
}


/** True once the wave has reached any part of an axis-aligned world rect. */
export function thawWaveReachedRect(
	centerX: number,
	centerZ: number,
	sizeX  : number,
	sizeZ  : number,
): boolean {
	const r = waveRadius()
	if (r < 0) return false
	const c  = centre()
	const wx = c.x
	const wz = c.z
	const nx = Math.max(centerX - sizeX / 2, Math.min(centerX + sizeX / 2 - 0.01, wx))
	const nz = Math.max(centerZ - sizeZ / 2, Math.min(centerZ + sizeZ / 2 - 0.01, wz))
	return thawTileDistAt(c, nx, nz) <= r
}


/**
 * Volcano-campfire heat 0..1 at world (x, z): 1 inside the thaw zone,
 * fading to 0 over THAW_EDGE_BAND_M at the (growing) wave edge.
 */
export function thawHeatAt(x: number, z: number): number {
	const r = waveRadius()
	if (r <= 0) return 0
	return thawHeatFactor(centre(), r, x, z)
}


export function winterDaysLeft(day: number): number {
	if (!thawed || thawDay <= 0) return 0
	const left = thawDay + POST_THAW_DAYS + 1 - day
	return left >= 1 && left <= POST_THAW_DAYS ? left : 0
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

	room.onMessage('worldThawState', ({ seed, thawed: flag, thawDay: day, waveAgeMs }) => {
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
		if (flag === 1) waveStartLocalMs = Date.now() - Math.max(0, waveAgeMs)
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
