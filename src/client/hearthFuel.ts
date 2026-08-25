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
import { HIDDEN_CAMPFIRE_COUNT } from 'src/shared/hiddenCampfire'


/** Seconds it takes `currentFuel` to converge on a fresh `targetFuel`.
 *  Server broadcasts up to every 2 s or on tier change / feed. 250 ms
 *  smooths jitter without feeling laggy on a feed pop. */
const LERP_TIME_S = 0.25


let currentFuel  = FUEL_MAIN_FLOOR
let targetFuel   = FUEL_MAIN_FLOOR
let playerCount  = 1
let installed    = false

// Per-hidden-fire lerped fuel + target. Zero-length arrays would
// break the getter contracts; init upfront so callers can safely
// index [0..HIDDEN_CAMPFIRE_COUNT).
const hiddenCurrent : number[] = new Array(HIDDEN_CAMPFIRE_COUNT).fill(0)
const hiddenTarget  : number[] = new Array(HIDDEN_CAMPFIRE_COUNT).fill(0)


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

	room.onMessage('hiddenHearthFuelUpdate', ({ index, fuel, players }) => {
		if (index < 0 || index >= HIDDEN_CAMPFIRE_COUNT) return
		hiddenTarget[index] = fuel
		playerCount         = players
	})

	engine.addSystem((dt: number) => {
		const t = Math.min(1, dt / LERP_TIME_S)
		if (currentFuel !== targetFuel) {
			currentFuel += (targetFuel - currentFuel) * t
			if (Math.abs(targetFuel - currentFuel) < 0.1) currentFuel = targetFuel
		}
		for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
			if (hiddenCurrent[i] === hiddenTarget[i]) continue
			hiddenCurrent[i] += (hiddenTarget[i] - hiddenCurrent[i]) * t
			if (Math.abs(hiddenTarget[i] - hiddenCurrent[i]) < 0.1) {
				hiddenCurrent[i] = hiddenTarget[i]
			}
		}
	})

	console.log('hearthFuel: setupHearthFuelClient: handler + lerp system installed')
}


// MARK: requestFeedFire
/**
 * Ask the server to add one log's worth of fuel to a fire. `target`
 * is -1 for the main hearth, 0..HIDDEN_CAMPFIRE_COUNT-1 for a hidden
 * fire slot. The local carry-slot clearing + SFX is still handled by
 * the caller (logsInventory.feedFire); this only owns the network
 * round-trip.
 */
export function requestFeedFire(target: number = -1): void {
	room.send('feedFireRequest', { target })
	console.log(`hearthFuel: requestFeedFire: target=${target}`)
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

// MARK: Hidden-fire accessors
/** Lerped fuel for hidden fire `index`. Zero when unlit. */
export function getHiddenFireFuel(index: number): number {
	if (index < 0 || index >= HIDDEN_CAMPFIRE_COUNT) return 0
	return hiddenCurrent[index]
}

/** Live melt radius (m) for hidden fire `index`. Zero when unlit. */
export function getHiddenFireMeltRadius(index: number): number {
	return hearthRadiusFromFuel(getHiddenFireFuel(index))
}
