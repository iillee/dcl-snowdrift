/**
 * touchControls.ts — mobile on-screen gamepad configuration.
 *
 * The DCL native mobile HUD always renders a fixed cluster of
 * on-screen buttons. We reshape that cluster to match the scene's
 * affordances:
 *
 *   \u2022 IA_PRIMARY   (`E`) \u2014 hidden. The scene's own relight-hand button
 *                            (see layer.mobileActions) is the mobile
 *                            surface for the desktop E-press.
 *   \u2022 IA_SECONDARY (`F`) \u2014 hidden. Reserved / unused in Snow Drift.
 *   \u2022 IA_ACTION_3  (`1`) \u2014 icon swapped to the eye glyph; dispatches
 *                            toggleTopDownCamera on rising edge.
 *   \u2022 IA_ACTION_4  (`2`) \u2014 icon swapped to the mute/unmute glyph;
 *                            dispatches toggleMusic on rising edge.
 *                            Icon re-applied after each toggle so the
 *                            mute state stays visible.
 *
 * TouchScreenControls only affects native on-screen buttons, so all of
 * this is a no-op on desktop.
 */

import {
	InputAction,
	PointerEventType,
	TouchScreenControls,
	engine,
	inputSystem,
} from '@dcl/sdk/ecs'
// (Transform is re-imported below alongside the torch helpers so the
// mobile-only pointer→relight guard can read the player position without
// duplicating the campfire radius check that lives in torchInput.ts.)
import { isMobile } from '@dcl/sdk/platform'

import { isMusicMuted, toggleMusic }             from 'src/client/audio'
import { toggleHelpPanel }                       from 'src/client/ui/layers/layer.helpPanel'
import { CAMPFIRE_RELIGHT_RADIUS_SQ_M, CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { isInHiddenRelightRange, isReadyToIgniteHidden, requestHiddenIgnite } from 'src/client/hiddenCampfire'
import { getTorchFuelFraction, isTorchEquipped, isTorchLit, relightTorch }  from 'src/client/torchEquip'
import { Transform }                             from '@dcl/sdk/ecs'


// MARK: Module state
let installed = false

// Icon sources for the two repurposed action buttons.
const EYE_ICON_SRC    = 'assets/images/eye3.png'
// Padded copies (transparent border) so the glyph reads at a similar
// visual size to the eye icon when the DCL native button stretches it
// to fill its square footprint. Source PNGs are 455 x 408 with almost
// no padding; padded copies are 700 x 700 (glyph occupies ~65 % of
// each axis). Regenerate with `pad-icons.js` if the source art changes.
const MUTED_ICON_SRC  = 'assets/images/muted_padded.png'
const UNMUTE_ICON_SRC = 'assets/images/unmute_padded.png'
// 700x700 white "?" glyph on transparent bg. Matches the eye + mute icon
// footprint so all three buttons read as one visual family.
const HELP_ICON_SRC   = 'assets/images/help-v3.png'


// MARK: applyLayout
/**
 * (Re)write the TouchScreenControls component with the current mute
 * icon. Called once at boot and again after every toggleMusic() so the
 * on-screen glyph reflects the audio state without needing per-frame
 * writes.
 */
function applyLayout(): void {
	const muteSrc = isMusicMuted() ? MUTED_ICON_SRC : UNMUTE_ICON_SRC

	TouchScreenControls.createOrReplace(engine.RootEntity, {
		touchInputs: [
			// Hide the two default keyboard-affordance buttons \u2014 the scene
			// has its own mobile UI for the underlying actions.
			{ inputAction: InputAction.IA_PRIMARY,   hide: true },
			{ inputAction: InputAction.IA_SECONDARY, hide: true },
			// Repurpose ACTION_3 / ACTION_4 as our eye + mute buttons.
			// Only the glyph changes here \u2014 the actual toggle happens in
			// the polling system below when the button reports pressed.
			{
				inputAction: InputAction.IA_ACTION_3,
				hide       : false,
				icon       : { tex: { $case: 'texture', texture: { src: EYE_ICON_SRC } } },
			},
			{
				inputAction: InputAction.IA_ACTION_4,
				hide       : false,
				icon       : { tex: { $case: 'texture', texture: { src: HELP_ICON_SRC } } },
			},
			{
				inputAction: InputAction.IA_ACTION_5,
				hide       : false,
				icon       : { tex: { $case: 'texture', texture: { src: muteSrc } } },
			},
		],
		hideJoystick : false,
		hideCrosshair: false,
	})
}


// MARK: setupTouchControls
/**
 * Configure the native mobile button cluster and register the input
 * dispatch system. Idempotent \u2014 safe to call once from bootstrap.
 * No-op on desktop.
 */
export function setupTouchControls(): void {
	if (installed) {
		console.log('touchControls: setupTouchControls: already installed, skipping')
		return
	}
	installed = true

	if (!isMobile()) {
		console.log('touchControls: setupTouchControls: desktop, no on-screen controls to configure')
		return
	}

	applyLayout()

	// Rising-edge dispatch. inputSystem.isTriggered(...PET_DOWN) already
	// gives us rising-edge semantics, so no manual `prev` bookkeeping.
	//
	// NOTE: IA_ACTION_3 is NOT handled here — topDownCamera.ts already
	// owns that input action and calls toggleTopDownCamera() on it. If
	// we also toggled here, mobile taps would flip the camera twice per
	// press (net: no visible change). Keep the eye dispatch there.
	engine.addSystem(() => {
		// ACTION_4 (`?`) opens the HelpPanel. Glyph is state-less — no re-apply.
		if (inputSystem.isTriggered(InputAction.IA_ACTION_4, PointerEventType.PET_DOWN)) {
			toggleHelpPanel()
		}
		// ACTION_5 (`3`, mute) — flip music state and re-apply so the glyph tracks it.
		if (inputSystem.isTriggered(InputAction.IA_ACTION_5, PointerEventType.PET_DOWN)) {
			toggleMusic()
			applyLayout()
		}

		// Mobile pointer-button → relight, gated by the same rule as the
		// desktop E-press: torch equipped, inside the fire heat ring, and
		// either unlit or not full. The DCL native pointer button (the
		// small hand glyph just left of jump) fires IA_POINTER on tap; we
		// reuse it here so mobile players have an obvious touch surface
		// without a scene-drawn extra button overlapping the HUD.
		//
		// Outside these conditions we do nothing — IA_POINTER stays free
		// for its other use (top-down drag-release in topDownCamera.ts).
		if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN)) {
			if (!isTorchEquipped()) return

			// Hidden campfire ignition takes priority — mirrors the desktop
			// E-press flow in torchInput.ts. Standing on a buried pit with a
			// lit torch turns the tap into an ignite request, not a relight.
			if (isReadyToIgniteHidden()) {
				requestHiddenIgnite()
				return
			}

			if (isTorchLit() && getTorchFuelFraction() >= 0.98) return

			const t = Transform.getOrNull(engine.PlayerEntity)
			if (t === null) return
			const dx = t.position.x - CAMPFIRE_WORLD_X
			const dz = t.position.z - CAMPFIRE_WORLD_Z
			const nearCentral = dx * dx + dz * dz <= CAMPFIRE_RELIGHT_RADIUS_SQ_M
			const nearHidden  = isInHiddenRelightRange()
			if (!nearCentral && !nearHidden) return

			relightTorch()
		}
	})

	console.log('touchControls: setupTouchControls: mobile layout applied (E/F hidden, 1=eye, 2=mute)')
}
