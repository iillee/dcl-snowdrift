/**
 * fireLight.ts — point lights that read remaining burn time.
 *
 * Torches: range and intensity follow fuel fraction so a dying flame
 * is a shrinking pool. Fires: range equals the melt ring, intensity
 * scales with that radius so a bigger fire lights a bigger circle.
 *
 * No shadows — the snow sun already uses the scene's shadow budget.
 * Active lights flicker so they read as fire, not bulbs.
 */

import { Entity, LightSource } from '@dcl/sdk/ecs'
import { Color3 } from '@dcl/sdk/math'


// MARK: Color
/** Warm firelight. Matches the torch flame orb (1.00, 0.80, 0.30). */
const FIRE_COLOR = Color3.create(1.00, 0.80, 0.30)


// MARK: Torch pool
/** Range (m) at an empty-but-still-lit torch. */
const TORCH_RANGE_MIN_M = 2.5
/** Range (m) at a full tank. Covers the 3 m melt path plus a little. */
const TORCH_RANGE_MAX_M = 7.0
/** Candela at empty-but-lit. */
const TORCH_INTENSITY_MIN = 1200
/** Candela at a full tank before night pinch. */
const TORCH_INTENSITY_MAX = 9000


// MARK: Hearth pool
/** Candela per metre of melt radius. Warm (8 m) lands near the SDK default. */
const HEARTH_INTENSITY_PER_M = 2000


// MARK: Write epsilons
const RANGE_EPS     = 0.05
const INTENSITY_EPS = 40


export interface FireLightParams {
	active    : boolean
	intensity : number
	range     : number
}


// MARK: fireFlicker
/**
 * Irregular intensity wobble (~0.78..1.00) and a smaller range shimmer,
 * unique per entity so neighbouring torches do not pulse in lockstep.
 */
function fireFlicker(
	entity: Entity,
	nowSec: number,
): { intensityMul: number, rangeMul: number } {
	const id = entity as number
	const a  = Math.sin(nowSec *  8.3 + id * 0.41)
	const b  = Math.sin(nowSec * 14.1 + id * 1.17)
	const c  = Math.sin(nowSec * 23.9 + id * 2.03)
	const n  = 0.50 * a + 0.32 * b + 0.18 * c
	return {
		intensityMul: 0.78 + 0.22 * (0.5 + 0.5 * n),
		rangeMul    : 0.94 + 0.08 * (0.5 + 0.5 * b),
	}
}


// MARK: torchLightParams
/**
 * Point-light params for a held torch. `fuelFrac` is 0..1 remaining
 * tank; `flameMul` is the phase pinch (night 0.65). Unlit is off.
 */
export function torchLightParams(
	lit     : boolean,
	fuelFrac: number,
	flameMul: number,
): FireLightParams {
	if (!lit) {
		return { active: false, intensity: 0, range: 0 }
	}
	const t = fuelFrac < 0 ? 0 : fuelFrac > 1 ? 1 : fuelFrac
	const mul = flameMul < 0.1 ? 0.1 : flameMul
	return {
		active    : true,
		intensity : (TORCH_INTENSITY_MIN + (TORCH_INTENSITY_MAX - TORCH_INTENSITY_MIN) * t) * mul,
		range     : TORCH_RANGE_MIN_M + (TORCH_RANGE_MAX_M - TORCH_RANGE_MIN_M) * t,
	}
}


// MARK: hearthLightParams
/**
 * Point-light params for a campfire. Range tracks the melt ring.
 * Intensity grows with the same radius so remaining fuel reads as a
 * bigger, brighter pool. Fuel at or below zero turns the light off.
 */
export function hearthLightParams(
	fuel        : number,
	meltRadiusM : number,
): FireLightParams {
	if (fuel <= 0 || meltRadiusM <= 0.1) {
		return { active: false, intensity: 0, range: 0 }
	}
	return {
		active    : true,
		intensity : meltRadiusM * HEARTH_INTENSITY_PER_M,
		range     : meltRadiusM,
	}
}


// MARK: syncPointLight
/**
 * Create or update a point LightSource on `entity`. Inactive lights
 * skip flicker and only write when active/range/intensity actually
 * change. Live lights rewrite intensity and range every frame so the
 * flame can flicker.
 */
export function syncPointLight(
	entity: Entity,
	params: FireLightParams,
): void {
	let intensity = params.intensity
	let range     = params.range
	if (params.active) {
		const flick = fireFlicker(entity, Date.now() * 0.001)
		intensity  *= flick.intensityMul
		range      *= flick.rangeMul
	}

	if (!LightSource.has(entity)) {
		LightSource.create(entity, {
			type     : LightSource.Type.Point({}),
			color    : FIRE_COLOR,
			intensity: intensity,
			range    : range,
			shadow   : false,
			active   : params.active,
		})
		return
	}
	const light = LightSource.getMutable(entity)
	if (light.active !== params.active) light.active = params.active
	if (params.active) {
		light.intensity = intensity
		light.range     = range
		return
	}
	if (Math.abs((light.intensity ?? 0) - intensity) >= INTENSITY_EPS) {
		light.intensity = intensity
	}
	if (Math.abs((light.range ?? 0) - range) >= RANGE_EPS) {
		light.range = range
	}
}

