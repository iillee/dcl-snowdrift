/**
 * summitMapSeat.ts — pick a walkable volcano-rim cell for the map table.
 *
 * Prefers an INNER rim cell (lava-adjacent) so the pillar is visible
 * from the crater floor where players look for heat. Never lava or
 * extruded crown. Pure: safe for client.
 */

import {
	TERRAIN_LEVEL_HIGH,
	TERRAIN_LEVEL_VOLCANO_RIM,
	TERRAIN_CELL_M,
	VOLCANO_LAVA_TOP_ABOVE_RIM_M,
	groundYForLevel,
	isCrownLevel,
} from 'src/shared/settings'

import { CRYSTAL_MAP_LADDER_CLEAR_M, CRYSTAL_MAP_LAVA_CLEAR_M, isFloatingCrystals } from 'src/shared/ruleset'
import { CRATER_HEAT_RADIUS_M } from 'src/shared/terrain/volcanoCraterHeat'

/** Plinth top above the lava top, so the pillar never reads as buried. */
export const SUMMIT_PLINTH_ABOVE_LAVA_M = 0.35
import {
	DIR_DX,
	DIR_DZ,
	LANDFORM_LAVA,
	LANDFORM_VOLCANO,
	TerrainMap,
	cellCenterWorld,
	cellOfWorld,
	groundFlatWithin,
	groundYAtWorld,
	inGrid,
} from 'src/shared/terrain/terrainMap'
import {
	volcanoCrownCells,
	volcanoLavaCells,
	volcanoLavaCentroid,
} from 'src/shared/terrain/volcanoCrown'


export type SummitMapSeat = {
	/** Crater floor under the plinth (rim level). */
	floorY: number
	cx: number
	cz: number
	x:  number
	y:  number
	z:  number
}


function touchesLava(map: TerrainMap, cx: number, cz: number): boolean {
	for (let d = 0; d < 4; d++) {
		const nx = cx + DIR_DX[d]
		const nz = cz + DIR_DZ[d]
		if (!inGrid(nx, nz)) continue
		if (map.landforms[nz * map.w + nx] === LANDFORM_LAVA) return true
	}
	return false
}


/**
 * Choose a rim walkable cell near the caldera lip. Null when the map
 * has no volcano or no safe seat.
 */
export function pickSummitMapSeat(map: TerrainMap): SummitMapSeat | null {
	if (!map.volcano) return null
	// Floating crystals: outer rim near the ladder arrival, away from lava.
	if (isFloatingCrystals()) return pickOuterRimSeat(map)
	// Crater centre: the lava cell nearest the lava centroid, on a plinth.
	{
		const lavaCells = volcanoLavaCells(map)
		const c = volcanoLavaCentroid(map)
		if (lavaCells.length > 0 && c) {
			let best = lavaCells[0]
			let bestD = Infinity
			for (const i of lavaCells) {
				const cx = i % map.w
				const cz = (i - cx) / map.w
				const d = (cx + 0.5 - c.fx) ** 2 + (cz + 0.5 - c.fz) ** 2
				if (d < bestD) { bestD = d; best = i }
			}
			const cx = best % map.w
			const cz = (best - cx) / map.w
			const { x, z } = cellCenterWorld(cx, cz)
			const floorY = groundYForLevel(TERRAIN_LEVEL_VOLCANO_RIM)
			const y = floorY + VOLCANO_LAVA_TOP_ABOVE_RIM_M + SUMMIT_PLINTH_ABOVE_LAVA_M
			return { cx, cz, x, y, z, floorY }
		}
	}
	const W = map.w
	const lava  = new Set(volcanoLavaCells(map))
	const crown = new Set(volcanoCrownCells(map))
	const lavaC = volcanoLavaCentroid(map)

	const open = new Set<number>()
	for (const l of map.ladders) {
		const hi = l.highCz * W + l.highCx
		if (map.levels[hi] < TERRAIN_LEVEL_HIGH) continue
		open.add(hi)
		for (let d = 0; d < 4; d++) {
			const nx = l.highCx + DIR_DX[d]
			const nz = l.highCz + DIR_DZ[d]
			if (!inGrid(nx, nz)) continue
			open.add(nz * W + nx)
		}
	}

	type Cand = { i: number; score: number }
	const cands: Cand[] = []

	const consider = (i: number, bonus: number): void => {
		if (lava.has(i) || crown.has(i)) return
		const cx = i % W
		const cz = (i - cx) / W
		const lv = map.levels[i]
		if (lv < TERRAIN_LEVEL_HIGH) return
		if (isCrownLevel(lv)) return
		if (map.landforms[i] === LANDFORM_LAVA) return
		const isVolc = map.landforms[i] === LANDFORM_VOLCANO
		const isRim  = lv === TERRAIN_LEVEL_VOLCANO_RIM
		if (!isVolc && !isRim && !open.has(i)) return

		let score = bonus
		if (isRim) score += 40
		if (isVolc) score += 30
		if (touchesLava(map, cx, cz)) score += 80
		if (open.has(i)) score += 15
		if (lavaC) {
			const dx = cx - lavaC.fx
			const dz = cz - lavaC.fz
			const dist = Math.sqrt(dx * dx + dz * dz)
			// Prefer INNER rim (close to lava) so the table is visible
			// when standing in the crater looking for heat / landmarks.
			score += Math.max(0, 50 - dist * 8)
		}
		cands.push({ i, score })
	}

	for (const i of open) consider(i, 10)
	for (let i = 0; i < map.levels.length; i++) {
		if (map.levels[i] !== TERRAIN_LEVEL_VOLCANO_RIM) continue
		if (map.landforms[i] !== LANDFORM_VOLCANO) continue
		consider(i, 0)
	}

	if (cands.length === 0) return null
	cands.sort((a, b) => b.score - a.score)
	const best = cands[0]
	const cx = best.i % W
	const cz = (best.i - cx) / W
	const { x, z } = cellCenterWorld(cx, cz)
	const y = groundYAtWorld(map, x, z)
	return { cx, cz, x, y, z, floorY: y }
}


/**
 * Floating crystals: a spot on the summit rim's OUTSKIRTS. Rim cells are
 * 16 m tiles ringing the lava, so the cell is chosen first (reachable rim,
 * preferring one a ladder arrives on) and the tablet is then pushed inside
 * it away from the lava centre, kept on flat rim ground, outside the
 * crater heat disc and clear of the ladder landing.
 */
function pickOuterRimSeat(map: TerrainMap): SummitMapSeat | null {
	const W = map.w
	const lava  = new Set(volcanoLavaCells(map))
	const crown = new Set(volcanoCrownCells(map))
	const lavaC = volcanoLavaCentroid(map)
	if (!lavaC) return null
	const half = TERRAIN_CELL_M / 2
	const c0 = cellCenterWorld(0, 0)
	const lavaX = c0.x + (lavaC.fx - 0.5) * TERRAIN_CELL_M
	const lavaZ = c0.z + (lavaC.fz - 0.5) * TERRAIN_CELL_M
	// Ladder landing points on the rim (edge midpoint between low/high cell).
	const landings: { x: number; z: number; i: number }[] = []
	for (const l of map.ladders) {
		const hi = l.highCz * W + l.highCx
		if (map.levels[hi] !== TERRAIN_LEVEL_VOLCANO_RIM) continue
		const a = cellCenterWorld(l.highCx, l.highCz)
		const b = cellCenterWorld(l.lowCx, l.lowCz)
		landings.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, i: hi })
	}
	const rimFlat = (x: number, z: number): boolean => {
		if (!groundFlatWithin(map, x, z, 1.5)) return false
		for (let k = 0; k < 8; k++) {
			const a = (k / 8) * Math.PI * 2
			const ci = cellIndexAt(map, x + Math.sin(a) * 1.5, z + Math.cos(a) * 1.5)
			if (ci < 0 || map.levels[ci] !== TERRAIN_LEVEL_VOLCANO_RIM || lava.has(ci) || crown.has(ci)) return false
		}
		return true
	}
	let best: { x: number; z: number; cx: number; cz: number } | null = null
	let bestScore = -Infinity
	for (let i = 0; i < map.levels.length; i++) {
		if (map.levels[i] !== TERRAIN_LEVEL_VOLCANO_RIM) continue
		if (lava.has(i) || crown.has(i) || map.landforms[i] === LANDFORM_LAVA) continue
		if (map.routeDist[i] < 0) continue
		const cx = i % W
		const cz = (i - cx) / W
		const cc = cellCenterWorld(cx, cz)
		// Sample a 5x5 grid inside the cell (2.5 m in from its sides).
		for (let sz = 0; sz < 5; sz++) for (let sx = 0; sx < 5; sx++) {
			const x = cc.x - half + 2.5 + sx * (TERRAIN_CELL_M - 5) / 4
			const z = cc.z - half + 2.5 + sz * (TERRAIN_CELL_M - 5) / 4
			if (!rimFlat(x, z)) continue
			const dl = Math.hypot(x - lavaX, z - lavaZ)
			if (dl < CRATER_HEAT_RADIUS_M + CRYSTAL_MAP_LAVA_CLEAR_M) continue
			let ld = Infinity
			for (const L of landings) ld = Math.min(ld, Math.hypot(x - L.x, z - L.z))
			if (ld < CRYSTAL_MAP_LADDER_CLEAR_M) continue
			// Outskirts first, then near the arrival ladder (visible on arrival).
			let score = Math.min(dl, 30) * 3
			if (ld < Infinity) score += Math.max(0, 80 - ld * 4)
			if (score > bestScore) { bestScore = score; best = { x, z, cx, cz } }
		}
	}
	if (!best) return null
	const y = groundYAtWorld(map, best.x, best.z)
	return { cx: best.cx, cz: best.cz, x: best.x, y, z: best.z, floorY: y }
}


function cellIndexAt(map: TerrainMap, x: number, z: number): number {
	const c = cellOfWorld(x, z)
	if (!inGrid(c.cx, c.cz)) return -1
	return c.cz * map.w + c.cx
}