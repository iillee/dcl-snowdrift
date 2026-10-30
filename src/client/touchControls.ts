/**
 * touchControls.ts - mobile on-screen gamepad configuration.
 *
 * The DCL native mobile HUD renders a fixed cluster of on-screen buttons around the jump button. We hide every native action button (joystick + jump stay) and replace them with scene UI:
 *
 *   - IA_PRIMARY   (`E`) - hidden. The scene's own Torch hotbar button is the mobile surface for the desktop E-press.
 *   - IA_SECONDARY (`F`) - hidden. Reserved / unused in Cryocene.
 *   - IA_ACTION_3 / 4 / 5 / 6 (`1` `2` `3` `4`) - hidden on touch. Desktop uses them only for the overhead view (topDownCamera.ts): 4 = eye,
 *                          3 = rotate, 2 = zoom out, 1 = zoom in (mute, star and ? have no key). On touch the eye, zoom and rotate are our own
 *                          round UI buttons in the right-hand column above jump (layer.topDownZoom; the eye calls the same toggleTopDownCamera() and
 *                          turns yellow while the overview is on), and mute, star (leaderboard) and ? (help) are on-screen round buttons at the
 *                          top-left of the HUD row (layer.brushSize MuteButton / LeaderboardButton / HelpButton, hosted by layer.frostBar).
 *   - IA_POINTER   (the native hand) - hidden on touch. Its two users have on-screen paths: the obelisk cinematic ends on the SKIP label in the
 *                          bottom bar (layer.cinematic) or the jump button (obeliskCinematic), and the summit map table gets a VIEW MAP button
 *                          while the player stands within reach (layer.topDownZoom, summitMapTable.isNearSummitTable).
 *
 * TouchScreenControls only affects native on-screen buttons, so all of this is a no-op on desktop. There is no mobile input dispatch in this file:
 * the hidden slots are replaced by plain UI buttons.
 */

import { InputAction, TouchScreenControls, engine } from '@dcl/sdk/ecs'
import { isMobile } from '@dcl/sdk/platform'


// MARK: Module state
let installed = false

// MARK: applyLayout
/** Write the TouchScreenControls component once at boot: every native action button hidden (joystick + jump stay). */
function applyLayout(): void {
	TouchScreenControls.createOrReplace(engine.RootEntity, {
		touchInputs: [
			// Hide the two default keyboard-affordance buttons - the scene has its own mobile UI for the underlying actions.
			{ inputAction: InputAction.IA_PRIMARY,   hide: true },
			{ inputAction: InputAction.IA_SECONDARY, hide: true },
			// Slots 1 / 2 / 3 / 4 (desktop: zoom in, zoom out, rotate, eye) and the pointer hand: on-screen UI buttons instead (see the header).
			{ inputAction: InputAction.IA_ACTION_3, hide: true },
			{ inputAction: InputAction.IA_ACTION_4, hide: true },
			{ inputAction: InputAction.IA_ACTION_5, hide: true },
			{ inputAction: InputAction.IA_ACTION_6, hide: true },
			{ inputAction: InputAction.IA_POINTER,  hide: true },
		],
		hideJoystick : false,
		hideCrosshair: false,
	})
}


// MARK: setupTouchControls
/** Configure the native mobile button cluster. Idempotent - safe to call once from bootstrap. No-op on desktop. */
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
	console.log('touchControls: setupTouchControls: mobile layout applied (all native action buttons hidden; eye / mute / star / help are UI buttons)')
}