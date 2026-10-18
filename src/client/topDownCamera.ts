/**
 * topDownCamera.ts — spectator-style angled isometric camera with follow + pan.
 *
 * Two modes:
 *   FOLLOW  — the focus point lerps toward the player each frame (default).
 *   FREE    — the focus point is driven by pan input (mouse drag on desktop,
 *             d-pad hold on mobile). Follow re-engages on recenter().
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
 *   All pan input (drag + d-pad) is mapped through F / R, so panning always
 *   follows the rotated view.
 *
 * Public API:
 *   setupTopDownCamera()   — create entities + register systems (call once).
 *   toggleTopDownCamera()  — flip in/out of top-down mode.
 *   isTopDownActive()      — for UI reactivity.
 *   applyPanDelta(dx, dy)  — desktop drag input, screen pixels.
 *   beginPan(vx, vz)       — mobile d-pad, start panning (see beginPan for the axis convention).
 *   endPan()               — mobile d-pad, stop.
 *   recenter()             — snap back to FOLLOW mode.
 *   getAvatarOffscreenHint() — edge face-bubble cue when the avatar left the view.
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
/** Yaw (deg, clockwise from north/+Z). 45 = classic diagonal; camera sits SW looking NE. */
export const ISO_YAW_DEG   = 45
/**
 * Vertical field of view (deg) passed to VirtualCamera.fov (SDK default 60).
 * Narrower = flatter / more axonometric but the camera must sit further away
 * (distance ∝ 1 / tan(fov/2)), which hits scene bounds, the ceiling and the
 * mobile fog band sooner. 30 is the compromise; 20 is flatter but ~1.6x the throw.
 */
export const ISO_FOV_DEG   = 30

// Zoom level ("view scale"): the old overhead altitude, kept as the zoom unit
// so the zoom buttons + pan speeds keep their tuning. A view scale of A frames
// the same on-screen height as the old 60°-FOV camera at A metres altitude;
// the actual camera distance is A * ISO_DIST_PER_SCALE.
const CAM_ALTITUDE_DESKTOP_DEFAULT = 30
const CAM_ALTITUDE_MOBILE_DEFAULT  = 20
const CAM_ALTITUDE_DEFAULT         = isMobile() ? CAM_ALTITUDE_MOBILE_DEFAULT : CAM_ALTITUDE_DESKTOP_DEFAULT
const CAM_ALTITUDE_MIN             = 12
const CAM_ALTITUDE_MAX             = 75
const CAM_ALTITUDE_STEP            = 6

/** Reference FOV the zoom scale was tuned against (old overhead camera, deg). */
const REF_FOV_DEG = 60
const DEG = Math.PI / 180
/** Camera distance (m) per unit of view scale: tan(ref/2) / tan(fov/2). FOV 30 → ≈ 2.15. */
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

// VirtualCamera transition speed (m/s) when entering / exiting. Raised from
// 200 with the longer throw so the glide takes about as long as before.
const TRANSITION_SPEED = 260

// Follow smoothing rate (higher = snappier catch-up to the player).
// Framerate-independent via 1 - exp(-k * dt).
const FOLLOW_RATE = 5.0

// Below this distance (m) FOLLOW snaps to the player exactly.
const FOLLOW_SNAP_EPSILON = 0.05

// How far outside the scene bounds the focus point may sit, scaled with zoom.
const PAN_BOUNDS_MARGIN_BASE = 4

// Mobile d-pad pan speed (world m/s at view scale 30), scaled with zoom.
const DPAD_PAN_SPEED_BASE = 22

// Desktop drag: minimum cumulative pixel movement before a click starts panning.
const DRAG_START_THRESHOLD_PX = 3

// Desktop pixel-drag → world metres at view scale 30 (scaled with zoom).
// Screen-vertical drags are divided by sin(pitch) because the ground is
// foreshortened along the view direction.
const DRAG_M_PER_PX_BASE = 0.05


// MARK: Derived pose
const SIN_P = Math.sin(ISO_PITCH_DEG * DEG)
const COS_P = Math.cos(ISO_PITCH_DEG * DEG)
/** Ground-plane screen-up (camera forward, flattened). */
const FWD   = { x: Math.sin(ISO_YAW_DEG * DEG), z: Math.cos(ISO_YAW_DEG * DEG) }
/** Ground-plane screen-right. */
const RIGHT = { x: Math.cos(ISO_YAW_DEG * DEG), z: -Math.sin(ISO_YAW_DEG * DEG) }


// MARK: Module state
let camEntity:      Entity | null = null
let lookTargetEnt:  Entity | null = null
let active                        = false
let currentAltitude               = CAM_ALTITUDE_DEFAULT

const enum Mode { FOLLOW, FREE }
let mode: Mode = Mode.FOLLOW

// Focus point (world XZ) and its smoothed ground height.
const targetPos = { x: CENTER_X, z: CENTER_Z }
let focusY      = 0
/** Smoothed effective camera distance (m) after clamps. */
let camDist     = CAM_ALTITUDE_DEFAULT * ISO_DIST_PER_SCALE

// Current pan velocity from mobile d-pad (world m/s on X / Z axes).
const panVel = { x: 0, z: 0 }

// Desktop drag bookkeeping.
let dragActive         = false
let dragPanning        = false
let dragAccumPx        = 0


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
	//   1 (IA_ACTION_3) = toggle spectator / isometric view
	// E (IA_PRIMARY) is claimed by torchInput.ts and must NOT be consumed here.
	engine.addSystem((dt: number) => {
		if (inputSystem.isTriggered(InputAction.IA_ACTION_3, PointerEventType.PET_DOWN)) {
			playUiClick()
			toggleTopDownCamera()
		}

		if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_UP)) {
			dragActive  = false
			dragPanning = false
			dragAccumPx = 0
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
	if (mode === Mode.FOLLOW) {
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
	} else {
		if (
			inputSystem.isPressed(InputAction.IA_FORWARD)  ||
			inputSystem.isPressed(InputAction.IA_BACKWARD) ||
			inputSystem.isPressed(InputAction.IA_LEFT)     ||
			inputSystem.isPressed(InputAction.IA_RIGHT)
		) {
			recenter()
		} else {
			targetPos.x += panVel.x * dt
			targetPos.z += panVel.z * dt
		}
	}

	clampToBounds()

	// Focus height follows the terrain under the focus point (smoothed).
	const gy = groundAt(targetPos.x, targetPos.z)
	focusY += (gy - focusY) * (1 - Math.exp(-ISO_FOCUS_Y_RATE * dt))

	const want = Math.min(currentAltitude * ISO_DIST_PER_SCALE, maxDistance())
	camDist += (want - camDist) * (1 - Math.exp(-ISO_DIST_RATE * dt))
	// Never lag outside a hard limit while smoothing.
	if (camDist > want) camDist = Math.min(camDist, maxDistance())

	const cx = targetPos.x - FWD.x * camDist * COS_P
	const cz = targetPos.z - FWD.z * camDist * COS_P
	let   cy = focusY + camDist * SIN_P
	const yMin = groundAt(cx, cz) + ISO_GROUND_CLEAR_M
	const yMax = sceneHeightLimitM() - ISO_CEILING_MARGIN_M
	if (cy < yMin) cy = yMin
	if (cy > yMax) cy = yMax

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
/** Keep the focus point inside the scene, with a small overpan margin. */
function clampToBounds(): void {
	const margin = PAN_BOUNDS_MARGIN_BASE * (currentAltitude / 30)
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
		mode = Mode.FOLLOW
		panVel.x = 0
		panVel.z = 0
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


// MARK: recenter
/** Snap back to FOLLOW mode (camera glides back to the player). */
export function recenter(): void {
	mode     = Mode.FOLLOW
	panVel.x = 0
	panVel.z = 0
}


// MARK: applyPanDelta
/**
 * Desktop drag input: pan by a screen-pixel delta, grab-and-pull-the-world
 * (Google Maps). Mapped through the rotated screen frame:
 *   drag up    → focus moves along -FWD (world slides up the screen)
 *   drag right → focus moves along -RIGHT
 */
export function applyPanDelta(dxPx: number, dyPx: number): void {
	if (!active) return
	if (!dragActive) return

	dragAccumPx += Math.abs(dxPx) + Math.abs(dyPx)
	if (!dragPanning) {
		if (dragAccumPx < DRAG_START_THRESHOLD_PX) return
		dragPanning = true
	}

	mode = Mode.FREE

	// screenDelta origin is bottom-left, positive y = cursor moved up.
	const mPerPx = DRAG_M_PER_PX_BASE * (currentAltitude / 30)
	const up     = -dyPx * mPerPx / SIN_P
	const right  = -dxPx * mPerPx
	targetPos.x += FWD.x * up + RIGHT.x * right
	targetPos.z += FWD.z * up + RIGHT.z * right
}


// MARK: beginDrag
/** Desktop: called by the UI overlay on pointer press. */
export function beginDrag(): void {
	if (!active) return
	dragActive  = true
	dragPanning = false
	dragAccumPx = 0
}


// MARK: endDrag
/** Desktop: called by the UI overlay on pointer release. */
export function endDrag(): void {
	dragActive  = false
	dragPanning = false
	dragAccumPx = 0
}


// MARK: isDragging
/** True while a desktop pan drag is in progress (post-threshold). */
export function isDragging(): boolean {
	return dragPanning
}


// MARK: beginPan
/**
 * Mobile d-pad: start panning. The d-pad still passes the legacy overhead
 * axis convention (screen-up = vx -1, screen-right = vz +1), which is
 * converted here to the rotated iso frame so "up" pans along the camera's
 * forward ground direction. Switches to FREE mode.
 */
export function beginPan(vx: number, vz: number): void {
	if (!active) return
	mode = Mode.FREE
	const up    = -vx
	const right =  vz
	panVel.x = FWD.x * up + RIGHT.x * right
	panVel.z = FWD.z * up + RIGHT.z * right
}


// MARK: endPan
/** Mobile d-pad: stop panning. Camera holds its current position. */
export function endPan(): void {
	panVel.x = 0
	panVel.z = 0
}


// MARK: getDpadSpeed
/** D-pad speed (m/s), scaled with zoom so on-screen pan feel stays constant. */
export function getDpadSpeed(): number {
	return DPAD_PAN_SPEED_BASE * (currentAltitude / 30)
}


// MARK: zoomIn
/** Move the camera closer by one step. Clamped at min. */
export function zoomIn(): void {
	if (!active) return
	const next = currentAltitude - CAM_ALTITUDE_STEP
	currentAltitude = next < CAM_ALTITUDE_MIN ? CAM_ALTITUDE_MIN : next
}


// MARK: zoomOut
/** Move the camera further away by one step. Clamped at max. */
export function zoomOut(): void {
	if (!active) return
	const next = currentAltitude + CAM_ALTITUDE_STEP
	currentAltitude = next > CAM_ALTITUDE_MAX ? CAM_ALTITUDE_MAX : next
}


// MARK: canZoomIn
export function canZoomIn(): boolean {
	return active && currentAltitude > CAM_ALTITUDE_MIN
}


// MARK: canZoomOut
export function canZoomOut(): boolean {
	return active && currentAltitude < CAM_ALTITUDE_MAX
}


// MARK: AvatarOffscreenHint
export interface AvatarOffscreenHint {
	/** Direction toward the avatar on screen. 0 = top, 90 = right, 180 = bottom, 270 = left. */
	angleDeg: number
}


// MARK: getAvatarOffscreenHint
/**
 * When free-panned far enough that the local avatar is outside the
 * viewport, returns the screen angle toward them. Null while following,
 * inactive, or while the avatar is still on screen.
 */
export function getAvatarOffscreenHint(): AvatarOffscreenHint | null {
	if (!active) return null
	if (mode === Mode.FOLLOW) return null

	const p = Transform.getOrNull(engine.PlayerEntity)?.position
	if (!p) return null

	// Screen-space metres (at the focus plane) from focus → avatar.
	const dx = p.x - targetPos.x
	const dz = p.z - targetPos.z
	const screenRight = dx * RIGHT.x + dz * RIGHT.z
	const screenUp    = (dx * FWD.x + dz * FWD.z) * SIN_P + (p.y - focusY) * COS_P

	// Half-viewport at the focus from the actual throw + FOV.
	const halfH = camDist * Math.tan(ISO_FOV_DEG * DEG / 2)
	const halfW = halfH * (isMobile() ? 0.85 : 1.65)
	const margin = 0.82
	const onScreen =
		Math.abs(screenRight) <= halfW * margin &&
		Math.abs(screenUp)    <= halfH * margin
	if (onScreen) return null

	let angleDeg = Math.atan2(screenRight, screenUp) * (180 / Math.PI)
	if (angleDeg < 0) angleDeg += 360
	return { angleDeg }
}
