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

import { CAMPFIRE_MELT_RADIUS_SQ_M, CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
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
		if (!isTorchEquipped()) return

		const t = Transform.getOrNull(engine.PlayerEntity)
		if (t === null) return
		const { x, z } = t.position
		const dx = x - CAMPFIRE_WORLD_X
		const dz = z - CAMPFIRE_WORLD_Z
		const distSq = dx * dx + dz * dz

		if (distSq > CAMPFIRE_MELT_RADIUS_SQ_M) {
			// Outside the heat ring: no relight. Log at debug level so
			// we can grep for it in playtest but stay quiet in normal use.
			console.log(`torchInput: relight ignored \u2014 outside fire radius (fuel=${getTorchFuelSeconds().toFixed(1)}s)`)
			return
		}

		relightTorch()
		console.log(`torchInput: torch relit at fire (fuel restored to ${TORCH_FUEL_MAX_S}s)`)
	})

	console.log('torchInput: setupTorchInput: fuel drain + E-relight active')
}
