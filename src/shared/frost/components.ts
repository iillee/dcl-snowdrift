/**
 * components.ts — synced ECS components for the frost survival loop.
 *
 * FrostLevel is per-player and synced so allies can eventually see each
 * other's danger via the HUD or an above-head icon. Kept small (single
 * float) to avoid CRDT chatter — the accumulation system only writes
 * when the value actually changes past a small epsilon.
 *
 * FrostDeath is populated when a player freezes. Owned by the frozen
 * client (client-authoritative, matching feed and spark). Synced so
 * other players can draw an ice block at the death spot and thaw it
 * with a lit torch.
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
 * Deleted when they thaw or the run resets. Includes world coords of
 * the death spot so other clients can draw an ice block without
 * tracking the player's live transform.
 *
 * `awake` stays false while the block should show. The component is
 * removed on thaw rather than flipped, so a missing component means
 * the player is up.
 */
export const FrostDeath = engine.defineComponent('snowdrift::frost-death', {
	deathT : Schemas.Float,   // scene-relative seconds when they froze
	deathX : Schemas.Float,
	deathZ : Schemas.Float,
	awake  : Schemas.Boolean,
})
