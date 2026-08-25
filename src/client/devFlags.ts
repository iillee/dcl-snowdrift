/**
 * devFlags.ts \u2014 client-side dev/debug toggles.
 *
 * Single source of truth for HUD elements that are useful during local
 * iteration but must be OFF in deploy builds. Flipping any of these to
 * true, saving, and hot-reloading re-exposes the feature without any
 * other code changes.
 *
 * Rule of thumb: anything that lets a random visitor nuke shared state
 * (rerolls, weather, server-side stats), or that adds visual noise
 * unrelated to the pitch, lives here.
 *
 * When adding a new flag, name it SHOW_* / ENABLE_* and add a one-line
 * comment describing what appears when it is on.
 */


// MARK: Action-bar buttons
/** \u21bb button that re-seeds maze + props + perimeter for every client in-scene. */
export const SHOW_REROLL_BUTTON       = false

/** Snowflake button that cycles global precipitation level. */
export const SHOW_PRECIPITATION_BUTTON = false

/** '#' button + bottom-left server-stats panel (CRDT + tile counts, entity budget). */
export const SHOW_SERVER_STATS         = false

/** '⇆' button that forces an immediate server cycle rollover (world regen). */
export const SHOW_DEV_ROLL_BUTTON      = false

/**
 * Small top-right readout showing the local torch's cluster tier, disc
 * radius, and how many lit torches are within CLUSTER_PROXIMITY_M.
 * Useful when playtesting warmth-together solo with two accounts —
 * lets you confirm the mechanic fired without watching both flames at
 * once. See src/client/ui/layers/layer.torchWarmthDebug.tsx.
 */
export const SHOW_TORCH_WARMTH_DEBUG   = true
