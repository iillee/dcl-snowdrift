/**
 * expedition.ts (server) - the NEW EXPEDITION reset. Behaviour + rules: src/shared/expedition.ts (ExpeditionServerCore, also run by
 * scripts/expeditionCheck.mjs); this file only wires it to the room, the world cycle and the ending's start time.
 *
 *  - Nothing brings winter back after the ending: the restored world stays playable until a player asks for a new expedition
 *    (stations.ts has no post-win roll for floating crystals, worldFlame.ts stops ending the world once the ending was reached).
 *  - `newExpeditionRequest` (any connected player) is accepted only when the expedition is complete AND the world is restored; it starts
 *    ONE shared countdown (NEW_EXPEDITION_COUNTDOWN_S), repeated presses change nothing. `newExpeditionCancel`: initiator's wallet only.
 *    If the initiator leaves, nothing listens for it: the countdown simply continues.
 *  - At zero: rollCycle() - the same path as the dev roll: fresh seed, Day 1, obelisks / finale / oasis / fires / snow / wood /
 *    torches reset by their own onCycleRoll handlers, the leaderboard's contributor list and run taint cleared. This module never calls
 *    the leaderboard's record functions and never taints the run, so a reset neither writes a record nor spoils the next run.
 */

import { engine } from '@dcl/sdk/ecs'

import { ExpeditionServerCore, NEW_EXPEDITION_COUNTDOWN_S } from 'src/shared/expedition'
import { room } from 'src/shared/messages'
import { isFloatingCrystals } from 'src/shared/ruleset'

import { getCurrentCycleSeed, onCycleRoll, rollCycle } from 'src/server/cycle'
import { getFinaleStartMs } from 'src/server/stations'


const CHECK_INTERVAL_S = 0.25

const core = new ExpeditionServerCore({
	nowMs        : () => Date.now(),
	seed         : () => getCurrentCycleSeed(),
	finaleStartMs: () => getFinaleStartMs(),
	roll         : () => rollCycle(),
	send         : (p, to) => (to === undefined ? room.send('newExpeditionState', p) : room.send('newExpeditionState', p, { to: [to] })),
}, isFloatingCrystals())

let installed = false
let clock = 0


/** Joiner hydration (server.ts, after cycleState): the countdown and the button state. */
export function sendExpeditionStateTo(userId: string): void {
	core.hydrate(userId)
}

export function setupExpeditionServer(): void {
	if (installed || !isFloatingCrystals()) return
	installed = true

	room.onMessage('newExpeditionRequest', ({ seed }, context) => {
		const from = context?.from ?? 'unknown'
		console.log(`[Server] expedition: request from ${from} -> ${core.request(from, seed)}`)
	})
	room.onMessage('newExpeditionCancel', ({ seed }, context) => {
		const from = context?.from ?? 'unknown'
		console.log(`[Server] expedition: cancel from ${from} -> ${core.cancel(from, seed)}`)
	})
	onCycleRoll(() => { core.onRolled() })
	engine.addSystem((dt: number) => {
		clock += dt
		if (clock < CHECK_INTERVAL_S) return
		clock = 0
		if (core.tick()) console.log(`[Server] expedition: countdown over (${NEW_EXPEDITION_COUNTDOWN_S} s) - a new expedition began (fresh seed, Day 1)`)
	}, undefined, 'newExpeditionSystem')
	console.log(`[Server] expedition: installed (countdown ${NEW_EXPEDITION_COUNTDOWN_S} s)`)
}