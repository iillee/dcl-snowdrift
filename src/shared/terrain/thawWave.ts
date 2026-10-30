/**
 * thawWave.ts - shared geometry + timing for the staged volcano thaw zone.
 *
 * Each activated obelisk (stage 1..3 = active count) grows the volcano's
 * eternal-campfire zone: a melt wave runs from the current radius out to
 * THAW_STAGE_RADIUS_M[stage] and stops there. Inside the radius snow,
 * cliff ice caps and scatter wood are gone, snowfall cannot refill, and
 * there is no ambient / night cold (Warm campfire heat). Outside it the
 * world stays wintry. Stage 3 is the victory thaw (splash, post-win days).
 *
 * Stage 3 is never smaller than the per-map area radius (the old victory
 * zone: THAW_AREA_FRACTION of the tiles x THAW_RADIUS_SCALE), so large
 * world profiles still get most of the map.
 *
 * Each stage's wave starts THAW_STAGE_START_DELAY_S after the server
 * accepts the activation, which is when the volcano beam lands on the
 * igniting player's screen (rise + settle + beam draw), so snow does not
 * melt before the volcano visibly reacts.
 *
 * The server owns the wave as a ThawSegment (from/to radius, start, length)
 * and broadcasts it in worldThawState; late joiners place it by age.
 *
 * Distances: segment radii in metres; tile tests in snow tiles (16 m),
 * measured from the crater tile.
 */

import { SNOW_ORIGIN_M, SNOW_TILE_M, SNOW_TILES_X, SNOW_TILES_Z } from 'src/shared/snowGrid'
import { TerrainMap } from 'src/shared/terrain/terrainMap'
import { volcanoCraterHeatCenter } from 'src/shared/terrain/volcanoCraterHeat'
import {
	THAW_EDGE_BAND_FRAC,
	THAW_EDGE_BAND_M,
	THAW_STAGE_RADIUS_M,
	THAW_STAGE_START_DELAY_S,
	THAW_STAGE_WAVE_S,
} from 'src/shared/volcanoStages'

// Stage radii / timing live in src/shared/volcanoStages.ts (one place).
export { THAW_STAGE_RADIUS_M, THAW_STAGE_WAVE_S, THAW_STAGE_START_DELAY_S }

/**
 * Full in-game days of warmth after the thaw day. The rest of the thaw
 * day is a bonus; each following sunrise shows "Winter Approaches in N
 * Day(s)" for N = POST_THAW_DAYS..1, and the sunrise after the last one
 * rolls a new winter. Tune here (server + client both read it).
 */
export const POST_THAW_DAYS = 1

/**
 * Share of the playfield's tiles the thaw zone must cover (0..1). The
 * radius is the smallest one whose disc contains this share. Tune here.
 */
export const THAW_AREA_FRACTION = 0.55

/**
 * Final thaw radius multiplier applied to the area-fraction radius.
 * 0.5 halves the post-victory ring (~1/4 of the area). Wave duration is
 * unchanged, so the edge spreads at half the speed. Tune here.
 */
export const THAW_RADIUS_SCALE = 0.5

/** Wave progress (0..1) at which the "World Thawed" card shows. */
export const THAW_SPLASH_AT_PROGRESS = 0.5

export { THAW_EDGE_BAND_M, THAW_EDGE_BAND_FRAC }

export type ThawWaveCentre = {
	tx     : number
	tz     : number
	/** World position of the crater tile centre. */
	x      : number
	z      : number
	/** Stage 3 (victory) thaw radius in tiles (tile-centre distance; tiles <= this melt). */
	radius : number
	/** Same radius in metres. */
	radiusM: number
}


/**
 * One outward melt-wave step. Radius goes fromM -> toM linearly over
 * durMs starting at startMs (server Date.now() on the server, local
 * Date.now() equivalent on clients). Before startMs it reads fromM.
 */
export type ThawSegment = {
	fromM  : number
	toM    : number
	startMs: number
	durMs  : number
}

/** Crater tile the zone grows from (map centre if no volcano) and its radius. */
export function thawWaveCentre(map: TerrainMap | null): ThawWaveCentre {
	let tx = Math.floor((SNOW_TILES_X - 1) / 2)
	let tz = Math.floor((SNOW_TILES_Z - 1) / 2)
	const c = map ? volcanoCraterHeatCenter(map) : null
	if (c) {
		tx = clampInt(Math.floor((c.x - SNOW_ORIGIN_M) / SNOW_TILE_M), SNOW_TILES_X)
		tz = clampInt(Math.floor((c.z - SNOW_ORIGIN_M) / SNOW_TILE_M), SNOW_TILES_Z)
	}
	const d: number[] = []
	for (let z = 0; z < SNOW_TILES_Z; z++) {
		for (let x = 0; x < SNOW_TILES_X; x++) d.push(Math.hypot(x - tx, z - tz))
	}
	d.sort((a, b) => a - b)
	const need   = Math.min(d.length - 1, Math.ceil(THAW_AREA_FRACTION * d.length) - 1)
	const areaR  = Math.max(1, d[Math.max(0, need)] * THAW_RADIUS_SCALE)
	const radius = Math.max(areaR, THAW_STAGE_RADIUS_M[3] / SNOW_TILE_M)
	return {
		tx, tz,
		x: SNOW_ORIGIN_M + (tx + 0.5) * SNOW_TILE_M,
		z: SNOW_ORIGIN_M + (tz + 0.5) * SNOW_TILE_M,
		radius,
		radiusM: radius * SNOW_TILE_M,
	}
}

/** Target thaw radius (m) for `stage` (0..3) on this map's centre. */
export function thawStageRadiusM(centre: ThawWaveCentre, stage: number): number {
	const s = Math.max(0, Math.min(3, Math.floor(stage)))
	if (s >= 3) return centre.radiusM
	return Math.min(centre.radiusM, THAW_STAGE_RADIUS_M[s])
}


/** Radius (m) of a segment at `nowMs`. */
export function thawSegmentRadiusM(seg: ThawSegment, nowMs: number): number {
	if (nowMs <= seg.startMs || seg.durMs <= 0) return nowMs <= seg.startMs ? seg.fromM : seg.toM
	const u = Math.min(1, (nowMs - seg.startMs) / seg.durMs)
	return seg.fromM + (seg.toM - seg.fromM) * u
}


/**
 * Plan the wave for reaching `stage` when the server accepted it at
 * `acceptedMs`. Starts THAW_STAGE_START_DELAY_S later from wherever the
 * previous wave will be then, so steps chain without jumps even when
 * obelisks are lit in quick succession. Never shrinks.
 */
export function planThawSegment(
	centre    : ThawWaveCentre,
	prev      : ThawSegment | null,
	stage     : number,
	acceptedMs: number,
): ThawSegment {
	const startMs = acceptedMs + THAW_STAGE_START_DELAY_S * 1000
	const fromM   = prev ? thawSegmentRadiusM(prev, startMs) : 0
	const toM     = Math.max(fromM, thawStageRadiusM(centre, stage))
	const s       = Math.max(1, Math.min(3, Math.floor(stage)))
	const span    = Math.max(1, thawStageRadiusM(centre, s) - thawStageRadiusM(centre, s - 1))
	const frac    = Math.min(1.5, (toM - fromM) / span)
	const durMs   = toM > fromM ? Math.max(1000, THAW_STAGE_WAVE_S[s] * 1000 * frac) : 0
	return { fromM, toM, startMs, durMs }
}

/** Distance in tiles from the zone centre to the tile holding world (x, z). */
export function thawTileDistAt(centre: ThawWaveCentre, x: number, z: number): number {
	const tx = clampInt(Math.floor((x - SNOW_ORIGIN_M) / SNOW_TILE_M), SNOW_TILES_X)
	const tz = clampInt(Math.floor((z - SNOW_ORIGIN_M) / SNOW_TILE_M), SNOW_TILES_Z)
	return Math.hypot(tx - centre.tx, tz - centre.tz)
}

/**
 * Heat factor 0..1 of the thaw campfire at world (x, z) for a wave of
 * `waveTiles` radius: 1 well inside, fading to 0 across THAW_EDGE_BAND_M
 * at the current wave edge, 0 outside.
 */
export function thawHeatFactor(centre: ThawWaveCentre, waveTiles: number, x: number, z: number): number {
	if (waveTiles <= 0) return 0
	const edgeM = (waveTiles + 0.5) * SNOW_TILE_M
	const d = Math.hypot(x - centre.x, z - centre.z)
	if (d >= edgeM) return 0
	const band = Math.max(1, Math.min(THAW_EDGE_BAND_M, edgeM * THAW_EDGE_BAND_FRAC))
	return Math.min(1, (edgeM - d) / band)
}

function clampInt(v: number, n: number): number {
	return v < 0 ? 0 : v >= n ? n - 1 : v
}
