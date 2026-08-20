/**
 * torchEquip.ts — local player's torch state.
 *
 * Owns three orthogonal flags plus the fuel timer:
 *   equipped  — do we have the torch item? (v1: always true)
 *   lit       — is it currently burning? (starts true at fire, false at
 *               fuel=0, flipped back to true by relightTorch())
 *   raised    — cosmetic hold-torch-aloft state (currently unused —
 *               reserved for a future relight emote ritual)
 *   fuel      — seconds of burn remaining. Decreases at 1s/s while lit.
 *
 * Nothing here touches the ECS engine directly. The fuel-tick system
 * and the E-press relight handler live in src/client/torchInput.ts,
 * which registers per-frame systems that mutate this state.
 */


// MARK: Tuning
/**
 * Full-tank torch fuel in seconds. Relight restores to this. Sized as
 * the exploration leash from the campfire — with default walk speed
 * ~2 m/s in snow, 90s = round-trip radius of roughly 60-80 m before
 * the flame dies. Tune based on playtest.
 */
export const TORCH_FUEL_MAX_S = 45


// MARK: State
let equipped = true
let raised   = false
// Torch starts UNLIT on scene load. Player must walk to the campfire
// and press E to light it. Same rule on respawn (see frost/death.ts) —
// waking up next to the fire is the invitation to relight, not a freebie.
let lit      = false
let fuel     = TORCH_FUEL_MAX_S


// MARK: isTorchEquipped
/** True while the local player is holding the torch. */
export function isTorchEquipped(): boolean {
	return equipped
}


// MARK: setTorchEquipped
export function setTorchEquipped(value: boolean): void {
	equipped = value
	if (!equipped) {
		raised = false
		lit    = false
	}
}


// MARK: isTorchLit
/**
 * True while the torch flame is burning. Drives whether the torch
 * halts baseline frost, sets the melt brush to 3x3, and (via the HUD)
 * whether the hotbar icon shows full-colour or dimmed.
 */
export function isTorchLit(): boolean {
	return equipped && lit
}


// MARK: relightTorch
/**
 * Ignite the torch and top the fuel back up. Called by the E-press
 * handler when the player stands inside the campfire's heat radius.
 * Safe to call every frame while E is held — subsequent calls just
 * re-top the fuel and re-assert lit.
 */
export function relightTorch(): void {
	if (!equipped) return
	lit  = true
	fuel = TORCH_FUEL_MAX_S
}


// MARK: extinguishTorch
/**
 * Force the flame out. Called by the fuel-tick system when fuel hits
 * zero. Fuel stays at 0 until relightTorch() runs.
 */
export function extinguishTorch(): void {
	lit = false
}


// MARK: getTorchFuelSeconds
/** Current fuel remaining in seconds, in the range [0, TORCH_FUEL_MAX_S]. */
export function getTorchFuelSeconds(): number {
	return fuel
}


// MARK: getTorchFuelFraction
/** Fuel remaining as a 0..1 fraction of TORCH_FUEL_MAX_S. */
export function getTorchFuelFraction(): number {
	return fuel / TORCH_FUEL_MAX_S
}


// MARK: consumeTorchFuel
/**
 * Decrement fuel by `dtSec`. Called by the per-frame drain system in
 * torchInput.ts. Clamps to 0 and does NOT auto-extinguish — the caller
 * checks the return value and decides whether to call extinguishTorch().
 * Separated so the drain system can log the burnout event once.
 */
export function consumeTorchFuel(dtSec: number): number {
	if (!lit) return fuel
	fuel -= dtSec
	if (fuel < 0) fuel = 0
	return fuel
}


// MARK: isTorchRaised
/**
 * Reserved for a future "raise torch aloft" emote used during the
 * campfire relight ritual. Not driven today — always false.
 */
export function isTorchRaised(): boolean {
	return raised
}


// MARK: setTorchRaised
export function setTorchRaised(value: boolean): void {
	raised = value && equipped
}
