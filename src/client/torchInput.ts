/**
 * torchInput.ts — hold E to raise the held torch (upper-body scene emote).
 *
 * Mirrors flagtag's `avatarEmotes.ts` pattern: ships a scene-local
 * `_emote.glb` under `models/emotes/` and plays it via
 * `triggerSceneEmote({ mask: 0 })` so the upper body raises while the
 * legs stay under locomotion control. Works for every player with no
 * ownership check (unlike collection-v2 URNs, which the client silently
 * refuses to play in this preview session), and the mask IS honoured by
 * triggerSceneEmote (unlike the predefined-emote RPC path).
 *
 * Press-and-hold E starts a looping emote; release stops it.
 *
 * Placeholder asset: `models/emotes/TorchRaise_emote.glb` is currently
 * flagtag's boomerang-charge loop clip — an arm-held-up looping stance.
 * Replace with a bespoke torch-raise animation when authored (keep the
 * `_emote.glb` suffix, keep the path).
 *
 * Mobile: masked scene emotes crash the client on mobile (documented in
 * flagtag). Guarded via isMobile() so mobile players skip the emote —
 * the HUD slot highlight still fires so F-hold state stays visible.
 *
 * Requires scene.json requiredPermissions to include
 * `ALLOW_TO_TRIGGER_AVATAR_EMOTE` (already present).
 */

import { InputAction, engine, inputSystem } from '@dcl/sdk/ecs'
import { isMobile } from '@dcl/sdk/platform'
import { stopEmote, triggerSceneEmote } from '~system/RestrictedActions'

import { isTorchEquipped, setTorchRaised } from 'src/client/torchEquip'


// MARK: Tuning
// Scene-local emote file. Must live under the scene and end in `_emote.glb`
// for the SDK to accept it via triggerSceneEmote.
const TORCH_EMOTE_SRC = 'assets/models/torch_emote.glb'

// Upper-body mask constant. The scene-emote `mask` field is a bitmask where
// 0 means "upper body only" — legs keep running/jumping under locomotion.
const AM_UPPER_BODY = 0


// MARK: State
let fHeldLastFrame = false
let emoteActive    = false
let installed      = false


// MARK: emotesDisabled
/** Mobile kill switch — masked scene emotes crash the mobile client. */
function emotesDisabled(): boolean {
	return isMobile()
}


// MARK: setupTorchInput
/**
 * Register the F-key polling system. Idempotent — safe to call once
 * from client bootstrap.
 */
export function setupTorchInput(): void {
	if (installed) {
		console.log('torchInput: setupTorchInput: already installed, skipping')
		return
	}
	installed = true

	engine.addSystem(() => {
		const fHeld = inputSystem.isPressed(InputAction.IA_PRIMARY)

		// Press edge — start the loop.
		if (fHeld && !fHeldLastFrame) {
			if (!isTorchEquipped()) {
				console.log('torchInput: E pressed but torch not equipped — ignoring')
			} else {
				setTorchRaised(true)
				if (!emotesDisabled()) {
					console.log('torchInput: E down → triggerSceneEmote(TorchRaise, loop, mask=upper)')
					void triggerSceneEmote({
						src:  TORCH_EMOTE_SRC,
						loop: true,
						mask: AM_UPPER_BODY,
					}).catch((err) => {
						console.error('torchInput: triggerSceneEmote failed:', err)
					})
					emoteActive = true
				}
			}
		}

		// Release edge — stop the loop.
		if (!fHeld && fHeldLastFrame) {
			setTorchRaised(false)
			if (emoteActive) {
				console.log('torchInput: E up → stopEmote')
				void stopEmote({}).catch(() => {})
				emoteActive = false
			}
		}

		fHeldLastFrame = fHeld
	})

	console.log('torchInput: setupTorchInput: hold E to raise torch (upper-body scene emote)')
}
