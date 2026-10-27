/**
 * campfireEmote.ts - the local player's "start a fire" emote.
 *
 * A custom scene emote (assets/animations/campfire_emote.glb, 2.57 s, one-shot): the avatar squats over
 * the logs, strikes the tinderbox with quick alternating hand strokes, a small flare-up, then stands.
 * Played only for the local player when they light a carried log with E (buildFire.ts). Other players
 * see it through the normal emote sync. Movement is locked while it plays (lockedEmote.ts).
 */

import { playLockedEmote, stopLockedEmote } from 'src/client/lockedEmote'


const CAMPFIRE_EMOTE_SRC = 'assets/animations/campfire_emote.glb'
/** Clip length (77 frames at 30 fps = 2.567 s) plus a hair. */
const CAMPFIRE_EMOTE_MS = 2600


// MARK: playCampfireEmote
export function playCampfireEmote(): void {
	playLockedEmote(CAMPFIRE_EMOTE_SRC, CAMPFIRE_EMOTE_MS)
}


// MARK: stopCampfireEmote
/** Cancel it (server refused the fire) - only while this emote could still be playing. */
export function stopCampfireEmote(): void {
	stopLockedEmote()
}