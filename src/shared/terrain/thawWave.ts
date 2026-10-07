/**
 * thawWave.ts - shared geometry + timing for the world-thaw zone.
 *
 * At the 3rd monument the volcano becomes a giant eternal campfire. A
 * melt wave grows from the crater tile out to the thaw radius over
 * THAW_WAVE_DURATION_S and stops there. Inside the radius snow, cliff
 * ice caps and scatter wood are gone and there is no ambient / night
 * cold; outside it the world stays wintry.
 *
 * The radius is sized per map so the zone covers at least
 * THAW_AREA_FRACTION of the playfield's snow tiles (counting the parts
 * of the disc that fall off the map edge as lost), so it holds for any
 * world profile and any volcano position.
 *
 * Distances are in snow tiles (16 m), measured from the crater tile.
 */

import { SNOW_ORIGIN_M, SNOW_TILE_M, SNOW_TILES_X, SNOW_TILES_Z } from 'src/shared/snowGrid'
import { TerrainMap } from 'src/shared/terrain/terrainMap'
import { volcanoCraterHeatCenter } from 'src/shared/terrain/volcanoCraterHeat'

/** Seconds for the melt wave to reach the thaw radius edge. Tune here. */
export const THAW_WAVE_DURATION_S = 45

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

/** Soft heat edge: warmth / cold-block fade over this many metres inside the radius. */
export const THAW_EDGE_BAND_M = 48

export type ThawWaveCentre = {
	tx     : number
	tz     : number
	/** World position of the crater tile centre. */
	x      : number
	z      : number
	/** Thaw radius in tiles (tile-centre distance; tiles <= this melt). */
	radius : number
	/** Same radius in metres. */
	radiusM: number
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
	const radius = Math.max(1, d[Math.max(0, need)])
	return {
		tx, tz,
		x: SNOW_ORIGIN_M + (tx + 0.5) * SNOW_TILE_M,
		z: SNOW_ORIGIN_M + (tz + 0.5) * SNOW_TILE_M,
		radius,
		radiusM: radius * SNOW_TILE_M,
	}
}

/** Wave radius in tiles after `ageMs`; stops at the thaw radius. */
export function thawWaveRadiusTiles(ageMs: number, radius: number): number {
	const t = ageMs / (THAW_WAVE_DURATION_S * 1000)
	return Math.max(0, Math.min(1, t)) * radius
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
	const band = Math.min(THAW_EDGE_BAND_M, edgeM)
	return Math.min(1, (edgeM - d) / band)
}

function clampInt(v: number, n: number): number {
	return v < 0 ? 0 : v >= n ? n - 1 : v
}
