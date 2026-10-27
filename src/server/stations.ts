/**
 * stations.ts — authoritative ignition-station activation + world thaw.
 *
 * Three sockets per cycle. First valid activate wins per index.
 * Each activation raises the volcano thaw stage (= active count, 0..3):
 * a melt wave grows the warm, snow-free zone around the crater to
 * THAW_STAGE_RADIUS_M[stage] (src/shared/terrain/thawWave.ts). Stage 3
 * is the world thaw (victory card, post-win days, new winter).
 * Reset on cycle roll. Late joiners hydrate stations + thaw stage/wave.
 */

import { DEBUG_THAW_BUTTON } from 'src/client/devFlags'
import { onCycleRoll, getCurrentCycleSeed, rollCycle } from 'src/server/cycle'
import { getDayNumber, onPhaseChange } from 'src/server/phase'
import { cycleSeedsEqual } from 'src/shared/cycleMazeSeed'
import { room } from 'src/shared/messages'
import { meltMonumentIceSquare, meltThawZone, publishCoverageIfDirty, releaseMonumentPitSquare } from 'src/server/snowState'
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
import { SNOW_TILE_M } from 'src/shared/snowGrid'
import {
	POST_THAW_DAYS,
	ThawSegment,
	planThawSegment,
	thawSegmentRadiusM,
	thawWaveCentre,
} from 'src/shared/terrain/thawWave'

import { engine } from '@dcl/sdk/ecs'
import {
	CHARGE_DECAY_ENABLED,
	CHARGE_DECAY_PER_S,
	CHARGE_ICE_GONE_AT,
	MONUMENT_LINK_RANGE_M,
	CRYSTAL_HEAT_RADIUS_M,
	CRYSTAL_THAW_SPREAD_S,
	CRYSTAL_THAW_DELAY_S,
	chainHops,
	chargeHopWeight,
	chargeRateFromWeight,
	isFloatingCrystals,
} from 'src/shared/ruleset'
import { getHiddenFireNodes } from 'src/server/hiddenCampfire'
import { ChargePair, monumentLinkedSlots, setChainHops, setChargePairs, setChargingSlots, slotToucher } from 'src/server/chargeLinks'
import { getVisibleEdges } from 'src/server/fireNetworkLinks'
import { CHARGE_LINK_EDGE_PAD_M, MONUMENT_NODE_ID_BASE } from 'src/shared/ruleset'
import { heatZoneCellCount, meltDisc, releaseDiscOutside, startHeatZoneFront, tickHeatFronts } from 'src/server/snowState'
import { hearthRadiusFromFuel } from 'src/shared/hearthFuel'
import { chargeHeatFuel } from 'src/shared/ruleset'

/** Array capacity (MONUMENT_COUNT max 8). The live count is stationTotal(). */
const STATION_CAP = 8
/** Monuments in the current layout (3 classic, MONUMENT_COUNT crystals). */
function stationTotal(): number {
	const n = activeTerrain()?.stations.length ?? 3
	return Math.max(1, Math.min(STATION_CAP, n))
}
/** Floating crystals: charge 0..1 per monument (server-authoritative). */
const charge: number[] = new Array<number>(STATION_CAP).fill(0)
/** Last charge value broadcast per monument. */
const sentCharge: number[] = new Array<number>(STATION_CAP).fill(-1)
/** Last player to build/feed a fire that charged monument i. */
const chargeBy: string[] = new Array<string>(STATION_CAP).fill('')
const CHARGE_TICK_S = 0.25
const CHARGE_SEND_STEP = 0.004
let chargeAcc = 0

let currentSeed = 0
const active: boolean[] = new Array<boolean>(STATION_CAP).fill(false)
/** Melted ice-chunk bitmask per monument (src/shared/monumentIce.ts). */
const iceMask: number[] = new Array<number>(STATION_CAP).fill(0)
/** Charging-monument heat ring (m) currently melted/protected per monument (0 = none). */
const monHeatR: number[] = new Array<number>(STATION_CAP).fill(0)
let worldThawed = false
/**
 * Day number the thaw happened on. Players get the rest of that day
 * plus POST_THAW_DAYS full days (countdown at each sunrise); at the sunrise
 * of thawDay + POST_THAW_DAYS + 1 the world rolls to a new winter.
 */
let thawDay = 0
/** Volcano thaw stage reached this cycle (0..3, = active count when accepted). */
let thawStage = 0
/** Current melt-wave step (null at stage 0). */
let thawSeg: ThawSegment | null = null
/** Date.now() when the first lava appears (stage 1 wave start = beam landing); 0 = none. */
let lavaLitAtMs = 0


// MARK: isVolcanoLavaLit
/**
 * True once stage 1+ lava exists in the crater (from the stage 1 beam
 * landing). Lava never goes out this cycle: it is a torch relight
 * source and counts as living flame for the world end.
 */
export function isVolcanoLavaLit(): boolean {
	return thawStage >= 1 && lavaLitAtMs > 0 && Date.now() >= lavaLitAtMs
}


function clampInt32(v: number): number {
	return Math.max(-2147483647, Math.min(2147483647, Math.round(v)))
}


/** worldThawState payload (broadcast + late-join hydrate). */
function thawPayload(): {
	seed: number; thawed: number; thawDay: number; stage: number
	fromM: number; toM: number; waveAgeMs: number; waveDurMs: number
} {
	const seg = thawSeg
	return {
		seed     : currentSeed,
		thawed   : worldThawed ? 1 : 0,
		thawDay  : worldThawed ? thawDay : 0,
		stage    : thawStage,
		fromM    : seg ? seg.fromM : 0,
		toM      : seg ? seg.toM : 0,
		// Signed: negative while the step waits for the beam to land.
		waveAgeMs: seg ? clampInt32(Date.now() - seg.startMs) : 0,
		waveDurMs: seg ? clampInt32(seg.durMs) : 0,
	}
}


function broadcastOne(index: number, fresh = false, by = ''): void {
	room.send('stationState', {
		seed  : currentSeed,
		index,
		active: active[index] ? 1 : 0,
		fresh : fresh ? 1 : 0,
		by    : fresh ? by : '',
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
	// Floating crystals: no ice; every socket stays an empty, snow-free
	// pit for the whole cycle (keepCrystalPitsClear), before and after release.
	if (isFloatingCrystals()) return
	const st = activeTerrain()?.stations[index]
	if (!st) return
	const c = cellCenterWorld(st.cx, st.cz)
	const n = releaseMonumentPitSquare(c.x, c.z, MONUMENT_PIT_SIZE_M)
	console.log(`[Server] stations[${index}]: pit snow released (${n} cells regrow)`)
}


function broadcastThaw(): void {
	room.send('worldThawState', thawPayload())
}


/**
 * Raise the thaw stage to the active count: plan the next melt-wave step
 * (starts when the volcano beam lands), queue its tiles, and at stage 3
 * fire the world thaw (victory day bookkeeping). Never lowers the stage.
 */
function advanceThawStage(reason: string): void {
	const lit = Math.min(stationTotal(), getActiveStationCount())
	// Thaw stages are 0..3 (THAW_STAGE_RADIUS_M); with more monuments
	// (floating crystals) the full-world stage 3 comes with the last one.
	const n = lit >= stationTotal() ? 3 : Math.min(3, lit)
	if (n <= thawStage) return
	thawStage = n
	const centre = thawWaveCentre(activeTerrain())
	const seg = planThawSegment(centre, thawSeg, n, Date.now())
	thawSeg = seg
	if (lavaLitAtMs === 0) lavaLitAtMs = seg.startMs
	meltThawZone(centre, seg.toM / SNOW_TILE_M, (nowMs) => thawSegmentRadiusM(seg, nowMs) / SNOW_TILE_M)
	console.log(
		`[Server] stations: thaw stage ${n} (${reason}) seed=${currentSeed} ` +
		`wave ${seg.fromM.toFixed(0)} -> ${seg.toM.toFixed(0)} m over ${(seg.durMs / 1000).toFixed(1)} s ` +
		`starting in ${((seg.startMs - Date.now()) / 1000).toFixed(1)} s`,
	)
	if (lit >= stationTotal() && !worldThawed) {
		worldThawed = true
		thawDay = getDayNumber()
		console.log(`[Server] stations: WORLD THAW (${reason}) seed=${currentSeed}`)
	}
	publishCoverageIfDirty()
	// No global CLEAR lock: only the thaw zone is warm, and snowfall /
	// regrowth keep running outside it.
	broadcastThaw()
}


function resetForCycle(seed: number): void {
	currentSeed = seed
	pitsCleared = false // re-held on the next charge tick, after clearAllSnow
	for (let i = 0; i < STATION_CAP; i++) { active[i] = false; iceMask[i] = 0; monHeatR[i] = 0 }
	resetCharges()
	worldThawed = false
	thawDay = 0
	thawStage = 0
	thawSeg = null
	lavaLitAtMs = 0
	clearWeatherThawLock()
	console.log(`[Server] stations: reset for cycle seed=${currentSeed}`)
	for (let i = 0; i < STATION_CAP; i++) { broadcastOne(i); broadcastIce(i) }
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
	for (let i = 0; i < stationTotal(); i++) {
		room.send(
			'stationState',
			{ seed: currentSeed, index: i, active: active[i] ? 1 : 0, fresh: 0, by: '' },
			{ to: [userId] },
		)
		broadcastIce(i, userId)
		if (isFloatingCrystals()) {
			room.send('monumentCharge', { seed: currentSeed, index: i, charge: charge[i] }, { to: [userId] })
		}
	}
	room.send('worldThawState', thawPayload(), { to: [userId] })
}


export function setupStationsServer(): void {
	currentSeed = getCurrentCycleSeed()
	for (let i = 0; i < STATION_CAP; i++) { active[i] = false; iceMask[i] = 0; monHeatR[i] = 0 }
	worldThawed = false
	thawStage = 0
	thawSeg = null
	lavaLitAtMs = 0
	resetCharges()
	console.log(`[Server] stations: setup seed=${currentSeed}`)
	if (isFloatingCrystals()) {
		engine.addSystem(chargeSystem, undefined, 'monumentChargeSystem')
		// Crystal heat fronts at ~8 Hz (ring batches), coverage published per tick.
		let frontAcc = 0
		engine.addSystem((dt: number) => {
			frontAcc += dt
			if (frontAcc < 0.125) return
			frontAcc = 0
			tickHeatFronts(Date.now())
			publishCoverageIfDirty()
		}, undefined, 'crystalHeatFrontSystem')
	}

	room.onMessage('monumentIceMelt', ({ seed, index, chunk }, context) => {
		const from = context?.from ?? 'unknown'
		// Floating crystals: ice recedes with charge, not the torch.
		if (isFloatingCrystals()) { broadcastIce(index, context?.from); return }
		if (!cycleSeedsEqual(seed, currentSeed)) return
		if (index < 0 || index >= stationTotal()) return
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
		if (index < 0 || index >= stationTotal()) {
			console.log(
				`[Server] stations: activate rejected from ${from} — bad index ${index}`,
			)
			return
		}
		if (active[index]) {
			console.log(`[Server] stations[${index}]: activate from ${from} ignored — already active`)
			broadcastOne(index)
			if (thawStage > 0) broadcastThaw()
			return
		}
		if (isFloatingCrystals()) {
			// Charge-driven: activation only happens at full charge.
			broadcastOne(index)
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
			`(seed=${currentSeed}, active=${getActiveStationCount()}/${stationTotal()})`,
		)
		broadcastOne(index, true, context?.from ?? '')
		advanceThawStage(`station ${index} by ${from}`)
	})

	// TEMPORARY debug thaw: same path as the 3rd monument (fresh station
	// broadcasts -> grow/spin/beam/SFX on clients, then advanceThawStage -> stage 3).
	room.onMessage('debugThaw', ({ seed }, context) => {
		const from = context?.from ?? 'unknown'
		if (!DEBUG_THAW_BUTTON) {
			console.log(`[Server] stations: debugThaw from ${from} ignored (flag off)`)
			return
		}
		if (worldThawed) return
		if (!cycleSeedsEqual(seed, currentSeed)) return
		console.log(`[Server] stations: DEBUG thaw requested by ${from}`)
		for (let i = 0; i < stationTotal(); i++) {
			if (active[i]) continue
			active[i] = true
			releasePitSnow(i)
			if (!iceFullyMelted(iceMask[i])) {
				iceMask[i] = MONUMENT_ICE_FULL_MASK
				broadcastIce(i)
			}
			if (isFloatingCrystals()) releaseCrystal(i, '', true)
			else broadcastOne(i, true)
		}
		advanceThawStage(`debug button by ${from}`)
	})

	// TEMPORARY debug: light the next unlit monument through the same path
	// (fresh broadcast -> rise/beam on clients, thaw stage +1). Same flag.
	room.onMessage('debugVolcanoStage', ({ seed }, context) => {
		const from = context?.from ?? 'unknown'
		if (!DEBUG_THAW_BUTTON) {
			console.log(`[Server] stations: debugVolcanoStage from ${from} ignored (flag off)`)
			return
		}
		if (!cycleSeedsEqual(seed, currentSeed)) return
		const i = active.indexOf(false)
		if (i < 0) return
		console.log(`[Server] stations: DEBUG stage +1 (station ${i}) requested by ${from}`)
		active[i] = true
		releasePitSnow(i)
		if (!iceFullyMelted(iceMask[i])) {
			iceMask[i] = MONUMENT_ICE_FULL_MASK
			broadcastIce(i)
		}
		if (isFloatingCrystals()) {
			releaseCrystal(i, '', true)
			if (getActiveStationCount() >= stationTotal()) advanceThawStage(`debug +1 by ${from}`)
			return
		}
		broadcastOne(i, true)
		advanceThawStage(`debug +1 by ${from}`)
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


// MARK: Floating crystals - charging

function resetCharges(): void {
	for (let i = 0; i < STATION_CAP; i++) { charge[i] = 0; sentCharge[i] = -1; chargeBy[i] = '' }
	chargeAcc = 0
	setChargingSlots([])
	setChargePairs([])
	if (isFloatingCrystals()) {
		for (let i = 0; i < stationTotal(); i++) sendCharge(i)
	}
}

function sendCharge(i: number): void {
	sentCharge[i] = charge[i]
	room.send('monumentCharge', { seed: currentSeed, index: i, charge: charge[i] })
}

/**
 * Charging monument = a campfire of the tier its charge maps to
 * (chargeHeatFuel): melt + protect the tier ring around the base when it
 * steps up. Never shrinks while charging (charge never drops unless decay
 * is on; then the ring is pulled in like a campfire tier decay).
 */
function syncChargeHeat(i: number, x: number, z: number): void {
	const r = hearthRadiusFromFuel(chargeHeatFuel(charge[i]))
	if (r === monHeatR[i]) return
	if (r > 0) meltDisc(x, z, r)
	if (r < monHeatR[i]) { releaseDiscOutside(x, z, r, monHeatR[i]); pitsCleared = false } // re-hold the pit square
	console.log(`[Server] stations[${i}]: charge heat ring ${monHeatR[i].toFixed(0)} -> ${r.toFixed(0)} m (charge ${(charge[i] * 100).toFixed(0)}%)`)
	monHeatR[i] = r
	publishCoverageIfDirty()
}

/** Ice chunk k melts at charge (k+1)/N * CHARGE_ICE_GONE_AT. */
function recedeIce(i: number): void {
	if (!stationHasIce(activeTerrain(), i)) return
	const chunks: number[] = []
	for (let k = 0; k < 32; k++) if (isIceChunk(k)) chunks.push(k)
	let changed = false
	for (let n = 0; n < chunks.length; n++) {
		const at = ((n + 1) / chunks.length) * CHARGE_ICE_GONE_AT
		const bit = 1 << chunks[n]
		if (charge[i] >= at && (iceMask[i] & bit) === 0) {
			iceMask[i] = (iceMask[i] | bit) & MONUMENT_ICE_FULL_MASK
			clearSnowOverChunk(i, chunks[n])
			changed = true
		}
	}
	if (changed) { publishCoverageIfDirty(); broadcastIce(i) }
}

/**
 * Full charge: release the crystal. Same fresh stationState path as an
 * activation (cinematic + rise + gold name), plus a permanent heat zone.
 */
function releaseCrystal(i: number, by: string, force = false): void {
	if (active[i] && !force) return
	active[i] = true
	charge[i] = 1
	sendCharge(i)
	if (!iceFullyMelted(iceMask[i])) { iceMask[i] = MONUMENT_ICE_FULL_MASK; broadcastIce(i) }
	const st = activeTerrain()?.stations[i]
	if (st) {
		const c = cellCenterWorld(st.cx, st.cz)
		startHeatZoneFront(c.x, c.z, CRYSTAL_HEAT_RADIUS_M, CRYSTAL_THAW_SPREAD_S, CRYSTAL_THAW_DELAY_S)
		console.log(`[Server] stations[${i}]: crystal heat front started (held so far ${heatZoneCellCount()})`)
	}
	publishCoverageIfDirty()
	console.log(`[Server] stations[${i}]: CRYSTAL RELEASED by ${by || '?'} (${getActiveStationCount()}/${stationTotal()})`)
	broadcastOne(i, true, by)
}

/** Floating crystals: set once per cycle (after the snow wipe) once every pit is held clear. */
let pitsCleared = false
/**
 * Floating crystals have no monument ice, so nothing ever melted the pit
 * and snow lay flush over the recess + socket (the 'filled' look on the
 * non-spawn sockets). Melt + heat-protect every monument pit square, for
 * all N monuments, like the classic socket after its ice is gone.
 */
function keepCrystalPitsClear(): void {
	const map = activeTerrain()
	if (!map) return
	for (let i = 0; i < stationTotal() && i < map.stations.length; i++) {
		const c = cellCenterWorld(map.stations[i].cx, map.stations[i].cz)
		meltMonumentIceSquare(c.x, c.z, MONUMENT_PIT_SIZE_M)
	}
	publishCoverageIfDirty()
	pitsCleared = true
	console.log(`[Server] stations: crystal pits held clear (${stationTotal()} monuments)`)
}

function chargeSystem(dt: number): void {
	if (!pitsCleared) keepCrystalPitsClear()
	chargeAcc += dt
	if (chargeAcc < CHARGE_TICK_S) return
	const step = chargeAcc
	chargeAcc = 0
	if (worldThawed) return
	const map = activeTerrain()
	if (!map) return
	const fires = getHiddenFireNodes().filter((f) => f.lit)
	const chargingIds = new Set<number>()
	const pairs: ChargePair[] = []
	const litSlots = new Set(fires.map((f) => f.index))
	const chainBest = new Map<number, number>()
	let released = false
	for (let i = 0; i < stationTotal() && i < map.stations.length; i++) {
		if (active[i]) continue
		const c = cellCenterWorld(map.stations[i].cx, map.stations[i].cz)
		const dists: number[] = []
		let best = -1
		let bestD = Infinity
		// Candidates: every lit fire within MONUMENT_LINK_RANGE_M (fireNetwork
		// routes + prunes them). Only fires with a LIVE link charge.
		const linked = monumentLinkedSlots(MONUMENT_NODE_ID_BASE + i)
		for (const f of fires) {
			const d = Math.hypot(f.x - c.x, f.z - c.z)
			if (d > MONUMENT_LINK_RANGE_M) continue
			// Link end on the pit square's edge facing the fire (+ pad).
			const ux = (f.x - c.x) / Math.max(0.01, d), uz = (f.z - c.z) / Math.max(0.01, d)
			const toEdge = (MONUMENT_PIT_SIZE_M / 2) / Math.max(0.01, Math.abs(ux), Math.abs(uz)) + CHARGE_LINK_EDGE_PAD_M
			const e = Math.min(toEdge, Math.max(0, d - 1))
			const side = MONUMENT_PIT_SIZE_M / 2 + CHARGE_LINK_EDGE_PAD_M
			const mids = [[side, 0], [-side, 0], [0, side], [0, -side]]
				.map(([dx, dz]) => ({ x: c.x + dx, z: c.z + dz }))
				.sort((p, q) => Math.hypot(p.x - f.x, p.z - f.z) - Math.hypot(q.x - f.x, q.z - f.z))
			pairs.push({ slot: f.index, mon: MONUMENT_NODE_ID_BASE + i, fx: f.x, fz: f.z, ends: [{ x: c.x + ux * e, z: c.z + uz * e }, ...mids] })
			if (!linked.has(f.index)) continue // in range but unrouted / pruned: no charge
			dists.push(d)
			chargingIds.add(f.index)
			if (d < bestD && slotToucher(f.index)) { bestD = d; best = f.index }
		}
		if (best >= 0) chargeBy[i] = slotToucher(best)
		// Chain charging: relay fires up to CHARGE_CHAIN_MAX_HOPS network hops
		// out (shortest hop each, network ids = slot + 1; the hearth never relays).
		let weight = 0
		for (const d of dists) weight += chargeHopWeight(1, d)
		if (linked.size > 0) {
			const seeds = [...linked].filter((s) => litSlots.has(s)).map((s) => s + 1)
			const hops = chainHops(seeds, getVisibleEdges(), (id) => id > 0 && litSlots.has(id - 1))
			for (const [id, h] of hops) {
				if (h <= 1) continue
				weight += chargeHopWeight(h, 0)
				const s = id - 1
				const cur = chainBest.get(s)
				if (cur === undefined || h < cur) chainBest.set(s, h)
			}
			for (const s of seeds) chainBest.set(s - 1, 1)
		}
		syncChargeHeat(i, c.x, c.z)
		const prev = charge[i]
		if (weight > 0) charge[i] = Math.min(1, charge[i] + chargeRateFromWeight(weight) * step)
		else if (CHARGE_DECAY_ENABLED) charge[i] = Math.max(0, charge[i] - CHARGE_DECAY_PER_S * step)
		if (charge[i] === prev) continue
		syncChargeHeat(i, c.x, c.z)
		if (charge[i] >= 1) {
			monHeatR[i] = 0 // hands over to the 50 m crystal heat zone
			releaseCrystal(i, chargeBy[i])
			released = true
			continue
		}
		recedeIce(i)
		if (Math.abs(charge[i] - sentCharge[i]) >= CHARGE_SEND_STEP) sendCharge(i)
	}
	setChargingSlots(chargingIds) // hop 1 only (CHARGE_CHAIN_DRAIN_HOP1_ONLY)
	setChargePairs(pairs)
	setChainHops(chainBest)
	if (released && getActiveStationCount() >= stationTotal()) {
		// Victory: all three released -> finale beams (client) + thaw wave.
		advanceThawStage('3 crystals released')
	}
}