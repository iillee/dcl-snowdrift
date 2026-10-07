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
	isCrownLevel,
} from 'src/shared/settings'
import {
	DIR_DX,
	DIR_DZ,
	LANDFORM_LAVA,
	LANDFORM_VOLCANO,
	TerrainMap,
	cellCenterWorld,
	groundYAtWorld,
	inGrid,
} from 'src/shared/terrain/terrainMap'
import {
	volcanoCrownCells,
	volcanoLavaCells,
	volcanoLavaCentroid,
} from 'src/shared/terrain/volcanoCrown'


export type SummitMapSeat = {
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
	return { cx, cz, x, y, z }
}
