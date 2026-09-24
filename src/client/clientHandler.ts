/**
 * clientHandler.ts — client network boundary.
 *
 * Inbound room messages → eventBus. Outbound: joinRoster + paintTick.
 * Paint *state* is CRDT only (PaintCell / PaletteEntry / PaintCoverage).
 */

import { engine, PlayerIdentityData } from '@dcl/sdk/ecs'
import { isStateSyncronized } from '@dcl/sdk/network'

import { room } from 'src/shared/messages'
import { cellIdToKey } from 'src/shared/paintGrid'
import { PAINT_TICK_HZ, PAINT_TICK_MAX_IDS } from 'src/shared/settings'
import { Team } from 'src/shared/team'
import { eventBus, ClientEvents } from 'src/shared/utils/eventBus'

import { drainPaintOutbox } from 'src/client/paint'
import { PrecipitationLevel, setPrecipitation } from 'src/client/snowfall'

let myTeam: Team = Team.None

/**
 * When true, the outbound tick will re-send joinRoster on its next
 * iteration. Set by the pleaseRejoin handler (server telling us it
 * doesn't recognise our wallet, typically after a mid-session server
 * restart wiped the in-memory roster) so we transparently recover
 * without the player having to refresh.
 */
let needsRejoin = false

/** How often to log while waiting for CRDT sync with the auth server. */
const SYNC_LOG_INTERVAL_MS = 1000
/** After this, keep waiting but warn that the Multiplayer Server is likely down. */
const SYNC_DOWN_WARN_MS    = 5000


// MARK: toCellKeys

// Transitional: the legacy paint outbox holds string ids; the wire carries
// integer snow cell keys (same layout as paintGrid.cellIdToKey).
function toCellKeys(ids: string[]): number[] {
	const out: number[] = []
	for (const id of ids) {
		const key = cellIdToKey(id)
		if (key === null) {
			console.log(`clientHandler: toCellKeys: dropping unparseable cell id "${id}"`)
			continue
		}
		out.push(key)
	}
	return out
}


// MARK: resolveJoinUserId

function resolveJoinUserId(): string {
	const pid = PlayerIdentityData.getOrNull(engine.PlayerEntity)
	if (pid?.address) return pid.address
	return 'guest-' + Math.floor(Math.random() * 1e9).toString(16)
}


// MARK: initClientHandler

export function initClientHandler(): void {
	wireInbound()
	wireTeamAssigned()
	wireOutbound()
}


// MARK: wireInbound

function wireInbound(): void {
	room.onMessage('teamAssigned', ({ team }) => {
		eventBus.emit(ClientEvents.TeamAssigned, { team: team as Team })
	})

	// Server-authoritative weather. Level 0..3 maps directly onto the
	// PrecipitationLevel enum, so no translation is needed — just clamp
	// defensively in case the server ever sends an out-of-range value.
	room.onMessage('weatherState', ({ level }) => {
		const clamped = Math.max(0, Math.min(3, level | 0)) as PrecipitationLevel
		setPrecipitation(clamped)
	})

	// Server → client rejoin nudge. Server sends this (rate-limited) when
	// a paintTick arrives from a wallet the server doesn't have in its
	// roster — typically because the server restarted and lost the
	// in-memory roster. Flag the outbound loop to re-issue joinRoster on
	// its next tick. Also clear myTeam so paint queueing pauses until the
	// re-assignment reply lands, matching the fresh-boot behaviour.
	room.onMessage('pleaseRejoin', () => {
		console.log('[Client] pleaseRejoin received — re-issuing joinRoster')
		needsRejoin = true
		myTeam      = Team.None
	})
}


// MARK: wireTeamAssigned

function wireTeamAssigned(): void {
	eventBus.on(ClientEvents.TeamAssigned, ({ team }) => {
		myTeam = team
		console.log(`[Client] teamAssigned → ${myTeam === Team.Red ? 'RED' : 'BLUE'}`)
	})
}


// MARK: wireOutbound

function wireOutbound(): void {
	let joinSent        = false
	let paintFlushClock = 0
	const paintInterval = 1 / PAINT_TICK_HZ
	let lastSyncLog     = 0
	let syncWaitMs      = 0
	let downWarned      = false

	engine.addSystem((dt: number) => {
		const synced = isStateSyncronized()
		if (!synced) {
			syncWaitMs += dt * 1000
			if (syncWaitMs - lastSyncLog >= SYNC_LOG_INTERVAL_MS) {
				lastSyncLog = syncWaitMs
				console.log(`[Client] waiting for isStateSyncronized… (${(syncWaitMs / 1000).toFixed(1)}s)`)
			}
			if (!downWarned && syncWaitMs >= SYNC_DOWN_WARN_MS) {
				downWarned = true
				console.log(
					'[Client] server not connected — Multiplayer Server likely down; ' +
					'not joining roster until isStateSyncronized()'
				)
			}
			return
		}

		if (!joinSent || needsRejoin) {
			joinSent    = true
			needsRejoin = false
			const userId = resolveJoinUserId()
			console.log(`[Client] isStateSyncronized — → joinRoster ${userId}`)
			room.send('joinRoster', { userId })
		}

		// Wait for roster before sending paint commands (outbox keeps growing).
		if (myTeam === Team.None) return

		paintFlushClock += dt
		if (paintFlushClock < paintInterval) return
		paintFlushClock = 0
		// Drain melt (stage 0) and stomp (stage 1) outboxes separately —
		// each maps to one paintTick with a coherent targetStage so the
		// server can apply the right write policy in bulk.
		const meltCells = toCellKeys(drainPaintOutbox(PAINT_TICK_MAX_IDS, 0))
		if (meltCells.length > 0) room.send('paintTick', { cells: meltCells,  targetStage: 0 })
		const stompCells = toCellKeys(drainPaintOutbox(PAINT_TICK_MAX_IDS, 1))
		if (stompCells.length > 0) room.send('paintTick', { cells: stompCells, targetStage: 1 })
	})
}
