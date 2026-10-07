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
import { meltAllSnow, meltDisc, publishCoverageIfDirty } from 'src/server/snowState'
import { activeTerrain } from 'src/shared/terrain/terrainCache'
import { cellCenterWorld } from 'src/shared/terrain/terrainMap'
import { CRATER_HEAT_RADIUS_M } from 'src/shared/terrain/volcanoCraterHeat'
import { clearWeatherThawLock } from 'src/server/weather'
import { POST_THAW_DAYS } from 'src/shared/terrain/thawWave'

const STATION_COUNT = 3

let currentSeed = 0
const active: boolean[] = [false, false, false]
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
	for (let i = 0; i < STATION_COUNT; i++) active[i] = false
	worldThawed = false
	thawDay = 0
	clearWeatherThawLock()
	console.log(`[Server] stations: reset for cycle seed=${currentSeed}`)
	for (let i = 0; i < STATION_COUNT; i++) broadcastOne(i)
	broadcastThaw()
}


// MARK: meltLitStationHeat
/**
 * Lit monuments are eternal Warm campfires: melt + heat-protect a
 * CRATER_HEAT_RADIUS_M disc around each. No fuel, never snuffs.
 * Called on ignite and from the server's 2 Hz crater-heat tick.
 */
export function meltLitStationHeat(): number {
	const map = activeTerrain()
	if (!map) return 0
	let changed = 0
	const n = Math.min(map.stations.length, STATION_COUNT)
	for (let i = 0; i < n; i++) {
		if (!active[i]) continue
		const st = map.stations[i]
		const c = cellCenterWorld(st.cx, st.cz)
		changed += meltDisc(c.x, c.z, CRATER_HEAT_RADIUS_M)
	}
	return changed
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
	}
	room.send(
		'worldThawState',
		{ seed: currentSeed, thawed: worldThawed ? 1 : 0, thawDay: worldThawed ? thawDay : 0, waveAgeMs: thawWaveAgeMs() },
		{ to: [userId] },
	)
}


export function setupStationsServer(): void {
	currentSeed = getCurrentCycleSeed()
	for (let i = 0; i < STATION_COUNT; i++) active[i] = false
	worldThawed = false
	console.log(`[Server] stations: setup seed=${currentSeed}`)

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
		active[index] = true
		console.log(
			`[Server] stations[${index}]: activated by ${from} ` +
			`(seed=${currentSeed}, active=${getActiveStationCount()}/${STATION_COUNT})`,
		)
		broadcastOne(index, true)
		meltLitStationHeat()
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
			broadcastOne(i, true)
		}
		meltLitStationHeat()
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
