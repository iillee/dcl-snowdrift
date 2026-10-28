/**
 * finaleCheck - the floating-crystals ending ("Level Thaws", src/shared/finale.ts) per seed:
 *  - ring topology: deterministic (same layout -> same ring, also from a copied point list and for every start monument),
 *    one closed counter-clockwise cycle through every monument, no crossing beams, edges through the volcano disc counted;
 *  - corridor: the server's stepper (corridorStep) run on a 125 ms tick with the real per-edge timeline covers every cell
 *    inside the corridors, nothing outside them, never gets ahead of its front, ends fully melted, and the sliced ticks
 *    equal one full sweep (no gaps); snow tiles touched (and how many are new vs the 50 m crystal discs) are counted;
 *  - timeline: beams one after another, thaw only after every beam is connected (and in the same order), title after the
 *    thaw, a late joiner (age past the end) sees every beam complete, the whole shot fits its cap;
 *  - hydration: server (corridors) and client (beams) derive the same ring from the same layout + first monument;
 *  - camera: the chase / pull-out camera stays under the ceiling, is continuous (per-frame jump bounded) and the end pose
 *    stays under the ceiling.
 * Bundled by scripts/finaleCheck.mjs.
 */
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { crystalFloatBottomY } from 'src/shared/crystalFloat'
import {
	CorridorFront, FINALE_CORRIDOR_HALF_W_M, FINALE_CORRIDOR_WOBBLE_M, FINALE_START_DELAY_S,
	corridorFrontS, corridorStep, finaleAvoidZone, finaleBeamProgress, finaleCameraAt, finaleCameraPose, finaleCycleCost, finaleEdgeLengths,
	finaleEdges, finaleOrder, finalePoints, finaleRingPoint, finaleTimes, finaleTravelS,
} from 'src/shared/finale'
import { CRYSTAL_HEAT_RADIUS_M } from 'src/shared/ruleset'
import { SNOW_CELL_M, SNOW_TILE_M, SNOW_ORIGIN_M, tileKeyOfCell, worldToCellKey } from 'src/shared/snowGrid'
import { WORLD_PROFILE, sceneHeightLimitM } from 'src/shared/settings'
import { getTerrain } from 'src/shared/terrain/terrainCache'
import { groundYAtWorld } from 'src/shared/terrain/terrainMap'

const SEEDS = Number(process.argv[2] ?? 12)
const g0 = globalThis as { __realLog?: typeof console.log }
g0.__realLog ??= console.log
const say = g0.__realLog
console.log = () => {}
let bad = 0
const fail = (m: string): void => { bad++; if (bad <= 40) say('FAIL ' + m) }

const OB_TOTAL_M = 22 // obelisk length (stationMarkers OB_SHAFT_M 14 + 2 * OB_TIP_M 4)
const CAM_CAP_S = 60 // crystalFinale CINE_CAP_S

function segDistS(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { d: number; s: number; len: number } {
	const dx = bx - ax, dz = bz - az
	const len = Math.hypot(dx, dz)
	const s = ((px - ax) * dx + (pz - az) * dz) / len
	const sc = Math.max(0, Math.min(len, s))
	return { d: Math.hypot(px - (ax + (dx / len) * sc), pz - (az + (dz / len) * sc)), s, len }
}

let rings = 0, volcanoHits = 0, volcanoHitsUnavoidable = 0, ringLenSum = 0, edgeMax = 0, edgeMin = Infinity
let cellsSum = 0, tilesSum = 0, tilesMax = 0, newTilesSum = 0, newTilesMax = 0
let beamS = 0, thawS = 0, cineS = 0, camSpeedMax = 0, camJumpMax = 0, lookSpeedMax = 0, endFits = 0, endPoses = 0
const maxH = sceneHeightLimitM() - 3
for (let s = 0; s < SEEDS; s++) {
	const seed = ((s + 1) * 2654435761) >>> 0
	const map = getTerrain(cycleMazeSeed(seed))
	const pts = finalePoints(map)
	const n = pts.length
	if (n < 3) { fail(`seed ${s}: only ${n} monuments`); continue }
	const avoid = finaleAvoidZone(map)

	// --- topology ---
	const e0 = finaleEdges(pts, avoid, 0)
	const again = finaleEdges(pts.map((p) => ({ x: p.x, z: p.z })), avoid ? { ...avoid } : null, 0)
	if (JSON.stringify(e0) !== JSON.stringify(again)) fail(`seed ${s}: ring not deterministic`)
	if (e0.length !== n) fail(`seed ${s}: ${e0.length} edges for ${n} monuments`)
	const outDeg = new Array<number>(n).fill(0), inDeg = new Array<number>(n).fill(0)
	for (const [a, b] of e0) { outDeg[a]++; inDeg[b]++ }
	if (outDeg.some((v) => v !== 1) || inDeg.some((v) => v !== 1)) fail(`seed ${s}: not a ring`)
	const order = finaleOrder(pts, avoid, 0)
	if (order.length !== n || new Set(order).size !== n) fail(`seed ${s}: ring does not visit every monument once`)
	for (let k = 0; k < n; k++) if (e0[k][0] !== order[k] || e0[k][1] !== order[(k + 1) % n]) fail(`seed ${s}: edges are not in ring order`)
	let area = 0
	for (const [a, b] of e0) area += pts[a].x * pts[b].z - pts[b].x * pts[a].z
	if (!(area > 0)) fail(`seed ${s}: ring not counter-clockwise (area ${area.toFixed(0)})`)
	const und = (e: Array<[number, number]>): string => e.map(([a, b]) => (a < b ? `${a}-${b}` : `${b}-${a}`)).sort().join(' ')
	for (let first = 0; first < n; first++) {
		const ef = finaleEdges(pts, avoid, first)
		if (ef[0][0] !== first) fail(`seed ${s}: ring from ${first} starts at ${ef[0][0]}`)
		if (und(ef) !== und(e0)) fail(`seed ${s}: ring edge set depends on the start monument (${first})`)
	}
	if (finaleCycleCost(order, pts, avoid) >= 1e6) fail(`seed ${s}: ring has crossing beams`)
	let hits = 0
	for (const [a, b] of e0) {
		const len = Math.hypot(pts[b].x - pts[a].x, pts[b].z - pts[a].z)
		ringLenSum += len; edgeMax = Math.max(edgeMax, len); edgeMin = Math.min(edgeMin, len)
		if (avoid && segDistS(avoid.x, avoid.z, pts[a].x, pts[a].z, pts[b].x, pts[b].z).d < avoid.r) hits++
	}
	rings++
	volcanoHits += hits
	if (hits > 0) {
		const free = finaleOrder(pts, null, 0)
		let freeHits = 0
		for (let k = 0; k < n; k++) { const a = free[k], b = free[(k + 1) % n]; if (avoid && segDistS(avoid.x, avoid.z, pts[a].x, pts[a].z, pts[b].x, pts[b].z).d < avoid.r) freeHits++ }
		if (freeHits > 0) volcanoHitsUnavoidable++
	}

	// --- timeline ---
	const lengths = finaleEdgeLengths(pts, e0)
	const times = finaleTimes(lengths)
	beamS += times.beamsDoneS; thawS += times.thawEndS - times.thawBeginS; cineS += times.cineEndS
	for (let k = 0; k < n; k++) {
		if (k > 0 && Math.abs(times.beamStartS[k] - (times.beamStartS[k - 1] + times.beamDurS[k - 1])) > 1e-6) fail('beams do not run one after another')
		if (k > 0 && Math.abs(times.thawStartS[k] - (times.thawStartS[k - 1] + lengths[k - 1] / times.thawSpeed)) > 1e-6) fail('thaw fronts are not in beam order')
		if (!(times.thawStartS[k] >= times.beamsDoneS)) fail('thaw starts before every beam is connected')
		if (finaleBeamProgress(times, k, times.cineEndS + 600) !== 1) fail('late joiner does not see beam ' + k + ' complete')
		if (finaleBeamProgress(times, k, -1) !== 0) fail('beam drawn before the start')
		let prev = 0
		for (let a = 0; a < times.beamsDoneS + 2; a += 0.25) { const p = finaleBeamProgress(times, k, a); if (p < prev) fail('beam progress not monotonic'); prev = p }
	}
	if (!(times.textAtS >= times.thawEndS)) fail('title shows before the thaw ends')
	if (!(times.cineEndS < CAM_CAP_S)) fail(`shot ${times.cineEndS.toFixed(1)} s over the ${CAM_CAP_S} s cap`)
	if (Math.abs(finaleTravelS(times, times.beamsDoneS) - times.total) > 1e-6) fail('beam traveller does not end at the ring length')
	if (Math.abs(finaleTravelS(times, times.thawEndS) - times.total) > 1e-6) fail('thaw traveller does not end at the ring length')

	// --- corridor: tick like the server (125 ms) over the whole thaw, per-edge timeline ---
	const T0 = 1_000_000_000_000
	const fronts: CorridorFront[] = e0.map(([a, b], k) => ({
		ax: pts[a].x, az: pts[a].z, bx: pts[b].x, bz: pts[b].z, edge: k, len: lengths[k],
		startMs: T0 + times.thawStartS[k] * 1000, durMs: times.thawDurS[k] * 1000, doneS: 0,
	}))
	const stage = new Map<number, number>()
	let ahead = 0
	const live = new Set(fronts.map((_, i) => i))
	for (let t = T0; t <= T0 + times.thawEndS * 1000 + 500 && live.size > 0; t += 125) {
		for (const i of [...live]) {
			const f = fronts[i]
			const sfNow = corridorFrontS(f.len, Math.max(0, Math.min(1, (t - f.startMs) / f.durMs)))
			const done = corridorStep(f, t, (x, z, st) => {
				const key = worldToCellKey(x, z)
				if (key === null) return
				const prev = stage.get(key)
				if (prev === undefined || st < prev) stage.set(key, st)
				if (t < f.startMs + f.durMs && segDistS(x, z, f.ax, f.az, f.bx, f.bz).s > sfNow + 1e-6) ahead++
			})
			if (done) live.delete(i)
		}
	}
	if (live.size > 0) fail(`seed ${s}: ${live.size} corridor fronts never finished`)
	if (ahead > 0) fail(`seed ${s}: ${ahead} cells melted ahead of the front`)
	let notZero = 0
	for (const v of stage.values()) if (v !== 0) notZero++
	if (notZero > 0) fail(`seed ${s}: ${notZero} corridor cells did not end fully melted`)
	let missing = 0, inside = 0, stray = 0
	const innerHW = FINALE_CORRIDOR_HALF_W_M - FINALE_CORRIDOR_WOBBLE_M - SNOW_CELL_M * Math.SQRT1_2
	for (const f of fronts) {
		const x0 = Math.min(f.ax, f.bx) - 8, x1 = Math.max(f.ax, f.bx) + 8, z0 = Math.min(f.az, f.bz) - 8, z1 = Math.max(f.az, f.bz) + 8
		for (let z = Math.floor(z0); z <= z1; z += SNOW_CELL_M) for (let x = Math.floor(x0); x <= x1; x += SNOW_CELL_M) {
			const cx = x + SNOW_CELL_M / 2, cz = z + SNOW_CELL_M / 2
			const key = worldToCellKey(cx, cz)
			if (key === null) continue
			const q = segDistS(cx, cz, f.ax, f.az, f.bx, f.bz)
			if (q.s >= 0 && q.s <= q.len && q.d <= innerHW) { inside++; if (stage.get(key) !== 0) missing++ }
		}
	}
	const full = new Set<number>()
	const outerHW = FINALE_CORRIDOR_HALF_W_M + FINALE_CORRIDOR_WOBBLE_M
	for (const f of fronts) {
		const probe: CorridorFront = { ...f, doneS: 0, startMs: 0, durMs: 1 }
		corridorStep(probe, 1_000_000, (x, z) => {
			const q = segDistS(x, z, f.ax, f.az, f.bx, f.bz)
			if (q.d > outerHW + 1e-6 || q.s < -1e-6 || q.s > q.len + 1e-6) stray++
			const k = worldToCellKey(x, z)
			if (k !== null) full.add(k)
		})
	}
	if (missing > 0) fail(`seed ${s}: ${missing} / ${inside} cells inside the corridors stayed snowy`)
	if (stray > 0) fail(`seed ${s}: ${stray} corridor samples outside the corridor width`)
	let diff = 0
	for (const k of full) if (!stage.has(k)) diff++
	for (const k of stage.keys()) if (!full.has(k)) diff++
	if (diff > 0) fail(`seed ${s}: ticked corridor differs from the full sweep in ${diff} cells`)
	cellsSum += stage.size
	const tiles = new Set<number>()
	for (const key of stage.keys()) tiles.add(tileKeyOfCell(key))
	tilesSum += tiles.size; tilesMax = Math.max(tilesMax, tiles.size)
	// tiles NOT already touched by the 50 m crystal discs (those snow tile entities exist anyway): tile centre farther than R + half a diagonal from every monument
	let fresh = 0
	// count distinct tiles whose centre is farther than disc reach from all monuments
	{
		const tx = (x: number): number => Math.floor((x - SNOW_ORIGIN_M) / SNOW_TILE_M)
		const byTile = new Map<number, [number, number]>()
		for (const f of fronts) {
			const probe: CorridorFront = { ...f, doneS: 0, startMs: 0, durMs: 1 }
			corridorStep(probe, 1_000_000, (x, z) => {
				const key = tx(x) * 100000 + tx(z)
				if (!byTile.has(key)) byTile.set(key, [SNOW_ORIGIN_M + (tx(x) + 0.5) * SNOW_TILE_M, SNOW_ORIGIN_M + (tx(z) + 0.5) * SNOW_TILE_M])
			})
		}
		for (const [cx, cz] of byTile.values()) {
			let near = false
			for (const p of pts) if (Math.hypot(cx - p.x, cz - p.z) <= CRYSTAL_HEAT_RADIUS_M - SNOW_TILE_M * Math.SQRT1_2) { near = true; break }
			if (!near) fresh++
		}
	}
	newTilesSum += fresh; newTilesMax = Math.max(newTilesMax, fresh)

	// --- camera ---
	const floatY = crystalFloatBottomY(map)
	const tipY = floatY + OB_TOTAL_M - 0.4
	const tips = pts.map((p) => ({ x: p.x, y: tipY, z: p.z }))
	const grounds = pts.map((p) => ({ x: p.x, y: groundYAtWorld(map, p.x, p.z), z: p.z }))
	const look = { x: tips.reduce((a, p) => a + p.x, 0) / n, y: grounds.reduce((a, p) => a + p.y, 0) / n, z: tips.reduce((a, p) => a + p.z, 0) / n }
	const gy = (x: number, z: number): number => groundYAtWorld(map, x, z)
	for (const aspect of [1.0, 16 / 9, 2.4]) {
		const wide = finaleCameraPose([...tips, ...grounds], look, aspect, maxH)
		endPoses++
		if (wide.fits) endFits++
		if (wide.cam.y > maxH + 1e-6) fail(`seed ${s} aspect ${aspect.toFixed(2)}: end camera ${wide.cam.y.toFixed(0)} m above the ceiling ${maxH.toFixed(0)}`)
		let prev = finaleCameraAt(pts, e0, times, 0, gy, tipY, maxH, wide)
		const dt = 1 / 60
		for (let a = dt; a <= times.cineEndS; a += dt) {
			const c = finaleCameraAt(pts, e0, times, a, gy, tipY, maxH, wide)
			const vals = [c.pos.x, c.pos.y, c.pos.z, c.look.x, c.look.y, c.look.z]
			if (vals.some((v) => !Number.isFinite(v))) { fail(`seed ${s}: camera not finite at ${a.toFixed(2)} s`); break }
			if (c.pos.y > maxH + 1e-6) { fail(`seed ${s}: chase camera above the ceiling at ${a.toFixed(2)} s`); break }
			const jump = Math.hypot(c.pos.x - prev.pos.x, c.pos.y - prev.pos.y, c.pos.z - prev.pos.z)
			camJumpMax = Math.max(camJumpMax, jump)
			camSpeedMax = Math.max(camSpeedMax, jump / dt)
			const ls = Math.hypot(c.look.x - prev.look.x, c.look.y - prev.look.y, c.look.z - prev.look.z) / dt
			lookSpeedMax = Math.max(lookSpeedMax, ls)
			prev = c
		}
		if (aspect === 16 / 9) {
			// the head is on the ring and the look is at the head
			const p = finaleRingPoint(pts, e0, times, finaleTravelS(times, times.beamsDoneS / 2))
			const c = finaleCameraAt(pts, e0, times, times.beamsDoneS / 2, gy, tipY, maxH, wide)
			if (Math.hypot(c.look.x - p.x, c.look.z - p.z) > 1e-6) fail('look is not on the traveller head')
		}
	}
}
if (camJumpMax > 8) fail(`camera moves ${camJumpMax.toFixed(1)} m in one 60 fps frame (> 8 m)`)
if (lookSpeedMax > 600) fail(`look point moves ${(lookSpeedMax / 60).toFixed(1)} m in one 60 fps frame (> 10 m)`)

say(
	`[${WORLD_PROFILE}] finaleCheck seeds=${SEEDS} rings=${rings} avgRing=${(ringLenSum / Math.max(1, rings)).toFixed(0)} m edges ${edgeMin.toFixed(0)}..${edgeMax.toFixed(0)} m ` +
	`volcano-disc edge hits ${volcanoHits} (${volcanoHitsUnavoidable} layouts unavoidable) | avg beams ${(beamS / Math.max(1, rings)).toFixed(1)} s thaw ${(thawS / Math.max(1, rings)).toFixed(1)} s shot ${(cineS / Math.max(1, rings)).toFixed(1)} s ` +
	`(start +${FINALE_START_DELAY_S}s) | corridor cells/seed ${(cellsSum / Math.max(1, rings)).toFixed(0)}, snow tiles/seed avg ${(tilesSum / Math.max(1, rings)).toFixed(0)} max ${tilesMax}, ` +
	`beyond the 50 m discs avg ${(newTilesSum / Math.max(1, rings)).toFixed(0)} max ${newTilesMax} | camera max ${camSpeedMax.toFixed(0)} m/s (${camJumpMax.toFixed(1)} m/frame), look ${lookSpeedMax.toFixed(0)} m/s, end pose fits ${endFits}/${endPoses}`,
)
say(bad === 0 ? 'finaleCheck: OK' : `finaleCheck: ${bad} FAILURES`)
if (bad) process.exitCode = 1
