/**
 * volcanoTerraceCheck entry - bundled by scripts/volcanoTerraceCheck.mjs.
 * Per seed: summit (lava-adjacent rim) reachable, a ladder on every
 * volcano step, terrace cells reachable, generator retries / give-ups,
 * footprint radius, and summit / plume heights vs the scene limit.
 */
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { generateTerrain, terrainPieceStats, mergeLevelRects } from 'src/shared/terrain/terrainGen'
import { pickSummitMapSeat } from 'src/shared/terrain/summitMapSeat'
import { isFloatingCrystals } from 'src/shared/ruleset'
import { LANDFORM_VOLCANO, LANDFORM_LAVA, groundFlatWithin, groundYAtWorld, cellCenterWorld } from 'src/shared/terrain/terrainMap'
import { pickHiddenCampfires, HIDDEN_CAMPFIRE_COUNT } from 'src/shared/hiddenCampfire'
import {
	TERRAIN_LEVEL_MID, TERRAIN_LEVEL_VOLCANO_RIM, TERRAIN_LEVEL_CROWN_MAX, TERRAIN_LEVEL_HIGH,
	TERRAIN_CELL_M, groundYForLevel, isMountainLevel, isVolcanoTerraceLevel, sceneHeightLimitM,
} from 'src/shared/settings'
const g: any = globalThis; g.__real ??= console.log; const real = g.__real
let giveUps = 0
console.log = (...a: any[]) => { if (String(a[0]).includes('generateTerrain: seed')) giveUps++ }
const P = g.__P, N = g.__N
const DX = [0, 1, 0, -1], DZ = [1, 0, -1, 0]
let fireOk = 0, fireLadderMinM = Infinity, fireOver = 0
const fireLv: Record<number, number> = {}
let piecesSum = 0, piecesMax = 0, seatBad = 0, farLift: Record<number, number> = {}
let bad = 0, sumMs = 0, maxMs = 0, sumAtt = 0, missingStep = 0, terrUnreach = 0, terrTotal = 0
const radii: number[] = []
for (let s = 0; s < N; s++) {
	const t0 = Date.now()
	const m = generateTerrain(cycleMazeSeed(s))
	const ms = Date.now() - t0; sumMs += ms; maxMs = Math.max(maxMs, ms); sumAtt += m.attempts
	const W = m.w
	const pc = mergeLevelRects(m).length; piecesSum += pc; piecesMax = Math.max(piecesMax, pc)
	const seat = pickSummitMapSeat(m)
	if (!seat || (isFloatingCrystals() ? m.levels[seat.cz * W + seat.cx] !== TERRAIN_LEVEL_VOLCANO_RIM : m.landforms[seat.cz * W + seat.cx] !== LANDFORM_LAVA) || m.routeDist[seat.cz * W + seat.cx] < 0 || !(m.ladders.some(l => m.levels[l.highCz * W + l.highCx] === TERRAIN_LEVEL_VOLCANO_RIM && m.landforms[l.highCz * W + l.highCx] !== LANDFORM_LAVA ? true : m.landforms[l.highCz * W + l.highCx] === LANDFORM_LAVA))) { seatBad++; real('  seed', s, 'summit seat', JSON.stringify(seat)) }
	for (const st of m.stations) if (!st.near) farLift[st.beamLiftM ?? -1] = (farLift[st.beamLiftM ?? -1] ?? 0) + 1
	if (!m.volcano) { bad++; real('  seed', s, 'no volcano'); continue }
	let summit = false, lx = 0, lz = 0, ln = 0
	for (let i = 0; i < W * m.h; i++) {
		if (m.landforms[i] === LANDFORM_LAVA) { lx += i % W; lz += Math.floor(i / W); ln++ }
		if (m.landforms[i] !== LANDFORM_LAVA && m.routeDist[i] >= 0 && m.levels[i] === TERRAIN_LEVEL_VOLCANO_RIM) {
			const x = i % W, z = (i - x) / W
			for (let d = 0; d < 4; d++) { const j = (z + DZ[d]) * W + x + DX[d]; if (m.landforms[j] === LANDFORM_LAVA) summit = true }
		}
	}
	if (!summit) { bad++; real('  seed', s, 'summit unreachable') }
	for (let low = TERRAIN_LEVEL_MID; low < TERRAIN_LEVEL_VOLCANO_RIM; low++) {
		const has = m.ladders.some(l => l.lowLevel === low && m.landforms[l.highCz * W + l.highCx] === LANDFORM_VOLCANO)
		if (!has && low >= TERRAIN_LEVEL_HIGH) { missingStep++; real('  seed', s, 'no volcano ladder', low, '->', low + 1) }
	}
	let r = 0
	const cx0 = ln ? lx / ln + 0.5 : m.volcano.cx + 0.5, cz0 = ln ? lz / ln + 0.5 : m.volcano.cz + 0.5
	for (let i = 0; i < W * m.h; i++) {
		const lv = m.levels[i]
		if (isVolcanoTerraceLevel(lv) && m.landforms[i] === LANDFORM_VOLCANO) { terrTotal++; if (m.routeDist[i] < 0) terrUnreach++ }
		if ((m.landforms[i] === LANDFORM_VOLCANO || m.landforms[i] === LANDFORM_LAVA) && !isMountainLevel(lv) && lv >= TERRAIN_LEVEL_HIGH) {
			r = Math.max(r, Math.hypot(i % W + 0.5 - cx0, Math.floor(i / W) + 0.5 - cz0))
		}
	}
	radii.push(r * TERRAIN_CELL_M)
	// Volcano terrace campfire (placed first => picks[0]).
	const pits = pickHiddenCampfires(s)
	if (pits.length > HIDDEN_CAMPFIRE_COUNT) fireOver++
	const p = pits[0]
	const pi = p ? p.tz * W + p.tx : -1
	if (p && isVolcanoTerraceLevel(m.levels[pi]) && m.landforms[pi] === LANDFORM_VOLCANO && m.routeDist[pi] >= 0 &&
		groundFlatWithin(m, p.x, p.z, 1.5) && Math.abs(p.y - groundYAtWorld(m, p.x, p.z)) < 0.01) {
		fireOk++
		fireLv[m.levels[pi]] = (fireLv[m.levels[pi]] ?? 0) + 1
		for (const l of m.ladders) for (const [cx, cz] of [[l.lowCx, l.lowCz], [l.highCx, l.highCz]]) {
			const c = cellCenterWorld(cx, cz)
			fireLadderMinM = Math.min(fireLadderMinM, Math.hypot(c.x - p.x, c.z - p.z))
		}
	} else real('  seed', s, 'no valid volcano terrace campfire', JSON.stringify(p))
}
radii.sort((a, b) => a - b)
const q = (p: number) => radii[Math.min(radii.length - 1, Math.floor(p * radii.length))].toFixed(0)
const rimY = groundYForLevel(TERRAIN_LEVEL_VOLCANO_RIM), crownY = groundYForLevel(TERRAIN_LEVEL_CROWN_MAX)
real(`${P} seeds ${N} bad ${bad} giveUps ${giveUps} missingStepLadders ${missingStep} terraceCellsUnreachable ${terrUnreach}/${terrTotal}`)
real(`${P} gen ms avg ${(sumMs / N).toFixed(1)} max ${maxMs} attempts avg ${(sumAtt / N).toFixed(2)}`)
real(`${P} High+ cone radius m p10 ${q(0.1)} p50 ${q(0.5)} p90 ${q(0.9)} max ${q(0.999)}`)
real(`${P} terrace campfire ok ${fireOk}/${N} by level ${JSON.stringify(fireLv)} min dist to ladder cell centre ${fireLadderMinM.toFixed(0)} m overBudget ${fireOver}`)
real(`${P} terrain slab rects (entities) avg ${(piecesSum / N).toFixed(0)} max ${piecesMax} | seat not on reachable crater floor / no rim ladder ${seatBad} | far-station beam lift hist ${JSON.stringify(farLift)}`)
real(`${P} rimY ${rimY.toFixed(2)} crownTopY ${crownY.toFixed(2)} sceneLimit ${sceneHeightLimitM().toFixed(1)}`)


