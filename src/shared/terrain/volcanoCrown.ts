/**
 * volcanoCrown.ts (shared) — the volcano's crater crown and lava lake.
 *
 * The crown is real terrain: the generator extrudes the inner-lip rim
 * cells to crown levels (TERRAIN_LEVEL_CROWN..CROWN_MAX, 5–7 m above
 * the rim), so the slab renderer, colliders, ground-height queries and
 * the per-level snow tiles all treat them as ordinary taller columns.
 * This module picks those cells and answers queries about them.
 *
 *   Lava  = LANDFORM_LAVA cells (crater interior, rim level, locked).
 *   Crown = rim-level volcano cells 4-adjacent to lava — the inner
 *           crater lip — minus ladder cells and a gate next to each
 *           ladder landing, so the stair top looks straight into the lava.
 *
 * Pure (no engine imports): safe for client, server and the generator.
 */

import {
	TERRAIN_CROWN_STEPS,
	TERRAIN_LEVEL_CROWN,
	TERRAIN_LEVEL_CROWN_MAX,
	TERRAIN_LEVEL_VOLCANO_RIM,
	VOLCANO_LAVA_TOP_ABOVE_RIM_M,
	groundYForLevel,
	isCrownLevel,
} from 'src/shared/settings'
import {
	DIR_DX,
	DIR_DZ,
	LANDFORM_LAVA,
	LANDFORM_VOLCANO,
	TerrainLadder,
	TerrainMap,
} from 'src/shared/terrain/terrainMap'

export { VOLCANO_LAVA_TOP_ABOVE_RIM_M }


// MARK: volcanoRimY
/** Walkable surface of the rim level (48.25 m with the 16 m step). */
export function volcanoRimY(): number {
	return groundYForLevel(TERRAIN_LEVEL_VOLCANO_RIM)
}


// MARK: volcanoLavaTopY
/** World Y of the lava lid (rim + 1.7 m, above the deepest snow). */
export function volcanoLavaTopY(): number {
	return volcanoRimY() + VOLCANO_LAVA_TOP_ABOVE_RIM_M
}


// MARK: computeVolcanoCrownCells
/**
 * Generator-side pick of the cells to extrude: rim-level volcano cells
 * touching lava, minus ladder cells and the landing gate.
 */
export function computeVolcanoCrownCells(
	levels   : Uint8Array,
	landforms: Uint8Array,
	ladders  : ReadonlyArray<TerrainLadder>,
	W        : number,
	H        : number,
): number[] {
	const open = new Set<number>()
	for (const l of ladders) {
		open.add(l.lowCz * W + l.lowCx)
		open.add(l.highCz * W + l.highCx)
		// Gate: keep the landing's neighbours open too.
		for (let d = 0; d < 4; d++) {
			const nx = l.highCx + DIR_DX[d]
			const nz = l.highCz + DIR_DZ[d]
			if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue
			open.add(nz * W + nx)
		}
	}
	const out: number[] = []
	for (let i = 0; i < levels.length; i++) {
		if (levels[i] !== TERRAIN_LEVEL_VOLCANO_RIM) continue
		if (landforms[i] !== LANDFORM_VOLCANO) continue
		if (open.has(i)) continue
		const cx = i % W
		const cz = (i - cx) / W
		for (let d = 0; d < 4; d++) {
			const nx = cx + DIR_DX[d]
			const nz = cz + DIR_DZ[d]
			if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue
			if (landforms[nz * W + nx] === LANDFORM_LAVA) {
				out.push(i)
				break
			}
		}
	}
	return out
}


// MARK: crownLevelFor
/** Deterministic crown level (jagged 5 / 6 / 7 m) for one cell. */
export function crownLevelFor(
	i   : number,
	seed: number,
): number {
	let h = (Math.imul(i + 1, 0x9E3779B1) ^ seed) >>> 0
	h = Math.imul(h ^ (h >>> 15), 0x85EBCA6B) >>> 0
	h = (h ^ (h >>> 13)) >>> 0
	return TERRAIN_LEVEL_CROWN + (h % TERRAIN_CROWN_STEPS)
}


// MARK: volcanoLavaCells
/** Flat indices of lava cells. */
export function volcanoLavaCells(map: TerrainMap): number[] {
	const out: number[] = []
	for (let i = 0; i < map.levels.length; i++) {
		if (map.landforms[i] === LANDFORM_LAVA) out.push(i)
	}
	return out
}


// MARK: volcanoCrownCells
/** Flat indices of extruded crown cells (crown terrain levels). */
export function volcanoCrownCells(map: TerrainMap): number[] {
	const out: number[] = []
	for (let i = 0; i < map.levels.length; i++) {
		if (isCrownLevel(map.levels[i])) out.push(i)
	}
	return out
}


// MARK: volcanoCrownTopY
/** Highest world Y the crown can reach (rim + 7 m). */
export function volcanoCrownTopY(): number {
	return groundYForLevel(TERRAIN_LEVEL_CROWN_MAX)
}


// MARK: volcanoLavaCentroid
/** Fractional cell coords of the lava lake centre, or null. */
export function volcanoLavaCentroid(map: TerrainMap): { fx: number; fz: number } | null {
	const cells = volcanoLavaCells(map)
	if (cells.length === 0) return null
	let sx = 0
	let sz = 0
	for (const i of cells) {
		sx += i % map.w
		sz += Math.floor(i / map.w)
	}
	return { fx: sx / cells.length, fz: sz / cells.length }
}
