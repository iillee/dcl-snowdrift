/**
 * components.ts — synced ECS components for the frost survival loop.
 *
 * FrostLevel is per-player and synced so allies can eventually see each
 * other's danger via the HUD or an above-head icon. Kept small (single
 * float) to avoid CRDT chatter — the accumulation system only writes
 * when the value actually changes past a small epsilon.
 *
 * FrostDeath is populated when a player freezes. Owned by the frozen
 * client for v1 (client-authoritative death, matching the current
 * seed / paint model). Also synced so other players can render a
 * corpse at the death spot and, later, initiate a revive.
 */

import { engine, Schemas } from '@dcl/sdk/ecs'


// MARK: FrostLevel
/**
 * Per-player frost accumulation in the range [0, FROST_MAX]. 0 = warm,
 * FROST_MAX = frozen. Written by the accumulation system, read by the
 * HUD pill and the death FSM.
 */
export const FrostLevel = engine.defineComponent('snowdrift::frost-level', {
	value: Schemas.Float,
})


// MARK: FrostDeath
/**
 * Set on the frozen player's entity the frame they hit FROST_MAX.
 * Cleared when they wake up post-respawn. Includes world coords of
 * the death spot so other clients can render a corpse anchor without
 * needing to track the player's live transform.
 *
 * `awake` transitions false -> true when the player's first movement
 * input is detected after the fade-in completes; the corpse-render
 * system uses that flag to know when to stop drawing the slumped body.
 */
export const FrostDeath = engine.defineComponent('snowdrift::frost-death', {
	deathT : Schemas.Float,   // scene-relative seconds when they froze
	deathX : Schemas.Float,
	deathZ : Schemas.Float,
	awake  : Schemas.Boolean,
})
