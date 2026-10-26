/**
 * worldThaw.ts — client mirror of the server's staged volcano thaw.
 *
 * The server owns the thaw stage (0..3 = activated monuments) and the
 * current melt-wave step (src/shared/terrain/thawWave.ts ThawSegment) and
 * broadcasts both in worldThawState; late joiners place the wave by age.
 * Snow itself arrives through the PaintTile CRDT. This module answers
 * "has the wave reached here?" (ice caps, scatter wood) and "how warm is
 * it here?" (frost model), and shows the victory card at stage 3.
 *
 * Lava and smoke are NOT driven from here: stationMarkers pushes the
 * landed monument count into volcanoCrown / volcanoSmoke so the volcano
 * reacts when the beam lands on screen.
 */

import { beginThawSplash, setupThawSplash } from 'src/client/thawSplash'
import { onCycleSeedChange, getCurrentCycleSeed } from 'src/client/cycle'
import { cycleSeedsEqual } from 'src/shared/cycleMazeSeed'
import { room } from 'src/shared/messages'
import { SNOW_TILE_M } from 'src/shared/snowGrid'
import { activeTerrain } from 'src/shared/terrain/terrainCache'
import {
	ThawSegment,
	ThawWaveCentre,
	thawHeatFactor,
	thawSegmentRadiusM,
	thawTileDistAt,
	thawWaveCentre,
	POST_THAW_DAYS,
	THAW_SPLASH_AT_PROGRESS,
} from 'src/shared/terrain/thawWave'
import { engine } from '@dcl/sdk/ecs'


/** Stage 3 reached (victory thaw) this cycle. */
let thawed = false
/** Volcano thaw stage 0..3 from the server. */
let stage = 0
/** Card waits for the stage 3 wave to reach THAW_SPLASH_AT_PROGRESS. */
let splashPending = false
/** Server day number of the thaw (0 = unknown / not thawed). */
let thawDay = 0
let currentSeed = 0
/** Current wave step in local Date.now() time, and the one before it. */
let seg    : ThawSegment | null = null
let prevSeg: ThawSegment | null = null
let waveCentre: ThawWaveCentre | null = null
let waveCentreMap: unknown = null
let installed = false


/** True once stage 3 (all monuments, world thaw) is reached. */
export function isWorldThawed(): boolean {
	return thawed
}


/** Volcano thaw stage 0..3 as the server last reported it. */
export function getThawStage(): number {
	return stage
}


function centre(): ThawWaveCentre {
	const map = activeTerrain()
	if (waveCentre === null || waveCentreMap !== map) {
		waveCentre    = thawWaveCentre(map)
		waveCentreMap = map
	}
	return waveCentre
}


/** Current thaw radius in metres (0 before the first wave starts). */
export function thawRadiusM(): number {
	if (seg === null) return 0
	const now = Date.now()
	// Waiting for the beam to land: the previous step keeps running.
	if (now < seg.startMs && prevSeg !== null) return Math.min(seg.fromM, thawSegmentRadiusM(prevSeg, now))
	return thawSegmentRadiusM(seg, now)
}


/** Current melt-wave radius in tiles, or -1 when nothing has thawed yet. */
function waveRadius(): number {
	const r = thawRadiusM()
	return r > 0 ? r / SNOW_TILE_M : -1
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
 * Volcano-campfire heat 0..1 at world (x, z): 1 inside the current thaw
 * zone (any stage), fading to 0 across the soft band at the wave edge.
 */
export function thawHeatAt(x: number, z: number): number {
	const r = waveRadius()
	if (r <= 0) return 0
	return thawHeatFactor(centre(), r, x, z)
}


/**
 * Days of warmth left on the given day (POST_THAW_DAYS..1), or 0 outside the post-win
 * countdown (not thawed, or still on the thaw day itself).
 */
export function winterDaysLeft(day: number): number {
	if (!thawed || thawDay <= 0) return 0
	const left = thawDay + POST_THAW_DAYS + 1 - day
	return left >= 1 && left <= POST_THAW_DAYS ? left : 0
}


function resetForSeed(seed: number): void {
	if (cycleSeedsEqual(seed, currentSeed) && currentSeed !== 0) return
	currentSeed = seed
	thawed = false
	stage = 0
	thawDay = 0
	splashPending = false
	seg = null
	prevSeg = null
}


export function setupWorldThaw(): void {
	if (installed) return
	installed = true
	currentSeed = getCurrentCycleSeed()
	setupThawSplash()

	room.onMessage('worldThawState', (msg) => {
		const { seed, thawed: flag, thawDay: day } = msg
		if (!cycleSeedsEqual(seed, currentSeed) && currentSeed !== 0) {
			// Adopt seed if we somehow missed the cycle packet.
			if (msg.stage > 0) currentSeed = seed
			else {
				console.log(
					`worldThaw: ignore worldThawState seed=${seed} (have ${currentSeed})`,
				)
				return
			}
		}
		try {
			const nextStage = Math.max(0, Math.min(3, msg.stage | 0))
			if (nextStage <= 0) {
				stage = 0
				seg = null
				prevSeg = null
			} else {
				const startMs = Date.now() - msg.waveAgeMs
				const next: ThawSegment = { fromM: msg.fromM, toM: msg.toM, startMs, durMs: Math.max(0, msg.waveDurMs) }
				// New step: keep the running one until the new one starts.
				// Duplicate / echo of the same stage: just re-sync timing.
				if (nextStage > stage && seg !== null) prevSeg = seg
				else if (nextStage > stage) prevSeg = null
				seg = next
				if (nextStage !== stage) {
					console.log(
						`worldThaw: stage ${stage} -> ${nextStage} wave ${next.fromM.toFixed(0)} -> ` +
						`${next.toM.toFixed(0)} m over ${(next.durMs / 1000).toFixed(1)} s ` +
						`(age ${(msg.waveAgeMs / 1000).toFixed(1)} s)`,
					)
				}
				stage = nextStage
			}
			thawDay = flag === 1 ? day : 0
			if (flag === 1 && !thawed) {
				thawed = true
				// Card at half of the stage 3 wave. Late joiners past that
				// point see it at once (the poll below fires next frame).
				splashPending = true
				console.log(`worldThaw: world thaw seed=${currentSeed}`)
			} else if (flag !== 1) {
				thawed = false
				splashPending = false
			}
		} catch (err) {
			// Never let a thaw-side error escape into the message pump.
			console.error('worldThaw: worldThawState failed:', err)
		}
	})

	engine.addSystem(() => {
		if (!splashPending || !thawed || seg === null) return
		const progress = seg.durMs > 0 ? (Date.now() - seg.startMs) / seg.durMs : 1
		if (progress < THAW_SPLASH_AT_PROGRESS) return
		splashPending = false
		beginThawSplash()
	})

	onCycleSeedChange(({ newSeed }) => {
		resetForSeed(newSeed)
	})

	console.log('worldThaw: setupWorldThaw: installed')
}
