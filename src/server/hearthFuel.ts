/**
 * hearthFuel.ts - authoritative fuel state for the main hearth.
 *
 * Owns:
 *   - mainFuel   : current fuel in seconds (float)
 *   - lastBroadcastFuel / lastBroadcastPlayers : throttle state
 *
 * Message contracts:
 *   Client -> Server  feedFireRequest    {}
 *   Server -> Client  hearthFuelUpdate   { fuel, players }
 *
 * Decay tick runs every frame (see setupHearthFuelServer). We only
 * broadcast when fuel has drifted by BROADCAST_FUEL_DELTA seconds
 * since the last packet, or when a tier boundary is crossed, or when
 * the roster size changes. Client lerps between snapshots so a lazy
 * broadcast rate still feels smooth.
 *
 * Hidden fires get their own module later; this one is main-hearth-only.
 */

import { engine } from '@dcl/sdk/ecs'

import { room } from 'src/shared/messages'
import {
	FUEL_MAIN_FLOOR,
	FUEL_MAX,
	FUEL_MAX_BURST_RADIUS_M,
	LOG_FUEL_SECONDS,
	TIER_FUEL,
	hearthDecayRate,
	hearthRadiusFromFuel,
	hearthTierFromFuel,
} from 'src/shared/hearthFuel'
import { rosterSize } from 'src/server/roster'
import { seedStartingArea } from 'src/server/server'
import { shrinkMeltRingTo } from 'src/server/paintState'
import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'


/** Broadcast when fuel has changed by more than this since the last
 *  packet. Client lerps, so 3 s of drift is imperceptible. */
const BROADCAST_FUEL_DELTA = 3

/** Hard broadcast cadence even if nothing much has happened - keeps
 *  late-joiners' first snapshot fresh and provides a heartbeat for
 *  the multiplier chip. */
const BROADCAST_HEARTBEAT_S = 2


let mainFuel              = FUEL_MAIN_FLOOR
let lastBroadcastFuel     = -999   // force first broadcast
let lastBroadcastTier     = -1
let lastBroadcastPlayers  = -1
let heartbeatClock        = 0
let installed             = false
/** True once the hearth-max burst has fired for the current fill
 *  cycle. Re-armed to false when fuel drops back below the Roaring
 *  tier entry (TIER_FUEL[4] = 450 s), so a group refilling from Warm
 *  gets a fresh celebration each time they push to full. */
let maxBurstArmed         = true


// MARK: maybeFireMaxBurst
/**
 * If fuel has just crossed FUEL_MAX from below AND the burst is
 * armed, expand the melt ring to FUEL_MAX_BURST_RADIUS_M, broadcast
 * hearthMax so clients can play a celebration, and disarm until fuel
 * drops back below the Roaring tier entry.
 */
function maybeFireMaxBurst(): void {
	if (!maxBurstArmed)          return
	if (mainFuel < FUEL_MAX)     return
	maxBurstArmed = false
	console.log(`[Server] hearthFuel: MAX BURST! ring -> ${FUEL_MAX_BURST_RADIUS_M}m`)
	seedStartingArea(FUEL_MAX_BURST_RADIUS_M)
	room.send('hearthMax', {})
}


// MARK: rearmMaxBurstIfSafe
/**
 * Re-arm the max burst once fuel has decayed below Roaring entry so
 * a subsequent refill can trigger a fresh celebration. Called every
 * frame from the decay tick; cheap.
 */
function rearmMaxBurstIfSafe(): void {
	if (maxBurstArmed)           return
	if (mainFuel >= TIER_FUEL[4]) return // still in Roaring tier
	maxBurstArmed = true
	console.log('[Server] hearthFuel: max-burst re-armed')
}


// MARK: syncMeltRingToCurrentFuel
/**
 * Reshape the visible blue melt ring to match the current fuel-derived
 * radius. Called on any tier crossing (up OR down).
 *   - Upward: seedStartingArea paints + protects the newly-warm outer
 *     band (cells inside the previous radius are already painted and
 *     idempotent no-ops).
 *   - Downward: shrinkMeltRingTo unprotects + force-clears any cells
 *     outside the new radius so the ring visibly retracts.
 *
 * Cycle roll resets the entire canvas separately via server.ts's
 * onCycleRoll (clearPaintState + seedStartingArea at baseline).
 */
function syncMeltRingToCurrentFuel(): void {
	const r = hearthRadiusFromFuel(mainFuel)
	console.log(`[Server] hearthFuel: sync melt ring to ${r.toFixed(1)}m`)
	seedStartingArea(r)
	shrinkMeltRingTo(CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z, r)
}


// MARK: getMainFireFuel
/** Read-only accessor for other server modules that want the current
 *  main-fire fuel (e.g. future analytics, hidden-fire lighting rules). */
export function getMainFireFuel(): number {
	return mainFuel
}


// MARK: sendHearthFuelStateTo
/**
 * Push the current fuel snapshot to a single client. Called from the
 * joinRoster handler so latecomers see the fire's current state
 * immediately instead of waiting for the next broadcast tick.
 */
export function sendHearthFuelStateTo(userId: string): void {
	room.send('hearthFuelUpdate', {
		fuel   : mainFuel,
		players: rosterSize(),
	}, { to: [userId] })
	console.log(`[Server] hearthFuel: hydrated ${mainFuel.toFixed(1)}s to ${userId}`)
}


// MARK: broadcastFuel
function broadcastFuel(): void {
	room.send('hearthFuelUpdate', {
		fuel   : mainFuel,
		players: rosterSize(),
	})
	lastBroadcastFuel    = mainFuel
	lastBroadcastTier    = hearthTierFromFuel(mainFuel)
	lastBroadcastPlayers = rosterSize()
	heartbeatClock       = 0
}


// MARK: setupHearthFuelServer
/**
 * Register the feed handler, start the decay tick. Idempotent - safe
 * to call once from setupServer bootstrap.
 */
export function setupHearthFuelServer(): void {
	if (installed) {
		console.log('[Server] hearthFuel: setupHearthFuelServer already installed, skipping')
		return
	}
	installed = true

	// Feed handler. Trust the client's has-log guard for now; server
	// just clamps to the max. Immediate broadcast so the feeder sees
	// their contribution land without waiting for the next threshold.
	room.onMessage('feedFireRequest', (_data, context) => {
		const from     = context?.from ?? 'unknown'
		const prev     = mainFuel
		const prevTier = hearthTierFromFuel(prev)
		mainFuel       = Math.min(FUEL_MAX, mainFuel + LOG_FUEL_SECONDS)
		const newTier  = hearthTierFromFuel(mainFuel)
		console.log(
			`[Server] hearthFuel: feed by ${from}  ` +
			`${prev.toFixed(1)}s -> ${mainFuel.toFixed(1)}s (tier ${newTier})`
		)
		if (newTier !== prevTier) syncMeltRingToCurrentFuel()
		// Max-burst check AFTER sync so the burst radius wins if both
		// fire on the same feed (e.g. jumping from Bright to Max).
		maybeFireMaxBurst()
		broadcastFuel()
	})

	// Decay + broadcast tick.
	engine.addSystem((dt: number) => {
		const players   = rosterSize()
		const drainRate = hearthDecayRate(players)
		const prev      = mainFuel
		const prevTier  = hearthTierFromFuel(prev)
		mainFuel        = Math.max(FUEL_MAIN_FLOOR, mainFuel - drainRate * dt)
		// Any tier crossing (up on defensive-only-during-decay, down when
		// fuel actually decays across a threshold) resyncs the ring so it
		// grows / shrinks in lock-step with the fuel model.
		if (hearthTierFromFuel(mainFuel) !== prevTier) syncMeltRingToCurrentFuel()
		rearmMaxBurstIfSafe()

		heartbeatClock += dt
		const tier        = hearthTierFromFuel(mainFuel)
		const fuelDrifted = Math.abs(mainFuel - lastBroadcastFuel) >= BROADCAST_FUEL_DELTA
		const tierChanged = tier !== lastBroadcastTier
		const rosterChanged = players !== lastBroadcastPlayers
		const heartbeatDue  = heartbeatClock >= BROADCAST_HEARTBEAT_S

		if (fuelDrifted || tierChanged || rosterChanged || heartbeatDue) {
			// Only log when something interesting happened - the heartbeat
			// tick would otherwise flood the console every 2s.
			if (tierChanged || rosterChanged) {
				console.log(
					`[Server] hearthFuel: broadcast fuel=${mainFuel.toFixed(1)} tier=${tier} ` +
					`players=${players} drain=${drainRate.toFixed(2)}x`
				)
			}
			broadcastFuel()
		}

		// Silence unused-var linting for `prev`; kept for future
		// "log every N seconds of drain" analytics hooks.
		void prev
	})

	console.log(`[Server] hearthFuel: installed. floor=${FUEL_MAIN_FLOOR}s max=${FUEL_MAX}s log=+${LOG_FUEL_SECONDS}s`)
}
