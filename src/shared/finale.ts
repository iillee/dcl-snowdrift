/**
 * finale.ts - the floating-crystals ENDING ("Level Thaws"), pure + shared by server and client.
 *
 * When the LAST monument is released, beams link the top tips of every monument (a closed ring), then the snow
 * under each beam thaws (a permanent heat corridor along the beam's ground projection), then the title card shows.
 * Everything is a function of the server's start time + the (deterministic) monument layout, so the server melts the
 * snow, every client draws the same beams and a late joiner lands on the finished state.
 *
 * The ring is long (a 52-parcel world: ~2 km, beams up to ~600 m), far more than one frame can show, so the whole
 * sequence is ONE traveller running along the ring and the cinematic camera follows its head:
 * Timeline (s since the finale start; the start is FINALE_START_DELAY_S after the last release so the release
 * cinematic finishes first):
 *   beams draw     one after another at a constant speed (total FINALE_BEAM_MIN_S..MAX_S), from the last-released
 *                  monument round the ring; they stay
 *   snow thaws     FINALE_THAW_GAP_S after the last beam lands: a front runs along the ground under the beams in the
 *                  same order at a constant speed (FINALE_THAW_MIN_S..MAX_S); thawed snow stays thawed
 *   title          FINALE_TEXT_GAP_S after the thaw ends
 *   camera         follows the head, then pulls out high over the network; hands back FINALE_CINE_AFTER_TEXT_S after the title
 */

import { TerrainMap, cellCenterWorld } from 'src/shared/terrain/terrainMap'

// MARK: Tuning
/** Finale start after the last monument's release (s): its own release cinematic (hold 2 + rise 4 + charge 2 + burst 3 + hold 2 + blend-out 1) is over by then. */
export const FINALE_START_DELAY_S = 14.5
/** Start delay for the debug trigger (no release cinematic to wait for). */
export const FINALE_DEBUG_DELAY_S = 3
/** Beams shoot round the ring at this speed (m/s), total time clamped to MIN..MAX s (so a short ring is not a blink, a huge one not endless). */
export const FINALE_BEAM_SPEED_MPS = 260
export const FINALE_BEAM_MIN_S = 5
export const FINALE_BEAM_MAX_S = 10
export const FINALE_THAW_GAP_S = 0.6
/** The thaw front runs the ring at this speed (m/s), total time clamped to MIN..MAX s. */
export const FINALE_THAW_SPEED_MPS = 200
export const FINALE_THAW_MIN_S = 7
export const FINALE_THAW_MAX_S = 12
export const FINALE_TEXT_GAP_S = 0.5
export const FINALE_CINE_AFTER_TEXT_S = 3.5
/** Title card length: thawSplash FADE_S 0.8 + HOLD_S 3 + FADE_S 0.8. */
export const FINALE_TEXT_TOTAL_S = 4.6
export const FINALE_TITLE = 'WORLD THAWS'
/** Corridor half width (m) around the beam's ground projection (~10 m wide) and the edge wobble amplitude (m). */
export const FINALE_CORRIDOR_HALF_W_M = 5
export const FINALE_CORRIDOR_WOBBLE_M = 0.8
/** Trailing band behind the front where snow steps 2 -> 1 -> 0 (m); the front runs this far past the end so the last cells finish. */
export const FINALE_THAW_BAND_M = 3
/** Sample spacing along / across the corridor (m); snow cells are 1 m, so 0.5 m never leaves a gap. */
export const FINALE_SAMPLE_M = 0.5
/** Beam thickness (m); thicker than the monument beams (0.5) because the finale is seen from high above. */
export const FINALE_BEAM_XZ_M = 1.0
/** Cinematic framing: vertical FOV (deg), letterbox bar fraction (each), fraction of the half-frame kept clear. */
export const FINALE_FOV_DEG = 60
export const FINALE_BAR_FRAC = 0.12
export const FINALE_FRAME_FILL = 0.8


export interface FinalePoint { x: number; z: number }
export type FinaleEdge = [number, number]
export interface FinaleAvoid { x: number; z: number; r: number }

// MARK: Layout
/** World XZ of every monument socket, station order. */
export function finalePoints(map: TerrainMap): FinalePoint[] {
	return map.stations.map((st) => cellCenterWorld(st.cx, st.cz))
}

/** The volcano's keep-clear disc (beams / corridors avoid crossing it when a good alternative exists), or null. */
export function finaleAvoidZone(map: TerrainMap): FinaleAvoid | null {
	const v = map.volcano
	if (!v) return null
	const c = cellCenterWorld(v.cx, v.cz)
	const r = Math.min(70, Math.max(32, Math.sqrt(Math.max(1, v.area) / Math.PI) * 16))
	return { x: c.x, z: c.z, r }
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
	const dx = bx - ax, dz = bz - az
	const l2 = dx * dx + dz * dz
	const u = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0
	return Math.hypot(px - (ax + dx * u), pz - (az + dz * u))
}

function orient(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
	return (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
}

/** Proper crossing of segments ab and cd (shared endpoints do not count). */
function segsCross(a: FinalePoint, b: FinalePoint, c: FinalePoint, d: FinalePoint): boolean {
	const o1 = orient(a.x, a.z, b.x, b.z, c.x, c.z), o2 = orient(a.x, a.z, b.x, b.z, d.x, d.z)
	const o3 = orient(c.x, c.z, d.x, d.z, a.x, a.z), o4 = orient(c.x, c.z, d.x, d.z, b.x, b.z)
	return o1 * o2 < 0 && o3 * o4 < 0
}

const CROSS_PENALTY = 1e6
const AVOID_PENALTY = 1e5
/** Brute-force tour search up to this many monuments (7! = 5040 orders); the angular ring above it. */
const FINALE_BRUTE_MAX = 8

/** Total length of the closed ring `order` plus the penalties (crossing edges, edges through the avoid disc). */
export function finaleCycleCost(order: number[], pts: FinalePoint[], avoid: FinaleAvoid | null): number {
	const n = order.length
	let cost = 0
	for (let i = 0; i < n; i++) {
		const a = pts[order[i]], b = pts[order[(i + 1) % n]]
		cost += Math.hypot(b.x - a.x, b.z - a.z)
		if (avoid && segDist(avoid.x, avoid.z, a.x, a.z, b.x, b.z) < avoid.r) cost += AVOID_PENALTY
	}
	for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
		if (i === 0 && j === n - 1) continue // adjacent through the closing edge
		if (segsCross(pts[order[i]], pts[order[(i + 1) % n]], pts[order[j]], pts[order[(j + 1) % n]])) cost += CROSS_PENALTY
	}
	return cost
}

function signedArea(order: number[], pts: FinalePoint[]): number {
	let s = 0
	for (let i = 0; i < order.length; i++) {
		const a = pts[order[i]], b = pts[order[(i + 1) % order.length]]
		s += a.x * b.z - b.x * a.z
	}
	return s / 2
}

/**
 * Closed ring through every monument, starting at `first` and running counter-clockwise (x right, z up). It is the
 * shortest tour (no self-crossing, and no edge through the `avoid` disc when any alternative exists) for up to
 * FINALE_BRUTE_MAX monuments, else the angular order around the centroid. Deterministic: same points, same ring.
 */
export function finaleOrder(pts: FinalePoint[], avoid: FinaleAvoid | null, first = 0): number[] {
	const n = pts.length
	if (n <= 0) return []
	let best: number[]
	if (n <= 3) best = pts.map((_, i) => i)
	else if (n <= FINALE_BRUTE_MAX) {
		best = pts.map((_, i) => i)
		let bestCost = Infinity
		const cur = [0]
		const used = new Array<boolean>(n).fill(false)
		used[0] = true
		const rec = (): void => {
			if (cur.length === n) {
				const c = finaleCycleCost(cur, pts, avoid)
				if (c < bestCost - 1e-9) { bestCost = c; best = cur.slice() }
				return
			}
			for (let i = 1; i < n; i++) {
				if (used[i]) continue
				used[i] = true; cur.push(i)
				rec()
				cur.pop(); used[i] = false
			}
		}
		rec()
	} else {
		let cx = 0, cz = 0
		for (const p of pts) { cx += p.x; cz += p.z }
		cx /= n; cz /= n
		best = pts.map((_, i) => i).sort((a, b) => Math.atan2(pts[a].z - cz, pts[a].x - cx) - Math.atan2(pts[b].z - cz, pts[b].x - cx) || a - b)
	}
	if (n > 2 && signedArea(best, pts) < 0) best = [best[0], ...best.slice(1).reverse()]
	const k = Math.max(0, best.indexOf(Math.max(0, Math.min(n - 1, first))))
	return [...best.slice(k), ...best.slice(0, k)]
}

/** Beam edges in draw order along the ring from `first` (a, b = monument indices; the corridor's front runs a -> b). */
export function finaleEdges(pts: FinalePoint[], avoid: FinaleAvoid | null, first = 0): FinaleEdge[] {
	const order = finaleOrder(pts, avoid, first)
	const n = order.length
	if (n < 2) return []
	if (n === 2) return [[order[0], order[1]]]
	const out: FinaleEdge[] = []
	for (let i = 0; i < n; i++) out.push([order[i], order[(i + 1) % n]])
	return out
}

// MARK: Timeline
/** Horizontal length (m) of every ring edge (the timeline is on ground distance so server and client agree exactly). */
export function finaleEdgeLengths(pts: FinalePoint[], edges: FinaleEdge[]): number[] {
	return edges.map(([a, b]) => Math.hypot(pts[b].x - pts[a].x, pts[b].z - pts[a].z))
}

export interface FinaleTimes {
	lengths: number[]
	/** Ring length (m). */
	total: number
	/** Beam travel speed (m/s) and the thaw front speed (m/s) after the clamps. */
	beamSpeed: number
	thawSpeed: number
	/** Per edge: when its beam starts / how long it draws (s since the finale start). */
	beamStartS: number[]
	beamDurS: number[]
	beamsDoneS: number
	/** Per edge: when its thaw front starts / how long it runs (includes the trailing band). */
	thawStartS: number[]
	thawDurS: number[]
	/** First thaw front start, last thaw front end. */
	thawBeginS: number
	thawEndS: number
	textAtS: number
	cineEndS: number
}

export function finaleTimes(lengths: number[]): FinaleTimes {
	const n = lengths.length
	let total = 0
	for (const l of lengths) total += l
	const beamTotalS = Math.max(FINALE_BEAM_MIN_S, Math.min(FINALE_BEAM_MAX_S, total / FINALE_BEAM_SPEED_MPS))
	const beamSpeed = total > 0 ? total / beamTotalS : 1
	const beamStartS: number[] = [], beamDurS: number[] = []
	let acc = 0
	for (let k = 0; k < n; k++) {
		beamStartS.push(acc / beamSpeed)
		beamDurS.push(lengths[k] / beamSpeed)
		acc += lengths[k]
	}
	const beamsDoneS = n > 0 ? beamTotalS : 0
	const thawBeginS = beamsDoneS + FINALE_THAW_GAP_S
	const thawTotalS = Math.max(FINALE_THAW_MIN_S, Math.min(FINALE_THAW_MAX_S, total / FINALE_THAW_SPEED_MPS))
	const thawSpeed = total > 0 ? total / thawTotalS : 1
	const thawStartS: number[] = [], thawDurS: number[] = []
	acc = 0
	for (let k = 0; k < n; k++) {
		thawStartS.push(thawBeginS + acc / thawSpeed)
		thawDurS.push((lengths[k] + FINALE_THAW_BAND_M) / thawSpeed)
		acc += lengths[k]
	}
	const thawEndS = n > 0 ? thawStartS[n - 1] + thawDurS[n - 1] : thawBeginS
	const textAtS = thawEndS + FINALE_TEXT_GAP_S
	return {
		lengths, total, beamSpeed, thawSpeed, beamStartS, beamDurS, beamsDoneS, thawStartS, thawDurS, thawBeginS, thawEndS,
		textAtS, cineEndS: textAtS + FINALE_CINE_AFTER_TEXT_S,
	}
}

/** Beam k draw progress 0..1 at `ageS` since the finale start. */
export function finaleBeamProgress(times: FinaleTimes, k: number, ageS: number): number {
	return Math.max(0, Math.min(1, (ageS - times.beamStartS[k]) / times.beamDurS[k]))
}

/** The traveller's distance (m) along the ring (0..total): the beam head while beams draw, then the thaw front. */
export function finaleTravelS(times: FinaleTimes, ageS: number): number {
	if (ageS < times.beamsDoneS) return Math.max(0, ageS) * times.beamSpeed
	if (ageS < times.thawBeginS) return times.total
	return Math.min(times.total, (ageS - times.thawBeginS) * times.thawSpeed)
}

/** Point on the ring at distance s (m, wraps) from the first monument: XZ, the edge it is on and the fraction along it. */
export function finaleRingPoint(pts: FinalePoint[], edges: FinaleEdge[], times: FinaleTimes, s: number): { x: number; z: number; edge: number; frac: number } {
	const n = edges.length
	if (n === 0) return { x: 0, z: 0, edge: 0, frac: 0 }
	let d = times.total > 0 ? s % times.total : 0
	if (d < 0) d += times.total
	for (let k = 0; k < n; k++) {
		const l = times.lengths[k]
		if (d <= l || k === n - 1) {
			const f = l > 0 ? Math.min(1, d / l) : 0
			const a = pts[edges[k][0]], b = pts[edges[k][1]]
			return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, edge: k, frac: f }
		}
		d -= l
	}
	return { x: pts[edges[0][0]].x, z: pts[edges[0][0]].z, edge: 0, frac: 0 }
}

// MARK: Corridor
/** Half width (m) of corridor `edge` at distance s along the beam: a gentle wobble so the cleared strip has a natural edge. */
export function corridorHalfW(edge: number, s: number): number {
	return FINALE_CORRIDOR_HALF_W_M + FINALE_CORRIDOR_WOBBLE_M * Math.sin(s * 0.19 + edge * 1.7)
}

/** Corridor front position (m along the beam, may exceed the length by the band) at progress u 0..1. */
export function corridorFrontS(lenM: number, u: number): number {
	return Math.max(0, Math.min(1, u)) * (lenM + FINALE_THAW_BAND_M)
}

/**
 * Visit every sample point (x, z, s = distance along the beam) of corridor `edge` between s = sLo and sHi (clamped to
 * 0..length), FINALE_SAMPLE_M apart. Pure; the server maps the points to snow cells, the check measures coverage.
 */
export function forEachCorridorSample(
	ax: number, az: number, bx: number, bz: number, edge: number, sLo: number, sHi: number,
	cb: (x: number, z: number, s: number) => void,
): void {
	const len = Math.hypot(bx - ax, bz - az)
	if (len < 1e-6) return
	const dx = (bx - ax) / len, dz = (bz - az) / len
	const px = -dz, pz = dx
	const lo = Math.max(0, sLo), hi = Math.min(len, sHi)
	for (let k = Math.floor(lo / FINALE_SAMPLE_M); k * FINALE_SAMPLE_M <= hi; k++) {
		const s = k * FINALE_SAMPLE_M
		if (s < lo - 1e-9) continue
		const hw = corridorHalfW(edge, s)
		const nl = Math.floor(hw / FINALE_SAMPLE_M)
		for (let j = -nl; j <= nl; j++) {
			const l = j * FINALE_SAMPLE_M
			cb(ax + dx * s + px * l, az + dz * s + pz * l, s)
		}
	}
}

/** One running corridor melt (server state; plain data so the check can drive the same stepper). */
export interface CorridorFront { ax: number; az: number; bx: number; bz: number; edge: number; len: number; startMs: number; durMs: number; doneS: number }

/**
 * Advance corridor front `f` to `nowMs`: visits the sample points the front newly reached with the snow stage they
 * should now be at (2 -> 1 -> 0 over the trailing FINALE_THAW_BAND_M, then 0 = held melted), and on completion a final
 * sweep of the whole corridor at 0. Returns true when finished. Used by snowState (server) and finaleCheck.
 */
export function corridorStep(f: CorridorFront, nowMs: number, cb: (x: number, z: number, stage: 0 | 1 | 2) => void): boolean {
	if (nowMs < f.startMs) return false
	const u = Math.min(1, (nowMs - f.startMs) / f.durMs)
	const sf = corridorFrontS(f.len, u)
	const lo = Math.max(0, f.doneS - FINALE_THAW_BAND_M)
	forEachCorridorSample(f.ax, f.az, f.bx, f.bz, f.edge, lo, Math.min(f.len, sf), (x, z, s) => {
		const lag = sf - s
		cb(x, z, lag >= FINALE_THAW_BAND_M ? 0 : lag >= (2 * FINALE_THAW_BAND_M) / 3 ? 1 : 2)
	})
	f.doneS = sf
	if (u < 1) return false
	forEachCorridorSample(f.ax, f.az, f.bx, f.bz, f.edge, 0, f.len, (x, z) => cb(x, z, 0))
	return true
}

// MARK: Camera
export interface FinaleV3 { x: number; y: number; z: number }
export interface FinalePose {
	cam: FinaleV3
	look: FinaleV3
	/** Horizontal view direction (rad) and pitch below horizontal (deg). */
	bearing: number
	pitchDeg: number
	/** Camera distance from the look point (m). */
	dist: number
	/** True when every framed point is inside the frame (false = best effort under the height ceiling). */
	fits: boolean
}

/** Largest |frame coordinate| over `pts` for a camera at `cam` looking along (bearing, pitch); 1 = at the frame edge. */
export function finaleFrameMetric(pts: FinaleV3[], cam: FinaleV3, bearing: number, pitchRad: number, aspect: number): number {
	const fx = Math.cos(bearing) * Math.cos(pitchRad), fy = -Math.sin(pitchRad), fz = Math.sin(bearing) * Math.cos(pitchRad)
	let rx = -fz, rz = fx
	const rl = Math.hypot(rx, rz) || 1
	rx /= rl; rz /= rl
	// up = right x forward (right has no y component)
	const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy
	const tv = Math.tan((FINALE_FOV_DEG / 2) * Math.PI / 180)
	let worst = 0
	for (const p of pts) {
		const vx = p.x - cam.x, vy = p.y - cam.y, vz = p.z - cam.z
		const depth = vx * fx + vy * fy + vz * fz
		if (depth < 1) return Infinity
		const x = (vx * rx + vz * rz) / (depth * tv * aspect)
		const y = (vx * ux + vy * uy + vz * uz) / (depth * tv) / (1 - 2 * FINALE_BAR_FRAC)
		worst = Math.max(worst, Math.abs(x), Math.abs(y))
	}
	return worst
}

/**
 * High oblique pose that frames every point in `pts` (monument tips + sockets) around `look`: over 12 bearings and 5
 * steep pitches the NEAREST camera that keeps the points inside FINALE_FRAME_FILL of the (letterboxed) frame and under
 * `maxCamH`. If the ceiling blocks every pose it takes the highest steep pose with the smallest overflow. Pure.
 */
export function finaleCameraPose(pts: FinaleV3[], look: FinaleV3, aspect: number, maxCamH: number): FinalePose {
	const pitches = [55, 62, 70, 78, 85]
	let best: FinalePose | null = null
	for (let b = 0; b < 12; b++) {
		const bearing = (b / 12) * Math.PI * 2
		for (const pd of pitches) {
			const pr = pd * Math.PI / 180
			for (let r = 40; r <= 1500; r += 10) {
				const cam = {
					x: look.x - Math.cos(bearing) * Math.cos(pr) * r,
					y: look.y + Math.sin(pr) * r,
					z: look.z - Math.sin(bearing) * Math.cos(pr) * r,
				}
				if (cam.y > maxCamH) break
				if (finaleFrameMetric(pts, cam, bearing, pr, aspect) <= FINALE_FRAME_FILL) {
					if (!best || r < best.dist - 1e-6) best = { cam, look, bearing, pitchDeg: pd, dist: r, fits: true }
					break
				}
			}
		}
	}
	if (best) return best
	// Ceiling-limited: the steepest pitch at the ceiling, bearing with the least overflow.
	const pr = 85 * Math.PI / 180
	const r = Math.max(40, (maxCamH - look.y) / Math.sin(pr))
	let fallback: FinalePose | null = null
	let fm = Infinity
	for (let b = 0; b < 12; b++) {
		const bearing = (b / 12) * Math.PI * 2
		const cam = { x: look.x - Math.cos(bearing) * Math.cos(pr) * r, y: look.y + Math.sin(pr) * r, z: look.z - Math.sin(bearing) * Math.cos(pr) * r }
		const m = finaleFrameMetric(pts, cam, bearing, pr, aspect)
		if (m < fm - 1e-9) { fm = m; fallback = { cam, look, bearing, pitchDeg: 85, dist: r, fits: false } }
	}
	return fallback!
}



// MARK: Chase camera
/** Chase shot: the camera rides this far inside the ring (toward its centroid, m), this high above the ground at the head (m), and averages the ring path over +- this window (m) so it rounds the corners. */
export const FINALE_CHASE_IN_M = 110
export const FINALE_CHASE_H_M = 140
export const FINALE_CHASE_SMOOTH_M = 90
/** The look height averages the terrain over +- this distance along the ring (m). */
export const FINALE_LOOK_GROUND_M = 60

function smooth01(u: number): number {
	const c = Math.max(0, Math.min(1, u))
	return c * c * (3 - 2 * c)
}
function smoother01(u: number): number {
	const c = Math.max(0, Math.min(1, u))
	return c * c * c * (c * (c * 6 - 15) + 10)
}

/**
 * Camera for the ending at `ageS` since the finale start: while the traveller (beam head, then thaw front) runs the ring
 * the camera sits inside the ring, high above the (corner-rounded) ring point, looking at the head (at mid beam height
 * while beams draw, on the ground for the thaw); after the thaw it eases out to `wide` (the high network pose) and the
 * look to the network centre. Pure: `groundY` is the terrain height lookup, `tipY` the beams' height.
 */
export function finaleCameraAt(
	pts: FinalePoint[], edges: FinaleEdge[], times: FinaleTimes, ageS: number, groundY: (x: number, z: number) => number,
	tipY: number, maxCamH: number, wide: { cam: FinaleV3; look: FinaleV3 },
): { pos: FinaleV3; look: FinaleV3 } {
	let cx = 0, cz = 0
	for (const p of pts) { cx += p.x; cz += p.z }
	cx /= Math.max(1, pts.length); cz /= Math.max(1, pts.length)
	const P = finaleTravelS(times, ageS)
	const head = finaleRingPoint(pts, edges, times, P)
	// Corner-rounded ring point and smoothed terrain height (a box average over the window, so a cliff under the path
	// never snaps the camera / look height): 25 samples, the inner ones (+- FINALE_LOOK_GROUND_M) average the look height.
	let sx = 0, sz = 0, sg = 0, lg = 0, ln = 0
	const K = 12
	for (let i = -K; i <= K; i++) {
		const off = (i / K) * FINALE_CHASE_SMOOTH_M
		const q = finaleRingPoint(pts, edges, times, P + off)
		sx += q.x; sz += q.z
		const gq = groundY(q.x, q.z)
		sg += gq
		if (Math.abs(off) <= FINALE_LOOK_GROUND_M) { lg += gq; ln++ }
	}
	sx /= 2 * K + 1; sz /= 2 * K + 1; sg /= 2 * K + 1; lg /= Math.max(1, ln)
	const tx = cx - sx, tz = cz - sz
	const td = Math.hypot(tx, tz)
	const off = td > 1 ? Math.min(FINALE_CHASE_IN_M, td * 0.85) : 0
	const px = sx + (td > 1 ? (tx / td) * off : 0), pz = sz + (td > 1 ? (tz / td) * off : 0)
	const pos: FinaleV3 = { x: px, y: Math.min(maxCamH, sg + FINALE_CHASE_H_M), z: pz }
	const g = lg
	const w = ageS < times.beamsDoneS ? 1 : 1 - smooth01((ageS - times.beamsDoneS) / 2)
	const look: FinaleV3 = { x: head.x, y: g + w * 0.5 * (tipY - g), z: head.z }
	if (ageS <= times.thawEndS) return { pos, look }
	const e = smoother01((ageS - times.thawEndS) / Math.max(0.1, times.cineEndS - times.thawEndS))
	return {
		pos : { x: pos.x + (wide.cam.x - pos.x) * e, y: pos.y + (wide.cam.y - pos.y) * e, z: pos.z + (wide.cam.z - pos.z) * e },
		look: { x: look.x + (wide.look.x - look.x) * e, y: look.y + (wide.look.y - look.y) * e, z: look.z + (wide.look.z - look.z) * e },
	}
}
