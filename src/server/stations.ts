/**
 * stations.ts — authoritative ignition-station activation + world thaw.
 *
 * Three sockets per cycle. First valid activate wins per index.
 * When all three are active, fire one world thaw for the cycle:
 * melt all snow, force CLEAR weather, broadcast worldThawState.
 * Reset on cycle roll. Late joiners hydrate stations + thaw flag.
 */

import { DEBUG_THAW_BUTTON } from 'src/client/devFlags'
import { onCycleRoll, getCurrentCycleSeed, rollCycle } from 'src/server/cycle'
import { getDayNumber, onPhaseChange } from 'src/server/phase'
import { cycleSeedsEqual } from 'src/shared/cycleMazeSeed'
import { room } from 'src/shared/messages'
import { meltAllSnow, meltMonumentIceSquare, publishCoverageIfDirty, releaseMonumentPitSquare } from 'src/server/snowState'
import { clearWeatherThawLock } from 'src/server/weather'
import {
	MONUMENT_ICE_CHUNK_M,
	MONUMENT_ICE_FULL_MASK,
	iceChunkOffset,
	iceFullyMelted,
	isIceChunk,
	stationHasIce,
} from 'src/shared/monumentIce'
import { activeTerrain } from 'src/shared/terrain/terrainCache'
import { MONUMENT_PIT_SIZE_M, MONUMENT_SOCKET_SIZE_M, cellCenterWorld } from 'src/shared/terrain/terrainMap'
import { POST_THAW_DAYS } from 'src/shared/terrain/thawWave'

const STATION_COUNT = 3

let currentSeed = 0
const active: boolean[] = [false, false, false]
/** Melted ice-chunk bitmask per monument (src/shared/monumentIce.ts). */
const iceMask: number[] = [0, 0, 0]
let worldThawed = false
/**
 * Day number the thaw happened on. Players get the rest of that day
 * plus POST_THAW_DAYS full days (countdown at each sunrise); at the sunrise
 * of thawDay + POST_THAW_DAYS + 1 the world rolls to a new winter.
 */
let thawDay = 0
/** Date.now() when the thaw fired (melt-wave origin time). */
let thawStartMs = 0
function thawWaveAgeMs(): number {
	return worldThawed ? Math.max(0, Math.min(2147483647, Date.now() - thawStartMs)) : 0
}


function broadcastOne(index: number, fresh = false): void {
	room.send('stationState', {
		seed  : currentSeed,
		index,
		active: active[index] ? 1 : 0,
		fresh : fresh ? 1 : 0,
	})
}


function broadcastIce(index: number, to?: string): void {
	const payload = { seed: currentSeed, index, mask: iceMask[index] }
	if (to !== undefined) room.send('monumentIceState', payload, { to: [to] })
	else room.send('monumentIceState', payload)
}


/**
 * Clear + protect the snow lying on ice chunk `chunk` of monument
 * `index` (it melted with the ice; clients drop it from the ice top
 * to nothing). Once the whole mound is free, the obelisk column too, so
 * the empty recess stays snow-free until activation.
 */
function clearSnowOverChunk(index: number, chunk: number): void {
	const st = activeTerrain()?.stations[index]
	if (!st) return
	const c = cellCenterWorld(st.cx, st.cz)
	const o = iceChunkOffset(chunk)
	meltMonumentIceSquare(c.x + o.dx, c.z + o.dz, MONUMENT_ICE_CHUNK_M)
	if (iceFullyMelted(iceMask[index])) {
		meltMonumentIceSquare(c.x, c.z, Math.ceil(MONUMENT_SOCKET_SIZE_M))
	}
}


/**
 * Monument `index` activated (the obelisk rose out): stop keeping its
 * empty recess snow-free so snowfall buries it again. The cells keep
 * their melted stage and regrow normally; clients draw them from the
 * recess floor so the shallow step fills back to ground level.
 * protectedCells is cleared on cycle wipe (clearAllSnow).
 */
function releasePitSnow(index: number): void {
	const st = activeTerrain()?.stations[index]
	if (!st) return
	const c = cellCenterWorld(st.cx, st.cz)
	const n = releaseMonumentPitSquare(c.x, c.z, MONUMENT_PIT_SIZE_M)
	console.log(`[Server] stations[${index}]: pit snow released (${n} cells regrow)`)
}


function broadcastThaw(): void {
	room.send('worldThawState', {
		seed  : currentSeed,
		thawed: worldThawed ? 1 : 0,
		thawDay: worldThawed ? thawDay : 0, waveAgeMs: thawWaveAgeMs(),
	})
}


function triggerWorldThaw(reason: string): void {
	if (worldThawed) return
	worldThawed = true
	thawDay = getDayNumber()
	thawStartMs = Date.now()
	console.log(`[Server] stations: WORLD THAW (${reason}) seed=${currentSeed}`)
	meltAllSnow()
	publishCoverageIfDirty()
	// No global CLEAR lock any more: only the thaw zone is warm, and
	// snowfall / regrowth must keep running outside it.
	broadcastThaw()
}


function maybeThaw(reason: string): void {
	if (getActiveStationCount() >= STATION_COUNT) triggerWorldThaw(reason)
}


function resetForCycle(seed: number): void {
	currentSeed = seed
	for (let i = 0; i < STATION_COUNT; i++) { active[i] = false; iceMask[i] = 0 }
	worldThawed = false
	thawDay = 0
	clearWeatherThawLock()
	console.log(`[Server] stations: reset for cycle seed=${currentSeed}`)
	for (let i = 0; i < STATION_COUNT; i++) { broadcastOne(i); broadcastIce(i) }
	broadcastThaw()
}


export function getActiveStationCount(): number {
	let n = 0
	for (const a of active) if (a) n++
	return n
}


export function isWorldThawed(): boolean {
	return worldThawed
}


export function sendStationStateTo(userId: string): void {
	for (let i = 0; i < STATION_COUNT; i++) {
		room.send(
			'stationState',
			{ seed: currentSeed, index: i, active: active[i] ? 1 : 0, fresh: 0 },
			{ to: [userId] },
		)
		broadcastIce(i, userId)
	}
	room.send(
		'worldThawState',
		{ seed: currentSeed, thawed: worldThawed ? 1 : 0, thawDay: worldThawed ? thawDay : 0, waveAgeMs: thawWaveAgeMs() },
		{ to: [userId] },
	)
}


export function setupStationsServer(): void {
	currentSeed = getCurrentCycleSeed()
	for (let i = 0; i < STATION_COUNT; i++) { active[i] = false; iceMask[i] = 0 }
	worldThawed = false
	console.log(`[Server] stations: setup seed=${currentSeed}`)

	room.onMessage('monumentIceMelt', ({ seed, index, chunk }, context) => {
		const from = context?.from ?? 'unknown'
		if (!cycleSeedsEqual(seed, currentSeed)) return
		if (index < 0 || index >= STATION_COUNT) return
		if (!isIceChunk(chunk)) return
		if (!stationHasIce(activeTerrain(), index)) return
		if (active[index]) return
		const bit = 1 << chunk
		if ((iceMask[index] & bit) !== 0) {
			// Already melted: echo so a racing client converges.
			broadcastIce(index, context?.from)
			return
		}
		iceMask[index] = (iceMask[index] | bit) & MONUMENT_ICE_FULL_MASK
		clearSnowOverChunk(index, chunk)
		publishCoverageIfDirty()
		broadcastIce(index)
		if (iceFullyMelted(iceMask[index])) {
			console.log(`[Server] stations[${index}]: ice fully melted (last chunk ${chunk} by ${from})`)
		}
	})

	room.onMessage('stationActivate', ({ seed, index }, context) => {
		const from = context?.from ?? 'unknown'
		console.log(
			`[Server] stations: RX activate seed=${seed} index=${index} from=${from} ` +
			`(currentSeed=${currentSeed} active[${index}]=${active[index] ?? '?'})`,
		)
		if (!cycleSeedsEqual(seed, currentSeed)) {
			console.log(
				`[Server] stations: activate rejected from ${from} — stale seed ` +
				`(got ${seed}, want ${currentSeed})`,
			)
			return
		}
		if (index < 0 || index >= STATION_COUNT) {
			console.log(
				`[Server] stations: activate rejected from ${from} — bad index ${index}`,
			)
			return
		}
		if (active[index]) {
			console.log(`[Server] stations[${index}]: activate from ${from} ignored — already active`)
			broadcastOne(index)
			if (worldThawed) broadcastThaw()
			return
		}
		// Only the iced monument needs its ice melted; the others ignite at once.
		if (stationHasIce(activeTerrain(), index) && !iceFullyMelted(iceMask[index])) {
			console.log(
				`[Server] stations[${index}]: activate from ${from} rejected - ice not melted ` +
				`(mask=${iceMask[index].toString(2)})`,
			)
			broadcastOne(index)
			broadcastIce(index, context?.from)
			return
		}
		active[index] = true
		releasePitSnow(index)
		console.log(
			`[Server] stations[${index}]: activated by ${from} ` +
			`(seed=${currentSeed}, active=${getActiveStationCount()}/${STATION_COUNT})`,
		)
		broadcastOne(index, true)
		maybeThaw(`station ${index} by ${from}`)
	})

	// TEMPORARY debug thaw: same path as the 3rd monument (fresh station
	// broadcasts -> grow/spin/beam/SFX on clients, then triggerWorldThaw).
	room.onMessage('debugThaw', ({ seed }, context) => {
		const from = context?.from ?? 'unknown'
		if (!DEBUG_THAW_BUTTON) {
			console.log(`[Server] stations: debugThaw from ${from} ignored (flag off)`)
			return
		}
		if (worldThawed) return
		if (!cycleSeedsEqual(seed, currentSeed)) return
		console.log(`[Server] stations: DEBUG thaw requested by ${from}`)
		for (let i = 0; i < STATION_COUNT; i++) {
			if (active[i]) continue
			active[i] = true
			releasePitSnow(i)
			if (!iceFullyMelted(iceMask[i])) {
				iceMask[i] = MONUMENT_ICE_FULL_MASK
				broadcastIce(i)
			}
			broadcastOne(i, true)
		}
		maybeThaw(`debug button by ${from}`)
		if (!worldThawed) triggerWorldThaw(`debug button by ${from}`)
	})

	onCycleRoll(({ newSeed }) => { resetForCycle(newSeed) })

	// Post-win: after POST_THAW_DAYS full days, winter returns via the
	// normal cycle roll (fresh seed, snow, stations, thaw flag, phase).
	onPhaseChange(() => {
		if (!worldThawed) return
		const day = getDayNumber()
		if (day < thawDay + POST_THAW_DAYS + 1) return
		console.log(`[Server] stations: thaw warmth over (thawDay=${thawDay} day=${day}) - rolling to new winter`)
		worldThawed = false
		rollCycle()
	})
}
