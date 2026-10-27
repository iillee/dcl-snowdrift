/**
 * heatFront.ts - crystal release melt front geometry. Pure; shared by the
 * server (authoritative melt, snowState.tickHeatFronts) and the client
 * (burst sphere + predicted melt, stationMarkers / snowModel) so both
 * agree on where the front is at any moment.
 *
 * The front is the ground circle of an energy sphere centred `h` m above
 * the crystal's ground point whose radius grows LINEARLY in time from 0 to
 * hypot(R + band, h). With h = 0 it is a plain disc growing linearly to R + band.
 */

/** The front runs this far past R so cells at the very edge still finish melting. */
export const HEAT_FRONT_BAND_M = 3

/** Sphere radius at progress u (0..1) for a heat disc of radius R, centre height h. */
export function heatFrontSphereRadiusM(u: number, R: number, h: number): number {
	return Math.min(1, Math.max(0, u)) * Math.hypot(R + HEAT_FRONT_BAND_M, h)
}

/** Front (ground circle) radius at progress u. May exceed R by up to HEAT_FRONT_BAND_M. */
export function heatFrontRadiusM(u: number, R: number, h: number): number {
	const uu = Math.min(1, Math.max(0, u))
	if (h <= 0) return uu * (R + HEAT_FRONT_BAND_M)
	const s = heatFrontSphereRadiusM(uu, R, h)
	return Math.sqrt(Math.max(0, s * s - h * h))
}