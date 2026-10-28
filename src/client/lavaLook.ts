/**
 * lavaLook.ts - the one lava material (client). The volcano lava lake (volcanoCrown.ts) and the monument socket lava
 * (socketLava.ts) both paint through it, so they always look the same.
 */

import { Entity, Material } from '@dcl/sdk/ecs'
import { Color3, Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

export const COLOR_LAVA     = Color4.create(1.0, 0.42, 0.04, 1)
export const LAVA_EMISSIVE  = Color3.create(1.0, 0.38, 0.03)
/** Cooler crust colours for the low heat values (blended by `heat`). */
export const COLOR_CRUST    = Color4.create(0.30, 0.08, 0.03, 1)
export const CRUST_EMISSIVE = Color3.create(0.70, 0.16, 0.02)

/**
 * Paint `e` as lava. heat 0..1 = dark crust .. bright orange, `emissive` = desktop glow intensity (already scaled by any
 * presence); mobile gets the basic (unlit) material.
 */
export function paintLava(e: Entity, heat: number, emissive: number): void {
	const k = Math.max(0, Math.min(1, heat))
	const col = Color4.create(
		COLOR_CRUST.r + (COLOR_LAVA.r - COLOR_CRUST.r) * k,
		COLOR_CRUST.g + (COLOR_LAVA.g - COLOR_CRUST.g) * k,
		COLOR_CRUST.b + (COLOR_LAVA.b - COLOR_CRUST.b) * k,
		1,
	)
	if (isMobile()) {
		Material.setBasicMaterial(e, { diffuseColor: col, castShadows: false })
		return
	}
	Material.setPbrMaterial(e, {
		albedoColor      : col,
		emissiveColor    : Color3.create(
			CRUST_EMISSIVE.r + (LAVA_EMISSIVE.r - CRUST_EMISSIVE.r) * k,
			CRUST_EMISSIVE.g + (LAVA_EMISSIVE.g - CRUST_EMISSIVE.g) * k,
			CRUST_EMISSIVE.b + (LAVA_EMISSIVE.b - CRUST_EMISSIVE.b) * k,
		),
		emissiveIntensity: emissive,
		roughness        : 0.6,
		metallic         : 0.0,
		castShadows      : false,
	})
}