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

import { debugFinaleAllowed, DEBUG_THAW_BUTTON } from 'src/client/devFlags'
import {
	FINALE_DEBUG_DELAY_S, FINALE_PULSE_S, FINALE_SNOW_RADIUS_M, FINALE_START_DELAY_S, finaleAvoidZone, finaleEdges, finalePoints, finaleTimes,
} from 'src/shared/finale'
import { onCycleRoll, getCurrentCycleSeed, rollCycle } from 'src/server/cycle'
import { getDayNumber, onPhaseChange } from 'src/server/phase'
import { cycleSeedsEqual } from 'src/shared/cycleMazeSeed'
import { room } from 'src/shared/messages'
import { meltObeliskIceSquare, meltThawZone, publishCoverageIfDirty, releaseObeliskPitSquare } from 'src/server/snowState'
import { clearWeatherThawLock } from 'src/server/weather'
import {
	OBELISK_ICE_CHUNK_M,
	OBELISK_ICE_FULL_MASK,
	iceChunkOffset,
	iceFullyMelted,
	isIceChunk,
	stationHasIce,
} from 'src/shared/obeliskIce'
import { activeTerrain } from 'src/shared/terrain/terrainCache'
import { crystalFloatAboveGround } from 'src/shared/crystalFloat'
import { groundYAtWorld } from 'src/shared/terrain/terrainMap'
import { OBELISK_PIT_SIZE_M, OBELISK_SOCKET_SIZE_M, cellCenterWorld } from 'src/shared/terrain/terrainMap'
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
	CHARGE_ICE_GONE_AT,
	OBELISK_LINK_RANGE_M,
	CRYSTAL_HEAT_RADIUS_M,
	CRYSTAL_THAW_SPREAD_S,
	CRYSTAL_THAW_DELAY_S,
	CRYSTAL_LASER_ENABLED,
	chainHops,
	chargeHopWeight,
	chargeRateFromWeight,
	isFloatingCrystals,
} from 'src/shared/ruleset'
import { getHiddenFireNodes } from 'src/server/hiddenCampfire'
import { noteContributor, recordRunProgress } from 'src/server/leaderboard'
import { markRunTainted } from 'src/server/runIntegrity'
import { ChargePair, obeliskLinkedSlots, setChainHops, setChargePairs, setChargingSlots, slotToucher } from 'src/server/chargeLinks'
import { getVisibleEdges } from 'src/server/fireNetworkLinks'
import { CHARGE_LINK_END_HALF_M, OBELISK_NODE_ID_BASE } from 'src/shared/ruleset'
import { heatZoneCellCount, meltDisc, releaseDiscOutside, startHeatZoneFront, tickHeatFronts } from 'src/server/snowState'
import { oasisClear, oasisNoteRelease, oasisRelease, oasisSetFinalePulse, oasisTick } from 'src/shared/terrain/oasis'
import { hearthRadiusFromFuel } from 'src/shared/hearthFuel'
import { chargeHeatFuel } from 'src/shared/ruleset'

/** Array capacity (OBELISK_COUNT max 8). The live count is stationTotal(). */
const STATION_CAP = 8
/** Obelisks in the current layout (3 classic, OBELISK_COUNT crystals). */
function stationTotal(): number {
	const n = activeTerrain()?.stations.length ?? 3
	return Math.max(1, Math.min(STATION_CAP, n))
}
/** Floating crystals: charge 0..1 per obelisk (server-authoritative). */
const charge: number[] = new Array<number>(STATION_CAP).fill(0)
/** Last charge value broadcast per obelisk. */
const sentCharge: number[] = new Array<number>(STATION_CAP).fill(-1)
/** Last player to build/feed a fire that charged obelisk i. */
const chargeBy: string[] = new Array<string>(STATION_CAP).fill('')
const CHARGE_TICK_S = 0.25
const CHARGE_SEND_STEP = 0.004
let chargeAcc = 0

let currentSeed = 0
const active: boolean[] = new Array<boolean>(STATION_CAP).fill(false)
/** Server epoch ms each crystal was released (0 = not released this cycle). Sent as ageMs so clients time the oasis melt + regrowth. */
const releasedAtMs: number[] = new Array<number>(STATION_CAP).fill(0)
/** Melted ice-chunk bitmask per obelisk (src/shared/obeliskIce.ts). */
const iceMask: number[] = new Array<number>(STATION_CAP).fill(0)
/** Charging-obelisk heat ring (m) currently melted/protected per obelisk (0 = none). */
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
/** Ending (src/shared/finale.ts): Date.now() of its start (0 = not scheduled this cycle), the obelisk its ring starts at, the last one released. */
let finaleStartMs = 0
let finaleFirst = 0
let lastReleased = 0


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


/** Age (ms) of crystal `index`'s release for the wire, -1 = not released. */
function releaseAgeMs(index: number): number {
	return active[index] && releasedAtMs[index] > 0 ? Math.max(0, clampInt32(Date.now() - releasedAtMs[index])) : -1
}


function broadcastOne(index: number, fresh = false, by = ''): void {
	room.send('stationState', {
		seed  : currentSeed,
		index,
		active: active[index] ? 1 : 0,
		fresh : fresh ? 1 : 0,
		by    : fresh ? by : '',
		ageMs : releaseAgeMs(index),
	})
}


function broadcastIce(index: number, to?: string): void {
	const payload = { seed: currentSeed, index, mask: iceMask[index] }
	if (to !== undefined) room.send('monumentIceState', payload, { to: [to] })
	else room.send('monumentIceState', payload)
}


/**
 * Clear + protect the snow lying on ice chunk `chunk` of obelisk
 * `index` (it melted with the ice; clients drop it from the ice top
 * to nothing). Once the whole mound is free, the obelisk column too, so
 * the empty recess stays snow-free until activation.
 */
function clearSnowOverChunk(index: number, chunk: number): void {
	const st = activeTerrain()?.stations[index]
	if (!st) return
	const c = cellCenterWorld(st.cx, st.cz)
	const o = iceChunkOffset(chunk)
	meltObeliskIceSquare(c.x + o.dx, c.z + o.dz, OBELISK_ICE_CHUNK_M)
	if (iceFullyMelted(iceMask[index])) {
		meltObeliskIceSquare(c.x, c.z, Math.ceil(OBELISK_SOCKET_SIZE_M))
	}
}


/**
 * Obelisk `index` activated (the obelisk rose out): stop keeping its
 * empty recess snow-free so snowfall buries it again. The cells keep
 * their melted stage and regrow normally; clients draw them from the
 * recess floor so the shallow step fills back to ground level.
 * protectedCells is cleared on cycle wipe (clearAllSnow).
 */
function releasePitSnow(index: number): void {
	const st = activeTerrain()?.stations[index]
	if (!st) return
	const c = cellCenterWorld(st.cx, st.cz)
	const n = releaseObeliskPitSquare(c.x, c.z, OBELISK_PIT_SIZE_M)
	console.log(`[Server] stations[${index}]: pit snow released (${n} cells regrow)`)
}


function broadcastThaw(): void {
	room.send('worldThawState', thawPayload())
}


// MARK: Ending (finale)
/** crystalFinaleState payload: ageMs is NEGATIVE until the ending starts. */
function finalePayload(fresh: boolean): { seed: number; running: number; first: number; ageMs: number; fresh: number } {
	return {
		seed   : currentSeed,
		running: finaleStartMs > 0 ? 1 : 0,
		first  : finaleFirst,
		ageMs  : finaleStartMs > 0 ? clampInt32(Date.now() - finaleStartMs) : 0,
		fresh  : fresh ? 1 : 0,
	}
}

/**
 * The last obelisk was released: schedule the ending `delayS` from now (its release cinematic finishes first). Beams link the
 * obelisk tips (client, from the shared ring) all at once, then every obelisk releases the same pulse: the oasis registry grows every
 * oasis to the larger finale radius (oasisSetFinalePulse, same clock on every client) and the snow in that area melts with it
 * (one held heat front per obelisk, FINALE_PULSE_S). No thaw corridors. Idempotent per cycle. The game goes on afterwards.
 */
function startFinale(first: number, delayS: number, reason: string): void {
	if (!isFloatingCrystals() || finaleStartMs > 0) return
	const map = activeTerrain()
	if (!map) return
	const pts = finalePoints(map).slice(0, stationTotal())
	const edges = finaleEdges(pts, finaleAvoidZone(map), first)
	if (edges.length === 0) return
	finaleStartMs = Date.now() + delayS * 1000
	finaleFirst = first
	const times = finaleTimes()
	oasisSetFinalePulse(finaleStartMs + times.pulseAtS * 1000)
	for (const p of pts) startHeatZoneFront(p.x, p.z, FINALE_SNOW_RADIUS_M, FINALE_PULSE_S, delayS + times.pulseAtS, 0)
	console.log(
		`[Server] stations: FINALE scheduled (${reason}) in ${delayS.toFixed(1)} s, ${pts.length} obelisks, ring from obelisk ${first}: ` +
		edges.map(([a, b]) => `${a}>${b}`).join(' ') + ` beams ${times.beamStartS.toFixed(1)}-${times.beamsDoneS.toFixed(1)} s, pulse ${times.pulseAtS.toFixed(1)}-${times.pulseEndS.toFixed(1)} s (r ${FINALE_SNOW_RADIUS_M} m)`,
	)
	room.send('crystalFinaleState', finalePayload(true))
}


/**
 * Raise the thaw stage to the active count: plan the next melt-wave step
 * (starts when the volcano beam lands), queue its tiles, and at stage 3
 * fire the world thaw (victory day bookkeeping). Never lowers the stage.
 */
function advanceThawStage(reason: string): void {
	// Floating crystals: no volcano auto-thaw / WORLD THAWED victory. Each
	// crystal keeps its own 50 m thaw zone; the volcano stays idle.
	if (isFloatingCrystals()) {
		console.log(`[Server] stations: thaw stage skipped (${reason}) - floating crystals has no world thaw`)
		return
	}
	const lit = Math.min(stationTotal(), getActiveStationCount())
	// Thaw stages are 0..3 (THAW_STAGE_RADIUS_M); with more obelisks
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
	oasisClear()
	oasisSetFinalePulse(Number.POSITIVE_INFINITY)
	for (let i = 0; i < STATION_CAP; i++) { active[i] = false; iceMask[i] = 0; monHeatR[i] = 0; releasedAtMs[i] = 0 }
	resetCharges()
	worldThawed = false
	thawDay = 0
	thawStage = 0
	thawSeg = null
	lavaLitAtMs = 0
	finaleStartMs = 0
	finaleFirst = 0
	lastReleased = 0
	clearWeatherThawLock()
	console.log(`[Server] stations: reset for cycle seed=${currentSeed}`)
	for (let i = 0; i < STATION_CAP; i++) { broadcastOne(i); broadcastIce(i) }
	broadcastThaw()
	if (isFloatingCrystals()) room.send('crystalFinaleState', finalePayload(false))
}


export function getActiveStationCount(): number {
	let n = 0
	for (const a of active) if (a) n++
	return n
}


export function isWorldThawed(): boolean {
	return worldThawed
}

/** Server epoch ms the ending started at (0 = it has not been scheduled this world). */
export function getFinaleStartMs(): number {
	return finaleStartMs
}

/** The expedition is won: the ending was scheduled (floating crystals). From then on nothing brings winter back by itself. */
export function isExpeditionWon(): boolean {
	return isFloatingCrystals() && finaleStartMs > 0
}


export function sendStationStateTo(userId: string): void {
	for (let i = 0; i < stationTotal(); i++) {
		room.send(
			'stationState',
			{ seed: currentSeed, index: i, active: active[i] ? 1 : 0, fresh: 0, by: '', ageMs: releaseAgeMs(i) },
			{ to: [userId] },
		)
		broadcastIce(i, userId)
		if (isFloatingCrystals()) {
			room.send('monumentCharge', { seed: currentSeed, index: i, charge: charge[i] }, { to: [userId] })
		}
	}
	room.send('worldThawState', thawPayload(), { to: [userId] })
	if (isFloatingCrystals()) room.send('crystalFinaleState', finalePayload(false), { to: [userId] })
}


export function setupStationsServer(): void {
	currentSeed = getCurrentCycleSeed()
	for (let i = 0; i < STATION_CAP; i++) { active[i] = false; iceMask[i] = 0; monHeatR[i] = 0 }
	worldThawed = false
	thawStage = 0
	thawSeg = null
	lavaLitAtMs = 0
	finaleStartMs = 0
	finaleFirst = 0
	lastReleased = 0
	resetCharges()
	console.log(`[Server] stations: setup seed=${currentSeed}`)
	if (isFloatingCrystals()) {
		engine.addSystem(chargeSystem, undefined, 'obeliskChargeSystem')
		// Crystal heat fronts at ~8 Hz (ring batches), coverage published per tick.
		let frontAcc = 0
		engine.addSystem((dt: number) => {
			frontAcc += dt
			if (frontAcc < 0.125) return
			frontAcc = 0
			tickHeatFronts(Date.now())
			oasisTick(Date.now())
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
		iceMask[index] = (iceMask[index] | bit) & OBELISK_ICE_FULL_MASK
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
		// Only the iced obelisk needs its ice melted; the others ignite at once.
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

	// TEMPORARY debug thaw: same path as the 3rd obelisk (fresh station
	// broadcasts -> grow/spin/beam/SFX on clients, then advanceThawStage -> stage 3).
	room.onMessage('debugThaw', ({ seed }, context) => {
		const from = context?.from ?? 'unknown'
		if (!DEBUG_THAW_BUTTON) {
			console.log(`[Server] stations: debugThaw from ${from} ignored (flag off)`)
			return
		}
		if (worldThawed) return
		if (!cycleSeedsEqual(seed, currentSeed)) return
		markRunTainted('debugThaw')
		console.log(`[Server] stations: DEBUG thaw requested by ${from}`)
		for (let i = 0; i < stationTotal(); i++) {
			if (active[i]) continue
			active[i] = true
			releasePitSnow(i)
			if (!iceFullyMelted(iceMask[i])) {
				iceMask[i] = OBELISK_ICE_FULL_MASK
				broadcastIce(i)
			}
			if (isFloatingCrystals()) releaseCrystal(i, '', true)
			else broadcastOne(i, true)
		}
		if (isFloatingCrystals()) startFinale(lastReleased, FINALE_START_DELAY_S, `debug thaw button by ${from}`)
		advanceThawStage(`debug button by ${from}`)
	})

	// TEMPORARY debug (DEBUG_FINALE_BUTTON, optionally limited to DEBUG_FINALE_HOSTS): every unreleased obelisk is released
	// SILENTLY (clients snap to the finished crystal, no per-obelisk cinematics), then the ending starts FINALE_DEBUG_DELAY_S later.
	// Taints the run (markRunTainted) so no leaderboard record is written.
	room.onMessage('debugFinale', ({ seed }, context) => {
		const from = context?.from ?? 'unknown'
		if (!debugFinaleAllowed(from)) {
			console.log(`[Server] stations: debugFinale from ${from} ignored (flag off / not a listed host)`)
			return
		}
		if (!isFloatingCrystals() || !cycleSeedsEqual(seed, currentSeed)) return
		if (finaleStartMs > 0) { console.log('[Server] stations: debugFinale ignored - the ending already ran this cycle'); return }
		markRunTainted('debugFinale')
		console.log(`[Server] stations: DEBUG finale requested by ${from}`)
		for (let i = 0; i < stationTotal(); i++) {
			if (active[i]) continue
			releasePitSnow(i)
			if (!iceFullyMelted(iceMask[i])) {
				iceMask[i] = OBELISK_ICE_FULL_MASK
				broadcastIce(i)
			}
			releaseCrystal(i, '', true, true)
		}
		startFinale(lastReleased, FINALE_DEBUG_DELAY_S, `debug finale by ${from}`)
	})

	// TEMPORARY debug: light the next unlit obelisk through the same path
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
		markRunTainted('debugVolcanoStage')
		console.log(`[Server] stations: DEBUG stage +1 (station ${i}) requested by ${from}`)
		active[i] = true
		releasePitSnow(i)
		if (!iceFullyMelted(iceMask[i])) {
			iceMask[i] = OBELISK_ICE_FULL_MASK
			broadcastIce(i)
		}
		if (isFloatingCrystals()) {
			releaseCrystal(i, '', true)
			if (getActiveStationCount() >= stationTotal()) {
				startFinale(i, FINALE_START_DELAY_S, `debug +1 by ${from}`)
				advanceThawStage(`debug +1 by ${from}`)
			}
			return
		}
		broadcastOne(i, true)
		advanceThawStage(`debug +1 by ${from}`)
	})

	onCycleRoll(({ newSeed }) => { resetForCycle(newSeed) })

	// Post-win: after POST_THAW_DAYS full days, winter returns via the
	// normal cycle roll (fresh seed, snow, stations, thaw flag, phase).
	onPhaseChange(() => {
		if (isFloatingCrystals()) return // the restored world stays: only a player's NEW EXPEDITION (server/expedition.ts) starts a new winter
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
 * Charging obelisk = a campfire of the tier its charge maps to
 * (chargeHeatFuel): melt + protect the tier ring around the base when it
 * steps up. Never shrinks while charging (charge never drops unless decay
 * is on; then the ring is pulled in like a campfire tier decay).
 */
function syncChargeHeat(i: number, x: number, z: number): void {
	const r = hearthRadiusFromFuel(chargeHeatFuel(charge[i]))
	if (r === monHeatR[i]) return
	if (r > 0) meltDisc(x, z, r)
	if (r < monHeatR[i]) releaseDiscOutside(x, z, r, monHeatR[i])
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
			iceMask[i] = (iceMask[i] | bit) & OBELISK_ICE_FULL_MASK
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
function releaseCrystal(i: number, by: string, force = false, silent = false): void {
	if (active[i] && !force) return
	active[i] = true
	lastReleased = i
	charge[i] = 1
	noteContributor(by) // releasing a crystal counts toward the leaderboard
	sendCharge(i)
	if (!iceFullyMelted(iceMask[i])) { iceMask[i] = OBELISK_ICE_FULL_MASK; broadcastIce(i) }
	const st = activeTerrain()?.stations[i]
	if (st) {
		const c = cellCenterWorld(st.cx, st.cz)
		releasedAtMs[i] = Date.now()
		oasisNoteRelease(c.x, c.z, releasedAtMs[i])
		oasisRelease(activeTerrain()!, c.x, c.z, 0) // inner cap melts with the front (snowState.tickHeatFronts), the rest on the oasisTick clock
		// silent (debug finale): the heat zone is instant and clients snap to the finished crystal (fresh = 0).
		if (silent) startHeatZoneFront(c.x, c.z, CRYSTAL_HEAT_RADIUS_M, 0, 0, 0)
		else startHeatZoneFront(c.x, c.z, CRYSTAL_HEAT_RADIUS_M, CRYSTAL_THAW_SPREAD_S, CRYSTAL_THAW_DELAY_S, CRYSTAL_LASER_ENABLED ? 0 : crystalFloatAboveGround(activeTerrain(), groundYAtWorld(activeTerrain()!, c.x, c.z)))
		console.log(`[Server] stations[${i}]: crystal heat front started (held so far ${heatZoneCellCount()})`)
	}
	publishCoverageIfDirty()
	console.log(`[Server] stations[${i}]: CRYSTAL RELEASED by ${by || '?'} (${getActiveStationCount()}/${stationTotal()})`)
	broadcastOne(i, !silent, by)
	// Personal-best leaderboard: every contributor gets this run's new count.
	recordRunProgress(getActiveStationCount(), stationTotal())
}

function chargeSystem(dt: number): void {
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
		// Candidates: every lit fire within OBELISK_LINK_RANGE_M (fireNetwork
		// routes + prunes them). Only fires with a LIVE link charge.
		const linked = obeliskLinkedSlots(OBELISK_NODE_ID_BASE + i)
		for (const f of fires) {
			const d = Math.hypot(f.x - c.x, f.z - c.z)
			if (d > OBELISK_LINK_RANGE_M) continue
			// Link end right beside the obelisk socket, on the side facing the fire (CHARGE_LINK_END_HALF_M).
			const ux = (f.x - c.x) / Math.max(0.01, d), uz = (f.z - c.z) / Math.max(0.01, d)
			const toEdge = CHARGE_LINK_END_HALF_M / Math.max(0.01, Math.abs(ux), Math.abs(uz))
			const e = Math.min(toEdge, Math.max(0, d - 1))
			const side = CHARGE_LINK_END_HALF_M
			const mids = [[side, 0], [-side, 0], [0, side], [0, -side]]
				.map(([dx, dz]) => ({ x: c.x + dx, z: c.z + dz }))
				.sort((p, q) => Math.hypot(p.x - f.x, p.z - f.z) - Math.hypot(q.x - f.x, q.z - f.z))
			pairs.push({ slot: f.index, mon: OBELISK_NODE_ID_BASE + i, fx: f.x, fz: f.z, ends: [{ x: c.x + ux * e, z: c.z + uz * e }, ...mids] })
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
		// The last obelisk is up: the ending (beams link the tips, then the synchronized pulse melts a large area around every obelisk).
		startFinale(lastReleased, FINALE_START_DELAY_S, 'last crystal released')
		advanceThawStage('all crystals released') // floating crystals: no-op (no volcano thaw / cycle roll)
	}
}