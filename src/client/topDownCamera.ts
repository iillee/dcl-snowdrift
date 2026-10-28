/**
 * topDownCamera.ts — spectator-style angled isometric camera that follows the player.
 *
 * The focus point lerps toward the player each frame. There is no manual pan / drag (removed
 * on purpose, desktop and mobile): the view only zooms, turns by button and auto-rotates off cliffs.
 *
 * Camera pose (axonometric approximation):
 *   DCL has no orthographic camera, so the VirtualCamera sits FAR from the
 *   focus point along a fixed diagonal (yaw ISO_YAW_DEG, pitch ISO_PITCH_DEG
 *   down) with a narrow FOV (ISO_FOV_DEG). The long throw + narrow lens keeps
 *   perspective distortion low, so the view reads close to true isometric.
 *   `lookAtEntity` on a ground-level focus entity aims it.
 *
 * Screen frame (yaw ψ measured clockwise from +Z / north toward +X / east):
 *   screen-up    on the ground = F = ( sin ψ, cos ψ)   camera forward, flattened
 *   screen-right on the ground = R = ( cos ψ, -sin ψ)
 *   With ψ = 45°: screen-up = north-east, screen-right = south-east.
 *   F / R track the live, possibly blending, yaw.
 *
 * Auto-rotation (occlusion): every ISO_OCCLUDE_SAMPLE_S the ray from the
 * camera to the player's chest is sampled against the 16 m terrain cell
 * heights. Blocked for ISO_OCCLUDE_BLOCKED_S → test the other three yaws
 * (45 + 90k°, nearest first) and blend to the first clear one over
 * ISO_YAW_BLEND_S. ISO_YAW_MIN_HOLD_S between turns stops flip-flopping;
 * if no yaw is clear the current one stays. The rotate button
 * turns the view 90° by hand. Hiding foreground cliffs instead is not
 * practical: terrain is merged slab meshes, not per-cliff entities.
 *
 * Public API:
 *   setupTopDownCamera()   — create entities + register systems (call once).
 *   toggleTopDownCamera()  — flip in/out of top-down mode.
 *   isTopDownActive()      — for UI reactivity.
 *   zoomIn / zoomOut / rotateView — zoom steps and the 90° turn.
 */

import { engine, Entity, InputAction, MainCamera, PointerEventType, Transform, VirtualCamera, inputSystem } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

import { playUiClick }                                                             from 'src/client/audio'
import { SCENE_WORLD_SIZE_X_METERS, SCENE_WORLD_SIZE_Z_METERS, sceneHeightLimitM } from 'src/shared/settings'
import { activeGroundYAt }                                                         from 'src/shared/terrain/terrainCache'


// MARK: Tuning
// Scene center at ground level.
const CENTER_X = SCENE_WORLD_SIZE_X_METERS / 2
const CENTER_Z = SCENE_WORLD_SIZE_Z_METERS / 2

// --- Isometric pose ---------------------------------------------------------
/** Downward pitch (deg). True isometric = atan(1/√2) ≈ 35.26°. 35–45 reads well. */
export const ISO_PITCH_DEG = 35.26
/** Default yaw (deg, clockwise from north/+Z). 45 = classic diagonal; camera sits SW looking NE. Auto-rotation steps by 90. */
export const ISO_YAW_DEG   = 45
/**
 * Vertical field of view (deg) passed to VirtualCamera.fov (SDK default 60).
 * Narrower = flatter / more axonometric but the camera must sit further away
 * (distance ∝ 1 / tan(fov/2)), which hits scene bounds, the ceiling and the
 * mobile fog band sooner. 24 (was 30) is slightly tighter; distance is
 * rescaled via ISO_DIST_PER_SCALE so the framing size stays the same.
 */
export const ISO_FOV_DEG   = 24

// Zoom level ("view scale"): the old overhead altitude, kept as the zoom unit
// so the zoom buttons + pan speeds keep their tuning. A view scale of A frames
// the same on-screen height as the old 60°-FOV camera at A metres altitude;
// the actual camera distance is A * ISO_DIST_PER_SCALE.
//
// Zoom steps from pixelwars overviewCamera.ts (2026-10-26): fixed steps per platform
// instead of the old 12..75 / step-6 ladder. Mobile has four, evenly spaced from the closest 5 to the farthest 25 (5 / 11.67 / 18.33 / 25).
// Mobile opens at its closest step every time; desktop opens at
// DESKTOP_ZOOM_DEFAULT the first time and then keeps its step. The table is
// latched on open because isMobile() resolves async.
export const MOBILE_ZOOM_SCALES   = [5, 11.67, 18.33, 25]
/** Desktop-only extra zoom-out step, as a multiple of the previous max (60). */
export const DESKTOP_ZOOM_FAR_MULT = 1.4
export const DESKTOP_ZOOM_SCALES  = [7, 29, 60, Math.round(60 * DESKTOP_ZOOM_FAR_MULT), Math.round(60 * DESKTOP_ZOOM_FAR_MULT * DESKTOP_ZOOM_FAR_MULT)]
export const DESKTOP_ZOOM_DEFAULT = 29
/** Past the bounds/ceiling clamp, widen the lens up to this to keep the framing (pixelwars). */
const ISO_FOV_MAX_DEG = 80
/** Cliff auto-rotate. Pixelwars drops it (flat tiles); Cryocene keeps it for its 16 m terrain cliffs. */
export const ISO_AUTO_ROTATE_ENABLED = true
const CAM_ALTITUDE_DEFAULT = DESKTOP_ZOOM_DEFAULT

/** Reference FOV the zoom scale was tuned against (old overhead camera, deg). */
const REF_FOV_DEG = 60
const DEG = Math.PI / 180
/** Camera distance (m) per unit of view scale: tan(ref/2) / tan(fov/2). FOV 24 → ≈ 2.72 (FOV 30 was ≈ 2.15). */
export const ISO_DIST_PER_SCALE = Math.tan(REF_FOV_DEG * DEG / 2) / Math.tan(ISO_FOV_DEG * DEG / 2)

/** Camera stays this far inside the scene edges (m). */
const ISO_BOUNDS_INSET_M     = 2
/** Camera stays this far above terrain directly below it (m). */
const ISO_GROUND_CLEAR_M     = 3
/** Camera stays this far under the scene height limit (m). */
const ISO_CEILING_MARGIN_M   = 3
/** Smoothing rate for the effective distance when a clamp kicks in (1/s). */
const ISO_DIST_RATE          = 6
/** Smoothing rate for the focus point's height (follows terrain under it, 1/s). */
const ISO_FOCUS_Y_RATE       = 4

// --- Auto-rotation when terrain hides the player ---------------------------
/** Occlusion ray test cadence (s). */
const ISO_OCCLUDE_SAMPLE_S   = 0.25
/** The player must be hidden this long before the view turns (s). */
const ISO_OCCLUDE_BLOCKED_S  = 0.4
/** Yaw blend time for an auto or manual turn (s). */
const ISO_YAW_BLEND_S        = 0.8
/** Minimum time between turns (hysteresis, s). */
const ISO_YAW_MIN_HOLD_S     = 2
/** Ray target height above the player's feet (chest, m). */
const ISO_OCCLUDE_CHEST_M    = 1.2
/** Ray sample spacing along the ray (m); cells are 16 m. */
const ISO_OCCLUDE_STEP_M     = 2
/** Ignore samples this close (horizontally) to the player (own cell edge / ledge, m). */
const ISO_OCCLUDE_NEAR_M     = 1.5
/** Terrain must rise this far above the ray to count as blocking (m). */
const ISO_OCCLUDE_MARGIN_M   = 0.3

// VirtualCamera transition speed (m/s) when entering / exiting. Raised from
// 200 with the longer throw so the glide takes about as long as before.
const TRANSITION_SPEED = 260

// Follow smoothing rate (higher = snappier catch-up to the player).
// Framerate-independent via 1 - exp(-k * dt).
const FOLLOW_RATE = 5.0

// Below this distance (m) FOLLOW snaps to the player exactly.
const FOLLOW_SNAP_EPSILON = 0.05

// How far outside the scene bounds the focus point may sit, scaled with zoom.
const FOCUS_BOUNDS_MARGIN_BASE = 4


// MARK: Derived pose
const SIN_P = Math.sin(ISO_PITCH_DEG * DEG)
const COS_P = Math.cos(ISO_PITCH_DEG * DEG)
/** Ground-plane screen-up (camera forward, flattened). Tracks the live yaw. */
const FWD   = { x: Math.sin(ISO_YAW_DEG * DEG), z: Math.cos(ISO_YAW_DEG * DEG) }
/** Ground-plane screen-right. Tracks the live yaw. */
const RIGHT = { x: Math.cos(ISO_YAW_DEG * DEG), z: -Math.sin(ISO_YAW_DEG * DEG) }

/** Yaw slot k → 45 + 90k degrees. */
function yawOfSlot(k: number): number {
	return ISO_YAW_DEG + 90 * (((k % 4) + 4) % 4)
}

/** Point FWD / RIGHT at `yawDeg`. */
function setYawFrame(yawDeg: number): void {
	const r = yawDeg * DEG
	FWD.x   = Math.sin(r)
	FWD.z   = Math.cos(r)
	RIGHT.x = Math.cos(r)
	RIGHT.z = -Math.sin(r)
}


// MARK: Module state
let camEntity:      Entity | null = null
let lookTargetEnt:  Entity | null = null
let active                        = false
let currentAltitude               = CAM_ALTITUDE_DEFAULT
let zoomIndex                     = DESKTOP_ZOOM_SCALES.indexOf(DESKTOP_ZOOM_DEFAULT)
let zoomMobile                    = false
let zoomInit                      = false
let fovApplied                    = -1

// Focus point (world XZ) and its smoothed ground height.
const targetPos = { x: CENTER_X, z: CENTER_Z }
let focusY      = 0
/** Smoothed effective camera distance (m) after clamps. */
let camDist     = CAM_ALTITUDE_DEFAULT * ISO_DIST_PER_SCALE

// Yaw / auto-rotation state.
/** Target yaw slot (0..3 → 45 + 90k°). */
let yawSlot         = 0
/** Live yaw (deg) and the blend it is on. */
let yawDeg          = ISO_YAW_DEG
let yawFromDeg      = ISO_YAW_DEG
let yawToDeg        = ISO_YAW_DEG
let yawBlendT       = ISO_YAW_BLEND_S
/** Seconds since the last turn (hold / hysteresis). */
let sinceTurnS      = ISO_YAW_MIN_HOLD_S
let occludeClock    = 0
/** Continuous time the player has been hidden at the current yaw (s). */
let blockedS        = 0


// MARK: setupTopDownCamera
/** Create the VirtualCamera + look-target entities and register the update system. Call once at boot. */
export function setupTopDownCamera(): void {
	if (camEntity !== null) return

	lookTargetEnt = engine.addEntity()
	Transform.create(lookTargetEnt, {
		position: Vector3.create(targetPos.x, 0, targetPos.z),
	})

	camEntity = engine.addEntity()
	Transform.create(camEntity, {
		position: Vector3.create(
			targetPos.x - FWD.x * camDist * COS_P,
			camDist * SIN_P,
			targetPos.z - FWD.z * camDist * COS_P,
		),
	})
	VirtualCamera.create(camEntity, {
		lookAtEntity:      lookTargetEnt,
		fov:               ISO_FOV_DEG,
		defaultTransition: { transitionMode: VirtualCamera.Transition.Speed(TRANSITION_SPEED) },
	})

	// Hotkeys:
	//   1 (IA_ACTION_3) = toggle spectator / isometric view (mobile: the round eye button in layer.topDownZoom)
	//   (2 mute: audio.ts, 3 leaderboard: layer.leaderboard.tsx, 4 help: layer.helpPanel.tsx.
	//   Rotate has no hotkey, button only.)
	// E (IA_PRIMARY) is claimed by torchInput.ts and must NOT be consumed here.
	engine.addSystem((dt: number) => {
		if (inputSystem.isTriggered(InputAction.IA_ACTION_3, PointerEventType.PET_DOWN)) { // 1: view
			playUiClick()
			toggleTopDownCamera()
		}

		if (active) updateCamera(dt)
	})
}


// MARK: updateCamera
/**
 * Per-frame camera update. Advances the focus point based on mode, clamps
 * it, then places the camera along the iso diagonal and clamps that pose
 * inside the scene, above terrain and under the ceiling.
 */
function updateCamera(dt: number): void {
	updateYaw(dt)
	{
		const p = Transform.getOrNull(engine.PlayerEntity)?.position
		if (p) {
			const t = 1 - Math.exp(-FOLLOW_RATE * dt)
			const dx = p.x - targetPos.x
			const dz = p.z - targetPos.z
			if (Math.abs(dx) < FOLLOW_SNAP_EPSILON && Math.abs(dz) < FOLLOW_SNAP_EPSILON) {
				targetPos.x = p.x
				targetPos.z = p.z
			} else {
				targetPos.x += dx * t
				targetPos.z += dz * t
			}
		}
	}

	clampToBounds()

	// Focus height follows the terrain under the focus point (smoothed).
	const gy = groundAt(targetPos.x, targetPos.z)
	focusY += (gy - focusY) * (1 - Math.exp(-ISO_FOCUS_Y_RATE * dt))

	const wantFull = currentAltitude * ISO_DIST_PER_SCALE
	const want = Math.min(wantFull, maxDistance())
	camDist += (want - camDist) * (1 - Math.exp(-ISO_DIST_RATE * dt))
	// Never lag outside a hard limit while smoothing.
	if (camDist > want) camDist = Math.min(camDist, maxDistance())
	writeFov(targetFov(wantFull, camDist))

	const { cx, cy, cz } = camPoseFor(FWD.x, FWD.z)

	if (lookTargetEnt !== null) {
		const t = Transform.getMutable(lookTargetEnt)
		t.position.x = targetPos.x
		t.position.y = focusY
		t.position.z = targetPos.z
	}
	if (camEntity !== null) {
		const t = Transform.getMutable(camEntity)
		t.position.x = cx
		t.position.y = cy
		t.position.z = cz
	}
}


// MARK: camPoseFor
/** Camera position for the current focus / distance along ground-forward (fx, fz), clamped. */
function camPoseFor(fx: number, fz: number): { cx: number; cy: number; cz: number } {
	const cx = targetPos.x - fx * camDist * COS_P
	const cz = targetPos.z - fz * camDist * COS_P
	let   cy = focusY + camDist * SIN_P
	const yMin = groundAt(cx, cz) + ISO_GROUND_CLEAR_M
	const yMax = sceneHeightLimitM() - ISO_CEILING_MARGIN_M
	if (cy < yMin) cy = yMin
	if (cy > yMax) cy = yMax
	return { cx, cy, cz }
}


// MARK: updateYaw
/**
 * Advance the yaw blend (shortest way, smoothstep) and, every
 * ISO_OCCLUDE_SAMPLE_S, run the occlusion test that may start a turn.
 */
function updateYaw(dt: number): void {
	sinceTurnS += dt
	if (yawBlendT < ISO_YAW_BLEND_S) {
		yawBlendT = Math.min(ISO_YAW_BLEND_S, yawBlendT + dt)
		const u = yawBlendT / ISO_YAW_BLEND_S
		yawDeg  = yawFromDeg + (yawToDeg - yawFromDeg) * (u * u * (3 - 2 * u))
		setYawFrame(yawDeg)
		if (yawBlendT >= ISO_YAW_BLEND_S) {
			yawDeg = yawOfSlot(yawSlot)
			setYawFrame(yawDeg)
		}
		return
	}
	if (!ISO_AUTO_ROTATE_ENABLED) return
	occludeClock += dt
	if (occludeClock < ISO_OCCLUDE_SAMPLE_S) return
	const step = occludeClock
	occludeClock = 0
	const p = Transform.getOrNull(engine.PlayerEntity)?.position
	if (!p) return
	if (!isPlayerHiddenAt(yawOfSlot(yawSlot), p.x, p.y, p.z)) {
		blockedS = 0
		return
	}
	blockedS += step
	if (blockedS < ISO_OCCLUDE_BLOCKED_S || sinceTurnS < ISO_YAW_MIN_HOLD_S) return
	// Nearest turns first (±90°), then the opposite side.
	for (const k of [1, -1, 2]) {
		if (isPlayerHiddenAt(yawOfSlot(yawSlot + k), p.x, p.y, p.z)) continue
		console.log(`topDownCamera: player hidden ${blockedS.toFixed(2)}s, turning to ${yawOfSlot(yawSlot + k)}°`)
		rotateView(k)
		return
	}
	// Nothing clear: keep the yaw; retry after another hold.
	sinceTurnS = 0
}


// MARK: isPlayerHiddenAt
/**
 * True when terrain (16 m cell tops) rises above the ray from the camera
 * at `yawD` to the player's chest. Samples every ISO_OCCLUDE_STEP_M,
 * skipping the player's immediate surroundings.
 */
function isPlayerHiddenAt(yawD: number, px: number, py: number, pz: number): boolean {
	const r  = yawD * DEG
	const { cx, cy, cz } = camPoseFor(Math.sin(r), Math.cos(r))
	const tx = px
	const ty = py + ISO_OCCLUDE_CHEST_M
	const tz = pz
	const dx = cx - tx
	const dy = cy - ty
	const dz = cz - tz
	const flat = Math.hypot(dx, dz)
	const len  = Math.hypot(flat, dy)
	if (flat < 1e-3) return false
	const n = Math.max(2, Math.ceil(len / ISO_OCCLUDE_STEP_M))
	for (let i = 1; i < n; i++) {
		const u = i / n
		if (u * flat < ISO_OCCLUDE_NEAR_M) continue
		const x = tx + dx * u
		const y = ty + dy * u
		const z = tz + dz * u
		if (groundAt(x, z) > y + ISO_OCCLUDE_MARGIN_M) return true
	}
	return false
}


// MARK: rotateView
/** Turn the overview by `steps` × 90° (blended). Resets the hold. */
export function rotateView(steps: number): void {
	if (steps === 0) return
	yawSlot    = (((yawSlot + steps) % 4) + 4) % 4
	yawFromDeg = yawDeg
	let to     = yawOfSlot(yawSlot)
	// Shortest way round from the live yaw.
	while (to - yawFromDeg > 180) to -= 360
	while (to - yawFromDeg < -180) to += 360
	yawToDeg   = to
	yawBlendT  = 0
	sinceTurnS = 0
	blockedS   = 0
}


// MARK: groundAt
/** Terrain height, 0 outside the scene / before terrain is ready. */
function groundAt(x: number, z: number): number {
	const y = activeGroundYAt(x, z)
	return Number.isFinite(y) ? y : 0
}


// MARK: maxDistance
/**
 * Longest throw that keeps the camera inside the scene (inset) and under
 * the ceiling. Near the edges the camera backs into (south / west with
 * yaw 45) the view tightens instead of leaving the scene.
 */
function maxDistance(): number {
	let max = Infinity
	const bx = -FWD.x * COS_P
	const bz = -FWD.z * COS_P
	const lo = ISO_BOUNDS_INSET_M
	const hiX = SCENE_WORLD_SIZE_X_METERS - ISO_BOUNDS_INSET_M
	const hiZ = SCENE_WORLD_SIZE_Z_METERS - ISO_BOUNDS_INSET_M
	if (bx < -1e-6) max = Math.min(max, (targetPos.x - lo) / -bx)
	if (bx >  1e-6) max = Math.min(max, (hiX - targetPos.x) / bx)
	if (bz < -1e-6) max = Math.min(max, (targetPos.z - lo) / -bz)
	if (bz >  1e-6) max = Math.min(max, (hiZ - targetPos.z) / bz)
	const ceil = sceneHeightLimitM() - ISO_CEILING_MARGIN_M - focusY
	if (SIN_P > 1e-6) max = Math.min(max, ceil / SIN_P)
	return Math.max(4, max)
}


// MARK: clampToBounds
/** Keep the focus point inside the scene, with a small margin. */
function clampToBounds(): void {
	const margin = FOCUS_BOUNDS_MARGIN_BASE * (currentAltitude / 30)
	const minX = -margin
	const maxX = SCENE_WORLD_SIZE_X_METERS + margin
	const minZ = -margin
	const maxZ = SCENE_WORLD_SIZE_Z_METERS + margin
	if (targetPos.x < minX) targetPos.x = minX
	if (targetPos.x > maxX) targetPos.x = maxX
	if (targetPos.z < minZ) targetPos.z = minZ
	if (targetPos.z > maxZ) targetPos.z = maxZ
}


// MARK: toggleTopDownCamera
/** Flip between the isometric view and the normal player camera. Recenters on entry. */
export function toggleTopDownCamera(): void {
	if (camEntity === null) return
	active = !active

	if (active) {
		const p = Transform.getOrNull(engine.PlayerEntity)?.position
		if (p) {
			targetPos.x = p.x
			targetPos.z = p.z
		}
		// Pixelwars zoom: latch the platform table; mobile snaps to closest each open.
		const mobile = isMobile()
		useZoomTable(mobile, !zoomInit || mobile)
		zoomInit = true
		// Seed the pose so the transition glides straight to the final framing.
		focusY  = groundAt(targetPos.x, targetPos.z)
		camDist = Math.min(currentAltitude * ISO_DIST_PER_SCALE, maxDistance())
		updateCamera(0)
	}

	const main = MainCamera.getMutableOrNull(engine.CameraEntity)
		?? MainCamera.create(engine.CameraEntity)
	main.virtualCameraEntity = active ? camEntity : undefined
}


// MARK: isTopDownActive
/** True while the isometric VirtualCamera is the active camera. */
export function isTopDownActive(): boolean {
	return active
}


// MARK: zoom tables (pixelwars)
function zoomTable(): readonly number[] {
	return zoomMobile ? MOBILE_ZOOM_SCALES : DESKTOP_ZOOM_SCALES
}

/** Latch the platform table. `snapDefault`: mobile ? closest, desktop ? DESKTOP_ZOOM_DEFAULT. */
function useZoomTable(mobile: boolean, snapDefault: boolean): void {
	zoomMobile = mobile
	const table = zoomTable()
	if (snapDefault) {
		const i = mobile ? 0 : table.indexOf(DESKTOP_ZOOM_DEFAULT)
		zoomIndex = i >= 0 ? i : 0
	} else if (zoomIndex < 0 || zoomIndex >= table.length) {
		zoomIndex = 0
	}
	currentAltitude = table[zoomIndex]
}

function stepZoom(dir: 1 | -1): void {
	const table = zoomTable()
	const next = zoomIndex + dir
	if (next < 0 || next >= table.length) return
	zoomIndex = next
	currentAltitude = table[zoomIndex]
}

/** Same framed width as an ISO_FOV_DEG camera at `wantDist` when clamped to `distCap`. */
function targetFov(wantDist: number, distCap: number): number {
	if (wantDist <= distCap) return ISO_FOV_DEG
	const tanHalf = Math.tan(ISO_FOV_DEG * DEG / 2) * (wantDist / distCap)
	return Math.min(ISO_FOV_MAX_DEG, 2 * Math.atan(tanHalf) / DEG)
}

function writeFov(next: number): void {
	if (camEntity === null || Math.abs(next - fovApplied) < 0.05) return
	fovApplied = next
	VirtualCamera.getMutable(camEntity).fov = next
}


// MARK: zoomIn
/** Next closer step of the platform table. */
export function zoomIn(): void { if (active) stepZoom(-1) }

// MARK: zoomOut
/** Next farther step of the platform table. */
export function zoomOut(): void { if (active) stepZoom(1) }

// MARK: canZoomIn
export function canZoomIn(): boolean { return active && zoomIndex > 0 }

// MARK: canZoomOut
export function canZoomOut(): boolean { return active && zoomIndex < zoomTable().length - 1 }


// MARK: getTopDownFocus
/** Ground point (x, z) the overview camera is centred on, or null while the overview is off. */
export function getTopDownFocus(): { x: number; z: number } | null {
	return active ? { x: targetPos.x, z: targetPos.z } : null
}
