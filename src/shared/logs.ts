/**
 * logs.ts - shared constants for the wood-log pile system.
 *
 * Position + radius knobs used by both server (drop-slot nudge) and
 * client (proximity poll for pickup). Kept in shared/ so any drift
 * between the two lives in one file. There is no starter pile.
 */

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { TERRAIN_HEARTH_SURFACE_Y } from 'src/shared/settings'


// MARK: Hearth drop slot
/**
 * Spot south of the campfire used only to keep two dropped piles from
 * stacking on each other at the fire. Nothing spawns here.
 */
export const INITIAL_LOGS_PILE_X = CAMPFIRE_WORLD_X + 0
export const INITIAL_LOGS_PILE_Z = CAMPFIRE_WORLD_Z + -2.5


// MARK: Ground height for pile entities
/**
 * All pile GLBs sit at this Y. Shared so a server-driven Transform
 * (if we ever add position sync via CRDT) matches what the client
 * would spawn locally.
 */
export const LOGS_PILE_WORLD_Y = TERRAIN_HEARTH_SURFACE_Y


// MARK: Pickup radius
/** Player must be within this radius (m) of a pile centre to pick up. */
export const LOGS_PICKUP_RADIUS_M  = 1.8
export const LOGS_PICKUP_RADIUS_SQ = LOGS_PICKUP_RADIUS_M * LOGS_PICKUP_RADIUS_M
/**
 * Max vertical gap (m) between the player's feet and the item (its ground
 * Y). Without it a player on a cliff anywhere above a dropped item picked
 * it up. Server re-checks with the feet Y the client reports.
 */
export const LOGS_PICKUP_MAX_DY_M = 1.5
/** Horizontal 1.8 m + vertical 1.5 m pickup reach (feet vs item ground Y). */
export function inPickupReach(px: number, py: number, pz: number, x: number, y: number, z: number): boolean {
	const dx = px - x, dz = pz - z
	return dx * dx + dz * dz <= LOGS_PICKUP_RADIUS_SQ && Math.abs(py - y) <= LOGS_PICKUP_MAX_DY_M
}
/** Server-side vertical check (client-reported feet Y; NaN/missing passes for old clients). */
export function pickupDyOk(py: number | undefined, itemY: number): boolean {
	return py === undefined || !Number.isFinite(py) || Math.abs(py - itemY) <= LOGS_PICKUP_MAX_DY_M + 0.25
}
