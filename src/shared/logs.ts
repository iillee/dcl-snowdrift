/**
 * logs.ts - shared constants for the wood-log pile system.
 *
 * Position + radius knobs used by both server (drop-slot nudge) and
 * client (proximity poll for pickup). Kept in shared/ so any drift
 * between the two lives in one file. There is no starter pile.
 */

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'


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
export const LOGS_PILE_WORLD_Y = 0.25


// MARK: Pickup radius
/** Player must be within this radius (m) of a pile centre to pick up. */
export const LOGS_PICKUP_RADIUS_M  = 1.8
export const LOGS_PICKUP_RADIUS_SQ = LOGS_PICKUP_RADIUS_M * LOGS_PICKUP_RADIUS_M
