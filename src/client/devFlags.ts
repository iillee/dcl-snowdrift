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

/** '⏭' button that jumps the day/night clock to the next phase. */
export const SHOW_DEV_ADVANCE_PHASE    = false

/** 'OUT' button that snuffs every fire to playtest ember-fail game over. */
export const SHOW_DEV_SNUFF_BUTTON     = false


// MARK: Survival cheats (ladder / geography iteration)
/** Skip frost gain and hold the bar at full warm. Flip off before deploy. */
export const DEV_DISABLE_FROST = false

/** Keep the local torch lit at full fuel (no drain). Flip off before deploy. */
export const DEV_KEEP_TORCH_LIT = false


// MARK: Thaw debug (TEMPORARY)
/**
 * TEMPORARY 'THAW' button right of the frost bar (desktop + mobile).
 * Lights all 3 monuments server-side and runs the real 3/3 thaw path.
 * The server handler is gated on this same flag. SET false BEFORE DEPLOY.
 */
export const DEBUG_THAW_BUTTON = false

/**
 * TEMPORARY 'END' button right of the frost bar (desktop + mobile), floating-crystals ruleset: fires the ENDING
 * ("The world begins to thaw": beams link the monument tips, every monument pulses and melts a large area, the title shows) without activating all
 * monuments (3 in the compact_3 playtest profile, 6 in the standard one). Releases every unreleased monument silently,
 * then the ending starts ~3 s later. Taints the run (no leaderboard record is ever written for that run). The server
 * handler is gated on this same flag. SET false BEFORE DEPLOY.
 *
 * PLAYTEST HOST ONLY: leave DEBUG_FINALE_BUTTON false for everyone else's build; to keep a fallback in a playtest, set it
 * true AND list the host's wallet in DEBUG_FINALE_HOSTS - then only that wallet sees the button and the server ignores
 * 'debugFinale' from anyone else.
 */
export const DEBUG_FINALE_BUTTON = false

/** Lower-case wallet addresses allowed to use DEBUG_FINALE_BUTTON. Empty = no restriction (when the flag is on, everyone). */
export const DEBUG_FINALE_HOSTS: string[] = []

/** True when this wallet may see / use the debug finale button (the flag is on and, if a host list is set, the wallet is on it). Used by the client button and the server handler. */
export function debugFinaleAllowed(address: string): boolean {
	return DEBUG_FINALE_BUTTON && (DEBUG_FINALE_HOSTS.length === 0 || DEBUG_FINALE_HOSTS.includes(address.toLowerCase()))
}

/**
 * Local preview of the volcano lava + smoke stage (0..3); -1 = off (use
 * landed monuments). Visual only: thaw radius / heat stay server-driven.
 * For server-side staging use DEBUG_THAW_BUTTON ('+1' lights the next
 * monument). Keep -1 in commits.
 */
export const DEBUG_VOLCANO_STAGE_OVERRIDE: number = -1
