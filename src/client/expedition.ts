/**
 * expedition.ts (client) - the NEW EXPEDITION reset state (rules: src/shared/expedition.ts, server: src/server/expedition.ts).
 *
 * Holds what the server last said: may the BEGIN button show (the ending is complete and the world restored), is a countdown
 * running, who started it. The countdown is stored as a LOCAL deadline computed once from the message's remaining time, so the HUD
 * and the Help panel read the same clock every frame with no drift. The server owns everything; the client only asks.
 * No UI imports (the Help panel and the HUD chip import this).
 */

import { getCurrentCycleSeed, onCycleSeedChange } from 'src/client/cycle'
import { getLocalAddress } from 'src/client/leaderboard'
import { expeditionLocalDeadline, expeditionSecondsLeft } from 'src/shared/expedition'
import { room } from 'src/shared/messages'
import { isFloatingCrystals } from 'src/shared/ruleset'

let ready = false
let active = false
let localDeadlineMs = 0
let initiator = ''


// MARK: state
/** The BEGIN NEW EXPEDITION button may show (and no countdown runs). */
export function canBeginNewExpedition(): boolean { return isFloatingCrystals() && ready && !active }
/** A shared countdown is running. */
export function isNewExpeditionCounting(): boolean { return isFloatingCrystals() && active }
/** The local player started the running countdown (only they see CANCEL). */
export function isNewExpeditionMine(): boolean {
	const me = getLocalAddress()
	return active && me !== '' && me === initiator
}
/** Whole seconds left on the shared countdown (0 when none). */
export function newExpeditionSecondsLeft(): number { return active ? expeditionSecondsLeft(localDeadlineMs, Date.now()) : 0 }
/** The Help panel has something to show about the expedition reset. */
export function hasExpeditionHelpSection(): boolean { return canBeginNewExpedition() || isNewExpeditionCounting() }


// MARK: requests
export function requestNewExpedition(): void {
	if (!canBeginNewExpedition()) return
	room.send('newExpeditionRequest', { seed: getCurrentCycleSeed() })
}

export function cancelNewExpedition(): void {
	if (!isNewExpeditionMine()) return
	room.send('newExpeditionCancel', { seed: getCurrentCycleSeed() })
}


// MARK: setupExpeditionClient
/** Register before initClientHandler so the joiner hydration is caught. */
export function setupExpeditionClient(): void {
	if (!isFloatingCrystals()) return
	room.onMessage('newExpeditionState', (m) => {
		ready = m.ready === 1
		active = m.active === 1
		localDeadlineMs = active ? expeditionLocalDeadline(m.remainingMs, Date.now()) : 0
		initiator = active ? m.initiator.toLowerCase() : ''
	})
	// A new world (the countdown ended, a dev roll, a restart) starts clean until the server says otherwise.
	onCycleSeedChange(() => {
		ready = false; active = false; localDeadlineMs = 0; initiator = ''
	})
}