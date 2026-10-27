/**
 * crystalCineFrame.ts - pure end-pose math for the floating-crystal
 * release cinematic (client/monumentCinematic.ts); shared so
 * scripts/cineFrameCheck can sanity-check it per terrace.
 *
 * End shot (Luke's reference): a high oblique view (pitch 45-50 deg down) of the monument from its front,
 * the whole melt circle (radius CRYSTAL_HEAT_RADIUS_M) inside the frame, the monument tip near the top with
 * CINE_CRYSTAL_TIP_HEADROOM of the visible height above it, fire network / cliffs below.
 */
import { CRYSTAL_HEAT_RADIUS_M } from 'src/shared/ruleset'

const DEG_C = Math.PI / 180
/** Vertical FOV assumed (deg). */
export const CINE_CRYSTAL_FOV_DEG = 60
/** Preferred end pitch (deg below horizontal); the solver may use anything in [MIN, MAX], then flatter only as a fallback. */
export const CINE_CRYSTAL_END_PITCH_DEG = 48
export const CINE_CRYSTAL_PITCH_MIN_DEG = 45
export const CINE_CRYSTAL_PITCH_MAX_DEG = 50
/** Screen aspect used when the real one is unknown (the real canvas aspect is passed in at runtime). */
export const CINE_CRYSTAL_ASPECT = 16 / 9
/** Aspect range the framing solves for (portrait phones / ultrawide are clamped to it). */
export const CINE_CRYSTAL_ASPECT_MIN = 1.0
export const CINE_CRYSTAL_ASPECT_MAX = 2.4

/** Canvas size -> the aspect to frame for (falls back to 16:9, clamped to the supported range). */
export function cineAspect(width: number, height: number): number {
	if (!(width > 0) || !(height > 0)) return CINE_CRYSTAL_ASPECT
	return Math.max(CINE_CRYSTAL_ASPECT_MIN, Math.min(CINE_CRYSTAL_ASPECT_MAX, width / height))
}
/** Letterbox bar height, fraction of the screen each (mirrors CINE_BAR_FRAC in monumentCinematic); the bars stay on for the end shot. */
export const CINE_CRYSTAL_BAR_FRAC = 0.12
/** Free space above the monument tip, as a fraction of the BAR-FREE visible height (Luke: ~8-10%). */
export const CINE_CRYSTAL_TIP_HEADROOM = 0.09
/** Everything framed must stay inside this fraction of the visible half-extent (edge margin). */
export const CINE_CRYSTAL_EDGE_FILL = 0.97
/** Ground circle kept fully in the end shot (m): the melt radius. */
export const CINE_CRYSTAL_FRAME_GROUND_R_M = CRYSTAL_HEAT_RADIUS_M

export interface CrystalEndPose { dist: number; camH: number; lookH: number; pitchDeg: number }

/** Projection of a point (s along the view bearing from the monument axis, height y, lateral x) -> visible-frame coords. */
function project(s: number, y: number, lat: number, D: number, Hc: number, pitch: number, aspect: number): { vx: number; vy: number } | null {
	const tv = Math.tan((CINE_CRYSTAL_FOV_DEG / 2) * DEG_C)
	const sr = s + D, dy = y - Hc
	const depth = sr * Math.cos(pitch) - dy * Math.sin(pitch)
	if (depth < 0.5) return null
	const up = sr * Math.sin(pitch) + dy * Math.cos(pitch)
	return { vx: lat / (depth * tv * aspect), vy: up / (depth * tv) / (1 - 2 * CINE_CRYSTAL_BAR_FRAC) }
}

/**
 * Crystal end pose relative to the crystal's ground. h = top tip height above ground, R = ground ring radius to keep in
 * frame, maxCamH = highest allowed camera height above the ground. For each pitch in [45, 50] and each horizontal
 * camera distance D from the monument axis (nearest first) the camera height is chosen so the tip sits exactly
 * CINE_CRYSTAL_TIP_HEADROOM below the top of the visible frame; D is accepted when the whole ring (lateral extremes,
 * near and far edges) and the foot stay inside the frame. Smallest D over the pitch range wins; if the ceiling blocks
 * every pitch it flattens (down to 20 deg). `aspect` = screen width / height (vertical FOV is fixed, so a narrower screen needs a farther camera). dist is the horizontal camera distance, lookH the height of the axis point the
 * camera looks at (so the pose is: camera at (dist, camH) aimed at (0, lookH)). Pure.
 */
export function crystalEndPose(h: number, R: number, maxCamH: number, aspect: number = CINE_CRYSTAL_ASPECT): CrystalEndPose {
	const solve = (pd: number): CrystalEndPose | null => {
		const pitch = pd * DEG_C
		const vTip = 1 - 2 * CINE_CRYSTAL_TIP_HEADROOM
		for (let D = 20; D < 600; D += 1) {
			// Camera height putting the tip at vTip (v falls as the camera rises): bisect.
			let lo = h - 400, hi = h + 4000
			for (let it = 0; it < 48; it++) {
				const mid = (lo + hi) / 2
				const p = project(0, h, 0, D, mid, pitch, aspect)
				if (p === null || p.vy > vTip) lo = mid; else hi = mid
			}
			const Hc = (lo + hi) / 2
			if (Hc > maxCamH) continue
			let ok = true
			const pts: Array<[number, number, number]> = [[0, 0, 0]]
			for (let k = 0; k < 48; k++) { const a = (k / 48) * Math.PI * 2; pts.push([R * Math.cos(a), 0, R * Math.sin(a)]) }
			for (const [s, y, lat] of pts) {
				const p = project(s, y, lat, D, Hc, pitch, aspect)
				if (p === null || Math.abs(p.vx) > CINE_CRYSTAL_EDGE_FILL || Math.abs(p.vy) > CINE_CRYSTAL_EDGE_FILL) { ok = false; break }
			}
			if (!ok) continue
			return { dist: D, camH: Hc, lookH: Hc - D * Math.tan(pitch), pitchDeg: pd }
		}
		return null
	}
	let best: CrystalEndPose | null = null
	for (let pd = CINE_CRYSTAL_PITCH_MIN_DEG; pd <= CINE_CRYSTAL_PITCH_MAX_DEG; pd += 1) {
		const r = solve(pd)
		if (r && (!best || r.dist < best.dist - 1e-6 || (Math.abs(r.dist - best.dist) < 1e-6 && Math.abs(r.pitchDeg - CINE_CRYSTAL_END_PITCH_DEG) < Math.abs(best.pitchDeg - CINE_CRYSTAL_END_PITCH_DEG)))) best = r
	}
	if (best) return best
	for (let pd = CINE_CRYSTAL_PITCH_MIN_DEG - 1; pd >= 20; pd -= 1) {
		const r = solve(pd)
		if (r) return r
	}
	return { dist: 400, camH: Math.min(maxCamH, h), lookH: h / 2, pitchDeg: 0 }
}