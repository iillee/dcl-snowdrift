/**
 * session.ts - server session id + liveness beat.
 *
 * The platform stops the authoritative server a couple of minutes after
 * the last player leaves and cold-starts a fresh one on the next visit.
 * A fresh server has an empty roster, new snow buffers, a new cycle seed
 * and fire / station / wood state. Anything the client kept from the old
 * run is stale. `SERVER_SESSION` is unique per process start; it rides on
 * cycleState, serverBeat and every PaintTile so the client can tell a
 * restart apart from a normal cycle roll and rebuild from scratch.
 */

import { engine } from '@dcl/sdk/ecs'

import { clampCycleSeed } from 'src/shared/cycleMazeSeed'
import { room } from 'src/shared/messages'


/** Per-process id (1..0x7FFFFFFF, Schemas.Int safe). */
export const SERVER_SESSION: number = clampCycleSeed(
	(Date.now() ^ Math.imul(Math.floor(Math.random() * 0x7fffffff) + 1, 0x9E3779B1)) >>> 0,
)

/** Seconds between serverBeat broadcasts. Client treats ~4 missed beats as silence. */
const BEAT_INTERVAL_S = 3


// MARK: setupSessionBeat

/** Broadcast serverBeat on a fixed cadence. Call once from setupServer. */
export function setupSessionBeat(): void {
	console.log(`[Server] session: id=${SERVER_SESSION}`)
	let clock = BEAT_INTERVAL_S
	engine.addSystem((dt: number) => {
		clock += dt
		if (clock < BEAT_INTERVAL_S) return
		clock = 0
		room.send('serverBeat', { session: SERVER_SESSION })
	})
}