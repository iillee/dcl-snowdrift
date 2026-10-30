/**
 * leaderboard.ts (client) - per-player leaderboard state.
 *
 * Receives `leaderboardState` from the server (joiners + every update),
 * holds the four boards (longest / fastest / obelisks / firenet), the selected
 * tab and whether the panel is open. The panel itself
 * is src/client/ui/layers/layer.leaderboard.tsx. Clients never submit
 * records; the only thing sent up is the display name (`playerName`),
 * used for the contributor list.
 *
 * No UI imports here so the help panel can close this one without an
 * import cycle.
 */

import { engine, PlayerIdentityData } from '@dcl/sdk/ecs'
import { getPlayer } from '@dcl/sdk/players'

import { isRostered } from 'src/client/clientHandler'
import { BoardKind, cleanName, decodeBoardWire, LeaderboardBoards, LeaderboardRow } from 'src/shared/leaderboard'
import { room } from 'src/shared/messages'
import { isFloatingCrystals } from 'src/shared/ruleset'


let boards: LeaderboardBoards = { longest: [], fastest: [], monuments: [], firenet: [] }
let tab: BoardKind = 'fastest'
let open = false


// MARK: state
export function getLeaderboardRows(kind: BoardKind = tab): LeaderboardRow[] { return boards[kind] }
export function getLeaderboardTab(): BoardKind { return tab }
export function setLeaderboardTab(kind: BoardKind): void { tab = kind }

/** Lowercase wallet of the local player ('' until identity loads). */
export function getLocalAddress(): string {
	return (PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address ?? getPlayer()?.userId ?? '').toLowerCase()
}
export function isLeaderboardOpen(): boolean { return open }

export function closeLeaderboard(): void { open = false }
export function toggleLeaderboard(): void { open = !open }


// MARK: setupLeaderboardClient
/** Register before initClientHandler so the joinRoster hydration is caught. */
export function setupLeaderboardClient(): void {
	if (!isFloatingCrystals()) return

	room.onMessage('leaderboardState', ({ json }) => {
		boards = decodeBoardWire(json)
	})

	// Tell the server our display name once per server session (it forgets
	// on restart; isRostered() drops to false then and comes back true).
	let sent = false
	let sentName = ''
	let clock = 0
	engine.addSystem((dt: number) => {
		clock += dt
		if (clock < 1) return
		clock = 0
		if (!isRostered()) { sent = false; return }
		const name = cleanName(getPlayer()?.name)
		if (!name || (sent && name === sentName)) return
		sent = true
		sentName = name
		room.send('playerName', { name })
	}, undefined, 'leaderboardNameSystem')
}