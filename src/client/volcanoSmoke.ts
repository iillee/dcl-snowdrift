/**
 * volcanoSmoke.ts — tall grey smoke plume rising out of the volcano
 * caldera so the landmark can be located from across the map.
 *
 * Native SDK ParticleSystem (same pattern as campfireSmoke.ts): one
 * upward Cone emitter, buoyant rise, puffs grow and fade into the sky.
 * Visual only — no eruption / activation / thaw logic.
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
} from 'src/shared/settings'
import { activeTerrain } from 'src/shared/terrain/terrainCache'
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
/**
 * Smoke rate by activated station count. 0 = silent volcano (no plume).
 * 1/2/3 escalate: small → medium → strong. No base rate when dormant.
 */
const RATE_BY_STATIONS = [0, 2.5, 6, 10] as const
const LIFETIME_S     = 12
const MAX_PARTICLES  = 72
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
/** Search radius (cells) around map.volcano for caldera cells. */
const CALDERA_SEARCH_R = 12


// MARK: State
let emitter: ReturnType<typeof engine.addEntity> | null = null
let lastMap: TerrainMap | null = null
let installed = false
let stationBoost = 0


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
	const y = Math.max(groundYForLevel(TERRAIN_LEVEL_VOLCANO_RIM), volcanoCrownTopY()) + ORIGIN_ABOVE_RIM_M
	Transform.getMutable(emitter).position = Vector3.create(x, y, z)
	ps.rate = RATE_BY_STATIONS[stationBoost]
	if (stationBoost <= 0) {
		ps.playbackState = PBParticleSystem_PlaybackState.PS_STOPPED
		console.log(
			`volcanoSmoke: seated at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}) ` +
			`but dormant (0 stations) seed ${map.seed}`,
		)
		return
	}
	ps.playbackState = PBParticleSystem_PlaybackState.PS_PLAYING
	console.log(
		`volcanoSmoke: plume at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}) ` +
		`cell (${cell.fx.toFixed(1)}, ${cell.fz.toFixed(1)}) stations=${stationBoost} ` +
		`rate=${ps.rate}/s seed ${map.seed}`,
	)
}


// MARK: setVolcanoSmokeBoost
/**
 * Plume from activated ignition stations (0–3).
 *   0 → stopped (dormant volcano)
 *   1 → small, 2 → medium, 3 → strong
 * Safe before the emitter exists; applied again when placeForMap seats it.
 */
export function setVolcanoSmokeBoost(activeCount: number): void {
	stationBoost = Math.max(0, Math.min(3, Math.floor(activeCount)))
	if (emitter === null) return
	const ps = ParticleSystem.getMutable(emitter)
	const rate = RATE_BY_STATIONS[stationBoost]
	ps.rate = rate
	if (stationBoost <= 0) {
		ps.playbackState = PBParticleSystem_PlaybackState.PS_STOPPED
	} else if (lastMap !== null) {
		// Only play once a caldera seat exists (placeForMap may still be pending).
		ps.playbackState = PBParticleSystem_PlaybackState.PS_PLAYING
	}
	console.log(
		`volcanoSmoke: setVolcanoSmokeBoost: stations=${stationBoost} rate=${rate}/s ` +
		`playback=${stationBoost <= 0 ? 'STOPPED' : 'PLAYING'}`,
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
		initialColor        : {
			// Darker volcanic grey near the vent so it stands out from snow.
			start: Color4.create(0.32, 0.30, 0.29, 0.80),
			end  : Color4.create(0.42, 0.40, 0.38, 0.70),
		},
		colorOverTime       : {
			start: Color4.create(0.55, 0.54, 0.53, 0.60),
			end  : Color4.create(0.80, 0.80, 0.82, 0.0),
		},
		blendMode           : PBParticleSystem_BlendMode.PSB_ALPHA,
		billboard           : true,
		loop                : true,
		prewarm             : true,
		playbackState       : PBParticleSystem_PlaybackState.PS_STOPPED,
	})

	// Re-seat whenever the active layout changes (reroll / new cycle).
	engine.addSystem(() => {
		const map = activeTerrain()
		if (map === lastMap) return
		lastMap = map
		placeForMap(map)
	})

	console.log('volcanoSmoke: setupVolcanoSmoke: emitter created, waiting for terrain')
}
