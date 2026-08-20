/**
 * topDownCamera.ts — spectator-style overhead camera with follow + pan.
 *
 * Two modes:
 *   FOLLOW  — lookTarget lerps toward the player each frame (default).
 *   FREE    — lookTarget is driven by pan input (mouse drag on desktop,
 *             d-pad hold on mobile). Follow re-engages on recenter().
 *
 * Camera pose:
 *   The VirtualCamera sits directly above the lookTarget with a small
 *   east offset so `lookAtEntity` produces a real forward vector. This
 *   keeps WASD axis-aligned with the view and puts world +X at the top
 *   of the screen (see the header comment of the previous revision for
 *   the geometric reasoning).
 *
 * Public API:
 *   setupTopDownCamera()   — create entities + register systems (call once).
 *   toggleTopDownCamera()  — flip in/out of top-down mode.
 *   isTopDownActive()      — for UI reactivity.
 *   applyPanDelta(dx, dy)  — desktop drag input, screen pixels.
 *   beginPan(vx, vz)       — mobile d-pad, start panning at velocity (m/s).
 *   endPan()               — mobile d-pad, stop.
 *   recenter()             — snap back to FOLLOW mode.
 */

import { engine, Entity, InputAction, MainCamera, PointerEventType, Transform, VirtualCamera, inputSystem } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

import { SCENE_WORLD_SIZE_X_METERS, SCENE_WORLD_SIZE_Z_METERS } from 'src/shared/settings'


// MARK: Tuning
// Scene center at ground level.
const CENTER_X = SCENE_WORLD_SIZE_X_METERS / 2
const CENTER_Z = SCENE_WORLD_SIZE_Z_METERS / 2

// Altitude. Kept inside DCL mobile's ~100 m fog band. Higher = more
// scene visible, but risks hitting fog + culling. Mobile drops lower
// because the portrait viewport makes 30 m read as "tiny ant world" —
// 20 m keeps the player + campfire legibly sized on a phone.
const CAM_ALTITUDE_DESKTOP = 30
const CAM_ALTITUDE_MOBILE  = 20
const CAM_ALTITUDE         = isMobile() ? CAM_ALTITUDE_MOBILE : CAM_ALTITUDE_DESKTOP

// Small horizontal offset so lookAtEntity produces a real forward
// vector — required for WASD axis alignment. See old header comment.
const CAM_EAST_OFFSET = 3

// VirtualCamera transition speed (m/s) when entering / exiting top-down.
const TRANSITION_SPEED = 200

// Follow smoothing rate (higher = snappier catch-up to the player).
// Framerate-independent via 1 - exp(-k * dt).
const FOLLOW_RATE = 5.0

// Below this distance (m) FOLLOW snaps to the player exactly, avoiding
// sub-millimeter jitter from continuous exponential lerp.
const FOLLOW_SNAP_EPSILON = 0.05

// How far outside the scene bounds the camera is allowed to pan. Small
// negative overpan lets players frame edge content without the void
// filling half the screen. Positive would prevent seeing the edges.
const PAN_BOUNDS_MARGIN = 4

// Mobile d-pad pan speed (world m/s). Scaled with altitude so the
// on-screen pan feel (screens/s) stays constant across zoom levels.
// Baseline: 22 m/s at 30 m altitude → ~0.6 screens/s per axis.
const DPAD_PAN_SPEED = 22 * (CAM_ALTITUDE / 30)

// Desktop drag: minimum cumulative pixel movement before a click starts
// panning. Prevents quick taps from stealing pan focus. Reset on release.
const DRAG_START_THRESHOLD_PX = 3

// Multiplier applied to desktop pixel-drag → world meters. Nominally
// worldPerPx = visibleHeight / screenHeight. At altitude 30m with a
// ~60° vertical FOV and a 1080-tall canvas: 34.6 / 1080 ≈ 0.032 m/px.
// Kept as a single constant instead of deriving from FOV (which the
// SDK doesn't expose reliably) — tune by feel.
const DRAG_M_PER_PX = 0.025


// MARK: Module state
let camEntity:      Entity | null = null
let lookTargetEnt:  Entity | null = null
let active                        = false

// Camera modes.
const enum Mode { FOLLOW, FREE }
let mode: Mode = Mode.FOLLOW

// Continuously-updated look target (world XZ, Y always 0). Position is
// smoothed toward this each frame; camera pose is derived from it.
const targetPos = { x: CENTER_X, z: CENTER_Z }

// Current pan velocity from mobile d-pad (world m/s on X / Z axes).
// Desktop drag applies deltas directly and leaves this at zero.
const panVel = { x: 0, z: 0 }

// Desktop drag bookkeeping.
let dragActive         = false     // pointer currently held
let dragPanning        = false     // drag has crossed the pan threshold
let dragAccumPx        = 0         // |cursor motion| since press, for threshold


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
		position: Vector3.create(targetPos.x + CAM_EAST_OFFSET, CAM_ALTITUDE, targetPos.z),
	})
	VirtualCamera.create(camEntity, {
		lookAtEntity:      lookTargetEnt,
		defaultTransition: { transitionMode: VirtualCamera.Transition.Speed(TRANSITION_SPEED) },
	})

	// Hotkeys:
	//   1 (IA_ACTION_3) = toggle spectator / top-down view
	//
	// E (IA_PRIMARY) is claimed by torchInput.ts for light/relight and
	// must NOT be consumed here. F (IA_SECONDARY) is currently free.
	engine.addSystem((dt: number) => {
		if (inputSystem.isTriggered(InputAction.IA_ACTION_3, PointerEventType.PET_DOWN)) toggleTopDownCamera()

		// Pointer up always ends any in-progress desktop drag, regardless
		// of whether top-down is still active. Safety net for edge cases
		// where the user toggles out mid-drag.
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
 * Per-frame camera update. Advances targetPos based on mode, clamps to
 * bounds, then writes camera + lookTarget transforms.
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
		// FREE mode: any player movement input immediately re-engages
		// follow. Mobile's on-screen joystick maps to the same actions,
		// so this covers both platforms with one check.
		if (
			inputSystem.isPressed(InputAction.IA_FORWARD)  ||
			inputSystem.isPressed(InputAction.IA_BACKWARD) ||
			inputSystem.isPressed(InputAction.IA_LEFT)     ||
			inputSystem.isPressed(InputAction.IA_RIGHT)
		) {
			recenter()
		} else {
			// Apply mobile d-pad velocity (desktop drag applies its own
			// delta directly in applyPanDelta).
			targetPos.x += panVel.x * dt
			targetPos.z += panVel.z * dt
		}
	}

	clampToBounds()

	// Write derived poses.
	if (lookTargetEnt !== null) {
		const t = Transform.getMutable(lookTargetEnt)
		t.position.x = targetPos.x
		t.position.z = targetPos.z
	}
	if (camEntity !== null) {
		const t = Transform.getMutable(camEntity)
		t.position.x = targetPos.x + CAM_EAST_OFFSET
		t.position.z = targetPos.z
	}
}


// MARK: clampToBounds
/** Keep the camera focus inside the scene, with a small overpan margin. */
function clampToBounds(): void {
	const minX = -PAN_BOUNDS_MARGIN
	const maxX = SCENE_WORLD_SIZE_X_METERS + PAN_BOUNDS_MARGIN
	const minZ = -PAN_BOUNDS_MARGIN
	const maxZ = SCENE_WORLD_SIZE_Z_METERS + PAN_BOUNDS_MARGIN
	if (targetPos.x < minX) targetPos.x = minX
	if (targetPos.x > maxX) targetPos.x = maxX
	if (targetPos.z < minZ) targetPos.z = minZ
	if (targetPos.z > maxZ) targetPos.z = maxZ
}


// MARK: toggleTopDownCamera
/** Flip between top-down and normal player camera. Recenters on entry. */
export function toggleTopDownCamera(): void {
	if (camEntity === null) return
	active = !active

	if (active) {
		// Snap follow target to player on entry so the transition ends
		// on the player rather than the last stale pan location.
		const p = Transform.getOrNull(engine.PlayerEntity)?.position
		if (p) {
			targetPos.x = p.x
			targetPos.z = p.z
		}
		mode = Mode.FOLLOW
		panVel.x = 0
		panVel.z = 0
	}

	const main = MainCamera.getMutableOrNull(engine.CameraEntity)
		?? MainCamera.create(engine.CameraEntity)
	main.virtualCameraEntity = active ? camEntity : undefined
}


// MARK: isTopDownActive
/** True while the top-down VirtualCamera is the active camera. */
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
 * Desktop drag input: pan the camera by a screen-pixel delta.
 *
 * Convention is grab-and-pull-the-world (Google Maps): dragging the
 * cursor right/up scrolls the *content* right/up on screen, which means
 * the camera focus moves in the opposite direction.
 *
 * Axis mapping (screen top = world +X because of CAM_EAST_OFFSET):
 *   screenDelta.y (cursor up) → world +X moves toward the top → target
 *                                slides in -X to reveal more +X (no —
 *                                see grab-and-pull rule → target -X).
 *   screenDelta.x (cursor right) → world -Z moves right → target +Z.
 * If a first playtest shows inverted feel, flip either sign here — the
 * geometry is intentional but not obvious.
 */
export function applyPanDelta(dxPx: number, dyPx: number): void {
	if (!active) return
	if (!dragActive) return

	dragAccumPx += Math.abs(dxPx) + Math.abs(dyPx)
	if (!dragPanning) {
		if (dragAccumPx < DRAG_START_THRESHOLD_PX) return
		dragPanning = true
	}

	// Switch to FREE on first pan tick; stays there until recenter().
	mode = Mode.FREE

	// screenDelta origin is bottom-left, positive y = cursor moved up.
	// Signs empirically corrected after playtest (initial derivation of
	// screen-top=+X was wrong — see the matching note in the d-pad
	// axis map in layer.topDownPan.tsx).
	targetPos.x +=  dyPx * DRAG_M_PER_PX
	targetPos.z += -dxPx * DRAG_M_PER_PX
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
 * Mobile d-pad: start panning at a constant velocity (world m/s on the
 * X / Z axes). Also switches the camera to FREE mode.
 */
export function beginPan(vx: number, vz: number): void {
	if (!active) return
	mode     = Mode.FREE
	panVel.x = vx
	panVel.z = vz
}


// MARK: endPan
/** Mobile d-pad: stop panning. Camera holds its current position. */
export function endPan(): void {
	panVel.x = 0
	panVel.z = 0
}


// MARK: getDpadSpeed
/** Exposed so the UI can pass the tuned constant into {@link beginPan}. */
export function getDpadSpeed(): number {
	return DPAD_PAN_SPEED
}
