/** mapSeatCheck entry: summit map tablet seat per seed (crystals outskirts). */
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { WORLD_PROFILE, TERRAIN_CELL_M, TERRAIN_LEVEL_VOLCANO_RIM } from 'src/shared/settings'
import { getTerrain, offHearthCellsForMazeSeed } from 'src/shared/terrain/terrainCache'
import { groundFlatWithin, LANDFORM_LAVA } from 'src/shared/terrain/terrainMap'
import { pickSummitMapSeat } from 'src/shared/terrain/summitMapSeat'
import { volcanoLavaCentroid, volcanoLavaCells } from 'src/shared/terrain/volcanoCrown'
import { computeWoodScatter } from 'src/shared/woodScatter'
import { scatterProps } from 'src/shared/props/scatter'
import { pickHiddenCampfires } from 'src/shared/hiddenCampfire'
import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { CRATER_HEAT_RADIUS_M } from 'src/shared/terrain/volcanoCraterHeat'
const g: any = globalThis; g.__real ??= console.log; const real = g.__real; console.log = () => {}
const N = Number(process.argv[2] ?? 12), CLEAR_M = 2.5
let bad = 0
const dirOf = (dx: number, dz: number) => ['N','NE','E','SE','S','SW','W','NW'][((Math.round(Math.atan2(dx, dz) / (Math.PI / 4)) % 8) + 8) % 8]
real(`[${WORLD_PROFILE}] cell ${TERRAIN_CELL_M} m, crater heat r ${CRATER_HEAT_RADIUS_M} m`)
for (let s = 0; s < N; s++) {
	const seed = 20000 + s * 7, ms = cycleMazeSeed(seed), m = getTerrain(ms), W = m.w
	const seat = pickSummitMapSeat(m)
	if (!seat) { bad++; real(`  seed ${seed}: NO SEAT`); continue }
	const i = seat.cz * W + seat.cx
	const errs: string[] = []
	if (m.levels[i] !== TERRAIN_LEVEL_VOLCANO_RIM) errs.push('not rim')
	if (m.landforms[i] === LANDFORM_LAVA) errs.push('lava')
	if (m.routeDist[i] < 0) errs.push('unreachable')
	if (!groundFlatWithin(m, seat.x, seat.z, 1.5)) errs.push('edge')
	const near = (x: number, z: number) => Math.hypot(x - seat.x, z - seat.z) < CLEAR_M
	for (const p of scatterProps(ms, offHearthCellsForMazeSeed(ms))) if (near(p.worldX, p.worldZ)) errs.push('prop ' + p.propId)
	for (const c of computeWoodScatter(seed, offHearthCellsForMazeSeed(ms))) if (near(c.worldX, c.worldZ)) errs.push('wood')
	for (const p of pickHiddenCampfires(seed)) if (Math.hypot(p.x - seat.x, p.z - seat.z) < 4) errs.push('pit')
	const c = volcanoLavaCentroid(m)
	let vx = 0, vz = 0
	if (c) { vx = (c.fx) * TERRAIN_CELL_M; vz = (c.fz) * TERRAIN_CELL_M }
	// convert via cell centre of lava cell nearest centroid offset
	let lavaMin = Infinity
	for (const j of volcanoLavaCells(m)) { const lx = j % W, lz = (j - lx) / W; lavaMin = Math.min(lavaMin, Math.hypot(lx - seat.cx, lz - seat.cz) * TERRAIN_CELL_M) }
	if (errs.length) bad++
	const hx = seat.x - CAMPFIRE_WORLD_X, hz = seat.z - CAMPFIRE_WORLD_Z
	real(`  seed ${seed}: cell (${seat.cx},${seat.cz}) lava centre ~${c ? (Math.hypot(seat.cx + 0.5 - c.fx, seat.cz + 0.5 - c.fz) * TERRAIN_CELL_M).toFixed(0) : '?'} m ${c ? dirOf(seat.cx + 0.5 - c.fx, seat.cz + 0.5 - c.fz) : ''} of crater, nearest lava ${lavaMin.toFixed(0)} m | hearth ${Math.hypot(hx, hz).toFixed(0)} m ${dirOf(hx, hz)} of hearth | ${errs.length ? 'FAIL ' + errs.join(',') : 'ok'}`)
}
real(`  ${bad === 0 ? 'ALL PASS' : bad + ' FAIL'}`)
