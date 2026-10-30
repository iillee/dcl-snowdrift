/**
 * socketLava.ts - lava in the socket of a released obelisk (pure; client, server and scripts/socketLavaCheck).
 *
 * Once an obelisk's crystal is released and has left its socket, the empty socket (OBELISK_SOCKET_SIZE_M square, up to
 * OBELISK_SOCKET_DEPTH_M deep, black floor, the invisible physics plug at ground level keeps nobody from dropping in) shows a
 * thin pool of lava on its floor. It is a PERMANENT relight source: a player near it lights their torch with the same prompt / E
 * press / mobile button as at a campfire or the volcano lava (volcanoCrown.isInLavaRelightRange), so a world whose fires burned out
 * can always be relit once one obelisk is up. Nothing else: no warmth, no new input, no new message, and it is NOT living flame: it never
 * keeps the world from ending (worldFlame) and is not a wake point for frozen players (frostLife / death), so a world reset is never blocked.
 *
 * Sync / late join: there is NO extra state. The lava of slot i exists exactly when the server says obelisk i is released
 * (stationState active, hydrated to joiners) AND the crystal has left the socket (a function of the rise animation / hover pose,
 * which a late joiner snaps to), so every client agrees. The server needs nothing.
 */

import { LAVA_EMISSIVE_BY_STAGE, LAVA_HEAT_BY_STAGE, LAVA_RELIGHT_REACH_M } from 'src/shared/volcanoStages'
import { OBELISK_SOCKET_SIZE_M, obeliskSocketDepth } from 'src/shared/terrain/terrainMap'

/** Lava pool footprint edge (m): a hair inside the socket walls. */
export const SOCKET_LAVA_SIZE_M = OBELISK_SOCKET_SIZE_M - 0.1
/** Lava lid thickness above the socket floor (m) at full presence. */
export const SOCKET_LAVA_THICK_M = 0.4
/** Seconds the pool takes to fill in (height + glow) once the crystal has cleared it. */
export const SOCKET_LAVA_RISE_S = 2.5
/** The crystal's bottom tip must be this far above the lava top before the pool appears (m). */
export const SOCKET_LAVA_CLEAR_M = 0.3
/** Look: the volcano lava's stage-2 heat / glow (volcanoStages), so it reads as the same material. */
export const SOCKET_LAVA_HEAT = LAVA_HEAT_BY_STAGE[2]
export const SOCKET_LAVA_EMISSIVE = LAVA_EMISSIVE_BY_STAGE[2]
/** Torch relight: horizontal reach from the pool edge (m; the volcano lava's reach) ... */
export const SOCKET_LAVA_REACH_M = LAVA_RELIGHT_REACH_M
/** ... and how far above / below the ground beside the socket the torch may be (m). */
export const SOCKET_LAVA_ABOVE_M = 4
export const SOCKET_LAVA_BELOW_M = 2
/** A pool counts as lit (relight / wake) from this presence (0..1). */
export const SOCKET_LAVA_LIT_MIN = 0.5
/** Socket floor Y (m) for an obelisk whose ground top is groundY (same clamp as the terrain socket). */
export function socketLavaFloorY(groundY: number): number {
	return groundY - obeliskSocketDepth(groundY)
}

/** Pool thickness (m) at full presence: SOCKET_LAVA_THICK_M, less on a shallow socket so the pool stays a hair under the ground. */
export function socketLavaThickM(groundY: number): number {
	return Math.max(0.05, Math.min(SOCKET_LAVA_THICK_M, obeliskSocketDepth(groundY) - 0.05))
}

/** Lava top Y (m) at full presence. */
export function socketLavaTopY(groundY: number): number {
	return socketLavaFloorY(groundY) + socketLavaThickM(groundY)
}

/** True once the crystal's bottom tip (world Y) is clear of the pool, so the pool may appear. */
export function socketLavaClear(obeliskBottomY: number, groundY: number): boolean {
	return obeliskBottomY >= socketLavaTopY(groundY) + SOCKET_LAVA_CLEAR_M
}

/** Advance a presence value (0..1) by dt seconds toward 1 (clear) or 0 (not clear / not released). */
export function socketLavaPresenceStep(p: number, dt: number, clear: boolean): number {
	const d = dt / SOCKET_LAVA_RISE_S
	return Math.max(0, Math.min(1, clear ? p + d : p - d))
}

/** Pool height (m) at presence p on an obelisk whose ground top is groundY. */
export function socketLavaHeightM(p: number, groundY: number): number {
	return Math.max(0, Math.min(1, p)) * socketLavaThickM(groundY)
}

/** Horizontal distance (m) from (px, pz) to the pool's square footprint (0 inside). */
export function socketLavaDistance(px: number, pz: number, cx: number, cz: number): number {
	const h = SOCKET_LAVA_SIZE_M / 2
	const nx = Math.max(cx - h, Math.min(cx + h, px))
	const nz = Math.max(cz - h, Math.min(cz + h, pz))
	return Math.hypot(px - nx, pz - nz)
}

/** Can a torch at (px, py, pz) light from the pool of an obelisk at (cx, cz) on ground groundY with presence p? */
export function socketLavaCanRelight(px: number, py: number, pz: number, cx: number, cz: number, groundY: number, p: number): boolean {
	if (p < SOCKET_LAVA_LIT_MIN) return false
	const dy = py - groundY
	if (dy < -SOCKET_LAVA_BELOW_M || dy > SOCKET_LAVA_ABOVE_M) return false
	return socketLavaDistance(px, pz, cx, cz) <= SOCKET_LAVA_REACH_M
}