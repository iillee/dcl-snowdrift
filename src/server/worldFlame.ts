/**
 * worldFlame.ts — server-authoritative world end: "the world's flame goes out".
 *
 * The run ends when ALL flame is out for WORLD_FLAME_GRACE_MS:
 *   - no lit campfire (spawn hearth fuel > 0, or any lit hidden pit), AND
 *   - no player still in the scene holding a lit torch (frozen players'
 *     torches are dark anyway and are ignored; leavers drop out via the
 *     frostLife presence heartbeat).
 * Lava, monuments and the thaw stage do NOT count as flame. Lava is still
 * a torch relight source, so relighting there inside the grace creates a
 * lit torch and cancels the end. Freezing no longer matters.
 *
 * Disabled once the world thaw (victory, stage 3) is reached: the
 * post-win days roll to a new winter on their own (stations.ts).
 *
 * Guards:
 *   - Grace: dark must hold WORLD_FLAME_GRACE_MS (a relight or torch-to-
 *     torch chain inside the window cancels it).
 *   - Armed: only after some flame has been seen this cycle (the spawn
 *     hearth starts lit, so this is immediate today; it protects any
 *     future unlit start).
 *   - Someone present: at least one fully loaded player (heartbeat), so
 *     an empty server never reseeds on its own; a player joining a dead
 *     world sees the end cards once they have loaded.
 *
 * The dev snuff (emberFail.ts checkEmberFail) still ends at once.
 */

import { engine } from '@dcl/sdk/ecs'

import { onCycleRoll } from 'src/server/cycle'
import { beginExtinction, isEmberFailing } from 'src/server/emberFail'
import { isPlayerFrozen, livingPlayerIds, presentPlayerIds } from 'src/server/frostLife'
import { getMainFireFuel } from 'src/server/hearthFuel'
import { isAnyHiddenFireLit } from 'src/server/hiddenCampfire'
import { isWorldThawed } from 'src/server/stations'
import { isUserTorchLit } from 'src/server/torch'


// MARK: Tuning
/** All flame must stay out this long before the world ends. */
export const WORLD_FLAME_GRACE_MS = 4000
/** Check cadence (s). */
const CHECK_INTERVAL_S = 0.5


// MARK: State
let installed  = false
let clock      = 0
/** Some flame was seen lit this cycle. */
let armed      = false
/** Date.now() when everything went dark; 0 = something burns. */
let darkSinceMs = 0


// MARK: describeFlame
/** First living flame found, or '' when all flame is out. */
function describeFlame(): string {
	if (getMainFireFuel() > 0) return 'spawn hearth'
	if (isAnyHiddenFireLit())  return 'hidden campfire'
	for (const id of livingPlayerIds()) {
		if (!isPlayerFrozen(id) && isUserTorchLit(id)) return `torch (${id})`
	}
	return ''
}


// MARK: checkWorldFlame
function checkWorldFlame(): void {
	if (isEmberFailing()) { darkSinceMs = 0; return }
	// Victory / post-win days: the new winter comes from the post-win roll.
	if (isWorldThawed()) {
		if (darkSinceMs !== 0) console.log('[Server] worldFlame: world end off — world thaw reached')
		darkSinceMs = 0
		return
	}
	const flame = describeFlame()
	if (flame !== '') {
		armed = true
		if (darkSinceMs !== 0) {
			darkSinceMs = 0
			console.log(`[Server] worldFlame: world end cancelled — ${flame} is lit`)
		}
		return
	}
	if (!armed) return
	if (presentPlayerIds().length === 0) {
		if (darkSinceMs !== 0) console.log('[Server] worldFlame: world end on hold — nobody in the scene')
		darkSinceMs = 0
		return
	}
	const now = Date.now()
	if (darkSinceMs === 0) {
		darkSinceMs = now
		console.log(`[Server] worldFlame: all flame is out — world ends in ${WORLD_FLAME_GRACE_MS} ms unless relit`)
		return
	}
	if (now - darkSinceMs < WORLD_FLAME_GRACE_MS) return
	darkSinceMs = 0
	beginExtinction('no lit campfire and no lit torch anywhere')
}


// MARK: setupWorldFlameServer
/** Install the all-flame-out watcher. Idempotent; call after frostLife. */
export function setupWorldFlameServer(): void {
	if (installed) return
	installed = true
	onCycleRoll(() => {
		armed       = false
		darkSinceMs = 0
	})
	engine.addSystem((dt: number) => {
		clock += dt
		if (clock < CHECK_INTERVAL_S) return
		clock = 0
		checkWorldFlame()
	})
	console.log(`[Server] worldFlame: installed (grace ${WORLD_FLAME_GRACE_MS} ms)`)
}
