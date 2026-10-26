/**
 * monumentIce.ts - shared layout of the chunked ice mound around each
 * monument obelisk (client visuals, server state, snow-over-ice clearing).
 *
 * The MONUMENT_PIT_SIZE_M recess is split into an N x N grid of
 * MONUMENT_ICE_CHUNK_M square columns (aligned to the 1 m snow cells).
 * The centre column is skipped: the obelisk stands there. Each column
 * runs from the ground (MONUMENT_PIT_DEPTH_M = 0, no recess) up to
 * MONUMENT_ICE_TOP_M ABOVE the ground (the second snow height mark), so
 * the ice is a wall you cannot step onto; snow lies on its top. A chunk
 * is either frozen or melted; the server keeps one bitmask per monument
 * (bit i = chunk i melted). The obelisk can be ignited only once every
 * chunk is melted (iceFullyMelted).
 */

import { SNOW_STAGE_HEIGHT_M } from 'src/shared/snowGrid'
import {
	MONUMENT_PIT_DEPTH_M,
	MONUMENT_PIT_SIZE_M,
} from 'src/shared/terrain/terrainMap'


// MARK: Layout
/** Edge length of one ice chunk (m). Even divisor of the pit size. */
export const MONUMENT_ICE_CHUNK_M = MONUMENT_PIT_SIZE_M / 2
/** Chunks along one pit edge. */
export const MONUMENT_ICE_GRID = Math.round(MONUMENT_PIT_SIZE_M / MONUMENT_ICE_CHUNK_M)
/** Grid index of the obelisk column (no ice there). */
// Four corner blocks (2 x 2 grid): no centre slot, the obelisk stands where
// the four inner corners meet. -1 = no skipped slot.
export const MONUMENT_ICE_CENTRE_INDEX = MONUMENT_ICE_GRID % 2 === 1
	? Math.floor(MONUMENT_ICE_GRID / 2) * MONUMENT_ICE_GRID + Math.floor(MONUMENT_ICE_GRID / 2)
	: -1
/** Total grid slots (incl. the skipped centre). */
export const MONUMENT_ICE_SLOTS = MONUMENT_ICE_GRID * MONUMENT_ICE_GRID
/** Bitmask with every real ice chunk set. */
export const MONUMENT_ICE_FULL_MASK = MONUMENT_ICE_CENTRE_INDEX >= 0
	? ((1 << MONUMENT_ICE_SLOTS) - 1) & ~(1 << MONUMENT_ICE_CENTRE_INDEX)
	: (1 << MONUMENT_ICE_SLOTS) - 1
/**
 * Ice top above the surrounding ground (m): the second snow height mark
 * (stage 2 = 1.0 m). Snow has no colliders, so the walkable surface next
 * to the ice is the ground; 1.0 m is far over the 0.3 m DCL auto-step,
 * so the mound blocks like a wall and you melt it from the side.
 */
export const MONUMENT_ICE_TOP_M = SNOW_STAGE_HEIGHT_M[2]
/**
 * Snow cap on a frozen chunk (m): exactly one snow section (stage 1),
 * so the mound is 3 sections tall with the top third snow. Deeper snow
 * stages never stack higher on the ice.
 */
export const MONUMENT_ICE_SNOW_CAP_M = SNOW_STAGE_HEIGHT_M[1]
/** Mound top above the ground (m): ice + snow cap. */
export const MONUMENT_MOUND_TOP_M = MONUMENT_ICE_TOP_M + MONUMENT_ICE_SNOW_CAP_M


// MARK: Melt tuning (client)
/** Seconds of lit-torch exposure to melt one chunk. */
export const MONUMENT_ICE_CHUNK_MELT_S = 6
/** Seconds for a partly melted chunk to fully refreeze when the torch leaves. */
export const MONUMENT_ICE_CHUNK_REFREEZE_S = 12
/** false (default): partly melted chunks keep their melt progress (ice never grows back this cycle). true = old refreeze over MONUMENT_ICE_CHUNK_REFREEZE_S. */
export const MONUMENT_ICE_REFREEZE_ENABLED: boolean = false
/**
 * XZ radius (m) around the torch-holding player whose chunk centres melt.
 * Block centres sit 1.5 m in from each pit edge: pressed against the
 * middle of a block's outer face (~1.9 m) you melt it; at the outer
 * corner (~2.7 m) too. Between two blocks (~2.4 m) you heat both.
 */
export const MONUMENT_ICE_MELT_RADIUS_M = 3.0


// MARK: isIceChunk
/** True for a real chunk index (in range, not the obelisk column). */
export function isIceChunk(i: number): boolean {
	return Number.isInteger(i) && i >= 0 && i < MONUMENT_ICE_SLOTS && i !== MONUMENT_ICE_CENTRE_INDEX
}


// MARK: iceFullyMelted
export function iceFullyMelted(mask: number): boolean {
	return (mask & MONUMENT_ICE_FULL_MASK) === MONUMENT_ICE_FULL_MASK
}


// MARK: iceChunkOffset
/** XZ offset (m) of chunk i's centre from the pit centre. */
export function iceChunkOffset(i: number): { dx: number; dz: number } {
	const col = i % MONUMENT_ICE_GRID
	const row = (i - col) / MONUMENT_ICE_GRID
	const half = MONUMENT_PIT_SIZE_M / 2
	return {
		dx: -half + (col + 0.5) * MONUMENT_ICE_CHUNK_M,
		dz: -half + (row + 0.5) * MONUMENT_ICE_CHUNK_M,
	}
}


// MARK: iceChunkAt
/**
 * Chunk index under XZ offset (dx, dz) from the pit centre, or -1 when
 * outside the pit. The centre (obelisk) slot is returned too; check
 * isIceChunk.
 */
export function iceChunkAt(dx: number, dz: number): number {
	const half = MONUMENT_PIT_SIZE_M / 2
	const col = Math.floor((dx + half) / MONUMENT_ICE_CHUNK_M)
	const row = Math.floor((dz + half) / MONUMENT_ICE_CHUNK_M)
	if (col < 0 || row < 0 || col >= MONUMENT_ICE_GRID || row >= MONUMENT_ICE_GRID) return -1
	return row * MONUMENT_ICE_GRID + col
}


// MARK: pitDepthAtRing
/**
 * Depth (m, >= 0) of the recess floor below ground at Chebyshev distance
 * `d` (m) from the pit centre, ignoring the socket: one shallow step,
 * MONUMENT_PIT_DEPTH_M inside the pit, 0 outside.
 */
export function pitDepthAtRing(d: number): number {
	return d < MONUMENT_PIT_SIZE_M / 2 ? MONUMENT_PIT_DEPTH_M : 0
}


// MARK: iceChunkDepth
/** Depth (m) of chunk i's ice bottom below the ground: the recess floor. */
export function iceChunkDepth(_i: number): number {
	return MONUMENT_PIT_DEPTH_M
}


// MARK: iceChunkHeight
/** Full height (m) of chunk i's ice column: recess floor to MONUMENT_ICE_TOP_M. */
export function iceChunkHeight(i: number): number {
	return iceChunkDepth(i) + MONUMENT_ICE_TOP_M
}


// MARK: icedStationIndex
/**
 * Index of the ONE monument that carries the ice test this cycle, or -1.
 * Deterministic from the terrain map (usedSeed + station list), so server
 * and every client (incl. late joiners, who rebuild the same map) agree.
 * Never the near-spawn monument: candidates are the stations not flagged
 * `near`; if none is flagged (far-only fallback), the one with the
 * shortest route from the hearth is excluded instead.
 */
export function icedStationIndex(
	map: { usedSeed: number; stations: { near?: boolean; route: number }[] } | null | undefined,
): number {
	if (!map || map.stations.length === 0) return -1
	const st = map.stations
	let excluded = st.findIndex((s) => s.near === true)
	if (excluded < 0) {
		excluded = 0
		for (let i = 1; i < st.length; i++) if (st[i].route < st[excluded].route) excluded = i
	}
	const candidates: number[] = []
	for (let i = 0; i < st.length; i++) if (i !== excluded) candidates.push(i)
	if (candidates.length === 0) return -1
	// Small integer hash of the seed (stable across JS runtimes).
	let h = (map.usedSeed | 0) ^ 0x9e3779b9
	h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
	h ^= h >>> 16
	return candidates[(h >>> 0) % candidates.length]
}

/** True when monument `index` of `map` has the ice test. */
export function stationHasIce(
	map: Parameters<typeof icedStationIndex>[0],
	index: number,
): boolean {
	return index >= 0 && index === icedStationIndex(map)
}
