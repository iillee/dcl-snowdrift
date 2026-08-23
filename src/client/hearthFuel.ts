/**
 * hearthFuel.ts - client-side fuel state for the main hearth.
 *
 * Subscribes to hearthFuelUpdate broadcasts from the server, lerps a
 * local `currentFuel` toward the last-received `targetFuel` so slow
 * broadcasts still feel smooth on-screen, and exposes read-only
 * accessors for everything downstream (frost accumulation, upcoming
 * billboard UI, tier-scaled flame/smoke/audio).
 *
 * Send side is a single function: requestFeedFire(). Called from
 * logsInventory.feedFire() the moment the local player consumes a log
 * so the server bumps fuel with no extra input plumbing.
 *
 * Bootstrap order (see src/client/index.ts): setupHearthFuelClient()
 * MUST run before initClientHandler so the joinRoster hydration
 * broadcast (hearthFuelUpdate on the joiner) is caught.
 */

import { engine } from '@dcl/sdk/ecs'

import { room } from 'src/shared/messages'
import {
	FUEL_MAIN_FLOOR,
	hearthFlameScaleFromFuel,
	hearthRadiusFromFuel,
	hearthSmokeHeightFromFuel,
	hearthTierFromFuel,
	hearthVolumeFromFuel,
	TIER_NAMES,
} from 'src/shared/hearthFuel'


/** Seconds it takes `currentFuel` to converge on a fresh `targetFuel`.
 *  Server broadcasts up to every 2 s or on tier change / feed. 250 ms
 *  smooths jitter without feeling laggy on a feed pop. */
const LERP_TIME_S = 0.25


let currentFuel  = FUEL_MAIN_FLOOR
let targetFuel   = FUEL_MAIN_FLOOR
let playerCount  = 1
let installed    = false


// MARK: setupHearthFuelClient
/** Install the network handler + the local lerp system. Idempotent. */
export function setupHearthFuelClient(): void {
	if (installed) {
		console.log('hearthFuel: setupHearthFuelClient: already installed, skipping')
		return
	}
	installed = true

	room.onMessage('hearthFuelUpdate', ({ fuel, players }) => {
		const prevTier = hearthTierFromFuel(currentFuel)
		targetFuel     = fuel
		playerCount    = players
		const newTier  = hearthTierFromFuel(targetFuel)
		if (newTier !== prevTier) {
			console.log(
				`hearthFuel: tier -> ${TIER_NAMES[newTier]} (fuel=${targetFuel.toFixed(1)}s players=${players})`
			)
		}
	})

	engine.addSystem((dt: number) => {
		if (currentFuel === targetFuel) return
		// Frame-rate independent lerp: approach `targetFuel` at a rate
		// that halves the remaining gap every LERP_TIME_S / ln(2).
		const t = Math.min(1, dt / LERP_TIME_S)
		currentFuel += (targetFuel - currentFuel) * t
		// Snap when we're within 0.1 s of the target - avoids the tail
		// of tiny lerp increments that never quite finish.
		if (Math.abs(targetFuel - currentFuel) < 0.1) currentFuel = targetFuel
	})

	console.log('hearthFuel: setupHearthFuelClient: handler + lerp system installed')
}


// MARK: requestFeedFire
/**
 * Ask the server to add one log's worth of fuel to the main hearth.
 * The local carry-slot clearing + SFX is still handled by the caller
 * (logsInventory.feedFire); this only owns the network round-trip.
 */
export function requestFeedFire(): void {
	room.send('feedFireRequest', {})
	console.log('hearthFuel: requestFeedFire: feed request sent')
}


// MARK: Read-only accessors
/** Live (lerped) fuel in seconds. */
export function getMainFireFuel(): number {
	return currentFuel
}

/** Live tier index 1..5. */
export function getMainFireTier(): number {
	return hearthTierFromFuel(currentFuel)
}

/** Live melt radius in meters, interpolated across tier anchors. */
export function getMainFireMeltRadius(): number {
	return hearthRadiusFromFuel(currentFuel)
}

/** Live melt radius SQUARED (m^2) - hot-loop convenience so callers
 *  don't multiply per frame. */
export function getMainFireMeltRadiusSq(): number {
	const r = hearthRadiusFromFuel(currentFuel)
	return r * r
}

/** Tier-snapped flame GLB uniform scale. */
export function getMainFireFlameScale(): number {
	return hearthFlameScaleFromFuel(currentFuel)
}

/** Interpolated smoke column height multiplier. */
export function getMainFireSmokeHeight(): number {
	return hearthSmokeHeightFromFuel(currentFuel)
}

/** Interpolated ambient volume 0..1. */
export function getMainFireVolume(): number {
	return hearthVolumeFromFuel(currentFuel)
}

/** Current player count as of the last server broadcast. Drives the
 *  "xN drain" chip in the fuel bar UI. */
export function getHearthPlayerCount(): number {
	return playerCount
}
