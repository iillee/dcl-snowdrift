/**
 * terrainGen.ts — seeded elevation generator.
 *
 * Regions first, boundaries second. Pipeline (design/terrain-plan.md):
 *   1. Mountain band around the edge: jittered thickness, corner
 *      bumpouts, inward fingers, bays, lip serration, then peak-height
 *      sculpting so the rim and horizon do not read as a box.
 *   2. Low / Middle / High from fractal noise, cut by quantile.
 *   3. Hearth disc forced Middle, noise blended toward Middle around it.
 *   4. Landform stamps in separate directions: canyon, ridge, plateau, basin.
 *   5. Cleanup: smoothing, tiny-region merge, diagonal-contact removal.
 *   6. Regions + ladders: spanning tree from the hearth region over
 *      one-step boundaries, one ladder per edge on a straight cliff run.
 *      Regions with no ladder site are flattened into a neighbour.
 *   7. Route distance from the hearth and far destinations.
 *   8. Validate; a failing seed retries deterministically.
 *
 * Pure and deterministic; client and server get the same map.
 *
 * Cell lengths scale with grid size relative to a 62-cell reference so
 * enlarging the World grows plateaus instead of adding more seams.
 */

import { computeVolcanoCrownCells, crownLevelFor } from 'src/shared/terrain/volcanoCrown'
import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import {
	MONUMENT_COUNT,
	MONUMENT_DISTANCE_BANDS,
	MONUMENT_MIN_ANGLE_DEG,
	MONUMENT_RELAX_SEP_FRAC,
	isFloatingCrystals,
	CRYSTAL_NEAR_MONUMENT_TARGET_M,
} from 'src/shared/ruleset'
import {
	MAJOR_GROVE_COUNT,
	TERRAIN_CELL_M,
	TERRAIN_GRID_H,
	TERRAIN_GRID_W,
	TERRAIN_LEVEL_HIGH,
	TERRAIN_LEVEL_LOW,
	TERRAIN_LEVEL_MID,
	TERRAIN_LEVEL_MOUNTAIN,
	TERRAIN_LEVEL_VOLCANO_RIM,
	TERRAIN_MOUNTAIN_PEAK_STEPS,
	VOLCANO_EXTRA_TERRACES,
	VOLCANO_LAVA_TOP_ABOVE_RIM_M,
	isCrownLevel,
	isMountainLevel,
} from 'src/shared/settings'
import {
	DIR_DX,
	DIR_DZ,
	LADDER_FOOT_M,
	LADDER_LAND_M,
	LANDFORM_BASIN,
	LANDFORM_CANYON,
	LANDFORM_HEARTH,
	LANDFORM_LAVA,
	LANDFORM_NONE,
	LANDFORM_PLATEAU,
	LANDFORM_RIDGE,
	LANDFORM_VOLCANO,
	TERRAIN_ORIGIN_M,
	TerrainDestination,
	TerrainStation,
	TerrainLadder,
	TerrainMap,
	TerrainVolcano,
	monumentHoverBottomY,
	cellCenterWorld,
	groundYForLevel,
} from 'src/shared/terrain/terrainMap'
import {
	Rng,
	fractalNoise2,
	mulberry32,
	randInt,
	shuffleInPlace,
	valueNoise2,
} from 'src/shared/utils/random'


// MARK: Tuning

const W = TERRAIN_GRID_W
const H = TERRAIN_GRID_H
const N = W * H

const LOW      = TERRAIN_LEVEL_LOW
const MID      = TERRAIN_LEVEL_MID
const HIGH     = TERRAIN_LEVEL_HIGH
const RIM      = TERRAIN_LEVEL_VOLCANO_RIM
const MOUNTAIN = TERRAIN_LEVEL_MOUNTAIN

/**
 * Reference grid the generator was tuned against (64×64 playfield → 62
 * cells). Maps larger than REF grow lengths/radii; maps smaller than
 * REF shrink them so a playtest_52 envelope does not keep full-size
 * stamps. Cliff-edge count stays roughly flat either way.
 */
const REF_GRID = 62
const SCALE    = Math.min(W, H) / REF_GRID

/** Scale a cell length/radius. Kept as a helper so call sites stay readable. */
function sc(cells: number): number {
	return cells * SCALE
}

// Mountain band scales with the envelope so a playtest_52 map keeps a
// usable interior (design: don't let the rim eat the playfield). Floors
// keep the outer seal intact. Fingers / corners / bays / serration +
// peak heights still break up the box silhouette.
const MOUNTAIN_BAND_MIN     = Math.max(2, Math.round(sc(3)))
const MOUNTAIN_BAND_JITTER  = Math.max(2, Math.round(sc(4)))
const MOUNTAIN_JITTER_SCALE = sc(5)
/** Extra mountain mass at each corner (cells into the interior). */
const MOUNTAIN_CORNER_R     = Math.max(3, Math.round(sc(6)))
/** Inward mountain spurs per edge (seed picks their slots). */
const MOUNTAIN_FINGERS_PER_EDGE = SCALE < 0.9 ? 2 : 4
const MOUNTAIN_FINGER_LEN_MIN   = Math.max(2, Math.round(sc(3)))
const MOUNTAIN_FINGER_LEN_MAX   = Math.max(4, Math.round(sc(9)))
const MOUNTAIN_FINGER_HALF_W    = 1
/** Recesses carved into the band per edge (outer rim stays sealed). */
const MOUNTAIN_BAYS_PER_EDGE = SCALE < 0.9 ? 1 : 2
const MOUNTAIN_BAY_HALF_W    = 2
/** Never strip mountain inside this many cells of the scene edge. */
const MOUNTAIN_SEAL_CELLS    = 2
/** Chance each inner-lip cell gains or loses a neighbour for jaggedness. */
const MOUNTAIN_SERRATE_CHANCE = 0.38
/**
 * Noise scale for peak-height sculpting. Large on purpose so raised /
 * lowered rim segments clump into long horizon chunks (not speckles).
 */
const MOUNTAIN_PEAK_NOISE_SCALE = sc(18)

// One noise feature spans this many cells. 14 on the reference grid
// (= 224 m); grows with SCALE so a 100×100 map keeps a similar number
// of plateaus, each larger in metres.
const FIELD_SCALE_CELLS = sc(14)
const FIELD_OCTAVES     = 3
const FIELD_GAIN        = 0.4

// Share of interior cells cut to Low and High; the rest is Middle.
const LOW_FRACTION  = 0.27
const HIGH_FRACTION = 0.27

// Hearth disc stays local to gameplay (not scaled with the world).
const HEARTH_FORCE_R = 4.5
const HEARTH_BLEND_R = 9

// Tiny regions fold into neighbours. Floor grows with SCALE so a big
// map does not keep more crumb-sized fragments than the reference.
const MIN_REGION_CELLS = Math.round(sc(8))

// Ladder placement.
const SECOND_LADDER_MIN_SITES = Math.round(sc(24))
const SECOND_LADDER_MIN_SEP   = Math.round(sc(10))

// Destinations — Low + Mid + High major grove sockets. Volcano is a
// separate High landmark (map.volcano), not a grove destination.
const DEST_MIN_AREA      = Math.round(sc(40))
const DEST_MAX           = MAJOR_GROVE_COUNT
/** Angular separation from the hearth so territories fan out. */
const DEST_MIN_ANGLE_RAD = Math.PI / 3
/** Min mean route distance (cells) so a Mid socket is not the hearth shelf. */
const DEST_MIN_ROUTE     = Math.round(sc(14))

// Volcano landmark (High plateau). Not a grove.
const VOLCANO_MIN_AREA       = Math.round(sc(28))
const VOLCANO_MIN_ROUTE      = Math.round(sc(16))
/** Min Chebyshev cells between volcano centroid and any grove socket. */
const VOLCANO_MIN_SEP_CELLS  = Math.round(sc(10))
/** Prefer opposite half of the map from the farther grove (radians). */
const VOLCANO_OPPOSITE_RAD   = Math.PI / 2

// Ignition stations (monuments) — three exploration sockets. They rise to
// hover ~20 m above the crater rim and beam down from the bottom tip, so the socket itself needs
// no line of sight: low ground and canyons are valid (and preferred).
// Not groves. Scaled so playtest_52 and full_100 share the same feel.
const STATION_COUNT            = isFloatingCrystals() ? MONUMENT_COUNT : 3
/** World gen accepts the map with at least this many (crystals: fewer than MONUMENT_COUNT is logged, not a reroll). */
const STATION_MIN_VALID        = 3
/** Min Chebyshev cells between any two stations. */
const STATION_MIN_SEP_CELLS    = Math.round(sc(12))
/** Min Chebyshev cells from hearth centre. */
const STATION_MIN_HEARTH_CELLS = Math.round(sc(10))
/** Min Chebyshev cells from the volcano marker. */
const STATION_MIN_VOLCANO_CELLS = Math.round(sc(10))
/** Min Chebyshev cells from a grove socket (avoid grove cores). */
const STATION_MIN_GROVE_CELLS  = Math.round(sc(6))
/** Min route steps from the hearth so a station is not the hearth shelf. */
const STATION_MIN_ROUTE        = Math.round(sc(10))
/** Angular fan-out from the hearth between stations (radians). */
const STATION_MIN_ANGLE_RAD    = Math.PI / 4
/**
 * Beam start height above the station surface, and LOS clearance under
 * the beam (m). Matches the ~1.5 m stump the client draws.
 */
const STATION_BEAM_CLEAR_M     = 1.5
const STATION_LOS_CLEAR_M      = 1.0
/** Last N cells before the target ignore blockers (crater lip / crown). */
const STATION_LOS_NEAR_TARGET  = 2

// Near-spawn monument: one station always sits on the OUTER side of the
// starting grove: the far side of the hearth from the volcano, ~160 m out
// at the outer edge of the starting grove (tip visible from the campfire).
// The grove is the hearth tree ring (catalog radiiM 64 / 88 / 96 / 104 m
// core, 144 / 168 m far trees) on the forced hearth terrace
// (HEARTH_FORCE_R 4.5 cells = 72 m, blended to 9 cells = 144 m).
/** Preferred distance from the hearth (m): between the two far hearth trees (144 / 168 m). */
export const NEAR_STATION_TARGET_M       = 160
/** Inner edge of the preferred band (m). */
export const NEAR_STATION_MIN_M          = 136
/** Outer edge of the preferred band (m). */
export const NEAR_STATION_MAX_M          = 192
/** Relaxed band when the preferred band has no usable cell (m). */
export const NEAR_STATION_RELAX_MIN_M    = 48
/** Relaxed outer edge (m). */
export const NEAR_STATION_RELAX_MAX_M    = 256
/** Max angle (deg) between hearth->socket and "directly away from the volcano". */
export const NEAR_STATION_AWAY_MAX_DEG   = 75
/** Relaxed away cone (deg). Past this the side is ignored (last resort only). */
export const NEAR_STATION_AWAY_RELAX_DEG = 110
/** Score weights: facing away from the volcano vs closeness to the target distance. */
const NEAR_W_AWAY = 2
const NEAR_W_DIST = 1.5
/**
 * Pull the near monument toward spawn AFTER the far two are placed:
 * the preferred band (target / min / max) is scaled by this and the best
 * valid socket that keeps spacing + angle to the (unchanged) far two is
 * used; else the original spot stays. 1 = old placement. 0.75 = ~25% closer.
 */
export const NEAR_STATION_PULL: number = 0.75
/** Ranked near sockets tried in turn when one blocks the far picks. */
const NEAR_STATION_TRIES = 8
/** Effective pull: crystals mode aims the near monument at CRYSTAL_NEAR_MONUMENT_TARGET_M. */
function nearPull(): number {
	return isFloatingCrystals() ? CRYSTAL_NEAR_MONUMENT_TARGET_M / NEAR_STATION_TARGET_M : NEAR_STATION_PULL
}
/** Hearth line of sight: eye height above the hearth ground (m). */
export const NEAR_LOS_EYE_M = 1.7
/**
 * Hearth line of sight: aim point above the socket ground (m) = the
 * seated pyramid tip (4 m pyramid, base flush with the ground; see
 * stationMarkers FROZEN_TIP_Y_M). Kept local so terrainGen does not
 * import the client / monumentIce chain.
 */
export const NEAR_LOS_TIP_M = 4
/** Ray samples per cell (16 m cells -> one sample every 2 m). */
const NEAR_LOS_SAMPLES_PER_CELL = 8
/**
 * Extra hover heights tried, smallest first (m on top of
 * monumentHoverBottomY), until the bottom-tip beam to a rim point
 * clears terrain. If none clears the socket is still valid (last step).
 */
const MONUMENT_LIFT_STEPS_M: readonly number[] = [0, 10, 20]
/** Chebyshev radius (cells) for the canyon / enclosure score. */
const STATION_ENCLOSE_R = 2
/** Beam aims this far above a rim cell's surface (m). */
const NEAR_RIM_AIM_ABOVE_M     = 1.0
/** Max rim points sampled for LOS (evenly by angle). */
const NEAR_RIM_SAMPLES         = 24

// Validation.
const MIN_HEARTH_REGION_CELLS = Math.round(sc(40))
const MIN_LADDERS             = 2
const MAX_ATTEMPTS            = 24
const MAX_REPAIR_PASSES       = 10

// Hearth in fractional cell coords (cell corner units).
const HEARTH_FX = (CAMPFIRE_WORLD_X - TERRAIN_ORIGIN_M) / TERRAIN_CELL_M
const HEARTH_FZ = (CAMPFIRE_WORLD_Z - TERRAIN_ORIGIN_M) / TERRAIN_CELL_M
const HEARTH_CX = Math.floor(HEARTH_FX)
const HEARTH_CZ = Math.floor(HEARTH_FZ)


// MARK: Working state

interface Work {
	rng       : Rng
	seed      : number
	levels    : Uint8Array
	landforms : Uint8Array
	/** 1 = generator must not change this cell's level. */
	locked    : Uint8Array
	/**
	 * Low cell of the one ladder allowed onto the rim (the top spiral
	 * pad), so the crater wall gets a single gap.
	 */
	rimPadLow : Set<number>
}

interface LadderSite {
	low  : number
	high : number
	dir  : number
}


// MARK: generateTerrain
/**
 * Build the terrain map for a layout seed. Always returns a map: when a
 * seed fails validation it retries with derived seeds, and after
 * MAX_ATTEMPTS keeps the last candidate and logs why.
 */
export function generateTerrain(seed: number): TerrainMap {
	let last: TerrainMap | null = null
	let lastFailure = ''
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		const usedSeed = attempt === 0 ? seed >>> 0 : (Math.imul(seed ^ attempt, 0x9E3779B1) + attempt) >>> 0
		const map      = buildOnce(seed, usedSeed, attempt + 1)
		const failure  = validate(map)
		if (failure === '') return map
		last        = map
		lastFailure = failure
	}
	console.log(`terrainGen: generateTerrain: seed ${seed} failed ${MAX_ATTEMPTS} attempts (${lastFailure}), keeping last`)
	return last!
}


// MARK: buildOnce
function buildOnce(
	seed     : number,
	usedSeed : number,
	attempts : number,
): TerrainMap {
	const work: Work = {
		rng       : mulberry32(usedSeed),
		seed      : usedSeed,
		levels    : new Uint8Array(N),
		landforms : new Uint8Array(N),
		locked    : new Uint8Array(N),
		rimPadLow : new Set<number>(),
	}

	paintMountainBand(work)
	paintLevelField(work)
	stampLandforms(work)
	smooth(work, 2)

	let regions     : Int16Array = new Int16Array(N)
	let regionLevel : number[] = []
	let regionArea  : number[] = []
	let ladders     : TerrainLadder[] = []

	for (let pass = 0; pass < MAX_REPAIR_PASSES; pass++) {
		mergeTinyRegions(work)
		removeDiagonals(work)
		mergeTinyRegions(work)
		removeDiagonals(work)

		const labelled = labelRegions(work.levels)
		regions        = labelled.regions
		regionLevel    = labelled.regionLevel
		regionArea     = labelled.regionArea

		const placed = placeLadders(work, regions, regionLevel)
		ladders      = placed.ladders
		if (placed.unreached.length === 0) break
		flattenRegions(work, regions, placed.unreached)
	}

	let hearthRegion = regions[HEARTH_CZ * W + HEARTH_CX]
	let routeDist    = computeRouteDist(work.levels, ladders)
	// Small envelopes (and messy volcano stamps) can leave tiny walkable
	// pockets the ladder tree never reaches. Seal them as mountain so
	// validate does not reject an otherwise good layout.
	if (sealUnreachable(work, routeDist) > 0) {
		const labelled = labelRegions(work.levels)
		regions     = labelled.regions
		regionLevel = labelled.regionLevel
		regionArea  = labelled.regionArea
		hearthRegion = regions[HEARTH_CZ * W + HEARTH_CX]
		routeDist    = computeRouteDist(work.levels, ladders)
	}
	const destinations = pickDestinations(
		work.landforms,
		regions,
		regionLevel,
		regionArea,
		routeDist,
		hearthRegion,
	)
	const volcano = pickVolcano(
		work,
		regions,
		regionLevel,
		regionArea,
		routeDist,
		hearthRegion,
		destinations,
	)

	// Extrude the crater crown: inner-lip rim cells become crown terrain
	// (5–7 m taller columns). After ladders + volcano so access and the
	// landmark are settled; the cells leave the walkable graph.
	for (const i of computeVolcanoCrownCells(work.levels, work.landforms, ladders, W, H)) {
		work.levels[i] = crownLevelFor(i, usedSeed)
		const r = regions[i]
		if (r >= 0) regionArea[r]--
		regions[i]   = -1
		routeDist[i] = -1
	}

	// Stations need the final heights (crown extruded) so the hover beam
	// check matches what the player sees. Empty when the volcano is
	// missing or no three sockets clear separation.
	// Floating crystals: pick the near monument at its target up front so the
	// far picks are built around it (a late pull often loses to their angles).
	const nearPicks = pickNearStation(work, regions, routeDist, volcano, ladders, hearthRegion, isFloatingCrystals() ? nearPull() : 1)
	let stations: TerrainStation[] = []
	let best: TerrainStation[] = []
	for (let k = 0; k < nearPicks.length; k++) {
		stations = pickStations(work, regions, routeDist, destinations, volcano, ladders, [nearPicks[k].station])
		if (stations.length > best.length) best = stations
		if (stations.length >= STATION_COUNT) {
			console.log('terrainGen: ' + nearPicks[k].log + (k > 0 ? ' (alt ' + k + ')' : ''))
			break
		}
	}
	stations = best
	if (stations.length < STATION_COUNT && stations.length < STATION_MIN_VALID) {
		console.log('terrainGen: near monument blocked the far picks - falling back to far-only stations')
		stations = pickStations(work, regions, routeDist, destinations, volcano, ladders, [])
	}
	if (stations.length < STATION_COUNT) console.log(`terrainGen: only ${stations.length}/${STATION_COUNT} monuments placed`)
	if (nearPull() !== 1 && stations.length >= STATION_MIN_VALID && stations[0].near) {
		stations = pullNearStation(work, regions, routeDist, volcano, ladders, hearthRegion, stations)
	}

	return {
		seed,
		usedSeed,
		attempts,
		w            : W,
		h            : H,
		levels       : work.levels,
		regions,
		landforms    : work.landforms,
		regionLevel,
		regionArea,
		hearthCx     : HEARTH_CX,
		hearthCz     : HEARTH_CZ,
		hearthRegion,
		ladders,
		destinations,
		volcano,
		stations,
		routeDist,
	}
}


// MARK: hearthDist
/** Distance in cells from a cell centre to the hearth point. */
function hearthDist(
	cx: number,
	cz: number,
): number {
	const dx = cx + 0.5 - HEARTH_FX
	const dz = cz + 0.5 - HEARTH_FZ
	return Math.sqrt(dx * dx + dz * dz)
}


// MARK: lockMountain
/**
 * Paint one cell as sealed mountain. Skips the hearth neighbourhood so
 * fingers never pin the spawn pad against a spur.
 */
function lockMountain(
	work: Work,
	cx:   number,
	cz:   number,
): void {
	if (cx < 0 || cz < 0 || cx >= W || cz >= H) return
	if (hearthDist(cx, cz) < HEARTH_BLEND_R) return
	const i = cz * W + cx
	work.levels[i] = MOUNTAIN
	work.locked[i] = 1
}


// MARK: paintMountainBand
/**
 * Outer rim plus breakup that keeps it from reading as a box: jittered
 * thickness, corner mass, inward fingers, bays, lip serration, then
 * peak-height tiers for an uneven horizon. Outer MOUNTAIN_SEAL_CELLS
 * stay solid so nothing walks out of the scene.
 */
function paintMountainBand(work: Work): void {
	for (let cz = 0; cz < H; cz++) {
		for (let cx = 0; cx < W; cx++) {
			const edge   = Math.min(cx, cz, W - 1 - cx, H - 1 - cz)
			const jitter = Math.floor(valueNoise2(cx / MOUNTAIN_JITTER_SCALE, cz / MOUNTAIN_JITTER_SCALE, work.seed + 77) * (MOUNTAIN_BAND_JITTER + 1))
			if (edge < MOUNTAIN_BAND_MIN + jitter) lockMountain(work, cx, cz)
		}
	}
	paintMountainCorners(work)
	paintMountainFingers(work)
	paintMountainBays(work)
	serrateMountainLip(work)
	sculptMountainHeights(work)
}


// MARK: paintMountainCorners
/** Thicken each corner so the silhouette does not meet as a sharp box. */
function paintMountainCorners(work: Work): void {
	const r = MOUNTAIN_CORNER_R
	const corners: Array<[number, number]> = [
		[0, 0],
		[W - 1, 0],
		[0, H - 1],
		[W - 1, H - 1],
	]
	for (const [ox, oz] of corners) {
		for (let dz = -r; dz <= r; dz++) {
			for (let dx = -r; dx <= r; dx++) {
				const cx = ox + dx
				const cz = oz + dz
				if (cx < 0 || cz < 0 || cx >= W || cz >= H) continue
				// Quarter-disk into the interior from that corner.
				const ix = ox === 0 ? cx : W - 1 - cx
				const iz = oz === 0 ? cz : H - 1 - cz
				if (ix * ix + iz * iz <= r * r) lockMountain(work, cx, cz)
			}
		}
	}
}


// MARK: paintMountainFingers
/**
 * Short mountain spurs pulling off each edge into the playfield — the
 * light version of the old perimeter canyon fingers.
 */
function paintMountainFingers(work: Work): void {
	const margin = MOUNTAIN_CORNER_R + 2
	const spanX  = W - 2 * margin
	const spanZ  = H - 2 * margin
	if (spanX < 4 || spanZ < 4) return

	type Edge = { along: number; axis: 'x' | 'z'; inward: 1 | -1; fixed: number }
	const edges: Edge[] = [
		{ along: spanX, axis: 'x', inward:  1, fixed: 0 },
		{ along: spanX, axis: 'x', inward: -1, fixed: H - 1 },
		{ along: spanZ, axis: 'z', inward:  1, fixed: 0 },
		{ along: spanZ, axis: 'z', inward: -1, fixed: W - 1 },
	]

	for (let e = 0; e < edges.length; e++) {
		const edge = edges[e]
		for (let f = 0; f < MOUNTAIN_FINGERS_PER_EDGE; f++) {
			const slot = margin + Math.floor(work.rng() * edge.along)
			const len  = randInt(work.rng, MOUNTAIN_FINGER_LEN_MIN, MOUNTAIN_FINGER_LEN_MAX)
			for (let s = 0; s <= len; s++) {
				for (let w = -MOUNTAIN_FINGER_HALF_W; w <= MOUNTAIN_FINGER_HALF_W; w++) {
					let cx: number
					let cz: number
					if (edge.axis === 'x') {
						cx = slot + w
						cz = edge.fixed + edge.inward * (MOUNTAIN_BAND_MIN + s)
					} else {
						cx = edge.fixed + edge.inward * (MOUNTAIN_BAND_MIN + s)
						cz = slot + w
					}
					lockMountain(work, cx, cz)
				}
			}
		}
	}
}


// MARK: paintMountainBays
/**
 * Carve shallow recesses into the inner face of the band. Outer seal
 * cells stay mountain so the world rim never opens.
 */
function paintMountainBays(work: Work): void {
	const margin = MOUNTAIN_CORNER_R + 3
	const spanX  = W - 2 * margin
	const spanZ  = H - 2 * margin
	if (spanX < 4 || spanZ < 4) return

	type Edge = { along: number; axis: 'x' | 'z'; inward: 1 | -1; fixed: number }
	const edges: Edge[] = [
		{ along: spanX, axis: 'x', inward:  1, fixed: 0 },
		{ along: spanX, axis: 'x', inward: -1, fixed: H - 1 },
		{ along: spanZ, axis: 'z', inward:  1, fixed: 0 },
		{ along: spanZ, axis: 'z', inward: -1, fixed: W - 1 },
	]

	for (let e = 0; e < edges.length; e++) {
		const edge = edges[e]
		for (let b = 0; b < MOUNTAIN_BAYS_PER_EDGE; b++) {
			const slot = margin + Math.floor(work.rng() * edge.along)
			// Depth reaches the inner lip of the band, not the seal.
			const depth = MOUNTAIN_BAND_MIN + MOUNTAIN_BAND_JITTER
			for (let s = MOUNTAIN_SEAL_CELLS; s < depth; s++) {
				for (let w = -MOUNTAIN_BAY_HALF_W; w <= MOUNTAIN_BAY_HALF_W; w++) {
					let cx: number
					let cz: number
					if (edge.axis === 'x') {
						cx = slot + w
						cz = edge.fixed + edge.inward * s
					} else {
						cx = edge.fixed + edge.inward * s
						cz = slot + w
					}
					if (cx < 0 || cz < 0 || cx >= W || cz >= H) continue
					const i = cz * W + cx
					if (!isMountainLevel(work.levels[i])) continue
					// Clear so paintLevelField can claim the bay as walkable.
					work.levels[i]    = MID
					work.locked[i]    = 0
					work.landforms[i] = LANDFORM_NONE
				}
			}
		}
	}
}


// MARK: serrateMountainLip
/**
 * Jab the inner mountain face: randomly grow one cell into the playfield
 * or chew one non-seal mountain cell back. Breaks long straight seams
 * left by the band / finger / bay pass.
 */
function serrateMountainLip(work: Work): void {
	const lip: number[] = []
	for (let cz = 0; cz < H; cz++) {
		for (let cx = 0; cx < W; cx++) {
			const i = cz * W + cx
			if (!isMountainLevel(work.levels[i])) continue
			let touchesInterior = false
			for (let d = 0; d < 4; d++) {
				const nx = cx + DIR_DX[d]
				const nz = cz + DIR_DZ[d]
				if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue
				if (!isMountainLevel(work.levels[nz * W + nx])) {
					touchesInterior = true
					break
				}
			}
			if (touchesInterior) lip.push(i)
		}
	}
	for (const i of lip) {
		if (work.rng() > MOUNTAIN_SERRATE_CHANCE) continue
		const cx   = i % W
		const cz   = (i - cx) / W
		const edge = Math.min(cx, cz, W - 1 - cx, H - 1 - cz)
		if (work.rng() < 0.55) {
			const order = [0, 1, 2, 3]
			for (let k = order.length - 1; k > 0; k--) {
				const j = Math.floor(work.rng() * (k + 1))
				const t = order[k]
				order[k] = order[j]
				order[j] = t
			}
			for (const d of order) {
				const nx = cx + DIR_DX[d]
				const nz = cz + DIR_DZ[d]
				if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue
				if (isMountainLevel(work.levels[nz * W + nx])) continue
				lockMountain(work, nx, nz)
				break
			}
			continue
		}
		if (edge < MOUNTAIN_SEAL_CELLS) continue
		work.levels[i]    = MID
		work.locked[i]    = 0
		work.landforms[i] = LANDFORM_NONE
	}
}


// MARK: sculptMountainHeights
/**
 * Assign peak tiers (MOUNTAIN .. MOUNTAIN+PEAK_STEPS) from very
 * low-frequency noise so raised and lowered rim segments form large
 * contiguous chunks — long horizon steps, not cell-scale speckles.
 */
function sculptMountainHeights(work: Work): void {
	if (TERRAIN_MOUNTAIN_PEAK_STEPS <= 0) return
	for (let cz = 0; cz < H; cz++) {
		for (let cx = 0; cx < W; cx++) {
			const i = cz * W + cx
			if (!isMountainLevel(work.levels[i])) continue
			const n = valueNoise2(
				cx / MOUNTAIN_PEAK_NOISE_SCALE,
				cz / MOUNTAIN_PEAK_NOISE_SCALE,
				work.seed + 191,
			)
			let boost = 0
			if (n > 0.36) boost = 1
			if (n > 0.66) boost = 2
			if (boost > TERRAIN_MOUNTAIN_PEAK_STEPS) boost = TERRAIN_MOUNTAIN_PEAK_STEPS
			work.levels[i] = MOUNTAIN + boost
			work.locked[i] = 1
		}
	}
}


// MARK: paintLevelField
function paintLevelField(work: Work): void {
	const field    = new Float32Array(N)
	const interior : number[] = []
	for (let cz = 0; cz < H; cz++) {
		for (let cx = 0; cx < W; cx++) {
			const i = cz * W + cx
			field[i] = fractalNoise2(cx / FIELD_SCALE_CELLS, cz / FIELD_SCALE_CELLS, work.seed, FIELD_OCTAVES, FIELD_GAIN)
			if (!isMountainLevel(work.levels[i])) interior.push(i)
		}
	}

	const median = quantile(interior.map(i => field[i]), 0.5)

	// Pull the field toward Middle around the hearth so the forced disc
	// does not read as a perfect circle.
	for (const i of interior) {
		const d = hearthDist(i % W, Math.floor(i / W))
		if (d >= HEARTH_BLEND_R) continue
		const t = Math.max(0, (d - HEARTH_FORCE_R) / (HEARTH_BLEND_R - HEARTH_FORCE_R))
		field[i] = median + (field[i] - median) * t
	}

	const values = interior.map(i => field[i])
	const tLow   = quantile(values, LOW_FRACTION)
	const tHigh  = quantile(values, 1 - HIGH_FRACTION)

	for (const i of interior) {
		const v = field[i]
		work.levels[i] = v < tLow ? LOW : v > tHigh ? HIGH : MID
		if (hearthDist(i % W, Math.floor(i / W)) < HEARTH_FORCE_R) {
			work.levels[i]    = MID
			work.locked[i]    = 1
			work.landforms[i] = LANDFORM_HEARTH
		}
	}
}


// MARK: quantile
function quantile(
	values: number[],
	q:      number,
): number {
	const sorted = values.slice().sort((a, b) => a - b)
	const idx    = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))
	return sorted[idx]
}


// MARK: stampLandforms
/**
 * One canyon, ridge, plateau, and basin, each in its own quarter of the
 * compass around the hearth so every direction has a different read.
 */
function stampLandforms(work: Work): void {
	const rng   = work.rng
	const base  = rng() * Math.PI * 2
	const kinds = shuffleInPlace(rng, [LANDFORM_CANYON, LANDFORM_RIDGE, LANDFORM_PLATEAU, LANDFORM_BASIN])
	for (let k = 0; k < kinds.length; k++) {
		const angle = base + k * (Math.PI / 2) + (rng() - 0.5) * 0.6
		switch (kinds[k]) {
			case LANDFORM_CANYON:  stampCanyon(work, angle);  break
			case LANDFORM_RIDGE:   stampRidge(work, angle);   break
			case LANDFORM_PLATEAU: stampVolcano(work, angle); break
			case LANDFORM_BASIN:   stampBasin(work, angle);   break
		}
	}
}


// MARK: stampCell
/** Set one cell's level and tag unless it is locked or off-grid. */
function stampCell(
	work:     Work,
	cx:       number,
	cz:       number,
	level:    number,
	landform: number,
): void {
	if (cx < 0 || cz < 0 || cx >= W || cz >= H) return
	const i = cz * W + cx
	if (work.locked[i]) return
	work.levels[i]    = level
	work.landforms[i] = landform
}


// MARK: stampDisc
function stampDisc(
	work:     Work,
	fx:       number,
	fz:       number,
	radius:   number,
	level:    number,
	landform: number,
): void {
	const r = Math.ceil(radius)
	for (let dz = -r; dz <= r; dz++) {
		for (let dx = -r; dx <= r; dx++) {
			const cx = Math.floor(fx) + dx
			const cz = Math.floor(fz) + dz
			const ex = cx + 0.5 - fx
			const ez = cz + 0.5 - fz
			if (ex * ex + ez * ez <= radius * radius) stampCell(work, cx, cz, level, landform)
		}
	}
}


// MARK: stampPath
/**
 * Walk from (fx, fz) along `angle` with a gentle wander, stamping a disc
 * of `radius` every half cell. Stops at the mountain band.
 */
function stampPath(
	work:     Work,
	fx:       number,
	fz:       number,
	angle:    number,
	length:   number,
	radius:   number,
	level:    number,
	landform: number,
): void {
	let a = angle
	let x = fx
	let z = fz
	for (let s = 0; s < length * 2; s++) {
		const cx = Math.floor(x)
		const cz = Math.floor(z)
		if (cx < 0 || cz < 0 || cx >= W || cz >= H) return
		if (isMountainLevel(work.levels[cz * W + cx])) return
		stampDisc(work, x, z, radius, level, landform)
		a += (work.rng() - 0.5) * 0.25
		x += Math.cos(a) * 0.5
		z += Math.sin(a) * 0.5
	}
}


// MARK: stampCanyon
/** Low corridor, two cells wide, from just outside the hearth outward. */
function stampCanyon(
	work:  Work,
	angle: number,
): void {
	const start = HEARTH_FORCE_R + 2
	// Length scales with the map; width stays a narrow corridor.
	const len   = randInt(work.rng, Math.round(sc(14)), Math.round(sc(22)))
	stampPath(work, HEARTH_FX + Math.cos(angle) * start, HEARTH_FZ + Math.sin(angle) * start, angle, len, 1.05, LOW, LANDFORM_CANYON)
}


// MARK: stampRidge
/** High line, two to three cells wide, running across the bearing. */
function stampRidge(
	work:  Work,
	angle: number,
): void {
	const dist   = randInt(work.rng, Math.round(sc(9)), Math.round(sc(13)))
	const len    = randInt(work.rng, Math.round(sc(12)), Math.round(sc(20)))
	const across = angle + Math.PI / 2 + (work.rng() - 0.5) * 0.8
	const cx     = HEARTH_FX + Math.cos(angle) * dist
	const cz     = HEARTH_FZ + Math.sin(angle) * dist
	const sx     = cx - Math.cos(across) * len / 2
	const sz     = cz - Math.sin(across) * len / 2
	const radius = work.rng() < 0.5 ? 1.05 : 1.5
	stampPath(work, sx, sz, across, len, radius, HIGH, LANDFORM_RIDGE)
}


// Volcano terrace widths (cells on the reference grid). Each ring is a
// walkable 16 m step; the spiral ladder pads below make them 2 deep
// where a ladder needs standing room.
const VOLCANO_RIM_W_CELLS     = 1.0
const VOLCANO_TERRACE_W_CELLS = 1.0
const VOLCANO_HIGH_W_CELLS    = 1.0
const VOLCANO_APRON_W_CELLS   = 1.0
/** Lava lake = ellipse t below this (was 0.40); keeps the cone tight. */
const VOLCANO_CRATER_T        = 0.30
/**
 * Per-side jitter: extra width (cells) added to the terrace and High
 * rings by a smooth noise of bearing, so the rings are not perfectly
 * concentric and the cone reads as a lumpy peak.
 */
const VOLCANO_SIDE_JITTER_CELLS = 0.35
/** Side noise below this drops a level on that face (32 m cliff there). */
const VOLCANO_RING_SKIP_BELOW = 0.38
/** Side noise above this widens the level into a shoulder. */
const VOLCANO_RING_WIDE_ABOVE = 0.75
/** Shoulder width as a multiple of the normal ring width. */
const VOLCANO_RING_W_WIDE     = 1.35

// MARK: stampVolcano
/**
 * Volcano cone + caldera landmark (not a grove).
 *
 * Concentric ellipse rings — the summit sits at VOLCANO_RIM, above
 * High and all mountain peaks:
 *   1. Crater interior: rim-level LANDFORM_LAVA (locked). The client
 *      lays a glowing lava lid over it and a 5–7 m crown of blocks on
 *      the inner lip (src/shared/terrain/volcanoCrown.ts).
 *   2. Volcano rim crest
 *   3. High outer slopes
 *   4. Mid foothill apron
 *
 * Mountain teeth only when a cell already touches the mountain band —
 * extends silhouette without sealing a stranded High pocket. Teeth
 * stay below the rim in height (see groundYForLevel).
 */
function stampVolcano(
	work:  Work,
	angle: number,
): void {
	const dist = randInt(work.rng, Math.round(sc(17)), Math.round(sc(25)))
	let fx = HEARTH_FX + Math.cos(angle) * dist
	let fz = HEARTH_FZ + Math.sin(angle) * dist
	// Mild oval (not a sausage) so it still reads as a cone from afar.
	const stretch = angle + (work.rng() - 0.5) * 0.55
	// majorR sizes the crater (lava = t < VOLCANO_CRATER_T); terraces are constant-
	// width rings stacked outside it.
	const majorR  = sc(5.2) + work.rng() * sc(2.2)
	const minorR  = majorR * (0.70 + work.rng() * 0.22)
	const spinSgn = work.rng() < 0.5 ? 1 : 3 // +90 or -90 deg per pad

	const wRim   = Math.max(1, sc(VOLCANO_RIM_W_CELLS))
	const tw     = Math.max(1, sc(VOLCANO_TERRACE_W_CELLS))
	const wHigh  = Math.max(1.1, sc(VOLCANO_HIGH_W_CELLS))
	const wApron = Math.max(1, sc(VOLCANO_APRON_W_CELLS))
	const eT1    = wRim + VOLCANO_EXTRA_TERRACES * tw
	// Widest possible ring stack (every level at its widest).
	const eHigh  = wRim + (VOLCANO_EXTRA_TERRACES + 1) * VOLCANO_RING_W_WIDE * Math.max(1, sc(1))
	const eApron = eHigh + wApron
	const eOuter = eApron + 0.8
	const craterR = majorR * VOLCANO_CRATER_T + 0.6

	// Slide the cone toward the hearth until the crater and terraces are
	// clear of the locked mountain band, but never into the hearth pad.
	// Done after all rng draws so the rest of the layout is unchanged.
	{
		const coreR = craterR + eT1 + 0.5
		const blocked = (x: number, z: number): boolean => {
			const r = Math.ceil(coreR)
			for (let dz = -r; dz <= r; dz++) {
				for (let dx = -r; dx <= r; dx++) {
					if (dx * dx + dz * dz > coreR * coreR) continue
					const cx = Math.floor(x) + dx
					const cz = Math.floor(z) + dz
					if (cx < 0 || cz < 0 || cx >= W || cz >= H) return true
					if (work.locked[cz * W + cx]) return true
				}
			}
			return false
		}
		let dd = dist
		const minD = Math.max(Math.round(sc(12)), Math.ceil(craterR + eApron + HEARTH_FORCE_R))
		while (dd > minD && blocked(fx, fz)) {
			dd -= 1
			fx = HEARTH_FX + Math.cos(angle) * dd
			fz = HEARTH_FZ + Math.sin(angle) * dd
		}
	}
	const cosA = Math.cos(stretch)
	const sinA = Math.sin(stretch)
	const rMax = Math.ceil(majorR * 0.45 + eOuter + 3)

	const ellipseT = (cx: number, cz: number): number => {
		const ex = cx + 0.5 - fx
		const ez = cz + 0.5 - fz
		const n  = valueNoise2(cx / 2.4, cz / 2.4, work.seed + 71)
		const lx =  ex * cosA + ez * sinA
		const lz = -ex * sinA + ez * cosA
		const u  = lx / (majorR + (n - 0.5) * 1.8)
		const v  = lz / (minorR + (n - 0.5) * 1.2)
		return Math.sqrt(u * u + v * v)
	}
	/** Cells outward from the lava edge along this cell's bearing (< 0 = lava). */
	const edgeDist = (cx: number, cz: number): number => {
		const t = ellipseT(cx, cz)
		if (t < VOLCANO_CRATER_T) return -1
		const d = Math.hypot(cx + 0.5 - fx, cz + 0.5 - fz)
		return d * (1 - VOLCANO_CRATER_T / t)
	}
	/** 0..1 smooth noise of bearing (per-side ring jitter). */
	const sideJitter = (cx: number, cz: number, salt: number): number => {
		const a = Math.atan2(cz + 0.5 - fz, cx + 0.5 - fx)
		return valueNoise2(Math.cos(a) * 1.6 + 5, Math.sin(a) * 1.6 + 5, work.seed + salt)
	}
	/**
	 * Per-side ring width (cells) of one level on this bearing: 0 (the
	 * level is missing there, so the face drops a full 32 m cliff),
	 * normal, or a wide shoulder. Smooth noise of bearing per level, so
	 * each face of the cone gets its own mix of 16 m and 32 m steps.
	 * Two levels in a row are never both missing (48 m is not climbable).
	 */
	const ringW = (level: number, cx: number, cz: number): number => {
		const pick = (lv: number): number => {
			const n = sideJitter(cx, cz, 313 + lv * 97)
			return n < VOLCANO_RING_SKIP_BELOW ? 0 : n < VOLCANO_RING_WIDE_ABOVE ? tw : tw * VOLCANO_RING_W_WIDE
		}
		const w = pick(level)
		if (w > 0) return w
		// Missing: keep it if the level above (or the rim) is also missing.
		if (level + 1 < RIM && pick(level + 1) === 0) return tw
		return 0
	}
	const levelForEdge = (e: number, cx: number, cz: number): number => {
		let acc = wRim
		if (e < acc) return RIM
		for (let lv = RIM - 1; lv >= HIGH; lv--) {
			acc += ringW(lv, cx, cz)
			if (e < acc) return lv
		}
		return MID
	}

	const cone: number[] = []
	// Pass 1 - crater, rim, terraces, High, Mid apron.
	for (let dz = -rMax; dz <= rMax; dz++) {
		for (let dx = -rMax; dx <= rMax; dx++) {
			const cx = Math.floor(fx) + dx
			const cz = Math.floor(fz) + dz
			if (cx < 0 || cz < 0 || cx >= W || cz >= H) continue
			const i = cz * W + cx
			if (work.locked[i]) continue
			const e = edgeDist(cx, cz)
			if (e > eOuter) continue
			if (e < 0) {
				// Crater interior: rim-level lava lake, locked.
				work.levels[i]    = RIM
				work.landforms[i] = LANDFORM_LAVA
				work.locked[i]    = 1
				continue
			}
			if (e >= eApron && work.rng() >= 0.45) continue
			work.levels[i]    = levelForEdge(e, cx, cz)
			work.landforms[i] = LANDFORM_VOLCANO
			cone.push(i)
		}
	}

	// Spiral ladder pads. Rings are ~1 cell deep and curved, so straight
	// 3-wide runs are rare. Each step up gets a locked 3x2 pad (one low
	// row, one high row) on a cardinal face; findLadderSites drops the
	// 2-deep standing-room rule on volcano cells (a 16 m ledge is room
	// enough). the bottom pad faces the hearth, each
	// higher pad turns 90 deg the same way, so the climb winds around
	// the cone. The spanning tree may still use any natural site.
	{
		const vx = HEARTH_FX - fx
		const vz = HEARTH_FZ - fz
		let dOut = 0
		let bestDot = -Infinity
		for (let d = 0; d < 4; d++) {
			const dot = DIR_DX[d] * vx + DIR_DZ[d] * vz
			if (dot > bestDot) {
				bestDot = dot
				dOut    = d
			}
		}
		const c0x = Math.floor(fx)
		const c0z = Math.floor(fz)
		// Same-level 4-connected component of a cell, limited to the cone box.
		const sameComp = (a: number, b: number): boolean => {
			const lv = work.levels[a]
			if (work.levels[b] !== lv) return false
			const seen = new Set<number>([a])
			const stack = [a]
			while (stack.length > 0) {
				const i = stack.pop()!
				if (i === b) return true
				const cx = i % W
				const cz = (i - cx) / W
				if (Math.abs(cx - c0x) > rMax + 2 || Math.abs(cz - c0z) > rMax + 2) continue
				for (let d = 0; d < 4; d++) {
					const nx = cx + DIR_DX[d]
					const nz = cz + DIR_DZ[d]
					if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue
					const j = nz * W + nx
					if (seen.has(j) || work.levels[j] !== lv || work.landforms[j] === LANDFORM_LAVA) continue
					seen.add(j)
					stack.push(j)
				}
			}
			return false
		}
		/**
		 * Stamp the 3x2 pad for low -> low+1 on face d (lateral offset off).
		 * The centre column must already sit on ring low / ring low+1 so
		 * the pad joins both terraces, and the foot must share a terrace
		 * with the previous landing so the climb chains. Returns the
		 * landing cell, or -1.
		 */
		const tryPad = (low: number, d: number, off: number, prevLanding: number): { land: number; landLv: number } | null => {
			const pd = (d + 1) % 4
			const at = (k: number, p: number): number => {
				const cx = c0x + DIR_DX[d] * k + DIR_DX[pd] * (p + off)
				const cz = c0z + DIR_DZ[d] * k + DIR_DZ[pd] * (p + off)
				if (cx < 1 || cz < 1 || cx >= W - 1 || cz >= H - 1) return -1
				return cz * W + cx
			}
			let q = -1
			for (let k = 1; k <= rMax; k++) {
				const i = at(k, 0)
				if (i < 0) return null
				if (work.landforms[i] === LANDFORM_LAVA) continue
				if (work.levels[i] <= low) { q = k; break }
			}
			if (q < 2) return null
			const foot = at(q, 0)
			const land = at(q - 1, 0)
			if (foot < 0 || land < 0) return null
			if (work.levels[foot] !== low) return null
			// Land one or two levels up (16 m or 32 m face).
			const landLava = work.landforms[land] === LANDFORM_LAVA
			const landLv = landLava ? RIM : work.levels[land]
			if (landLv !== low + 1 && landLv !== low + 2) return null
			if (landLv > RIM || (landLava && low + 2 < RIM)) return null
			if (prevLanding >= 0 && !sameComp(prevLanding, foot)) return null
			const cells: Array<[number, number]> = []
			for (let k = q - 1; k <= q; k++) {
				const lv = k < q ? landLv : low
				for (let p = -1; p <= 1; p++) {
					const i = at(k, p)
					if (i < 0) return null
					const lf = work.landforms[i]
					if (lf === LANDFORM_LAVA && lv !== RIM) return null
					// Pads may share a cell with another pad at the same level
					// (stacked steps); never overwrite band / hearth locks.
					if (work.locked[i] && lf !== LANDFORM_LAVA && !(lf === LANDFORM_VOLCANO && work.levels[i] === lv)) return null
					cells.push([i, lv])
				}
			}
			for (const [i, lv] of cells) {
				work.levels[i]    = lv
				work.landforms[i] = LANDFORM_VOLCANO
				work.locked[i]    = 1
			}
			if (landLv === RIM) work.rimPadLow.add(foot)
			return { land, landLv }
		}
		let d = dOut
		let prevLanding = -1
		for (let low = MID; low < RIM;) {
			const order = [d, (d + spinSgn) % 4, (d + 4 - spinSgn) % 4, (d + 2) % 4]
			// Lateral offsets along each face give more slots than one
			// pad per cardinal (5 steps, 4 faces, thin rings).
			const offs = work.rng() < 0.5 ? [0, 2, -2, 3, -3, 1, -1] : [0, -2, 2, -3, 3, -1, 1]
			let used = -1
			let got: { land: number; landLv: number } | null = null
			for (const cand of order) {
				for (const off of offs) {
					got = tryPad(low, cand, off, prevLanding)
					if (got) { used = cand; break }
				}
				if (used >= 0) break
			}
			if (used < 0 || !got) {
				console.log(`terrainGen: stampVolcano: no pad for level ${low} -> ${low + 1}`)
				break
			}
			prevLanding = got.land
			low = got.landLv
			d = (used + spinSgn) % 4
		}
	}

	// Pass 2 - silhouette teeth glued to the existing mountain band,
	// apron only so the terraces stay continuous.
	for (const i of cone) {
		if (work.locked[i]) continue
		const cx = i % W
		const cz = (i - cx) / W
		const e = edgeDist(cx, cz)
		if (e < eHigh || e > eOuter) continue
		if (hearthDist(cx, cz) < HEARTH_BLEND_R) continue
		let touchesMountain = false
		for (let d = 0; d < 4; d++) {
			const nx = cx + DIR_DX[d]
			const nz = cz + DIR_DZ[d]
			if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue
			if (isMountainLevel(work.levels[nz * W + nx])) {
				touchesMountain = true
				break
			}
		}
		if (!touchesMountain) continue
		if (work.rng() > 0.42) continue
		work.levels[i] = MOUNTAIN
		work.locked[i] = 1
	}

	// Thin rings on a curve leave corner-only touches; fix them while the
	// ring cells can still move, then lock the cone so smoothing and
	// region merging keep the terraces.
	removeDiagonals(work)
	for (const i of cone) work.locked[i] = 1
}

// MARK: stampBasin
/** Low blob ringed by at least Middle ground, so it reads as a bowl. */
function stampBasin(
	work:  Work,
	angle: number,
): void {
	const dist   = randInt(work.rng, Math.round(sc(12)), Math.round(sc(18)))
	const radius = sc(3) + work.rng() * sc(2)
	const fx     = HEARTH_FX + Math.cos(angle) * dist
	const fz     = HEARTH_FZ + Math.sin(angle) * dist
	const ring   = Math.ceil(radius + 2)
	for (let dz = -ring; dz <= ring; dz++) {
		for (let dx = -ring; dx <= ring; dx++) {
			const cx = Math.floor(fx) + dx
			const cz = Math.floor(fz) + dz
			if (cx < 0 || cz < 0 || cx >= W || cz >= H) continue
			const d = Math.hypot(cx + 0.5 - fx, cz + 0.5 - fz)
			const i = cz * W + cx
			if (d > radius + 0.5 && d <= radius + 2 && work.levels[i] === LOW) stampCell(work, cx, cz, MID, LANDFORM_NONE)
		}
	}
	stampBlob(work, fx, fz, radius, LOW, LANDFORM_BASIN)
}


// MARK: stampBlob
/** Disc with a noisy rim so blobs do not read as circles. */
function stampBlob(
	work:     Work,
	fx:       number,
	fz:       number,
	radius:   number,
	level:    number,
	landform: number,
): void {
	const r = Math.ceil(radius + 2)
	for (let dz = -r; dz <= r; dz++) {
		for (let dx = -r; dx <= r; dx++) {
			const cx = Math.floor(fx) + dx
			const cz = Math.floor(fz) + dz
			const d  = Math.hypot(cx + 0.5 - fx, cz + 0.5 - fz)
			const rim = radius + (valueNoise2(cx / 2.5, cz / 2.5, work.seed + landform * 31) - 0.5) * 3
			if (d <= rim) stampCell(work, cx, cz, level, landform)
		}
	}
}


// MARK: smooth
/**
 * Majority filter: an untagged cell adopts a level held by 6+ of its 8
 * neighbours. Stamped landforms are left alone so thin ridges survive.
 */
function smooth(
	work:   Work,
	passes: number,
): void {
	const counts = new Int32Array(16)
	for (let p = 0; p < passes; p++) {
		const next = work.levels.slice()
		for (let cz = 1; cz < H - 1; cz++) {
			for (let cx = 1; cx < W - 1; cx++) {
				const i = cz * W + cx
				if (work.locked[i] || work.landforms[i] !== LANDFORM_NONE) continue
				counts.fill(0)
				for (let dz = -1; dz <= 1; dz++) {
					for (let dx = -1; dx <= 1; dx++) {
						if (dx === 0 && dz === 0) continue
						const lv = work.levels[(cz + dz) * W + cx + dx]
						if (!isMountainLevel(lv)) counts[lv]++
					}
				}
				for (let lv = LOW; lv <= HIGH; lv++) {
					if (counts[lv] >= 6 && lv !== work.levels[i]) next[i] = lv
				}
			}
		}
		work.levels = next
	}
}


// MARK: labelRegions
/** 4-connected same-level components. Mountain cells get -1. */
function labelRegions(levels: Uint8Array): {
	regions     : Int16Array
	regionLevel : number[]
	regionArea  : number[]
} {
	const regions     = new Int16Array(N).fill(-1)
	const regionLevel : number[] = []
	const regionArea  : number[] = []
	const stack       : number[] = []
	for (let start = 0; start < N; start++) {
		if (regions[start] !== -1 || isMountainLevel(levels[start])) continue
		const id = regionLevel.length
		const lv = levels[start]
		let area = 0
		regions[start] = id
		stack.push(start)
		while (stack.length > 0) {
			const i  = stack.pop()!
			const cx = i % W
			const cz = (i - cx) / W
			area++
			for (let d = 0; d < 4; d++) {
				const nx = cx + DIR_DX[d]
				const nz = cz + DIR_DZ[d]
				if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue
				const j = nz * W + nx
				if (regions[j] !== -1 || levels[j] !== lv) continue
				regions[j] = id
				stack.push(j)
			}
		}
		regionLevel.push(lv)
		regionArea.push(area)
	}
	return { regions, regionLevel, regionArea }
}


// MARK: mergeTinyRegions
/** Fold regions under MIN_REGION_CELLS into their most common neighbour level. */
function mergeTinyRegions(work: Work): void {
	const { regions, regionArea } = labelRegions(work.levels)
	const counts = new Int32Array(16)
	const members = new Map<number, number[]>()
	for (let i = 0; i < N; i++) {
		const r = regions[i]
		if (r < 0 || regionArea[r] >= MIN_REGION_CELLS) continue
		let list = members.get(r)
		if (!list) {
			list = []
			members.set(r, list)
		}
		list.push(i)
	}
	for (const cells of members.values()) {
		if (cells.some(i => work.locked[i])) continue
		const own = work.levels[cells[0]]
		counts.fill(0)
		for (const i of cells) {
			const cx = i % W
			const cz = (i - cx) / W
			for (let d = 0; d < 4; d++) {
				const nx = cx + DIR_DX[d]
				const nz = cz + DIR_DZ[d]
				if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue
				const lv = work.levels[nz * W + nx]
				if (lv !== own && !isMountainLevel(lv)) counts[lv]++
			}
		}
		let best = MID
		let bestCount = -1
		for (let lv = LOW; lv <= HIGH; lv++) {
			if (counts[lv] > bestCount) {
				best      = lv
				bestCount = counts[lv]
			}
		}
		for (const i of cells) work.levels[i] = best
	}
}


// MARK: removeDiagonals
/**
 * For every step threshold, remove 2×2 blocks where the two high cells
 * touch only at a corner. The cliff kit has no piece for that case.
 * Raises one of the low cells; if both are locked, lowers a high one.
 */
function removeDiagonals(work: Work): void {
	const lv = work.levels
	for (let iter = 0; iter < 8; iter++) {
		let changed = false
		for (let t = MID; t <= MOUNTAIN + TERRAIN_MOUNTAIN_PEAK_STEPS; t++) {
			for (let cz = 0; cz < H - 1; cz++) {
				for (let cx = 0; cx < W - 1; cx++) {
					const a = cz * W + cx
					const b = a + 1
					const c = a + W
					const d = c + 1
					const ha = lv[a] >= t
					const hb = lv[b] >= t
					const hc = lv[c] >= t
					const hd = lv[d] >= t
					let lowPair: number[] | null  = null
					let highPair: number[] | null = null
					if (ha && hd && !hb && !hc) {
						lowPair  = [b, c]
						highPair = [a, d]
					} else if (hb && hc && !ha && !hd) {
						lowPair  = [a, d]
						highPair = [b, c]
					}
					if (lowPair === null || highPair === null) continue
					const raise = lowPair.find(i => !work.locked[i])
					if (raise !== undefined) {
						lv[raise] = t
					} else {
						const lower = highPair.find(i => !work.locked[i])
						if (lower === undefined) continue
						lv[lower] = t - 1
					}
					changed = true
				}
			}
		}
		if (!changed) return
	}
}


// MARK: findLadderSites
/**
 * Every (low, high) cell pair one level apart where the cliff runs
 * straight for three cells and both sides have standing room.
 */
function findLadderSites(
	levels    : Uint8Array,
	landforms?: Uint8Array,
): LadderSite[] {
	const sites: LadderSite[] = []
	const at = (cx: number, cz: number): number =>
		cx < 0 || cz < 0 || cx >= W || cz >= H ? MOUNTAIN : levels[cz * W + cx]
	for (let cz = 0; cz < H; cz++) {
		for (let cx = 0; cx < W; cx++) {
			const lowLv = levels[cz * W + cx]
			if (isMountainLevel(lowLv)) continue
			for (let d = 0; d < 4; d++) {
				const hx = cx + DIR_DX[d]
				const hz = cz + DIR_DZ[d]
				const highLv = at(hx, hz)
				const volcPair = landforms !== undefined &&
					landforms[cz * W + cx] === LANDFORM_VOLCANO && landforms[hz * W + hx] === LANDFORM_VOLCANO
				// Volcano faces may be 32 m (two levels): a double ladder.
				if (isMountainLevel(highLv)) continue
				if (highLv !== lowLv + 1 && !(volcPair && highLv === lowLv + 2)) continue
				// No landings inside the lava lake.
				if (landforms && landforms[hz * W + hx] === LANDFORM_LAVA) continue
				// Volcano terraces are one 16 m cell deep: the ledge itself is
				// standing room, so skip the 2-deep check there.
				const volc = landforms !== undefined &&
					landforms[cz * W + cx] === LANDFORM_VOLCANO && landforms[hz * W + hx] === LANDFORM_VOLCANO
				if (!volc && at(cx - DIR_DX[d], cz - DIR_DZ[d]) !== lowLv) continue
				if (!volc && at(hx + DIR_DX[d], hz + DIR_DZ[d]) !== highLv) continue
				let straight = true
				for (const p of [(d + 1) % 4, (d + 3) % 4]) {
					if (at(cx + DIR_DX[p], cz + DIR_DZ[p]) !== lowLv)  straight = false
					if (at(hx + DIR_DX[p], hz + DIR_DZ[p]) !== highLv) straight = false
				}
				if (!straight) continue
				sites.push({ low: cz * W + cx, high: hz * W + hx, dir: d })
			}
		}
	}
	return sites
}


// MARK: placeLadders
/**
 * Spanning tree from the hearth region: each newly reached region gets
 * one ladder to the region that reached it. Long shared cliffs get a
 * second ladder far from the first. Returns regions no ladder reaches.
 */
function placeLadders(
	work:        Work,
	regions:     Int16Array,
	regionLevel: number[],
): { ladders: TerrainLadder[]; unreached: number[] } {
	const pairSites = new Map<string, LadderSite[]>()
	const adjacency = new Map<number, Set<number>>()
	for (const site of findLadderSites(work.levels, work.landforms)) {
		// One crater-wall gap: the only ladder onto the volcano rim is the
		// top spiral pad.
		if (work.levels[site.high] === RIM && work.landforms[site.high] === LANDFORM_VOLCANO &&
			!work.rimPadLow.has(site.low)) continue
		const ra  = regions[site.low]
		const rb  = regions[site.high]
		const key = ra < rb ? `${ra},${rb}` : `${rb},${ra}`
		let list = pairSites.get(key)
		if (!list) {
			list = []
			pairSites.set(key, list)
		}
		list.push(site)
		if (!adjacency.has(ra)) adjacency.set(ra, new Set())
		if (!adjacency.has(rb)) adjacency.set(rb, new Set())
		adjacency.get(ra)!.add(rb)
		adjacency.get(rb)!.add(ra)
	}

	const chosen  : LadderSite[] = []
	const visited = new Set<number>()
	const hearth  = regions[HEARTH_CZ * W + HEARTH_CX]
	const queue   = [hearth]
	visited.add(hearth)
	while (queue.length > 0) {
		const r = queue.shift()!
		const next = Array.from(adjacency.get(r) ?? []).sort((a, b) => a - b)
		for (const n of next) {
			if (visited.has(n)) continue
			visited.add(n)
			queue.push(n)
			const key   = r < n ? `${r},${n}` : `${n},${r}`
			const sites = pairSites.get(key)!
			chosen.push(sites[Math.floor(work.rng() * sites.length)])
		}
	}

	// Second ladder on long shared cliffs, tree edge or not.
	for (const sites of pairSites.values()) {
		if (sites.length < SECOND_LADDER_MIN_SITES) continue
		const existing = chosen.filter(c => sites.includes(c))
		if (existing.length >= 2) continue
		let best: LadderSite | null = null
		let bestSep = -1
		for (const s of sites) {
			let sep = Infinity
			for (const e of existing) sep = Math.min(sep, cellSep(s.low, e.low))
			if (existing.length === 0) sep = 0
			if (sep > bestSep) {
				best    = s
				bestSep = sep
			}
		}
		if (best === null) continue
		if (existing.length > 0 && bestSep < SECOND_LADDER_MIN_SEP) continue
		chosen.push(best)
	}

	const unreached: number[] = []
	for (let r = 0; r < regionLevel.length; r++) {
		if (!visited.has(r)) unreached.push(r)
	}
	return { ladders: chosen.map(s => toLadder(s, work.levels)), unreached }
}


// MARK: cellSep
/** Chebyshev distance in cells between two flat indices. */
function cellSep(
	a: number,
	b: number,
): number {
	return Math.max(Math.abs((a % W) - (b % W)), Math.abs(Math.floor(a / W) - Math.floor(b / W)))
}


// MARK: toLadder
function toLadder(
	site:   LadderSite,
	levels: Uint8Array,
): TerrainLadder {
	const lowCx  = site.low % W
	const lowCz  = (site.low - lowCx) / W
	const highCx = site.high % W
	const highCz = (site.high - highCx) / W
	const lowLv  = levels[site.low]
	const c      = cellCenterWorld(lowCx, lowCz)
	const dx     = DIR_DX[site.dir]
	const dz     = DIR_DZ[site.dir]
	const edgeX  = c.x + dx * TERRAIN_CELL_M / 2
	const edgeZ  = c.z + dz * TERRAIN_CELL_M / 2
	return {
		lowCx,
		lowCz,
		highCx,
		highCz,
		dir      : site.dir,
		lowLevel : lowLv,
		bottom   : { x: edgeX - dx * LADDER_FOOT_M, y: groundYForLevel(lowLv),     z: edgeZ - dz * LADDER_FOOT_M },
		top      : { x: edgeX + dx * LADDER_LAND_M, y: groundYForLevel(levels[site.high]), z: edgeZ + dz * LADDER_LAND_M },
	}
}


// MARK: flattenRegions
/** Fold unreachable regions into their most common neighbour level. */
function flattenRegions(
	work:      Work,
	regions:   Int16Array,
	unreached: number[],
): void {
	const set    = new Set(unreached)
	const counts = new Int32Array(16)
	const cellsOf = new Map<number, number[]>()
	for (let i = 0; i < N; i++) {
		const r = regions[i]
		if (!set.has(r)) continue
		let list = cellsOf.get(r)
		if (!list) {
			list = []
			cellsOf.set(r, list)
		}
		list.push(i)
	}
	for (const cells of cellsOf.values()) {
		const own = work.levels[cells[0]]
		counts.fill(0)
		for (const i of cells) {
			const cx = i % W
			const cz = (i - cx) / W
			for (let d = 0; d < 4; d++) {
				const nx = cx + DIR_DX[d]
				const nz = cz + DIR_DZ[d]
				if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue
				const lv = work.levels[nz * W + nx]
				if (lv !== own && !isMountainLevel(lv)) counts[lv]++
			}
		}
		// Prefer a level one step away so the merged region gets ladder sites.
		let best = MID
		let bestCount = -1
		for (let lv = LOW; lv <= HIGH; lv++) {
			const weight = counts[lv] * (Math.abs(lv - own) === 1 ? 2 : 1)
			if (weight > bestCount) {
				best      = lv
				bestCount = weight
			}
		}
		for (const i of cells) {
			if (!work.locked[i]) work.levels[i] = best
		}
	}
}


// MARK: sealUnreachable
/** Paint walkable cells the hearth cannot route to as mountain. */
function sealUnreachable(
	work:      Work,
	routeDist: Int32Array,
): number {
	let n = 0
	for (let i = 0; i < N; i++) {
		if (isMountainLevel(work.levels[i])) continue
		if (routeDist[i] >= 0) continue
		// A rim fragment the single rim ladder cannot reach becomes crown
		// rock (rim height), not a low mountain pit in the summit.
		if (work.levels[i] === RIM && work.landforms[i] === LANDFORM_VOLCANO) {
			work.levels[i] = crownLevelFor(i, work.seed)
			work.locked[i] = 1
			n++
			continue
		}
		work.levels[i]    = MOUNTAIN
		work.locked[i]    = 1
		work.landforms[i] = LANDFORM_NONE
		n++
	}
	return n
}


// MARK: computeRouteDist
/**
 * BFS steps from the hearth cell. Walk between same-level neighbours,
 * drop to any lower neighbour, and climb only at ladders.
 */
function computeRouteDist(
	levels:  Uint8Array,
	ladders: TerrainLadder[],
): Int32Array {
	const dist  = new Int32Array(N).fill(-1)
	const climb = new Map<number, number[]>()
	for (const l of ladders) {
		const lo = l.lowCz * W + l.lowCx
		const hi = l.highCz * W + l.highCx
		if (!climb.has(lo)) climb.set(lo, [])
		if (!climb.has(hi)) climb.set(hi, [])
		climb.get(lo)!.push(hi)
		climb.get(hi)!.push(lo)
	}
	const start = HEARTH_CZ * W + HEARTH_CX
	const queue = new Int32Array(N)
	let head = 0
	let tail = 0
	dist[start]   = 0
	queue[tail++] = start
	while (head < tail) {
		const i  = queue[head++]
		const cx = i % W
		const cz = (i - cx) / W
		const lv = levels[i]
		const visit = (j: number): void => {
			if (dist[j] !== -1) return
			dist[j]       = dist[i] + 1
			queue[tail++] = j
		}
		for (let d = 0; d < 4; d++) {
			const nx = cx + DIR_DX[d]
			const nz = cz + DIR_DZ[d]
			if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue
			const j  = nz * W + nx
			const nl = levels[j]
			if (isMountainLevel(nl) || nl > lv) continue
			visit(j)
		}
		for (const j of climb.get(i) ?? []) visit(j)
	}
	return dist
}


// MARK: pickDestinations
/**
 * Three major grove sockets: Low + Mid + High. Far + large regions win
 * within each level; sockets stay DEST_MIN_ANGLE_RAD apart from the
 * hearth view and skip the hearth region itself. The volcano landmark
 * is picked separately and may share the High shelf with the High grove
 * when cell separation allows.
 */
function pickDestinations(
	landforms:    Uint8Array,
	regions:      Int16Array,
	regionLevel:  number[],
	regionArea:   number[],
	routeDist:    Int32Array,
	hearthRegion: number,
): TerrainDestination[] {
	const sumX  = new Float64Array(regionLevel.length)
	const sumZ  = new Float64Array(regionLevel.length)
	const sumD  = new Float64Array(regionLevel.length)
	const volN  = new Float64Array(regionLevel.length)
	for (let i = 0; i < N; i++) {
		const r = regions[i]
		if (r < 0) continue
		sumX[r] += i % W
		sumZ[r] += Math.floor(i / W)
		sumD[r] += Math.max(0, routeDist[i])
		if (landforms[i] === LANDFORM_VOLCANO || landforms[i] === LANDFORM_LAVA) volN[r]++
	}

	const byLevel: TerrainDestination[][] = [[], [], []]
	for (let r = 0; r < regionLevel.length; r++) {
		const lv = regionLevel[r]
		if (lv !== LOW && lv !== MID && lv !== HIGH) continue
		if (r === hearthRegion) continue
		if (regionArea[r] < DEST_MIN_AREA) continue
		// Caldera Mid / cone High are the volcano landform — not groves.
		if (volN[r] / regionArea[r] >= 0.30) continue
		const meanRoute = sumD[r] / regionArea[r]
		if (meanRoute < DEST_MIN_ROUTE) continue
		const mx = sumX[r] / regionArea[r]
		const mz = sumZ[r] / regionArea[r]
		let best = -1
		let bestD = Infinity
		for (let i = 0; i < N; i++) {
			if (regions[i] !== r || routeDist[i] < 0) continue
			const cx = i % W
			const cz = (i - cx) / W
			let interior = true
			for (let d = 0; d < 4; d++) {
				const nx = cx + DIR_DX[d]
				const nz = cz + DIR_DZ[d]
				if (nx < 0 || nz < 0 || nx >= W || nz >= H || regions[nz * W + nx] !== r) interior = false
			}
			const dd = (cx - mx) * (cx - mx) + (cz - mz) * (cz - mz) + (interior ? 0 : 1000)
			if (dd < bestD) {
				best  = i
				bestD = dd
			}
		}
		if (best < 0) continue
		byLevel[lv].push({
			region : r,
			level  : lv,
			area   : regionArea[r],
			cx     : best % W,
			cz     : Math.floor(best / W),
			route  : Math.round(meanRoute),
		})
	}

	const score = (d: TerrainDestination): number => d.route * Math.sqrt(d.area)
	for (const list of byLevel) {
		list.sort((a, b) => score(b) - score(a) || a.region - b.region)
	}

	const clashes = (c: TerrainDestination, out: TerrainDestination[]): boolean => {
		const ang = Math.atan2(c.cz + 0.5 - HEARTH_FZ, c.cx + 0.5 - HEARTH_FX)
		return out.some(o => {
			const oa  = Math.atan2(o.cz + 0.5 - HEARTH_FZ, o.cx + 0.5 - HEARTH_FX)
			let diff  = Math.abs(ang - oa) % (Math.PI * 2)
			if (diff > Math.PI) diff = Math.PI * 2 - diff
			return diff < DEST_MIN_ANGLE_RAD
		})
	}

	// Pick Low / Mid / High in that order so each elevation gets a socket
	// when candidates exist; angle clashes skip to the next best on that level.
	const out: TerrainDestination[] = []
	for (const lv of [LOW, MID, HIGH]) {
		if (out.length >= DEST_MAX) break
		for (const c of byLevel[lv]) {
			if (clashes(c, out)) continue
			out.push(c)
			break
		}
	}
	return out
}


// MARK: pickVolcano
/**
 * Place the volcano on a far High (or volcano-stamped) region.
 * Prefers opposite half from the farther grove, keeps cell separation
 * from all grove sockets (including the High grove), and must be
 * route-reachable. May sit on the same High shelf as the High grove
 * when the region is large enough for VOLCANO_MIN_SEP_CELLS.
 */
function pickVolcano(
	work:         Work,
	regions:      Int16Array,
	regionLevel:  number[],
	regionArea:   number[],
	routeDist:    Int32Array,
	hearthRegion: number,
	groves:       TerrainDestination[],
): TerrainVolcano | null {
	const sumX = new Float64Array(regionLevel.length)
	const sumZ = new Float64Array(regionLevel.length)
	const sumD = new Float64Array(regionLevel.length)
	const volcanoCells = new Float64Array(regionLevel.length)
	const lavaCells    = new Float64Array(regionLevel.length)
	for (let i = 0; i < N; i++) {
		const r = regions[i]
		if (r < 0) continue
		sumX[r] += i % W
		sumZ[r] += Math.floor(i / W)
		sumD[r] += Math.max(0, routeDist[i])
		if (work.landforms[i] === LANDFORM_VOLCANO || work.landforms[i] === LANDFORM_LAVA) volcanoCells[r]++
		if (work.landforms[i] === LANDFORM_LAVA && routeDist[i] >= 0) lavaCells[r]++
	}

	// Farther grove anchors the "opposite half" preference.
	let farGrove: TerrainDestination | null = null
	for (const g of groves) {
		if (!farGrove || g.route > farGrove.route) farGrove = g
	}
	const farAng = farGrove
		? Math.atan2(farGrove.cz + 0.5 - HEARTH_FZ, farGrove.cx + 0.5 - HEARTH_FX)
		: 0

	type Cand = TerrainVolcano & { score: number }
	const cands: Cand[] = []
	for (let r = 0; r < regionLevel.length; r++) {
		const lv = regionLevel[r]
		// Summit crest (RIM) or High cone slopes both host the landmark.
		if (lv !== HIGH && lv !== RIM) continue
		if (r === hearthRegion) continue
		// The reachable lava crater IS the volcano: skip the size /
		// distance / grove-gap filters for it and boost its score below.
		const hasLava = lavaCells[r] > 0
		if (!hasLava && regionArea[r] < VOLCANO_MIN_AREA) continue
		const meanRoute = sumD[r] / regionArea[r]
		if (!hasLava && meanRoute < VOLCANO_MIN_ROUTE) continue
		const mx = sumX[r] / regionArea[r]
		const mz = sumZ[r] / regionArea[r]

		// Reject if too close to a grove socket.
		let tooClose = false
		for (const g of hasLava ? [] : groves) {
			if (Math.max(Math.abs(mx - g.cx), Math.abs(mz - g.cz)) < VOLCANO_MIN_SEP_CELLS) {
				tooClose = true
				break
			}
		}
		if (tooClose) continue

		// Prefer a volcano-tagged cell (caldera / rim) near the landform
		// centroid so the landmark sits on the cone, not a random High shelf.
		let volSumX = 0
		let volSumZ = 0
		let volCount = 0
		for (let i = 0; i < N; i++) {
			if (regions[i] !== r || routeDist[i] < 0) continue
			if (work.landforms[i] !== LANDFORM_VOLCANO && work.landforms[i] !== LANDFORM_LAVA) continue
			volSumX += i % W
			volSumZ += Math.floor(i / W)
			volCount++
		}
		const tx = volCount > 0 ? volSumX / volCount : mx
		const tz = volCount > 0 ? volSumZ / volCount : mz

		let best = -1
		let bestD = Infinity
		for (let i = 0; i < N; i++) {
			if (regions[i] !== r || routeDist[i] < 0) continue
			const cx = i % W
			const cz = (i - cx) / W
			const lf = work.landforms[i]
			const volcanoBias = lf === LANDFORM_VOLCANO || lf === LANDFORM_LAVA ? 0 : 80
			// Prefer the lava lake so the marker is the crater centre.
			const lavaBias = lf === LANDFORM_LAVA ? -50 : 0
			const dd = (cx - tx) * (cx - tx) + (cz - tz) * (cz - tz) + volcanoBias + lavaBias
			if (dd < bestD) {
				best = i
				bestD = dd
			}
		}
		if (best < 0) continue

		const cx = best % W
		const cz = Math.floor(best / W)
		const ang = Math.atan2(cz + 0.5 - HEARTH_FZ, cx + 0.5 - HEARTH_FX)
		let opp = 1
		if (farGrove) {
			let diff = Math.abs(ang - farAng) % (Math.PI * 2)
			if (diff > Math.PI) diff = Math.PI * 2 - diff
			opp = diff >= VOLCANO_OPPOSITE_RAD ? 1.55 : 0.65 + diff / Math.PI
		}
		const volcanoBias = 1 + Math.min(1.2, volcanoCells[r] / Math.max(1, regionArea[r]) * 2)
		const rimBias = lv === RIM ? 1.8 : 1
		const lavaBoost = hasLava ? 100 : 1
		const score = meanRoute * Math.sqrt(regionArea[r]) * opp * volcanoBias * rimBias * lavaBoost
		cands.push({
			region: r,
			level: lv,
			area: regionArea[r],
			cx,
			cz,
			route: Math.round(meanRoute),
			score,
		})
	}

	cands.sort((a, b) => b.score - a.score || a.region - b.region)
	if (cands.length === 0) return null
	const best = cands[0]
	return {
		region: best.region,
		level: best.level,
		area: best.area,
		cx: best.cx,
		cz: best.cz,
		route: best.route,
	}
}


// MARK: stationLosTarget
/** Fractional cell target the station beam aims at (lava centre, else marker). */
function stationLosTarget(
	landforms : Uint8Array,
	volcano   : TerrainVolcano,
): { fx: number; fz: number; endY: number } {
	let sx = 0
	let sz = 0
	let n  = 0
	for (let i = 0; i < N; i++) {
		if (landforms[i] !== LANDFORM_LAVA) continue
		sx += i % W
		sz += Math.floor(i / W)
		n++
	}
	if (n > 0) {
		return {
			fx: sx / n + 0.5,
			fz: sz / n + 0.5,
			endY: groundYForLevel(RIM) + VOLCANO_LAVA_TOP_ABOVE_RIM_M,
		}
	}
	return {
		fx: volcano.cx + 0.5,
		fz: volcano.cz + 0.5,
		endY: groundYForLevel(volcano.level),
	}
}


// MARK: hasStationLos
/**
 * Line of sight from a station cell to the volcano for a future beam.
 *
 * Samples cell centres along a DDA ray from the station to the lava
 * centroid (or volcano marker). Beam height lerps from
 * groundY(station) + STATION_BEAM_CLEAR_M to the target endY. An
 * intermediate cell blocks when its surface height exceeds the beam
 * height at that fraction by more than STATION_LOS_CLEAR_M. The last
 * STATION_LOS_NEAR_TARGET cells before the target are ignored so the
 * crater lip / crown does not kill every inbound ray. Mountain and
 * crown cells further out still block when they poke above the beam.
 */
function hasStationLos(
	levels    : Uint8Array,
	fromCx    : number,
	fromCz    : number,
	toFx      : number,
	toFz      : number,
	endY      : number,
	startClearM: number = STATION_BEAM_CLEAR_M,
): boolean {
	const x0 = fromCx + 0.5
	const z0 = fromCz + 0.5
	const dx = toFx - x0
	const dz = toFz - z0
	const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) * 2))
	const startY = groundYForLevel(levels[fromCz * W + fromCx]) + startClearM
	for (let s = 1; s < steps; s++) {
		const t  = s / steps
		const fx = x0 + dx * t
		const fz = z0 + dz * t
		const cx = Math.floor(fx)
		const cz = Math.floor(fz)
		if (cx < 0 || cz < 0 || cx >= W || cz >= H) return false
		if (cx === fromCx && cz === fromCz) continue
		// Near-target soft zone: lip / crown may sit above the beam.
		const remain = steps - s
		if (remain <= STATION_LOS_NEAR_TARGET) continue
		const lv = levels[cz * W + cx]
		const cellY = groundYForLevel(lv)
		const beamY = startY + (endY - startY) * t
		if (cellY > beamY + STATION_LOS_CLEAR_M) return false
		// Tall impassable columns always count once above the soft zone.
		if ((isMountainLevel(lv) || isCrownLevel(lv)) && cellY > beamY) return false
	}
	return true
}


// MARK: volcanoRimPoints
/**
 * Cone cells touching lava (the crater rim), sampled evenly by angle
 * around the lava centroid. Deterministic. Falls back to the centroid.
 */
function volcanoRimPoints(
	work   : Work,
	volcano: TerrainVolcano,
): Array<{ cx: number; cz: number; fx: number; fz: number; endY: number }> {
	const centre = stationLosTarget(work.landforms, volcano)
	const rim: Array<{ cx: number; cz: number; fx: number; fz: number; endY: number; ang: number }> = []
	for (let i = 0; i < N; i++) {
		if (work.landforms[i] !== LANDFORM_VOLCANO) continue
		const cx = i % W
		const cz = (i - cx) / W
		let touches = false
		for (let d = 0; d < 4; d++) {
			const nx = cx + DIR_DX[d]
			const nz = cz + DIR_DZ[d]
			if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue
			if (work.landforms[nz * W + nx] === LANDFORM_LAVA) { touches = true; break }
		}
		if (!touches) continue
		rim.push({
			cx, cz, fx: cx + 0.5, fz: cz + 0.5,
			endY: groundYForLevel(work.levels[i]) + NEAR_RIM_AIM_ABOVE_M,
			ang : Math.atan2(cz + 0.5 - centre.fz, cx + 0.5 - centre.fx),
		})
	}
	if (rim.length === 0) {
		return [{ cx: Math.floor(centre.fx), cz: Math.floor(centre.fz), fx: centre.fx, fz: centre.fz, endY: centre.endY }]
	}
	rim.sort((a, b) => a.ang - b.ang || a.cx - b.cx || a.cz - b.cz)
	if (rim.length <= NEAR_RIM_SAMPLES) return rim
	const out: typeof rim = []
	for (let k = 0; k < NEAR_RIM_SAMPLES; k++) out.push(rim[Math.floor(k * rim.length / NEAR_RIM_SAMPLES)])
	return out
}


// MARK: stationEnclosure
/**
 * Canyon / hollow score: how many cells within STATION_ENCLOSE_R
 * (Chebyshev) stand higher than `lv`. Off-grid counts as higher. 0..24.
 */
function stationEnclosure(levels: Uint8Array, cx: number, cz: number, lv: number): number {
	let n = 0
	for (let dz = -STATION_ENCLOSE_R; dz <= STATION_ENCLOSE_R; dz++) {
		for (let dx = -STATION_ENCLOSE_R; dx <= STATION_ENCLOSE_R; dx++) {
			if (dx === 0 && dz === 0) continue
			const x = cx + dx
			const z = cz + dz
			if (x < 0 || z < 0 || x >= W || z >= H || levels[z * W + x] > lv) n++
		}
	}
	return n
}

type RimPoint = { cx: number; cz: number; fx: number; fz: number; endY: number }

// MARK: stationBeam
/**
 * Hover beam for a socket: from the hovering bottom tip
 * (monumentHoverBottomY: rim aim + MONUMENT_HOVER_ABOVE_TARGET_M + lift) to the closest crater
 * rim point the line clears, smallest lift first. `clear` false means no
 * lift cleared; the highest lift + nearest rim is returned anyway.
 */
function stationBeam(
	levels: Uint8Array,
	cx    : number,
	cz    : number,
	rimPts: RimPoint[],
): { lift: number; rim: RimPoint; clear: boolean } {
	const byDist = rimPts.slice().sort((a, b) =>
		Math.hypot(a.fx - cx - 0.5, a.fz - cz - 0.5) - Math.hypot(b.fx - cx - 0.5, b.fz - cz - 0.5)
		|| a.cx - b.cx || a.cz - b.cz)
	for (const lift of MONUMENT_LIFT_STEPS_M) {
		for (const p of byDist) {
			const groundY = groundYForLevel(levels[cz * W + cx])
			const startClear = monumentHoverBottomY(groundY, p.endY, lift) - groundY
			if (hasStationLos(levels, cx, cz, p.fx, p.fz, p.endY, startClear)) {
				return { lift, rim: p, clear: true }
			}
		}
	}
	return { lift: MONUMENT_LIFT_STEPS_M[MONUMENT_LIFT_STEPS_M.length - 1], rim: byDist[0], clear: false }
}


// MARK: nearStationHasHearthLos
/**
 * True when a player standing at the spawn campfire (eye NEAR_LOS_EYE_M
 * above the hearth ground) can see the frozen monument tip
 * (NEAR_LOS_TIP_M above the socket cell's ground). Terrain only: the ray
 * is sampled NEAR_LOS_SAMPLES_PER_CELL times per cell and blocked where a
 * cell's surface (groundYForLevel: terraces, cliffs, mountains, volcano
 * crown are all flat-topped columns, so a step is caught at the first
 * sample past it) rises above the ray. Trees / snow are not counted.
 */
export function nearStationHasHearthLos(levels: Uint8Array, cx: number, cz: number): boolean {
	const x0 = HEARTH_FX
	const z0 = HEARTH_FZ
	const x1 = cx + 0.5
	const z1 = cz + 0.5
	const y0 = groundYForLevel(levels[HEARTH_CZ * W + HEARTH_CX]) + NEAR_LOS_EYE_M
	const y1 = groundYForLevel(levels[cz * W + cx]) + NEAR_LOS_TIP_M
	const len = Math.hypot(x1 - x0, z1 - z0)
	const steps = Math.max(2, Math.ceil(len * NEAR_LOS_SAMPLES_PER_CELL))
	for (let k = 1; k < steps; k++) {
		const t  = k / steps
		const sx = Math.floor(x0 + (x1 - x0) * t)
		const sz = Math.floor(z0 + (z1 - z0) * t)
		if (sx < 0 || sz < 0 || sx >= W || sz >= H) return false
		if (sx === cx && sz === cz) continue
		if (groundYForLevel(levels[sz * W + sx]) > y0 + (y1 - y0) * t) return false
	}
	return true
}


// MARK: pickNearStation
/**
 * Ranked sockets for the one monument near spawn (best first, up to
 * NEAR_STATION_TRIES). It belongs on the outer side of the starting
 * grove: the hearth->socket bearing within NEAR_STATION_AWAY_MAX_DEG of
 * directly away from the volcano, at about NEAR_STATION_TARGET_M.
 * Candidates are walkable Low/Mid/High cells, off ladder ends, the map
 * border and the volcano / lava. Score = facing away (cos of the angle
 * off "away") * NEAR_W_AWAY - distance error * NEAR_W_DIST, plus small
 * hearth-terrace / hollow / low-ground bonuses. Every pass but the last
 * two requires terrain line of sight from the campfire to the frozen tip
 * (nearStationHasHearthLos). No pass needs a clear volcano beam. Passes,
 * in order: band+cone+LOS, relaxed band+cone+LOS, relaxed band+relaxed
 * cone+LOS, relaxed any side+LOS, then (last resort, logged) relaxed cone
 * without LOS, relaxed any side without LOS. The
 * station spacing / angle fan-out is enforced by pickStations with this
 * pick as the preset; buildOnce tries the next pick if one blocks it.
 * Empty only when no walkable cell lies in the relaxed band.
 */
function pickNearStation(
	work        : Work,
	regions     : Int16Array,
	routeDist   : Int32Array,
	volcano     : TerrainVolcano | null,
	ladders     : TerrainLadder[],
	hearthRegion: number,
	distScale   : number = 1,
): Array<{ station: TerrainStation; log: string }> {
	if (!volcano) return []
	const targetM = NEAR_STATION_TARGET_M * distScale
	const rimPts  = volcanoRimPoints(work, volcano)
	const centre  = stationLosTarget(work.landforms, volcano)
	const volcAng = Math.atan2(centre.fz - HEARTH_FZ, centre.fx - HEARTH_FX)
	const awayAng = volcAng + Math.PI
	const ladderCells = new Set<number>()
	for (const l of ladders) {
		ladderCells.add(l.lowCz * W + l.lowCx)
		ladderCells.add(l.highCz * W + l.highCx)
	}
	const hearthLv = work.levels[HEARTH_CZ * W + HEARTH_CX]

	type NearCand = { cx: number; cz: number; i: number; distM: number; offDeg: number; sameTerrace: boolean; score: number; los?: boolean }
	const cands: NearCand[] = []
	const maxCells = Math.ceil(NEAR_STATION_RELAX_MAX_M / TERRAIN_CELL_M) + 1
	for (let cz = HEARTH_CZ - maxCells; cz <= HEARTH_CZ + maxCells; cz++) {
		for (let cx = HEARTH_CX - maxCells; cx <= HEARTH_CX + maxCells; cx++) {
			if (cx < 2 || cz < 2 || cx >= W - 2 || cz >= H - 2) continue
			const i = cz * W + cx
			const distM = Math.hypot(cx + 0.5 - HEARTH_FX, cz + 0.5 - HEARTH_FZ) * TERRAIN_CELL_M
			if (distM < NEAR_STATION_RELAX_MIN_M || distM > NEAR_STATION_RELAX_MAX_M) continue
			if (routeDist[i] < 0) continue
			const lv = work.levels[i]
			if (lv !== LOW && lv !== MID && lv !== HIGH) continue
			const lf = work.landforms[i]
			if (lf === LANDFORM_VOLCANO || lf === LANDFORM_LAVA) continue // hearth disc IS the spawn terrace; the min distance keeps it off the fire
			if (ladderCells.has(i)) continue
			const ang = Math.atan2(cz + 0.5 - HEARTH_FZ, cx + 0.5 - HEARTH_FX)
			let off = Math.abs(ang - awayAng) % (Math.PI * 2)
			if (off > Math.PI) off = Math.PI * 2 - off
			const away = Math.cos(off)
			const sameTerrace = regions[i] === hearthRegion
			const enclose = stationEnclosure(work.levels, cx, cz, lv) / 24
			const lower = lv < hearthLv ? 1 : 0
			const score = away * NEAR_W_AWAY
				- Math.abs(distM - targetM) / targetM * NEAR_W_DIST
				+ (sameTerrace ? 0.2 : 0) + enclose * 0.3 + lower * 0.15
			cands.push({ cx, cz, i, distM, offDeg: off * 180 / Math.PI, sameTerrace, score })
		}
	}
	cands.sort((a, b) => b.score - a.score || a.cx - b.cx || a.cz - b.cz)

	const beams = new Map<number, ReturnType<typeof stationBeam>>()
	const beamOf = (c: NearCand): ReturnType<typeof stationBeam> => {
		let b = beams.get(c.i)
		if (!b) { b = stationBeam(work.levels, c.cx, c.cz, rimPts); beams.set(c.i, b) }
		return b
	}

	const losOf = (c: NearCand): boolean => {
		if (c.los === undefined) c.los = nearStationHasHearthLos(work.levels, c.cx, c.cz)
		return c.los
	}

	type Pass = { name: string; minM: number; maxM: number; maxOffDeg: number; clear: boolean; los: boolean }
	// No volcano line of sight needed any more (the obelisk hovers above
	// the rim), so no pass requires a clear beam; the beam lift is still
	// computed for the hover height.
	const passes: Pass[] = [
		{ name: 'band+away+los',        minM: Math.max(NEAR_STATION_RELAX_MIN_M, NEAR_STATION_MIN_M * distScale), maxM: NEAR_STATION_MAX_M * distScale,       maxOffDeg: NEAR_STATION_AWAY_MAX_DEG,   clear: false, los: true  },
		{ name: 'relaxed+away+los',     minM: NEAR_STATION_RELAX_MIN_M, maxM: NEAR_STATION_RELAX_MAX_M, maxOffDeg: NEAR_STATION_AWAY_MAX_DEG,   clear: false, los: true  },
		{ name: 'relaxed+wideAway+los', minM: NEAR_STATION_RELAX_MIN_M, maxM: NEAR_STATION_RELAX_MAX_M, maxOffDeg: NEAR_STATION_AWAY_RELAX_DEG, clear: false, los: true  },
		{ name: 'relaxed+anySide+los',  minM: NEAR_STATION_RELAX_MIN_M, maxM: NEAR_STATION_RELAX_MAX_M, maxOffDeg: 180,                          clear: false, los: true  },
		// Last resort: no campfire line of sight (logged when picked).
		{ name: 'relaxed+wideAway+NOLOS', minM: NEAR_STATION_RELAX_MIN_M, maxM: NEAR_STATION_RELAX_MAX_M, maxOffDeg: NEAR_STATION_AWAY_RELAX_DEG, clear: false, los: false },
		{ name: 'relaxed+anySide+NOLOS',  minM: NEAR_STATION_RELAX_MIN_M, maxM: NEAR_STATION_RELAX_MAX_M, maxOffDeg: 180,                          clear: false, los: false },
	]
	const out: Array<{ station: TerrainStation; log: string }> = []
	const used = new Set<number>()
	for (const p of passes) {
		for (const c of cands) {
			if (out.length >= NEAR_STATION_TRIES) break
			if (used.has(c.i)) continue
			if (c.distM < p.minM || c.distM > p.maxM || c.offDeg > p.maxOffDeg) continue
			if (p.los && !losOf(c)) continue
			const beam = beamOf(c)
			if (p.clear && !beam.clear) continue
			used.add(c.i)
			out.push({
				station: {
					cx: c.cx, cz: c.cz, level: work.levels[c.i], region: regions[c.i], route: routeDist[c.i],
					near: true, beamLiftM: beam.lift,
					aimX: TERRAIN_ORIGIN_M + beam.rim.fx * TERRAIN_CELL_M,
					aimY: beam.rim.endY,
					aimZ: TERRAIN_ORIGIN_M + beam.rim.fz * TERRAIN_CELL_M,
				},
				log: 'near monument pass=' + p.name + ' cell=(' + c.cx + ',' + c.cz + ') dist=' +
					c.distM.toFixed(0) + 'm offAway=' + c.offDeg.toFixed(0) + 'deg lift=' + beam.lift +
					'm beamClear=' + beam.clear + ' sameTerrace=' + c.sameTerrace +
					(p.los ? ' hearthLos=true' : ' hearthLos=false (LAST RESORT: no campfire line of sight)'),
			})
		}
	}
	if (out.length === 0) {
		console.log('terrainGen: near monument: no cell within ' + NEAR_STATION_RELAX_MAX_M + 'm - far-only stations')
	}
	return out
}


// MARK: pullNearStation
/**
 * Move ONLY the near monument closer to spawn (NEAR_STATION_PULL). The
 * far stations are kept exactly; a candidate must be strictly closer
 * than today's and keep STATION_MIN_SEP_CELLS / STATION_MIN_ANGLE_RAD to
 * them (same rules pickStations applied with the near pick as preset).
 * Same near-pick rules otherwise (hearth LOS passes first, walkable,
 * reachable, off ladders / volcano). No valid closer one: unchanged.
 */
function pullNearStation(
	work        : Work,
	regions     : Int16Array,
	routeDist   : Int32Array,
	volcano     : TerrainVolcano | null,
	ladders     : TerrainLadder[],
	hearthRegion: number,
	stations    : TerrainStation[],
): TerrainStation[] {
	const cur  = stations[0]
	const far  = stations.slice(1)
	const dOf  = (st: TerrainStation) => Math.hypot(st.cx + 0.5 - HEARTH_FX, st.cz + 0.5 - HEARTH_FZ)
	const aOf  = (st: TerrainStation) => Math.atan2(st.cz + 0.5 - HEARTH_FZ, st.cx + 0.5 - HEARTH_FX)
	const curD = dOf(cur)
	const picks = pickNearStation(work, regions, routeDist, volcano, ladders, hearthRegion, nearPull())
	for (const p of picks) {
		const c = p.station
		if (dOf(c) >= curD) continue
		let ok = true
		for (const o of far) {
			if (Math.max(Math.abs(c.cx - o.cx), Math.abs(c.cz - o.cz)) < STATION_MIN_SEP_CELLS) { ok = false; break }
			let diff = Math.abs(aOf(c) - aOf(o)) % (Math.PI * 2)
			if (diff > Math.PI) diff = Math.PI * 2 - diff
			if (diff < STATION_MIN_ANGLE_RAD) { ok = false; break }
		}
		if (!ok) continue
		console.log('terrainGen: near monument pulled x' + nearPull().toFixed(2) + ': ' + (curD * TERRAIN_CELL_M).toFixed(0) + 'm -> ' + p.log)
		return [c, ...far]
	}
	console.log('terrainGen: near monument pull: no valid closer socket, kept at ' + (curD * TERRAIN_CELL_M).toFixed(0) + 'm')
	return stations
}


// MARK: pickStations
/**
 * Place STATION_COUNT ignition sockets on walkable Low/Mid/High cells
 * with reachability and separation from each other / hearth / volcano /
 * grove cores / ladder ends. No line of sight needed: the obelisk
 * hovers above the rim (monumentHoverBottomY) and the hover height is raised
 * (beamLiftM) until the beam clears; sockets whose beam never clears
 * are only used as a last resort. Prefers low ground, hollows and
 * canyons, one socket per elevation, fanned out around the hearth.
 */
function pickStations(
	work        : Work,
	regions     : Int16Array,
	routeDist   : Int32Array,
	groves      : TerrainDestination[],
	volcano     : TerrainVolcano | null,
	ladders     : TerrainLadder[],
	preset      : TerrainStation[] = [],
): TerrainStation[] {
	if (!volcano) return []
	const rimPts = volcanoRimPoints(work, volcano)
	const ladderCells = new Set<number>()
	for (const l of ladders) {
		ladderCells.add(l.lowCz * W + l.lowCx)
		ladderCells.add(l.highCz * W + l.highCx)
	}

	type Cand = TerrainStation & { ang: number; score: number; i: number }
	const cands: Cand[] = []
	for (let i = 0; i < N; i++) {
		const route = routeDist[i]
		if (route < STATION_MIN_ROUTE) continue
		const lv = work.levels[i]
		if (lv !== LOW && lv !== MID && lv !== HIGH) continue
		const lf = work.landforms[i]
		if (lf === LANDFORM_VOLCANO || lf === LANDFORM_LAVA || lf === LANDFORM_HEARTH) continue
		if (ladderCells.has(i)) continue
		const cx = i % W
		const cz = (i - cx) / W
		if (cx < 1 || cz < 1 || cx >= W - 1 || cz >= H - 1) continue
		if (Math.max(Math.abs(cx - HEARTH_CX), Math.abs(cz - HEARTH_CZ)) < STATION_MIN_HEARTH_CELLS) continue
		if (Math.max(Math.abs(cx - volcano.cx), Math.abs(cz - volcano.cz)) < STATION_MIN_VOLCANO_CELLS) continue
		let nearGrove = false
		for (const g of groves) {
			if (Math.max(Math.abs(cx - g.cx), Math.abs(cz - g.cz)) < STATION_MIN_GROVE_CELLS) {
				nearGrove = true
				break
			}
		}
		if (nearGrove) continue

		const ang = Math.atan2(cz + 0.5 - HEARTH_FZ, cx + 0.5 - HEARTH_FX)
		// Farther route, then hollows / canyons (higher cells around) and
		// lower ground: the obelisk rising out of a pit in a gorge is the
		// money shot now that it no longer has to see the volcano.
		const enclose = stationEnclosure(work.levels, cx, cz, lv) / 24
		const levelBias = lv === LOW ? 1.3 : lv === MID ? 1.15 : 1
		const score = route * (1 + enclose * 0.8) * levelBias
		cands.push({ cx, cz, i, level: lv, region: regions[i], route, ang, score })
	}
	cands.sort((a, b) => b.score - a.score || a.cx - b.cx || a.cz - b.cz)

	// Beam check is lazy (only for sockets that pass spacing) and cached.
	const beams = new Map<number, ReturnType<typeof stationBeam>>()
	const beamOf = (c: Cand): ReturnType<typeof stationBeam> => {
		let b = beams.get(c.i)
		if (!b) { b = stationBeam(work.levels, c.cx, c.cz, rimPts); beams.set(c.i, b) }
		return b
	}

	const out: TerrainStation[] = preset.slice()
	const oAng = (st: TerrainStation): number =>
		Math.atan2(st.cz + 0.5 - HEARTH_FZ, st.cx + 0.5 - HEARTH_FX)
	const minAngle = isFloatingCrystals() ? (MONUMENT_MIN_ANGLE_DEG * Math.PI) / 180 : STATION_MIN_ANGLE_RAD
	const angOk = (ang: number): boolean => {
		for (const o of out) {
			let diff = Math.abs(ang - oAng(o)) % (Math.PI * 2)
			if (diff > Math.PI) diff = Math.PI * 2 - diff
			if (diff < minAngle) return false
		}
		return true
	}
	const sepOkAt = (c: Cand, sep: number): boolean => {
		for (const o of out) {
			if (Math.max(Math.abs(c.cx - o.cx), Math.abs(c.cz - o.cz)) < sep) return false
		}
		return true
	}
	const sepOk = (c: Cand): boolean => sepOkAt(c, STATION_MIN_SEP_CELLS)
	const taken = (c: Cand): boolean => out.some(o => o.cx === c.cx && o.cz === c.cz)
	const take = (c: Cand): void => {
		const b = beamOf(c)
		out.push({
			cx: c.cx, cz: c.cz, level: c.level, region: c.region, route: c.route,
			beamLiftM: b.lift,
			aimX: TERRAIN_ORIGIN_M + b.rim.fx * TERRAIN_CELL_M,
			aimY: b.rim.endY,
			aimZ: TERRAIN_ORIGIN_M + b.rim.fz * TERRAIN_CELL_M,
		})
	}

	// Floating crystals: the hover beam is unused (crystals float at a
	// fixed height), and monuments fan out over distance bands from the
	// hearth so some are near, some far (fractions of the farthest route).
	const crystals = isFloatingCrystals()
	const beamOk = (c: Cand): boolean => crystals || beamOf(c).clear
	if (crystals) {
		let maxRoute = 1
		for (const c of cands) maxRoute = Math.max(maxRoute, c.route)
		for (const [lo, hi] of MONUMENT_DISTANCE_BANDS) {
			if (out.length >= STATION_COUNT) break
			// Best-scoring candidate whose route falls in the band.
			for (const c of cands) {
				const f = c.route / maxRoute
				if (f < lo || f > hi) continue
				if (taken(c) || !sepOk(c) || !angOk(c.ang)) continue
				take(c)
				break
			}
		}
	}
	// Pass 1: one socket per elevation (low ground first) with a clear
	// hover beam, so stations fan across Low / Mid / High.
	for (const want of [LOW, MID, HIGH]) {
		if (out.length >= STATION_COUNT) break
		for (const c of cands) {
			if (c.level !== want) continue
			if (taken(c) || !sepOk(c) || !angOk(c.ang)) continue
			if (!beamOk(c)) continue
			take(c)
			break
		}
	}
	// Pass 2: fill remaining with angle + separation + clear beam.
	for (const c of cands) {
		if (out.length >= STATION_COUNT) break
		if (taken(c) || !sepOk(c) || !angOk(c.ang)) continue
		if (!beamOk(c)) continue
		take(c)
	}
	// Pass 3: relax angle and the beam check (keep separation).
	for (const c of cands) {
		if (out.length >= STATION_COUNT) break
		if (taken(c) || !sepOk(c)) continue
		take(c)
	}
	// Pass 4 (crystals): relax separation for a crowded small map.
	if (crystals) {
		const sep = Math.max(2, Math.round(STATION_MIN_SEP_CELLS * MONUMENT_RELAX_SEP_FRAC))
		for (const c of cands) {
			if (out.length >= STATION_COUNT) break
			if (taken(c) || !sepOkAt(c, sep)) continue
			take(c)
		}
	}
	return out
}


// MARK: validate
/** Empty string when the map is playable, else the first failure. */
function validate(map: TerrainMap): string {
	if (map.hearthRegion < 0) return 'hearth on mountain'
	if (map.regionArea[map.hearthRegion] < MIN_HEARTH_REGION_CELLS) return `hearth region ${map.regionArea[map.hearthRegion]} cells`
	if (map.ladders.length < MIN_LADDERS) return `${map.ladders.length} ladders`
	let hasLow  = false
	let hasHigh = false
	for (let r = 0; r < map.regionLevel.length; r++) {
		if (map.regionLevel[r] === LOW)  hasLow  = true
		if (map.regionLevel[r] === HIGH) hasHigh = true
	}
	if (!hasLow)  return 'no low region'
	if (!hasHigh) return 'no high region'
	for (let i = 0; i < N; i++) {
		if (map.regions[i] >= 0 && map.routeDist[i] < 0) return `unreachable cell ${i % W},${Math.floor(i / W)} lv ${map.levels[i]} lf ${map.landforms[i]}`
	}
	if (map.destinations.length < DEST_MAX) {
		return `destinations ${map.destinations.length}/${DEST_MAX}`
	}
	const seen = new Set<number>()
	for (const d of map.destinations) {
		if (d.level !== LOW && d.level !== MID && d.level !== HIGH) {
			return `bad dest level ${d.level}`
		}
		if (seen.has(d.level)) return `duplicate dest level ${d.level}`
		seen.add(d.level)
	}
	if (seen.size < DEST_MAX) return 'missing dest elevation'
	if (map.volcano === null) return 'no volcano'
	const vi = map.volcano.cz * W + map.volcano.cx
	if (vi < 0 || vi >= N || map.routeDist[vi] < 0) return 'volcano unreachable'
	{
		// The crater lip must be climbable: some rim cell beside the lava
		// is on the route graph (ladders up the terraces).
		let summit = false
		for (let i = 0; i < N && !summit; i++) {
			if (map.levels[i] !== RIM || map.landforms[i] === LANDFORM_LAVA || map.routeDist[i] < 0) continue
			const cx = i % W
			const cz = (i - cx) / W
			for (let d = 0; d < 4; d++) {
				const nx = cx + DIR_DX[d]
				const nz = cz + DIR_DZ[d]
				if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue
				if (map.landforms[nz * W + nx] === LANDFORM_LAVA) { summit = true; break }
			}
		}
		if (!summit) return 'summit unreachable'
	}
	if (map.volcano.level !== HIGH && map.volcano.level !== RIM) {
		return `volcano level ${map.volcano.level}`
	}
	if (map.stations.length < STATION_MIN_VALID) {
		return `stations ${map.stations.length}/${STATION_COUNT}`
	}
	{
		// No line-of-sight rule: monuments hover above the rim and beam from
		// there (terrain gen raises beamLiftM until it clears).
		const seen = new Set<string>()
		for (const s of map.stations) {
			const key = `${s.cx},${s.cz}`
			if (seen.has(key)) return 'duplicate station'
			seen.add(key)
			const i = s.cz * W + s.cx
			if (i < 0 || i >= N || map.routeDist[i] < 0) return 'station unreachable'
			if (s.level !== LOW && s.level !== MID && s.level !== HIGH) {
				return `bad station level ${s.level}`
			}
		}
		for (let a = 0; a < map.stations.length; a++) {
			for (let b = a + 1; b < map.stations.length; b++) {
				const A = map.stations[a]
				const B = map.stations[b]
				const minSep = isFloatingCrystals() ? Math.max(2, Math.round(STATION_MIN_SEP_CELLS * MONUMENT_RELAX_SEP_FRAC)) : STATION_MIN_SEP_CELLS
				if (Math.max(Math.abs(A.cx - B.cx), Math.abs(A.cz - B.cz)) < minSep) {
					return 'stations too close'
				}
			}
		}
	}
	return ''
}


// MARK: LevelRect

/** A run of same-level cells merged into one box. */
export interface LevelRect {
	cx    : number
	cz    : number
	w     : number
	h     : number
	level : number
}


// MARK: mergeLevelRects
/**
 * Greedy rectangle decomposition of the level grid: scan in row order,
 * grow each unclaimed cell as wide as the same level allows, then as
 * deep as full matching rows allow. Turns ~3800 cells into a few
 * hundred boxes for the greybox renderer.
 */
export function mergeLevelRects(map: TerrainMap): LevelRect[] {
	const used = new Uint8Array(map.w * map.h)
	const out: LevelRect[] = []
	for (let cz = 0; cz < map.h; cz++) {
		for (let cx = 0; cx < map.w; cx++) {
			const i = cz * map.w + cx
			if (used[i]) continue
			const level = map.levels[i]

			let w = 1
			while (cx + w < map.w) {
				const j = cz * map.w + cx + w
				if (used[j] || map.levels[j] !== level) break
				w++
			}

			let h = 1
			while (cz + h < map.h) {
				let rowMatches = true
				for (let k = 0; k < w; k++) {
					const j = (cz + h) * map.w + cx + k
					if (used[j] || map.levels[j] !== level) {
						rowMatches = false
						break
					}
				}
				if (!rowMatches) break
				h++
			}

			for (let dz = 0; dz < h; dz++) {
				for (let dx = 0; dx < w; dx++) used[(cz + dz) * map.w + cx + dx] = 1
			}
			out.push({ cx, cz, w, h, level })
		}
	}
	return out
}


// MARK: Cliff piece classification

/**
 * Dual-grid piece at one grid corner for one step threshold. 'diag' is
 * two high cells touching only at the corner; the generator removes
 * these, so seeing one means a cleanup bug.
 */
export type CornerPiece = 'none' | 'outer' | 'edge' | 'inner' | 'top' | 'diag'


// MARK: classifyCorner
/**
 * Piece for the grid corner at (vx, vz) and threshold `t`: looks at the
 * four cells touching that corner and counts those at or above `t`.
 * Off-grid cells count as mountain. Also returns the rotation in
 * quarter turns so the renderer and the stats agree.
 */
export function classifyCorner(
	levels: Uint8Array,
	vx:     number,
	vz:     number,
	t:      number,
): { piece: CornerPiece; rot: number } {
	const at = (cx: number, cz: number): boolean =>
		cx < 0 || cz < 0 || cx >= W || cz >= H ? MOUNTAIN >= t : levels[cz * W + cx] >= t
	// Bits: SW, SE, NE, NW (counter-clockwise from SW).
	const sw = at(vx - 1, vz - 1)
	const se = at(vx,     vz - 1)
	const ne = at(vx,     vz)
	const nw = at(vx - 1, vz)
	const bits  = [sw, se, ne, nw]
	const count = bits.filter(b => b).length
	if (count === 0) return { piece: 'none', rot: 0 }
	if (count === 4) return { piece: 'top',  rot: 0 }
	if (count === 1) return { piece: 'outer', rot: bits.indexOf(true) }
	if (count === 3) return { piece: 'inner', rot: bits.indexOf(false) }
	for (let k = 0; k < 4; k++) {
		if (bits[k] && bits[(k + 1) % 4]) return { piece: 'edge', rot: k }
	}
	return { piece: 'diag', rot: sw ? 0 : 1 }
}


// MARK: terrainPieceStats
/**
 * Cliff pieces the renderer will need for this map, per type, across
 * every step threshold. Used by the preview tool and load logging.
 */
export function terrainPieceStats(map: TerrainMap): {
	outer   : number
	edge    : number
	inner   : number
	diag    : number
	ladders : number
	total   : number
} {
	let outer = 0
	let edge  = 0
	let inner = 0
	let diag  = 0
	for (let t = MID; t <= MOUNTAIN + TERRAIN_MOUNTAIN_PEAK_STEPS; t++) {
		for (let vz = 0; vz <= H; vz++) {
			for (let vx = 0; vx <= W; vx++) {
				const { piece } = classifyCorner(map.levels, vx, vz, t)
				if (piece === 'outer')      outer++
				else if (piece === 'edge')  edge++
				else if (piece === 'inner') inner++
				else if (piece === 'diag')  diag++
			}
		}
	}
	return { outer, edge, inner, diag, ladders: map.ladders.length, total: outer + edge + inner + map.ladders.length }
}
