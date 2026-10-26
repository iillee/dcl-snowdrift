/**
 * monumentCinematic.ts — local-only cinematic when THIS player ignites a
 * monument.
 *
 * One VirtualCamera entity whose Transform is interpolated every frame
 * between live key poses (smoothstep between keys), aimed with
 * lookAtEntity at a helper target entity that is also moved every frame.
 * Keys are evaluated live from the obelisk rig, so the camera tracks the
 * real rise / hover / beam timing in stationMarkers (which stretches its
 * settle / sky-beam / volcano-beam phases to CINE_* while a cinematic runs
 * for that slot; client-only, the server and other players are untouched).
 *
 * Shots (T = seconds after ignition, rise = MONUMENT_RISE_S = 10). The sky
 * beam drops during the last CINE_SKY_DROP_S of the rise (cinematic only)
 * and lands in the top tip exactly as the rise ends; the volcano beam
 * starts CINE_SETTLE_S later:
 *   a-c) 0 .. rise+CINE_WIDE_LAND_S   one continuous crane: starts low and
 *                                     close at the socket looking up, rises
 *                                     while pulling back, ends on the wide
 *                                     shot as the sky beam lands at rise.
 *                                     Single cubic Bezier (distance, height,
 *                                     bearing; each monotone) eased by one
 *                                     smootherstep, baked once into a
 *                                     terrain-safe table (no per-frame clamp)
 *   d) +CINE_BEAM_CUT_S .. +draw+hold behind the bottom tip, dolly along the
 *                                     redirected beam, end framing the volcano
 *   e) release                        MainCamera back to the player camera
 *                                     (CINE_BLEND_OUT_S), letterbox slides out
 * Default timeline: drop 8.6-10.0, volcano draw 10.6-12.4, release 13.2,
 * player camera back at 14.2 s.
 *
 * Input: InputModifier disableAll while running (only if no other system
 * already owns one). Skip: E / click / Space after CINE_SKIP_GRACE_S, or
 * the SKIP label in the letterbox (mobile). Never replays: it is only
 * started from the local ignite request, never from hydration.
 *
 * Survival pause: while it runs (incl. the blend-out) the watching player's
 * frost / warmth and torch fuel are held (isSurvivalPausedByCinematic,
 * read by frost/accumulation.ts and torchInput.ts). Both are client-owned,
 * so nothing goes to the server and nobody else is affected. Hard cap:
 * CINE_SURVIVAL_PAUSE_MAX_S wall-clock, after which the pause lifts and
 * the cinematic is force-ended, so it can never stay stuck.
 */

import {
	InputAction,
	InputModifier,
	MainCamera,
	PointerEventType,
	Transform,
	VirtualCamera,
	engine,
	inputSystem,
	type Entity,
} from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

import { SCENE_WORLD_SIZE_X_METERS, SCENE_WORLD_SIZE_Z_METERS, sceneHeightLimitM } from 'src/shared/settings'
import { activeGroundYAt } from 'src/shared/terrain/terrainCache'


// MARK: Tuning
/** Look target starts lifting above the tip (toward the incoming sky beam) at this fraction of the rise. */
export const CINE_MID_END_FRAC     = 0.65
/** Look target lift above the tip while the sky beam drops / once it has landed (m). */
export const CINE_LOOK_SKY_LIFT_M  = 8
export const CINE_LOOK_LAND_LIFT_M = 2
/**
 * Critically damped look-target smoothing (rad/s). Higher = tighter on the
 * tip; 5 gives a slight lag (~0.4 s) and no overshoot.
 */
export const CINE_LOOK_OMEGA       = 5
/** Crane path table resolution (samples over the crane, baked once). */
export const CINE_CRANE_SAMPLES    = 160
/** Terrain-lift smoothing half-window along the crane (samples). */
export const CINE_CRANE_LIFT_WIN   = 10
/** The wide shot is reached this long before the sky drop starts (s). */
export const CINE_WIDE_LEAD_S      = 0.2
/** Wide shot keeps easing this long past the sky-beam landing (s). */
export const CINE_WIDE_LAND_S      = 0.2
/** Cut-in to the beam shot completes this long after the volcano draw starts (s). */
export const CINE_BEAM_CUT_S       = 0.4
/**
 * stationMarkers phases while the cinematic runs (s; normal: settle 0.6,
 * sky 1.2, volcano 1.5). In the cinematic the sky drop overlaps the end of
 * the rise (lands as it ends); settle is then the pause before the volcano
 * beam. Was 1.6 / 2.4 / 3.0 (not overlapped).
 */
export const CINE_SETTLE_S         = 0.6
export const CINE_SKY_DROP_S       = 1.4
export const CINE_VOLCANO_DRAW_S   = 1.8
/** Hold on the volcano after the beam has drawn (s). Was 2.0. */
export const CINE_END_HOLD_S       = 0.8
/** Blend from the player camera into shot a, and back out at the end (s). Were 0.8 / 1.5. */
export const CINE_BLEND_IN_S       = 0.6
export const CINE_BLEND_OUT_S      = 1.0
/** Letterbox bar height (fraction of screen height, each bar) and slide time (s). */
export const CINE_BAR_FRAC         = 0.12
export const CINE_BAR_SLIDE_S      = 0.6
/** Ignore skip input this long after the start (the ignite press itself). */
export const CINE_SKIP_GRACE_S     = 0.75
/** Shot distances from the socket (m) and heights. */
export const CINE_LOW_DIST_M       = 7
export const CINE_LOW_EYE_M        = 1.2
export const CINE_MID_DIST_M       = 28
export const CINE_WIDE_DIST_M      = 58
/**
 * Mid / wide distances also scale with the hover height above the socket
 * ground (m of distance per m of height); the larger of fixed and scaled
 * wins, so a higher hover pulls the camera back and keeps it framed.
 */
export const CINE_MID_DIST_PER_H   = 0.3
export const CINE_WIDE_DIST_PER_H  = 0.5
/** Shot b ends at this fraction of the hover height above ground. */
export const CINE_MID_HEIGHT_FRAC  = 0.65
/** Beam shot: behind / above / beside the bottom tip, and dolly length along the beam (m). */
export const CINE_BEAM_BACK_M      = 14
export const CINE_BEAM_UP_M        = 5
export const CINE_BEAM_SIDE_M      = 5
export const CINE_BEAM_DOLLY_M     = 22
/** Camera stays this far above terrain / inside bounds / under the ceiling (m). */
export const CINE_GROUND_CLEAR_M   = 2
export const CINE_BOUNDS_MARGIN_M  = 2
export const CINE_CEILING_MARGIN_M = 3
/**
 * Safety cap (s, wall clock) on the survival pause and the cinematic
 * itself. The normal sequence is ~14 s incl. the blend-out.
 */
export const CINE_SURVIVAL_PAUSE_MAX_S = 30


// MARK: Types
/** Live geometry of the monument being ignited (closures into stationMarkers). */
export type CineTarget = {
	x       : number
	z       : number
	groundY : number
	/** Mean hovering centre / top tip / bottom tip (world Y, no bob). */
	hoverCentreY: number
	/** Current obelisk centre (world, includes rise + bob). */
	rigPos  : () => Vector3
	/** Half the obelisk length (centre to tip, m). */
	halfLen : number
	/** Volcano beam far end (world). */
	aim     : Vector3
	/** Seconds of the rise animation. */
	riseS   : number
	/** Called once when the cinematic ends (finished, skipped or aborted). */
	onEnd   : () => void
}

type Key = { t: number; pos: () => Vector3; look: () => Vector3 }


// MARK: State
let active    = false
let releasing = false
let t         = 0
let releaseT  = 0
let barK      = 0
let cam       : Entity | null = null
let lookEnt   : Entity | null = null
let keys      : Key[] = []
let endT      = 0
let target    : CineTarget | null = null
let ownsInput = false
let installed = false
/** Date.now() at start; drives the CINE_SURVIVAL_PAUSE_MAX_S cap. */
let startedMs = 0
/** Baked crane path (terrain-safe world positions) and its end time (s). */
let crane: Vector3[] = []
let craneEndT = 0
/** Raw (unsmoothed) look target for the crane part, bob-free. */
let craneLook: (time: number) => Vector3 = () => Vector3.Zero()
/** Critically damped look-target state. */
let lookP = Vector3.Zero()
let lookV = Vector3.Zero()


// MARK: Public
/** True while the cinematic (incl. its blend-out / bar slide) owns the screen. */
export function isMonumentCinematicActive(): boolean {
	return active || barK > 0
}

/** Letterbox bar height as a fraction of the screen (0 when hidden). */
export function getCinematicBarFrac(): number {
	return CINE_BAR_FRAC * smooth(barK)
}

// MARK: isSurvivalPausedByCinematic
/**
 * True while the local player's frost, warmth reserve and torch fuel
 * should hold still: the cinematic (or its blend-out) is running and it
 * started less than CINE_SURVIVAL_PAUSE_MAX_S ago. Ends on finish, skip,
 * abort (cycle reset / layout rebuild) or the timeout.
 */
export function isSurvivalPausedByCinematic(): boolean {
	if (!active) return false
	return Date.now() - startedMs < CINE_SURVIVAL_PAUSE_MAX_S * 1000
}

/** True while the SKIP label should show. */
export function isCinematicSkippable(): boolean {
	return active && !releasing && t >= CINE_SKIP_GRACE_S
}

/** Skip to the blend-out (SKIP label, keys). */
export function skipMonumentCinematic(): void {
	if (!active || releasing) return
	release()
}

/** Hard stop (layout rebuild / cycle reset): no blend. */
export function abortMonumentCinematic(): void {
	if (!active && !cam) return
	finish(true)
}

/** Start the sequence for a monument the local player just ignited. */
export function startMonumentCinematic(tgt: CineTarget): void {
	install()
	if (active) finish(true)
	target    = tgt
	active    = true
	releasing = false
	t         = 0
	startedMs = Date.now()
	buildKeys(tgt)

	lookP = craneLook(0)
	lookV = Vector3.Zero()
	lookEnt = engine.addEntity()
	Transform.create(lookEnt, { position: lookP })
	cam = engine.addEntity()
	Transform.create(cam, { position: crane[0] })
	VirtualCamera.create(cam, {
		lookAtEntity     : lookEnt,
		defaultTransition: { transitionMode: VirtualCamera.Transition.Time(CINE_BLEND_IN_S) },
	})
	MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: cam })

	ownsInput = !InputModifier.has(engine.PlayerEntity)
	if (ownsInput) {
		InputModifier.createOrReplace(engine.PlayerEntity, {
			mode: InputModifier.Mode.Standard({ disableAll: true }),
		})
	}
	console.log('monumentCinematic: start')
}


// MARK: Keys
function smooth(u: number): number {
	const c = Math.max(0, Math.min(1, u))
	return c * c * (3 - 2 * c)
}

function smoother(u: number): number {
	const c = Math.max(0, Math.min(1, u))
	return c * c * c * (c * (c * 6 - 15) + 10)
}

function bez(a: number, b: number, c: number, d: number, u: number): number {
	const v = 1 - u
	return v * v * v * a + 3 * v * v * u * b + 3 * v * u * u * c + u * u * u * d
}

function lerpV(a: Vector3, b: Vector3, u: number): Vector3 {
	return Vector3.create(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u)
}

/** Highest terrain along the socket -> (dir * dist) line, relative to the socket ground. */
function sightCost(tgt: CineTarget, dx: number, dz: number, dist: number): number {
	let worst = 0
	for (let k = 1; k <= 8; k++) {
		const d = (dist * k) / 8
		const x = tgt.x + dx * d
		const z = tgt.z + dz * d
		if (x < CINE_BOUNDS_MARGIN_M || z < CINE_BOUNDS_MARGIN_M ||
			x > SCENE_WORLD_SIZE_X_METERS - CINE_BOUNDS_MARGIN_M || z > SCENE_WORLD_SIZE_Z_METERS - CINE_BOUNDS_MARGIN_M) {
			worst = Math.max(worst, 50)
			continue
		}
		worst = Math.max(worst, activeGroundYAt(x, z) - tgt.groundY)
	}
	return worst
}

/**
 * Pick the horizontal side the camera works from: of 16 bearings, the one
 * whose wide-shot line crosses the lowest terrain, preferring bearings
 * square to the beam (so the redirected beam crosses the frame).
 */
function pickSide(tgt: CineTarget): { sx: number; sz: number } {
	const bx = tgt.aim.x - tgt.x
	const bz = tgt.aim.z - tgt.z
	const bl = Math.hypot(bx, bz) || 1
	let best = { sx: -bz / bl, sz: bx / bl }
	let bestScore = Number.POSITIVE_INFINITY
	for (let k = 0; k < 16; k++) {
		const a  = (k / 16) * Math.PI * 2
		const sx = Math.cos(a)
		const sz = Math.sin(a)
		const along = Math.abs((sx * bx + sz * bz) / bl) // 0 = square to the beam
		const score = sightCost(tgt, sx, sz, Math.max(CINE_WIDE_DIST_M, Math.max(0, tgt.hoverCentreY - tgt.groundY) * CINE_WIDE_DIST_PER_H)) + along * 6
		if (score < bestScore - 1e-6) { bestScore = score; best = { sx, sz } }
	}
	return best
}

function buildKeys(tgt: CineTarget): void {
	const { sx, sz } = pickSide(tgt)
	const g   = tgt.groundY
	const hov = tgt.hoverCentreY
	const bottom = (): Vector3 => {
		const p = tgt.rigPos()
		return Vector3.create(p.x, p.y - tgt.halfLen, p.z)
	}
	// Beam direction (horizontal + full) from the mean bottom tip to the aim.
	const b0  = Vector3.create(tgt.x, hov - tgt.halfLen, tgt.z)
	const bd  = Vector3.normalize(Vector3.subtract(tgt.aim, b0))
	const bhl = Math.hypot(bd.x, bd.z) || 1
	const px  = -bd.z / bhl
	const pz  = bd.x / bhl
	const side = (sx * px + sz * pz) >= 0 ? 1 : -1 // beam shot on the same side as the wide shot

	const orbit = (dist: number, y: number, rot: number): Vector3 => {
		const c = Math.cos(rot)
		const s = Math.sin(rot)
		const ox = sx * c - sz * s
		const oz = sx * s + sz * c
		return Vector3.create(tgt.x + ox * dist, y, tgt.z + oz * dist)
	}
	const beamPos = (dolly: number): Vector3 => {
		const bt = bottom()
		return Vector3.create(
			bt.x - bd.x * CINE_BEAM_BACK_M + bd.x * dolly + px * CINE_BEAM_SIDE_M * side,
			bt.y - bd.y * CINE_BEAM_BACK_M + bd.y * dolly + CINE_BEAM_UP_M,
			bt.z - bd.z * CINE_BEAM_BACK_M + bd.z * dolly + pz * CINE_BEAM_SIDE_M * side,
		)
	}

	const rise   = tgt.riseS
	const hAbove = Math.max(0, hov - g)
	const midD   = Math.max(CINE_MID_DIST_M, hAbove * CINE_MID_DIST_PER_H)
	const wideD  = Math.max(CINE_WIDE_DIST_M, hAbove * CINE_WIDE_DIST_PER_H)
	const tMid   = rise * CINE_MID_END_FRAC
	const tDrop  = Math.max(tMid + 0.5, rise - CINE_SKY_DROP_S) // sky drop starts (lands at rise)
	const tWide  = Math.max(tMid + 0.5, tDrop - CINE_WIDE_LEAD_S)
	const tLand  = rise + CINE_WIDE_LAND_S
	const tBeam  = rise + CINE_SETTLE_S                         // volcano draw starts
	const tCut   = Math.max(tLand + 0.6, tBeam + CINE_BEAM_CUT_S)
	const tDrawn = Math.max(tCut + 0.4, tBeam + CINE_VOLCANO_DRAW_S)
	endT = tDrawn + CINE_END_HOLD_S

	// a-c) Rise crane: one cubic Bezier in (distance, height, bearing) from
	// the low close shot to the wide pose, each component monotone (no
	// direction reversals), eased by a single smootherstep over 0..tLand.
	// Baked once with a smoothed terrain lift + bounds / ceiling clamp, so
	// nothing is clamped (or pops) per frame.
	craneEndT = tLand
	const cD = [CINE_LOW_DIST_M, CINE_LOW_DIST_M + 2, midD, wideD + 4]
	const cH = [g + CINE_LOW_EYE_M, g + CINE_LOW_EYE_M + 1, g + hAbove * CINE_MID_HEIGHT_FRAC, hov - 2]
	const cR = [0, 0.15, 0.5, 0.7]
	const n = CINE_CRANE_SAMPLES
	const raw: Vector3[] = []
	const need: number[] = []
	for (let i = 0; i <= n; i++) {
		const u = smoother(i / n)
		const p = orbit(bez(cD[0], cD[1], cD[2], cD[3], u), bez(cH[0], cH[1], cH[2], cH[3], u), bez(cR[0], cR[1], cR[2], cR[3], u))
		const x = Math.max(CINE_BOUNDS_MARGIN_M, Math.min(SCENE_WORLD_SIZE_X_METERS - CINE_BOUNDS_MARGIN_M, p.x))
		const z = Math.max(CINE_BOUNDS_MARGIN_M, Math.min(SCENE_WORLD_SIZE_Z_METERS - CINE_BOUNDS_MARGIN_M, p.z))
		raw.push(Vector3.create(x, p.y, z))
		need.push(Math.max(0, activeGroundYAt(x, z) + CINE_GROUND_CLEAR_M - p.y))
	}
	// Lift: dilate by 2W then box-average by W, so it is smooth and still
	// >= the raw requirement at every sample.
	const W = CINE_CRANE_LIFT_WIN
	const dil = need.map((_, i) => {
		let m = 0
		for (let j = Math.max(0, i - 2 * W); j <= Math.min(n, i + 2 * W); j++) m = Math.max(m, need[j])
		return m
	})
	const yMax = sceneHeightLimitM() - CINE_CEILING_MARGIN_M
	crane = raw.map((p, i) => {
		let sum = 0
		let cnt = 0
		for (let j = Math.max(0, i - W); j <= Math.min(n, i + W); j++) { sum += dil[j]; cnt++ }
		return Vector3.create(p.x, Math.min(yMax, p.y + sum / cnt), p.z)
	})

	// Look target for the crane, bob-free: the top tip on the deterministic
	// rise curve (stationMarkers: smoothstep over riseS from the seated
	// centre), lifted toward the incoming sky beam, then settling just above
	// the tip as it lands. Fed through a critically damped spring in cineSystem.
	const y0 = tgt.rigPos().y
	craneLook = (time: number): Vector3 => {
		const cy  = time < rise ? y0 + (hov - y0) * smooth(time / rise) : hov
		const tip = Math.max(g + 1.5, cy + tgt.halfLen)
		const up  = time < tWide
			? CINE_LOOK_SKY_LIFT_M * smoother((time - tMid) / Math.max(0.1, tWide - tMid))
			: CINE_LOOK_SKY_LIFT_M + (CINE_LOOK_LAND_LIFT_M - CINE_LOOK_SKY_LIFT_M) * smoother((time - tWide) / Math.max(0.1, tLand - tWide))
		return Vector3.create(tgt.x, tip + up, tgt.z)
	}
	const craneEnd = crane[n]

	keys = [
		// End of the crane = start of the beam move.
		{ t: tLand,            pos: () => craneEnd,                                              look: () => craneLook(tLand) },
		// d) behind the bottom tip, then dolly along the redirected beam.
		{ t: tCut,             pos: () => beamPos(0),                                            look: () => Vector3.add(bottom(), Vector3.scale(bd, 12)) },
		{ t: tDrawn,           pos: () => beamPos(CINE_BEAM_DOLLY_M),                            look: () => tgt.aim },
		{ t: endT,             pos: () => beamPos(CINE_BEAM_DOLLY_M + 4),                        look: () => tgt.aim },
	]
}

/** Clamp a camera point inside the scene, above terrain, under the ceiling. */
function safe(p: Vector3): Vector3 {
	const x = Math.max(CINE_BOUNDS_MARGIN_M, Math.min(SCENE_WORLD_SIZE_X_METERS - CINE_BOUNDS_MARGIN_M, p.x))
	const z = Math.max(CINE_BOUNDS_MARGIN_M, Math.min(SCENE_WORLD_SIZE_Z_METERS - CINE_BOUNDS_MARGIN_M, p.z))
	const yMin = activeGroundYAt(x, z) + CINE_GROUND_CLEAR_M
	const yMax = sceneHeightLimitM() - CINE_CEILING_MARGIN_M
	return Vector3.create(x, Math.min(yMax, Math.max(yMin, p.y)), z)
}

function sample(time: number): { pos: Vector3; look: Vector3 } {
	if (time <= keys[0].t) return { pos: keys[0].pos(), look: keys[0].look() }
	for (let i = 0; i < keys.length - 1; i++) {
		const a = keys[i]
		const b = keys[i + 1]
		if (time <= b.t) {
			const u = smooth((time - a.t) / Math.max(1e-3, b.t - a.t))
			return { pos: lerpV(a.pos(), b.pos(), u), look: lerpV(a.look(), b.look(), u) }
		}
	}
	const last = keys[keys.length - 1]
	return { pos: last.pos(), look: last.look() }
}


// MARK: Lifecycle
function release(): void {
	releasing = true
	releaseT  = 0
	if (cam && VirtualCamera.has(cam)) {
		VirtualCamera.getMutable(cam).defaultTransition = { transitionMode: VirtualCamera.Transition.Time(CINE_BLEND_OUT_S) }
	}
	const mc = MainCamera.getMutableOrNull(engine.CameraEntity)
	if (mc) mc.virtualCameraEntity = undefined
	if (ownsInput && InputModifier.has(engine.PlayerEntity)) InputModifier.deleteFrom(engine.PlayerEntity)
	ownsInput = false
	const tg = target
	target = null
	if (tg) tg.onEnd()
	console.log('monumentCinematic: release')
}

function finish(hard: boolean): void {
	if (!releasing && active) release()
	if (hard) {
		const mc = MainCamera.getMutableOrNull(engine.CameraEntity)
		if (mc) mc.virtualCameraEntity = undefined
		barK = 0
	}
	if (cam) engine.removeEntity(cam)
	if (lookEnt) engine.removeEntity(lookEnt)
	cam = null
	lookEnt = null
	active = false
	releasing = false
}

function cineSystem(dt: number): void {
	// Bars: slide in while running, out once releasing.
	const wantBars = active && !releasing
	barK = Math.max(0, Math.min(1, barK + (wantBars ? dt : -dt) / CINE_BAR_SLIDE_S))
	if (!active) return

	// Safety net: never let the cinematic (and the survival pause) outlive the cap.
	if (Date.now() - startedMs >= CINE_SURVIVAL_PAUSE_MAX_S * 1000) {
		console.log('monumentCinematic: cineSystem: timeout after ' + CINE_SURVIVAL_PAUSE_MAX_S + ' s, forcing end')
		finish(true)
		return
	}

	if (releasing) {
		releaseT += dt
		if (releaseT >= CINE_BLEND_OUT_S + 0.2) finish(false)
		return
	}

	t += dt
	if (t >= CINE_SKIP_GRACE_S && (
		inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN) ||
		inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN) ||
		inputSystem.isTriggered(InputAction.IA_JUMP, PointerEventType.PET_DOWN))) {
		release()
		return
	}
	if (t >= endT) { release(); return }

	let pos: Vector3
	let want: Vector3
	if (t <= craneEndT) {
		pos  = cranePos(t)
		want = craneLook(t)
	} else {
		const s = sample(t)
		pos  = safe(s.pos)
		want = s.look
	}
	springLook(want, dt)
	if (cam) Transform.getMutable(cam).position = pos
	if (lookEnt) Transform.getMutable(lookEnt).position = lookP
}

/** Position on the baked crane table at time `time` (linear between dense samples). */
function cranePos(time: number): Vector3 {
	const n = crane.length - 1
	if (n <= 0) return crane[0] ?? Vector3.Zero()
	const f = Math.max(0, Math.min(1, time / Math.max(1e-3, craneEndT))) * n
	const i = Math.min(n - 1, Math.floor(f))
	return lerpV(crane[i], crane[i + 1], f - i)
}

/** Critically damped spring of lookP toward `want` (CINE_LOOK_OMEGA). */
function springLook(want: Vector3, dt: number): void {
	const w   = CINE_LOOK_OMEGA
	const e   = Math.exp(-w * dt)
	const ax = (k: 'x' | 'y' | 'z'): [number, number] => {
		const x   = lookP[k] - want[k]
		const tmp = (lookV[k] + w * x) * dt
		return [want[k] + (x + tmp) * e, (lookV[k] - w * tmp) * e]
	}
	const [px, vx] = ax('x')
	const [py, vy] = ax('y')
	const [pz, vz] = ax('z')
	lookP = Vector3.create(px, py, pz)
	lookV = Vector3.create(vx, vy, vz)
}

function install(): void {
	if (installed) return
	installed = true
	engine.addSystem(cineSystem)
}
