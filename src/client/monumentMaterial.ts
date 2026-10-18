/**
 * monumentMaterial.ts - shared matte deep-black material for the monument
 * stone: the obelisk glb parts (GltfNodeModifiers override in
 * stationMarkers.ts), the socket border slabs and the socket bottom
 * (terrainRenderer.ts addMonumentPit). No reflectivity of any kind:
 * metallic 0, roughness 1, specular 0, black reflectivity colour. The
 * beams keep their own emissive material (stationMarkers paintGlow).
 */

import { Color3, Color4 } from '@dcl/sdk/math'


// MARK: Tuning
/** Deep black albedo for the obelisk and its socket border / bottom. */
export const MONUMENT_BLACK = Color4.create(0.02, 0.02, 0.02, 1)

/** PBR fields for every monument stone surface (Material.setPbrMaterial / GltfNodeModifiers). */
export const MONUMENT_MATTE_PBR = {
	albedoColor      : MONUMENT_BLACK,
	metallic         : 0,
	roughness        : 1,
	specularIntensity: 0,
	reflectivityColor: Color3.create(0, 0, 0),
}
