/**
 * finale.ts - the floating-crystals ENDING ("The world begins to thaw"), pure + shared by server and client.
 *
 * When the LAST obelisk is released (any obelisk count: 3 in the compact profile, 6 in the standard one):
 *   1. a short beat, then ALL ring beams connect AT ONCE (every beam draws in parallel between the obelisks' top tips: a closed ring);
 *   2. a short beat after the ring is closed, every obelisk releases the same larger PULSE (flash + expanding energy sphere, existing burst sound);
 *   3. the pulse melts a much larger area around each obelisk (OASIS_FINALE_RADIUS_M instead of OASIS_RADIUS_M): the SNOW melts fast
 *      (server heat front, held melted, FINALE_PULSE_S) and the obelisk's warmth / frost-safe radius grows with it (finaleWarmRadiusM),
 *      while the permafrost cap -> earth and the grass / pines / bushes / rocks open up GRADUALLY over OASIS_FINALE_MELT_S (~60 s) like the
 *      first oasis, with the same ragged edge / cell / earth / vegetation rules (shared/terrain/oasis.ts);
 *   4. the title card shows (FINALE_TITLE) while the pulse spreads; the cinematic camera holds the high framing of the whole ring.
 * Everything is a function of the server's start time + the (deterministic) obelisk layout, so the server melts the snow, every
 * client draws the same beams / pulse and a late joiner lands on the finished state. There are NO thaw corridors under the beams any more.
 * Timeline (s since the finale start; the start is FINALE_START_DELAY_S after the last release so the release cinematic finishes first):
 *   beams      FINALE_BEAM_BEAT_S, then every beam grows over FINALE_BEAM_DRAW_S (all together)
 *   pulse      FINALE_PULSE_GAP_S after the ring is closed; the snow front / warmth radius runs out to FINALE_PULSE_RADIUS_M over FINALE_PULSE_S
 *   title      FINALE_TEXT_AFTER_PULSE_S after the pulse starts
 *   camera     frames the whole ring from the start; hands back FINALE_CINE_AFTER_PULSE_S after the pulse ends
 */

import { CRYSTAL_HEAT_RADIUS_M } from 'src/shared/ruleset'
import { OASIS_FINALE_MELT_S, OASIS_FINALE_RADIUS_M, OASIS_JITTER_M } from 'src/shared/terrain/oasis'
import { SCENE_WORLD_SIZE_X_METERS, SCENE_WORLD_SIZE_Z_METERS, WORLD_IS_COMPACT } from 'src/shared/settings'
import { TerrainMap, cellCenterWorld } from 'src/shared/terrain/terrainMap'

// MARK: Tuning
/** Finale start after the last obelisk's release (s): its own release cinematic (hold 2 + rise 4 + charge 2 + burst 3 + hold 2 + blend-out 1) is over by then. */
export const FINALE_START_DELAY_S = 14.5
/** Start delay for the debug trigger (no release cinematic to wait for). */
export const FINALE_DEBUG_DELAY_S = 3
/** Short beat after the finale start before the beams draw (s), and how long every beam takes to connect (s; all beams in parallel). */
export const FINALE_BEAM_BEAT_S = 1.5
export const FINALE_BEAM_DRAW_S = 2.5
/** Beat between the ring closing and the synchronized pulse (s). */
export const FINALE_PULSE_GAP_S = 0.8
/** The pulse: nominal radius (m) it melts to around every obelisk, the seconds it takes to spread there (shared with the oasis), the snow disc it melts (covers the ragged edge). */
export const FINALE_PULSE_RADIUS_M = OASIS_FINALE_RADIUS_M
/** Seconds the pulse's snow melt (and the visual flash / warmth radius) takes. The permafrost cap / earth / plants open much slower (OASIS_FINALE_MELT_S). */
export const FINALE_PULSE_S = 12
export const FINALE_SNOW_RADIUS_M = OASIS_FINALE_RADIUS_M + OASIS_JITTER_M
export const FINALE_TEXT_AFTER_PULSE_S = 2
/** Warmth / frost-safe radius (m) of a released obelisk once the pulse is done: it covers the whole enlarged melted area (snow disc incl. ragged edge). */
export const FINALE_WARM_RADIUS_M = FINALE_SNOW_RADIUS_M
export const FINALE_CINE_AFTER_PULSE_S = 3.5
/** Title card length: thawSplash FADE_S 0.8 + HOLD_S 3 + FADE_S 0.8. */
export const FINALE_TEXT_TOTAL_S = 4.6
export const FINALE_TITLE = 'THE WORLD BEGINS TO THAW'
/** Beam thickness (m): the same as the vertical obelisk (sky) beam (stationMarkers SKY_BEAM_XZ_M). */
export const FINALE_BEAM_XZ_M = 0.42
/** Cinematic framing: vertical FOV (deg), letterbox bar fraction (each), fraction of the half-frame kept clear. */
export const FINALE_FOV_DEG = 60
export const FINALE_BAR_FRAC = 0.12
export const FINALE_FRAME_FILL = 0.8


export interface FinalePoint { x: number; z: number }
export type FinaleEdge = [number, number]
export interface FinaleAvoid { x: number; z: number; r: number }

/**
 * Warmth / frost-safe radius (m) of every released obelisk at local epoch `nowMs`: CRYSTAL_HEAT_RADIUS_M until the finale pulse
 * (`pulseMs`, Infinity = none), then it grows linearly to FINALE_WARM_RADIUS_M with the pulse's snow front (FINALE_PULSE_S), so
 * the warm area always covers the snow that has melted. A function of the pulse time only: every client (and a late joiner) agrees.
 */
export function finaleWarmRadiusM(pulseMs: number, nowMs: number): number {
	const t = (nowMs - pulseMs) / 1000
	if (!(t > 0)) return CRYSTAL_HEAT_RADIUS_M
	const u = Math.min(1, t / FINALE_PULSE_S)
	return CRYSTAL_HEAT_RADIUS_M + (FINALE_WARM_RADIUS_M - CRYSTAL_HEAT_RADIUS_M) * u
}

/**
 * Seconds after the finale start at which the world counts as RESTORED: the pulse has started and both the snow melt (FINALE_PULSE_S)
 * and the gradual permafrost / earth opening (OASIS_FINALE_MELT_S) are done. The New Expedition button appears only after this.
 */
export function finaleRestoredS(): number {
	return finaleTimes().pulseAtS + Math.max(FINALE_PULSE_S, OASIS_FINALE_MELT_S)
}

// MARK: Layout
/** World XZ of every obelisk socket, station order. */
export function finalePoints(map: TerrainMap): FinalePoint[] {
	return map.stations.map((st) => cellCenterWorld(st.cx, st.cz))
}

/** The volcano's keep-clear disc (beams avoid crossing it when a good alternative exists), or null. */
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
/** Brute-force tour search up to this many obelisks (7! = 5040 orders); the angular ring above it. */
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
 * Closed ring through every obelisk, starting at `first` and running counter-clockwise (x right, z up). It is the
 * shortest tour (no self-crossing, and no edge through the `avoid` disc when any alternative exists) for up to
 * FINALE_BRUTE_MAX obelisks, else the angular order around the centroid. Deterministic: same points, same ring.
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

/** Beam edges in draw order along the ring from `first` (a, b = obelisk indices). */
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
/** Horizontal length (m) of every ring edge. */
export function finaleEdgeLengths(pts: FinalePoint[], edges: FinaleEdge[]): number[] {
	return edges.map(([a, b]) => Math.hypot(pts[b].x - pts[a].x, pts[b].z - pts[a].z))
}

export interface FinaleTimes {
	/** Every beam starts at the same time and takes the same time (all connect simultaneously). */
	beamStartS: number
	beamDurS: number
	beamsDoneS: number
	/** The pulse starts / ends (s since the finale start). */
	pulseAtS: number
	pulseEndS: number
	textAtS: number
	cineEndS: number
}

export function finaleTimes(): FinaleTimes {
	const beamStartS = FINALE_BEAM_BEAT_S
	const beamsDoneS = beamStartS + FINALE_BEAM_DRAW_S
	const pulseAtS = beamsDoneS + FINALE_PULSE_GAP_S
	const pulseEndS = pulseAtS + FINALE_PULSE_S
	return {
		beamStartS, beamDurS: FINALE_BEAM_DRAW_S, beamsDoneS, pulseAtS, pulseEndS,
		textAtS: pulseAtS + FINALE_TEXT_AFTER_PULSE_S, cineEndS: pulseEndS + FINALE_CINE_AFTER_PULSE_S,
	}
}

/** Draw progress 0..1 of EVERY ring beam at `ageS` since the finale start (they are in step). */
export function finaleBeamProgress(times: FinaleTimes, ageS: number): number {
	const u = Math.max(0, Math.min(1, (ageS - times.beamStartS) / times.beamDurS))
	return u * u * (3 - 2 * u)
}

/** Pulse front radius (m) at `ageS`: 0 before it starts, FINALE_PULSE_RADIUS_M once spread (linear, like the oasis / snow fronts). */
export function finalePulseRadiusM(times: FinaleTimes, ageS: number): number {
	return FINALE_PULSE_RADIUS_M * Math.max(0, Math.min(1, (ageS - times.pulseAtS) / FINALE_PULSE_S))
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

/** Steep pitches (deg) the pose search tries; the standard (6-obelisk) finale uses exactly these. */
export const FINALE_POSE_PITCHES: readonly number[] = [55, 62, 70, 78, 85]
/** Shallower pitches for the compact (3-obelisk) profile: a camera pulled back horizontally under the same ceiling can frame the whole triangle. */
export const FINALE_POSE_PITCHES_COMPACT: readonly number[] = [26, 32, 38, 46, 55, 62, 70, 78, 85]
export interface FinalePoseOpts {
	/** Pitches (deg) to try; default FINALE_POSE_PITCHES. */
	pitches?: readonly number[]
	/** When set, a camera position (x, z) outside this predicate is rejected (e.g. keep the camera inside the scene parcels). */
	inBounds?: (x: number, z: number) => boolean
}

/** Pose options of the ACTIVE profile: undefined (= the original steep search) for the standard finale; the compact profile pulls back at shallower pitches but keeps the camera inside the scene parcels. */
export function finalePoseOpts(): FinalePoseOpts | undefined {
	if (!WORLD_IS_COMPACT) return undefined
	const m = 12
	return {
		pitches : FINALE_POSE_PITCHES_COMPACT,
		inBounds: (x, z) => x >= m && z >= m && x <= SCENE_WORLD_SIZE_X_METERS - m && z <= SCENE_WORLD_SIZE_Z_METERS - m,
	}
}

/**
 * High oblique pose that frames every point in `pts` (obelisk tips + sockets) around `look`: over 12 bearings and 5
 * steep pitches the NEAREST camera that keeps the points inside FINALE_FRAME_FILL of the (letterboxed) frame and under
 * `maxCamH`. If the ceiling blocks every pose it takes the highest steep pose with the smallest overflow. Pure.
 */
export function finaleCameraPose(pts: FinaleV3[], look: FinaleV3, aspect: number, maxCamH: number, opts?: FinalePoseOpts): FinalePose {
	const pitches = opts?.pitches ?? FINALE_POSE_PITCHES
	const inBounds = opts?.inBounds
	let best: FinalePose | null = null
	let bestAny: FinalePose | null = null // opts only: the least-overflow pose seen, used when nothing fits
	let bestAnyM = Infinity
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
				if (inBounds && !inBounds(cam.x, cam.z)) break
				const fm0 = finaleFrameMetric(pts, cam, bearing, pr, aspect)
				if (opts && fm0 < bestAnyM) { bestAnyM = fm0; bestAny = { cam, look, bearing, pitchDeg: pd, dist: r, fits: false } }
				if (fm0 <= FINALE_FRAME_FILL) {
					if (!best || r < best.dist - 1e-6) best = { cam, look, bearing, pitchDeg: pd, dist: r, fits: true }
					break
				}
			}
		}
	}
	if (best) return best
	if (bestAny) return bestAny // opts (compact profile): best effort over every pitch, still under the ceiling and inside the bounds
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



// MARK: Camera shot
/**
 * Camera for the ending at `ageS` since the finale start: the high framing `wide` of the whole ring (obelisk tips + sockets, from
 * finaleCameraPose) from the first frame to the end - the beams connect, the pulse spreads and the title shows inside one steady shot
 * (obeliskCinematic blends in from the player camera and out again). Pure; kept as a function of time so the cinematic API is unchanged.
 */
export function finaleCameraAt(_times: FinaleTimes, _ageS: number, wide: { cam: FinaleV3; look: FinaleV3 }): { pos: FinaleV3; look: FinaleV3 } {
	return { pos: { x: wide.cam.x, y: wide.cam.y, z: wide.cam.z }, look: { x: wide.look.x, y: wide.look.y, z: wide.look.z } }
}
