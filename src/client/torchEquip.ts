/**
 * torchEquip.ts — local player's torch-slot state.
 *
 * Currently a stub that reports the torch as always equipped, matching
 * the existing setupTorch() attach-on-boot behaviour. When Day 6's
 * equip-from-campfire pickup mechanic lands, this becomes a real state
 * machine (pickup / drop, fuel timer, extinguish). Everything else in
 * the client — HUD slot, F-key input, torch model visibility — reads
 * from these getters so the transition is a single-file change.
 */


// MARK: State
let equipped = true
let raised   = false


// MARK: isTorchEquipped
/** True while the local player is holding the torch. */
export function isTorchEquipped(): boolean {
	return equipped
}


// MARK: setTorchEquipped
export function setTorchEquipped(value: boolean): void {
	equipped = value
	if (!equipped) raised = false
}


// MARK: isTorchRaised
/**
 * True while the player is actively raising the torch (F held / just
 * pressed). Cosmetic only — no gameplay effect yet, drives the HUD
 * highlight and the upper-body emote trigger.
 */
export function isTorchRaised(): boolean {
	return raised
}


// MARK: setTorchRaised
export function setTorchRaised(value: boolean): void {
	raised = value && equipped
}
