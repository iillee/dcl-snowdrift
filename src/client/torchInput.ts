/**
 * torchInput.ts — per-frame torch fuel drain + E-press relight handler.
 *
 * Runs two concerns in a single system so we don't pay two per-frame
 * closure allocations:
 *
 *   1. Fuel drain. While the torch is lit, subtracts real seconds from
 *      torchEquip.getTorchFuelSeconds() and extinguishes at zero.
 *   2. Relight input. On the rising edge of the E key (IA_PRIMARY),
 *      if the player is inside the campfire heat radius, refills fuel
 *      and re-lights the flame. Any E press outside the radius is
 *      swallowed silently for now (future: play a "cant relight here"
 *      shake / SFX).
 *
 * The upper-body torch-raise emote from the earlier torch-v2 stub is
 * intentionally NOT wired here \u2014 relight is instant in v1; the emote
 * comes back later as the relight ritual (design owner: user).
 */

import { InputAction, Transform, engine, inputSystem } from '@dcl/sdk/ecs'

import { playTorchSfxLocal }                                                 from 'src/client/audio'
import { CAMPFIRE_RELIGHT_RADIUS_SQ_M, CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { isInHiddenRelightRange, isReadyToIgniteHidden, requestHiddenIgnite } from 'src/client/hiddenCampfire'
import {
	TORCH_FUEL_MAX_S,
	consumeTorchFuel,
	extinguishTorch,
	getTorchFuelSeconds,
	isTorchEquipped,
	isTorchLit,
	relightTorch,
} from 'src/client/torchEquip'


// MARK: Module state
let installed  = false
let eHeldPrev  = false
// Post-relight cooldown. Blocks a follow-up relight (no double-tap
// spam of the whoosh SFX) AND hides the relight prompt so the player
// isn't nagged to press E again while the torch is fresh. Cleared
// automatically by wall-clock comparison — no timer entity needed.
const RELIGHT_COOLDOWN_MS = 5000
let   relightCooldownUntilMs = 0


// MARK: isTorchRelightOnCooldown
/**
 * True while the post-relight cooldown window is active. Consumed by
 * layer.relightPrompt to suppress the tooltip for RELIGHT_COOLDOWN_MS
 * after each successful ignition.
 */
export function isTorchRelightOnCooldown(): boolean {
	return Date.now() < relightCooldownUntilMs
}


// MARK: tryRelightAtFire
/**
 * Shared relight entry-point used by BOTH the E-key handler and the
 * mobile TorchButton tap. Runs the full gate stack:
 *   - torch must be equipped
 *   - hidden-campfire ignition takes priority if the player is on the pit
 *   - otherwise the player must be inside the central OR hidden fire radius
 *
 * Silently no-ops when any gate fails, so callers can wire it directly
 * to an onMouseDown without worrying about accidental relights from
 * anywhere on the map.
 */
export function tryRelightAtFire(): void {
	if (!isTorchEquipped()) return
	// Post-relight cooldown swallows the input entirely — no SFX, no
	// fuel top-off, no state change. Prevents accidental double-taps
	// from firing the whoosh twice in a row.
	if (isTorchRelightOnCooldown()) return

	if (isReadyToIgniteHidden()) {
		requestHiddenIgnite()
		return
	}

	const t = Transform.getOrNull(engine.PlayerEntity)
	if (t === null) return
	const { x, z } = t.position
	const dx = x - CAMPFIRE_WORLD_X
	const dz = z - CAMPFIRE_WORLD_Z
	const nearCentral = dx * dx + dz * dz <= CAMPFIRE_RELIGHT_RADIUS_SQ_M
	const nearHidden  = isInHiddenRelightRange()

	if (!nearCentral && !nearHidden) {
		console.log(`torchInput: tryRelightAtFire: outside fire radius (fuel=${getTorchFuelSeconds().toFixed(1)}s)`)
		return
	}

	relightTorch()
	relightCooldownUntilMs = Date.now() + RELIGHT_COOLDOWN_MS
	// Torch ignition SFX fires here — on the successful relight action
	// itself, not on an isTorchLit() state edge. Topping off a still-lit
	// torch doesn't flip lit false->true, so an edge-based trigger would
	// silently skip every relight except the one after a full burnout.
	playTorchSfxLocal()
	console.log(`torchInput: tryRelightAtFire: torch relit (fuel restored to ${TORCH_FUEL_MAX_S}s)`)
}


// MARK: setupTorchInput
/**
 * Register the per-frame torch fuel + E-relight system. Idempotent \u2014
 * safe to call once from client bootstrap.
 */
export function setupTorchInput(): void {
	if (installed) {
		console.log('torchInput: setupTorchInput: already installed, skipping')
		return
	}
	installed = true

	engine.addSystem((dt: number) => {
		// \u2500\u2500 Fuel drain \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
		if (isTorchLit()) {
			const remaining = consumeTorchFuel(dt)
			if (remaining <= 0) {
				extinguishTorch()
				console.log('torchInput: torch burnt out (fuel=0)')
			}
		}

		// \u2500\u2500 E-press relight (only near fire) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
		const eHeld = inputSystem.isPressed(InputAction.IA_PRIMARY)
		const risingEdge = eHeld && !eHeldPrev
		eHeldPrev = eHeld

		if (!risingEdge) return
		tryRelightAtFire()
	})

	console.log('torchInput: setupTorchInput: fuel drain + E-relight active')
}
