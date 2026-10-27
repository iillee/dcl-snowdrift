/**
 * volcanoSmoke.ts — tall grey smoke plume rising out of the volcano
 * caldera so the landmark can be located from across the map.
 *
 * Native SDK ParticleSystem (same pattern as campfireSmoke.ts): one
 * upward Cone emitter, buoyant rise, puffs grow and fade into the sky.
 * Visual only. Three stages by landed monuments (0 dormant / no plume,
 * 1 small low thin, 2 medium, 3 the full eruption plume): rate, puff
 * size, launch speed, buoyancy and opacity all come from the stage
 * tables in src/shared/volcanoStages.ts and blend over
 * SMOKE_STAGE_BLEND_S.
 *
 * Placement follows the active terrain: a system watches activeTerrain()
 * and re-seats (or stops) the emitter whenever the layout changes, so a
 * reroll / new cycle moves the plume with the volcano.
 *
 * Caldera centre: the Mid + LANDFORM_VOLCANO component near map.volcano
 * that is most enclosed by High rim (the bowl). Falls back to the
 * centroid of volcano-tagged cells, then to the map.volcano cell.
 */

import {
	PBParticleSystem_BlendMode,
	PBParticleSystem_PlaybackState,
	ParticleSystem,
	Transform,
	engine,
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'

import {
	TERRAIN_LEVEL_HIGH,
	TERRAIN_LEVEL_MID,
	TERRAIN_LEVEL_VOLCANO_RIM,
	sceneHeightLimitM,
} from 'src/shared/settings'
import { activeTerrain } from 'src/shared/terrain/terrainCache'
import {
	SMOKE_ALPHA_BY_STAGE,
	SMOKE_LIFT_BY_STAGE,
	SMOKE_RATE_BY_STAGE,
	SMOKE_SIZE_BY_STAGE,
	SMOKE_SPEED_BY_STAGE,
	SMOKE_STAGE_BLEND_S,
	volcanoStageIndex,
} from 'src/shared/volcanoStages'
import { volcanoCrownTopY, volcanoLavaCentroid } from 'src/shared/terrain/volcanoCrown'
import {
	DIR_DX,
	DIR_DZ,
	LANDFORM_VOLCANO,
	TerrainMap,
	cellCenterWorld,
	groundYForLevel,
} from 'src/shared/terrain/terrainMap'


// MARK: Tuning
/** Emit a little above the High rim so puffs clear the crater lip. */
const ORIGIN_ABOVE_RIM_M = 2
/** Cone: wide base (caldera-sized), narrow angle → column that widens. */
const CONE_ANGLE_DEG = 10
const CONE_RADIUS_M  = 4
/** Sparse but long-lived: few big puffs read at distance cheaply. */
const LIFETIME_MAX_S = 12
const MAX_PARTICLES  = 140
/**
 * Buoyant rise. Negative gravity multiplier accelerates puffs upward
 * (~0.8 m/s²). With 3.5–5 m/s launch over 12 s the plume tops out
 * ~95 m above the emitter (~130 m world Y), above the 64 m peak tier.
 */
const GRAVITY_MULT   = -0.08
const SPEED_MIN      = 3.5
const SPEED_MAX      = 5.0
/** Gentle lean downwind, matching the campfire / snowfall drift. */
const WIND_FORCE     = Vector3.create(0.3, 0, 0.1)
/**
 * Puff size. initialSize ~1 + sizeOverTime 8→22 reads as 8→22 m puffs
 * whether the runtime treats sizeOverTime as absolute scale or as a
 * multiplier on initialSize (docs are ambiguous; campfireSmoke treats
 * it as absolute).
 */
const SIZE_INIT_MIN  = 1.0
const SIZE_INIT_MAX  = 1.4
const SIZE_OVER_START = 8
const SIZE_OVER_END   = 22
/**
 * Puff lifetime capped so the plume (rise + half the final puff) stays
 * PLUME_CEILING_MARGIN_M under the DCL scene height limit
 * (log2(parcels + 1) * 20 m: 228 m on 52x52) now that the emitter sits
 * on the taller volcano. Rise s = v t + a t^2 / 2 at SPEED_MAX.
 */
const PLUME_CEILING_MARGIN_M = 5
const PLUME_ORIGIN_Y = Math.max(groundYForLevel(TERRAIN_LEVEL_VOLCANO_RIM), volcanoCrownTopY()) + ORIGIN_ABOVE_RIM_M
const PLUME_MAX_RISE_M = sceneHeightLimitM() - PLUME_CEILING_MARGIN_M - SIZE_OVER_END / 2 - PLUME_ORIGIN_Y
const PLUME_ACCEL = -GRAVITY_MULT * 9.81
const LIFETIME_S = Math.min(
	LIFETIME_MAX_S,
	Math.max(2, (-SPEED_MAX + Math.sqrt(SPEED_MAX * SPEED_MAX + 2 * PLUME_ACCEL * Math.max(0, PLUME_MAX_RISE_M))) / PLUME_ACCEL),
)
/** Plume top estimate (m world Y), logged at setup. */
const PLUME_TOP_Y = PLUME_ORIGIN_Y + SPEED_MAX * LIFETIME_S + 0.5 * PLUME_ACCEL * LIFETIME_S * LIFETIME_S + SIZE_OVER_END / 2
/** Search radius (cells) around map.volcano for caldera cells. */
const CALDERA_SEARCH_R = 12
/** Particle component writes per second while a stage blend runs. */
const SMOKE_BLEND_WRITE_HZ = 5
/** Base puff colours (alpha scaled per stage). */
const COLOR_INIT_START = Color4.create(0.32, 0.30, 0.29, 0.80)
const COLOR_INIT_END   = Color4.create(0.42, 0.40, 0.38, 0.70)
const COLOR_OVER_START = Color4.create(0.55, 0.54, 0.53, 0.60)
const COLOR_OVER_END   = Color4.create(0.80, 0.80, 0.82, 0.0)


import { CRYSTAL_IDLE_SMOKE_ALPHA, CRYSTAL_IDLE_SMOKE_RATE, CRYSTAL_IDLE_SMOKE_SIZE, isFloatingCrystals } from 'src/shared/ruleset'


// MARK: State
let emitter: ReturnType<typeof engine.addEntity> | null = null
let lastMap: TerrainMap | null = null
let installed = false
let stationBoost = 0
/** Live plume parameters (blended toward the stage targets). */
type SmokeParams = { rate: number; size: number; speed: number; lift: number; alpha: number }
function stageParams(st: number): SmokeParams {
	// Floating crystals: 'dormant' is a thin idle wisp (stage-1 shape, scaled).
	if (st <= 0 && isFloatingCrystals()) return {
		rate : SMOKE_RATE_BY_STAGE[1]  * CRYSTAL_IDLE_SMOKE_RATE,
		size : SMOKE_SIZE_BY_STAGE[1]  * CRYSTAL_IDLE_SMOKE_SIZE,
		speed: SMOKE_SPEED_BY_STAGE[1],
		lift : SMOKE_LIFT_BY_STAGE[1],
		alpha: SMOKE_ALPHA_BY_STAGE[1] * CRYSTAL_IDLE_SMOKE_ALPHA,
	}
	return {
		rate : SMOKE_RATE_BY_STAGE[st],
		size : SMOKE_SIZE_BY_STAGE[st],
		speed: SMOKE_SPEED_BY_STAGE[st],
		lift : SMOKE_LIFT_BY_STAGE[st],
		alpha: SMOKE_ALPHA_BY_STAGE[st],
	}
}
let cur : SmokeParams = stageParams(0)
let from: SmokeParams = stageParams(0)
let blendT = SMOKE_STAGE_BLEND_S
let writeClock = 0


// MARK: findCalderaCell
/**
 * Fractional cell coords of the caldera centre, or null without a volcano.
 */
function findCalderaCell(map: TerrainMap): { fx: number; fz: number } | null {
	const v = map.volcano
	if (!v) return null
	// 0) Lava lake centre — the crater the crown rings.
	const lava = volcanoLavaCentroid(map)
	if (lava) return lava
	const W = map.w
	const H = map.h
	const inR = (cx: number, cz: number): boolean =>
		Math.max(Math.abs(cx - v.cx), Math.abs(cz - v.cz)) <= CALDERA_SEARCH_R
	const isBowl = (i: number): boolean =>
		map.levels[i] === TERRAIN_LEVEL_MID && map.landforms[i] === LANDFORM_VOLCANO

	// 1) Mid volcano components; pick the one most enclosed by High.
	const seen = new Uint8Array(W * H)
	let bestScore = -1
	let best: { fx: number; fz: number } | null = null
	for (let cz = Math.max(0, v.cz - CALDERA_SEARCH_R); cz <= Math.min(H - 1, v.cz + CALDERA_SEARCH_R); cz++) {
		for (let cx = Math.max(0, v.cx - CALDERA_SEARCH_R); cx <= Math.min(W - 1, v.cx + CALDERA_SEARCH_R); cx++) {
			const start = cz * W + cx
			if (seen[start] || !isBowl(start)) continue
			const stack = [start]
			seen[start] = 1
			let sx = 0
			let sz = 0
			let n = 0
			let edges = 0
			let highEdges = 0
			while (stack.length > 0) {
				const i = stack.pop()!
				const x = i % W
				const z = (i - x) / W
				sx += x
				sz += z
				n++
				for (let d = 0; d < 4; d++) {
					const nx = x + DIR_DX[d]
					const nz = z + DIR_DZ[d]
					if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue
					const j = nz * W + nx
					if (isBowl(j)) {
						if (!seen[j] && inR(nx, nz)) {
							seen[j] = 1
							stack.push(j)
						}
						continue
					}
					edges++
					if (map.levels[j] >= TERRAIN_LEVEL_HIGH) highEdges++ // High terrace or rim
				}
			}
			if (n === 0 || edges === 0) continue
			const enclosure = highEdges / edges
			if (enclosure > bestScore) {
				bestScore = enclosure
				best = { fx: sx / n, fz: sz / n }
			}
		}
	}
	if (best && bestScore >= 0.5) return best

	// 2) Centroid of all volcano-tagged cells near the marker (rings are
	//    concentric, so this approximates the cone centre).
	let sx = 0
	let sz = 0
	let n = 0
	for (let cz = Math.max(0, v.cz - CALDERA_SEARCH_R); cz <= Math.min(H - 1, v.cz + CALDERA_SEARCH_R); cz++) {
		for (let cx = Math.max(0, v.cx - CALDERA_SEARCH_R); cx <= Math.min(W - 1, v.cx + CALDERA_SEARCH_R); cx++) {
			if (map.landforms[cz * W + cx] !== LANDFORM_VOLCANO) continue
			sx += cx
			sz += cz
			n++
		}
	}
	if (n > 0) return { fx: sx / n, fz: sz / n }

	// 3) The volcano marker cell itself.
	return { fx: v.cx, fz: v.cz }
}


// MARK: placeForMap
function placeForMap(map: TerrainMap | null): void {
	if (emitter === null) return
	const ps = ParticleSystem.getMutable(emitter)
	const cell = map ? findCalderaCell(map) : null
	if (!map || !cell) {
		ps.playbackState = PBParticleSystem_PlaybackState.PS_STOPPED
		console.log('volcanoSmoke: no volcano on active terrain, plume stopped')
		return
	}
	// cellCenterWorld takes integer cells; offset by the fractional part
	// so the plume sits on the true centroid, not a cell corner.
	const base = cellCenterWorld(Math.floor(cell.fx), Math.floor(cell.fz))
	const cellM = cellCenterWorld(1, 0).x - cellCenterWorld(0, 0).x
	const x = base.x + (cell.fx - Math.floor(cell.fx)) * cellM
	const z = base.z + (cell.fz - Math.floor(cell.fz)) * cellM
	// Above the crown so puffs clear the crater lip.
	const y = PLUME_ORIGIN_Y
	Transform.getMutable(emitter).position = Vector3.create(x, y, z)
	writeParams()
	if (stationBoost <= 0 && cur.rate <= 0.01) {
		ParticleSystem.getMutable(emitter).playbackState = PBParticleSystem_PlaybackState.PS_STOPPED
		console.log(
			`volcanoSmoke: seated at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}) ` +
			`but dormant (0 stations) seed ${map.seed}`,
		)
		return
	}
	ParticleSystem.getMutable(emitter).playbackState = PBParticleSystem_PlaybackState.PS_PLAYING
	console.log(
		`volcanoSmoke: plume at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}) ` +
		`cell (${cell.fx.toFixed(1)}, ${cell.fz.toFixed(1)}) stations=${stationBoost} ` +
		`rate=${cur.rate.toFixed(1)}/s seed ${map.seed}`,
	)
}


// MARK: writeParams
/** Push the live blended parameters into the particle component. */
function writeParams(): void {
	if (emitter === null) return
	const ps = ParticleSystem.getMutable(emitter)
	const c  = cur
	const a  = (col: Color4): Color4 => Color4.create(col.r, col.g, col.b, col.a * c.alpha)
	ps.rate                 = c.rate
	ps.sizeOverTime         = { start: SIZE_OVER_START * c.size, end: SIZE_OVER_END * c.size }
	ps.initialVelocitySpeed = { start: SPEED_MIN * c.speed, end: SPEED_MAX * c.speed }
	ps.gravity              = GRAVITY_MULT * c.lift
	ps.initialColor         = { start: a(COLOR_INIT_START), end: a(COLOR_INIT_END) }
	ps.colorOverTime        = { start: a(COLOR_OVER_START), end: a(COLOR_OVER_END) }
}


// MARK: smokeBlendSystem
/** Ease the plume toward the stage target; stop the emitter once fully dormant. */
function smokeBlendSystem(dt: number): void {
	if (blendT >= SMOKE_STAGE_BLEND_S || emitter === null) return
	blendT = Math.min(SMOKE_STAGE_BLEND_S, blendT + dt)
	writeClock += dt
	const done = blendT >= SMOKE_STAGE_BLEND_S
	if (!done && writeClock < 1 / SMOKE_BLEND_WRITE_HZ) return
	writeClock = 0
	const u = blendT / SMOKE_STAGE_BLEND_S
	const k = u * u * (3 - 2 * u)
	const to = stageParams(stationBoost)
	cur = {
		rate : from.rate  + (to.rate  - from.rate)  * k,
		size : from.size  + (to.size  - from.size)  * k,
		speed: from.speed + (to.speed - from.speed) * k,
		lift : from.lift  + (to.lift  - from.lift)  * k,
		alpha: from.alpha + (to.alpha - from.alpha) * k,
	}
	// Shrinking toward dormant keeps the old shape while the rate fades.
	if (stationBoost <= 0 && !isFloatingCrystals()) cur = { ...from, rate: cur.rate, alpha: from.alpha }
	writeParams()
	if (done && stationBoost <= 0 && !isFloatingCrystals() && lastMap !== null) {
		ParticleSystem.getMutable(emitter).playbackState = PBParticleSystem_PlaybackState.PS_STOPPED
	}
}


// MARK: setVolcanoSmokeBoost
/**
 * Plume stage from landed monuments (0–3).
 *   0 → stopped (dormant volcano), 1 → small, 2 → medium, 3 → eruption.
 * Blends over SMOKE_STAGE_BLEND_S. Safe before the emitter exists;
 * placeForMap seats it with the live parameters.
 */
export function setVolcanoSmokeBoost(activeCount: number): void {
	const next = volcanoStageIndex(activeCount)
	if (next === stationBoost) return
	stationBoost = next
	from   = { ...cur }
	blendT = 0
	writeClock = 1
	// Before seating (or after a reroll) nothing to blend from visually.
	if (emitter === null) {
		cur = stageParams(next)
		blendT = SMOKE_STAGE_BLEND_S
		return
	}
	if (next > 0 && lastMap !== null) {
		// Only play once a caldera seat exists (placeForMap may still be pending).
		ParticleSystem.getMutable(emitter).playbackState = PBParticleSystem_PlaybackState.PS_PLAYING
	}
	console.log(
		`volcanoSmoke: setVolcanoSmokeBoost: stage=${stationBoost} -> rate ${SMOKE_RATE_BY_STAGE[next]}/s ` +
		`over ${SMOKE_STAGE_BLEND_S}s`,
	)
}


// MARK: setupVolcanoSmoke
/**
 * Create the volcano plume emitter (stopped) and a watcher that seats
 * it on the caldera of whatever terrain is active. Idempotent.
 */
export function setupVolcanoSmoke(): void {
	if (installed) {
		console.log('volcanoSmoke: setupVolcanoSmoke: already installed, skipping')
		return
	}
	installed = true
	console.log(`volcanoSmoke: setupVolcanoSmoke: plume origin ${PLUME_ORIGIN_Y.toFixed(1)} m, lifetime ${LIFETIME_S.toFixed(1)} s, top ~${PLUME_TOP_Y.toFixed(0)} m (scene limit ${sceneHeightLimitM().toFixed(0)} m)`)

	emitter = engine.addEntity()
	Transform.create(emitter, {
		position: Vector3.create(0, -100, 0),
		rotation: Quaternion.Identity(),
	})
	ParticleSystem.create(emitter, {
		shape               : ParticleSystem.Shape.Cone({
			angle : CONE_ANGLE_DEG,
			radius: CONE_RADIUS_M,
		}),
		rate                : 0, // setVolcanoSmokeBoost / placeForMap own the rate
		maxParticles        : MAX_PARTICLES,
		lifetime            : LIFETIME_S,
		gravity             : GRAVITY_MULT,
		initialVelocitySpeed: { start: SPEED_MIN, end: SPEED_MAX },
		additionalForce     : WIND_FORCE,
		initialSize         : { start: SIZE_INIT_MIN, end: SIZE_INIT_MAX },
		sizeOverTime        : { start: SIZE_OVER_START, end: SIZE_OVER_END },
		// Darker volcanic grey near the vent so it stands out from snow.
		initialColor        : { start: COLOR_INIT_START, end: COLOR_INIT_END },
		colorOverTime       : { start: COLOR_OVER_START, end: COLOR_OVER_END },
		blendMode           : PBParticleSystem_BlendMode.PSB_ALPHA,
		billboard           : true,
		loop                : true,
		prewarm             : true,
		playbackState       : PBParticleSystem_PlaybackState.PS_STOPPED,
	})

	engine.addSystem(smokeBlendSystem)

	// Re-seat whenever the active layout changes (reroll / new cycle).
	engine.addSystem(() => {
		const map = activeTerrain()
		if (map === lastMap) return
		lastMap = map
		placeForMap(map)
	})

	console.log('volcanoSmoke: setupVolcanoSmoke: emitter created, waiting for terrain')
}
