/**
 * hiddenCampfire.ts — authoritative state for the buried bonfires.
 *
 * Owns:
 *   - the current cycle seed (from shared/hiddenCampfire.getHiddenCampfireSeed)
 *   - lit[HIDDEN_CAMPFIRE_COUNT]        — per-fire ignition flag
 *   - secondsSinceIgnite[HIDDEN_...]    — per-fire growth clock for the
 *                                          expanding melt ring
 *   - worldPos[HIDDEN_...]              — cached world-space centres so
 *                                          the ring pass doesn't recompute
 *                                          tile→world every tick
 *
 * Message contracts:
 *   Client → Server  hiddenCampfireIgnite  { seed, index }
 *   Server → Client  hiddenCampfireState   { seed, index, lit }
 *
 * Broadcast granularity is per-fire — every state flip sends ONE
 * message tagged with its index. Hydration on join sends
 * HIDDEN_CAMPFIRE_COUNT messages in a row.
 *
 * Follow-ups:
 *   - Roll cycle at bucket boundary (reset lit[] to false, recompute
 *     positions, stop protecting old rings).
 *   - "All lit" completion moment — kick a celebration broadcast when
 *     every entry flips true.
 */

import { engine } from '@dcl/sdk/ecs'

import { cycleSeedsEqual } from 'src/shared/cycleMazeSeed'
import {
	FUEL_HIDDEN_FLOOR,
	FUEL_HIDDEN_INITIAL,
	FUEL_MAX,
	feedFitsFire,
	fuelSecondsForKind,
	hearthDecayRate,
	hearthRadiusFromFuel,
	hearthTierFromFuel,
} from 'src/shared/hearthFuel'
import {
	getHiddenCampfireSeed,
	HIDDEN_CAMPFIRE_COUNT,
	pickHiddenCampfires,
} from 'src/shared/hiddenCampfire'
import { room } from 'src/shared/messages'
import { clampWoodKind } from 'src/shared/woodKind'

import { getCurrentCycleSeed, onCycleRoll } from 'src/server/cycle'
import { noteContributor } from 'src/server/leaderboard'
import { isEmberFailing } from 'src/server/emberFail'
import { getPhaseDrainMul } from 'src/server/phase'
import { rosterSize } from 'src/server/roster'
import { meltDisc, releaseDiscOutside, seedFireDimple } from 'src/server/snowState'
import { isFireLinked, registerFireFuel, tryShareFeed } from 'src/server/fireNetworkLinks'
import { NETWORK_BURN_MUL } from 'src/shared/fireNetwork'
import {
	buildStartFuelFor,
	BUILT_FIRE_MAX,
	BUILT_FIRE_PERMANENT,
	BUILT_FIRE_START_FUEL,
	isBuildYourOwnFire,
	builtFireFrontSpot,
	validateBuiltFireSpot,
} from 'src/shared/ruleset'
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { activeTerrain, getTerrain } from 'src/shared/terrain/terrainCache'
import { getStageAtWorld } from 'src/server/snowState'
import { CHARGE_FIRE_DRAIN_MUL } from 'src/shared/ruleset'
import { pickRecycleSlot } from 'src/shared/fireSlots'
import { chargeTargetsOf, clearSlotTouches, isSlotCharging, noteSlotTouched } from 'src/server/chargeLinks'


// MARK: Melt-growth tuning
// Time (seconds) from ignition until the melt ring reaches full radius.
// Slower than the central bonfire's instant seed so a fresh ignition
// visibly "thaws" outward instead of snapping to a full disc. Growth
// is linear — easy to reason about and reads well at any framerate.
const MELT_GROWTH_DURATION_S = 10


// MARK: State (per-fire arrays, all length HIDDEN_CAMPFIRE_COUNT)
let currentSeed         = getHiddenCampfireSeed()
const lit               : boolean[] = new Array(HIDDEN_CAMPFIRE_COUNT).fill(false)
const secondsSinceIgnite: number[]  = new Array(HIDDEN_CAMPFIRE_COUNT).fill(0)
const worldX            : number[]  = new Array(HIDDEN_CAMPFIRE_COUNT).fill(0)
const worldZ            : number[]  = new Array(HIDDEN_CAMPFIRE_COUNT).fill(0)
/** Live fuel per hidden fire. Zero when unlit. Set to FUEL_HIDDEN_INITIAL
 *  on ignition; drained per frame; snuffs (lit=false) at 0. */
const fuel              : number[]  = new Array(HIDDEN_CAMPFIRE_COUNT).fill(0)
/** Throttle state for hiddenHearthFuelUpdate broadcasts, per fire. */
const lastBroadcastFuel : number[]  = new Array(HIDDEN_CAMPFIRE_COUNT).fill(-999)
const lastBroadcastTier : number[]  = new Array(HIDDEN_CAMPFIRE_COUNT).fill(-1)
const heartbeatClock    : number[]  = new Array(HIDDEN_CAMPFIRE_COUNT).fill(0)
/** Build Your Own Fire: slot holds a player-built fire this cycle. */
const built             : boolean[] = new Array(HIDDEN_CAMPFIRE_COUNT).fill(false)
/** Built fires: Date.now() when it went out (0 = burning / never). */
const extinguishedAt    : number[]  = new Array(HIDDEN_CAMPFIRE_COUNT).fill(0)
/** Last recycle candidate broadcast (-2 = never sent). */
let lastRecycleSent = -2
function recycleCandidate(): number { return pickRecycleSlot(built, lit, extinguishedAt) }
function broadcastRecycle(userId?: string): void {
	const index = recycleCandidate()
	if (!userId && index === lastRecycleSent) return
	if (!userId) lastRecycleSent = index
	room.send('builtFireRecycleNext', { seed: currentSeed, index }, userId ? { to: [userId] } : undefined)
}
/** Server cap; never more than the slot arrays hold. */
const BUILT_CAP = Math.min(BUILT_FIRE_MAX, HIDDEN_CAMPFIRE_COUNT)

/** Permanent built fires neither drain nor take shared fuel. */
function isPermanentSlot(i: number): boolean {
	return BUILT_FIRE_PERMANENT && built[i]
}

/** Number of player-built fires placed this cycle (lit or dead). */
export function builtFireCount(): number {
	let n = 0
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) if (built[i]) n++
	return n
}

/** Same tuning as main hearth. Broadcast on fuel delta > 3s, tier
 *  change, or 2s heartbeat while lit. */
const BROADCAST_FUEL_DELTA  = 3
const BROADCAST_HEARTBEAT_S = 2

let fireRelitHandler: (() => void) | null = null


// MARK: onHiddenFireRelit
/**
 * Register a callback for a dead→lit hidden-fire ignite. Used by
 * frostLife to cancel a pending extinction without a circular import.
 */
export function onHiddenFireRelit(handler: () => void): void {
	fireRelitHandler = handler
}


// MARK: recomputePositions
function recomputePositions(): void {
	const spots = pickHiddenCampfires(currentSeed)
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
		const spot = spots[i]
		if (!spot) {
			worldX[i] = 0
			worldZ[i] = 0
			console.log(`[Server] hiddenCampfire: recomputePositions: slot ${i} unused this cycle`)
			continue
		}
		worldX[i] = spot.x
		worldZ[i] = spot.z
		console.log(
			`[Server] hiddenCampfire: slot ${i} ` +
			`tile=(${spot.tx},${spot.tz}) ` +
			`world=(${spot.x.toFixed(1)},${spot.y.toFixed(1)},${spot.z.toFixed(1)})`,
		)
	}
}


// MARK: seedHiddenCampfireDimples
/**
 * One-cell snow dip above every placed hidden pit. Call after positions
 * are known and after any clearAllSnow (cycle wipe runs after this
 * module's reset, so the cycle handler must call this again).
 */
export function seedHiddenCampfireDimples(): void {
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
		if (worldX[i] === 0 && worldZ[i] === 0) continue
		seedFireDimple(worldX[i], worldZ[i])
	}
}


// MARK: resetForCycle
/**
 * Wipe per-cycle state and rebroadcast a fresh unlit tuple. Called by
 * the cycle rollover in src/server/cycle.ts. The paint clear that
 * removes the old melt rings lives in server.ts's cycle handler —
 * this module only owns lit-state + positions + broadcast.
 */
function resetForCycle(newSeed: number): void {
	currentSeed = newSeed
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
		lit[i]                = false
		secondsSinceIgnite[i] = 0
		fuel[i]               = 0
		lastBroadcastFuel[i]  = -999
		lastBroadcastTier[i]  = -1
		heartbeatClock[i]     = 0
		built[i]              = false
		extinguishedAt[i]     = 0
	}
	lastRecycleSent = -2
	clearSlotTouches()
	recomputePositions()
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
		console.log(
			`[Server] hiddenCampfire[${i}]: reset for cycle seed=${currentSeed} ` +
			`pos=(${worldX[i].toFixed(1)}, ${worldZ[i].toFixed(1)})`,
		)
		broadcastOne(i)
	}
}


// MARK: seedHiddenMeltRing
/**
 * Same shape as server.ts::seedStartingArea, but centred on hidden
 * bonfire `index`. Called on ignition and on every ring-refresh tick
 * so paint dropped inside a warm ring snaps back to the warm state
 * and never regrows into snow.
 */
function seedHiddenMeltRing(index: number): void {
	if (!lit[index]) return
	// Ring size follows the fuel-derived radius (matches main hearth's
	// live tier -> radius mapping) with an initial-grow-in fade on top
	// so a fresh ignition still visibly "thaws" outward from 0 to the
	// current fuel radius over MELT_GROWTH_DURATION_S. Once the fade
	// completes, the radius tracks fuel directly - grows on feed,
	// shrinks on decay.
	const grow = Math.min(1, secondsSinceIgnite[index] / MELT_GROWTH_DURATION_S)
	const r    = hearthRadiusFromFuel(fuel[index]) * grow
	if (r <= 0) return
	meltDisc(worldX[index], worldZ[index], r)
}


// MARK: broadcastOne
function broadcastOne(index: number): void {
	room.send('hiddenCampfireState', {
		seed : currentSeed,
		index,
		lit  : lit[index] ? 1 : 0,
	})
}


// MARK: broadcastFuel
function broadcastFuel(index: number, userId?: string): void {
	const opts = userId ? { to: [userId] } : undefined
	room.send('hiddenHearthFuelUpdate', {
		index,
		fuel   : fuel[index],
		players: rosterSize(),
	}, opts)
	lastBroadcastFuel[index] = fuel[index]
	lastBroadcastTier[index] = hearthTierFromFuel(fuel[index])
	heartbeatClock[index]    = 0
}


// MARK: snuffFire
/**
 * Fuel hit zero. Flip lit=false, retract the melt ring to nothing,
 * broadcast the state change. Rebroadcast fuel=0 first so any client
 * that hasn't received the last fuel packet yet sees the definitive
 * "went out" moment before the lit-state flip.
 */
function snuffFire(index: number): void {
	console.log(`[Server] hiddenCampfire[${index}]: SNUFFED (fuel exhausted)`)
	fuel[index]               = 0
	secondsSinceIgnite[index] = 0
	lit[index]                = false
	if (built[index]) extinguishedAt[index] = Date.now()
	broadcastFuel(index)
	// previousRadiusM = max possible so any cell this fire ever
	// painted is swept; cells owned by other fires are left alone.
	releaseDiscOutside(worldX[index], worldZ[index], 0, hearthRadiusFromFuel(FUEL_MAX))
	broadcastOne(index)
	broadcastRecycle()
}


// MARK: getHiddenFireNodes
/** Placed hidden fires with position + lit flag (fire network). */
export function getHiddenFireNodes(): { index: number; x: number; z: number; lit: boolean }[] {
	const out: { index: number; x: number; z: number; lit: boolean }[] = []
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
		if (worldX[i] === 0 && worldZ[i] === 0) continue
		out.push({ index: i, x: worldX[i], z: worldZ[i], lit: lit[i] && fuel[i] > 0 })
	}
	return out
}


// MARK: isAnyHiddenFireLit
/** True if at least one hidden bonfire still has fuel. */
export function isAnyHiddenFireLit(): boolean {
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
		if (lit[i] && fuel[i] > 0) return true
	}
	return false
}


// MARK: snuffAllHiddenFires
/** Force every hidden fire out. Used by the dev ember-fail trigger. */
export function snuffAllHiddenFires(): void {
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
		if (!lit[i] && fuel[i] <= 0) continue
		snuffFire(i)
	}
}


// MARK: sendHiddenCampfireStateTo
/**
 * Push the full lit tuple + fuel snapshots to a specific client.
 * Called from the joinRoster handler in server.ts so new joiners
 * immediately see every fire in its correct state.
 */
export function sendHiddenCampfireStateTo(userId: string): void {
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
		// Built fires: position first so the client moves the pit there.
		if (built[i]) {
			room.send('builtFirePlaced', { seed: currentSeed, index: i, x: worldX[i], z: worldZ[i] }, { to: [userId] })
		}
		// Fuel first when lit so applyLitVisuals reads a real tank.
		if (lit[i]) broadcastFuel(i, userId)
		room.send(
			'hiddenCampfireState',
			{ seed: currentSeed, index: i, lit: lit[i] ? 1 : 0 },
			{ to: [userId] },
		)
	}
	broadcastRecycle(userId)
}


// MARK: setupHiddenCampfireServer
/**
 * Register handlers + broadcast the initial state. Idempotent — call
 * once during setupServer bootstrap AFTER setupCycleServer so we adopt
 * its authoritative seed rather than sampling Date.now() a second time.
 */
export function setupHiddenCampfireServer(): void {
	currentSeed = getCurrentCycleSeed()
	recomputePositions()
	seedHiddenCampfireDimples()
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
		console.log(
			`[Server] hiddenCampfire[${i}]: cycle seed=${currentSeed} ` +
			`pos=(${worldX[i].toFixed(1)}, ${worldZ[i].toFixed(1)}) lit=${lit[i]}`
		)
	}

	room.onMessage('hiddenCampfireIgnite', ({ seed, index }, context) => {
		const from = context?.from ?? 'unknown'
		console.log(
			`[Server] hiddenCampfire: RX ignite seed=${seed} index=${index} from=${from} ` +
			`(currentSeed=${currentSeed} lit[${index}]=${lit[index] ?? '?'})`
		)
		if (!cycleSeedsEqual(seed, currentSeed)) {
			console.log(
				`[Server] hiddenCampfire: ignite rejected from ${from} ` +
				`— stale seed (got ${seed}, want ${currentSeed})`
			)
			return
		}
		if (index < 0 || index >= HIDDEN_CAMPFIRE_COUNT) {
			console.log(
				`[Server] hiddenCampfire: ignite rejected from ${from} ` +
				`— bad index ${index} (valid 0..${HIDDEN_CAMPFIRE_COUNT - 1})`
			)
			return
		}
		if (lit[index]) {
			console.log(`[Server] hiddenCampfire[${index}]: ignite from ${from} ignored — already lit`)
			return
		}
		lit[index]                = true
		extinguishedAt[index]     = 0
		secondsSinceIgnite[index] = 0
		fuel[index]               = FUEL_HIDDEN_INITIAL
		console.log(
			`[Server] hiddenCampfire[${index}]: ignited by ${from} ` +
			`(seed=${currentSeed}, fuel=${FUEL_HIDDEN_INITIAL}s tier ${hearthTierFromFuel(FUEL_HIDDEN_INITIAL)})`
		)
		if (fireRelitHandler) fireRelitHandler()
		broadcastRecycle()
		// Fuel BEFORE lit-state so clients spawn flame cards at Ember
		// scale instead of scale 0 (lit packet used to win the race and
		// leave a blank pit for a beat). Melt ring still grows in on the
		// tick below — no seed pass here.
		broadcastFuel(index)
		broadcastOne(index)
	})

	// Fuel decay + ring refresh + broadcast throttling. Runs every
	// frame; ring refresh coalesces at 4 Hz; broadcasts fire on delta.
	const RING_REFRESH_HZ = 4
	const RING_INTERVAL   = 1 / RING_REFRESH_HZ
	let   ringClock       = 0
	engine.addSystem((dt: number) => {
		const players   = rosterSize()
		const drainRate = hearthDecayRate(players) * getPhaseDrainMul()
		let anyLit      = false

		for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
			if (!lit[i]) continue
			anyLit                 = true
			secondsSinceIgnite[i] += dt
			const prev             = fuel[i]
			const prevTier         = hearthTierFromFuel(prev)
			const netMul           = NETWORK_BURN_MUL !== 1 && isFireLinked(i + 1) ? NETWORK_BURN_MUL : 1
			// Permanent built fires (ruleset Test 2) hold their fuel.
			// Floating crystals: a fire charging a monument burns faster.
			const chargeMul        = isSlotCharging(i) ? CHARGE_FIRE_DRAIN_MUL : 1
			const burn             = isPermanentSlot(i) ? 0 : drainRate * netMul * chargeMul * dt
			fuel[i]                = Math.max(FUEL_HIDDEN_FLOOR, prev - burn)

			// Downward tier crossing on decay -> shrink the ring so it
			// visibly retracts in step with fuel loss.
			const newTier = hearthTierFromFuel(fuel[i])
			if (newTier < prevTier) {
				const r = hearthRadiusFromFuel(fuel[i])
				// Bound to this fire's max possible radius so the shrink
				// never touches cells owned by other fires.
				releaseDiscOutside(worldX[i], worldZ[i], r, hearthRadiusFromFuel(FUEL_MAX))
				console.log(`[Server] hiddenCampfire[${i}]: tier decay ${prevTier}->${newTier} ring->${r.toFixed(1)}m`)
			}

			// Snuff on fuel exhaustion. snuffFire handles broadcasts +
			// ring retraction to zero.
			if (fuel[i] <= 0 && prev > 0) {
				snuffFire(i)
				continue
			}

			// Throttled fuel broadcast.
			heartbeatClock[i] += dt
			const fuelDrifted = Math.abs(fuel[i] - lastBroadcastFuel[i]) >= BROADCAST_FUEL_DELTA
			const tierChanged = newTier !== lastBroadcastTier[i]
			const heartbeatDue = heartbeatClock[i] >= BROADCAST_HEARTBEAT_S
			if (fuelDrifted || tierChanged || heartbeatDue) broadcastFuel(i)
		}

		if (!anyLit) return
		ringClock += dt
		if (ringClock < RING_INTERVAL) return
		ringClock = 0
		for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
			if (lit[i]) seedHiddenMeltRing(i)
		}
	})

	// Feed handler - filter by target index. -1 means main hearth
	// (handled by src/server/hearthFuel.ts); anything in [0, N) is a
	// hidden fire slot. Ignites nothing - fire must already be lit.
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
		// Permanent built fires report full so shared fuel passes them by.
		registerFireFuel(i + 1, () => (lit[i] ? (isPermanentSlot(i) ? FUEL_MAX : fuel[i]) : 0), (n) => {
			if (!lit[i] || isPermanentSlot(i)) return
			const prevTier = hearthTierFromFuel(fuel[i])
			fuel[i] = Math.min(FUEL_MAX, fuel[i] + n)
			if (hearthTierFromFuel(fuel[i]) > prevTier) seedHiddenMeltRing(i)
			broadcastFuel(i)
		})
	}
	room.onMessage('feedFireRequest', ({ target, kind }, context) => {
		if (target < 0 || target >= HIDDEN_CAMPFIRE_COUNT) return
		if (isEmberFailing()) {
			console.log(`[Server] hiddenCampfire[${target}]: feed ignored — ember fail in progress`)
			return
		}
		const from = context?.from ?? 'unknown'
		if (!lit[target] || fuel[target] <= 0) {
			console.log(`[Server] hiddenCampfire[${target}]: feed refused from ${from} — fire is out`)
			if (context?.from) {
				room.send('feedFireRejected', { kind: clampWoodKind(kind) }, { to: [context.from] })
			}
			return
		}
		const add      = fuelSecondsForKind(clampWoodKind(kind))
		const prev     = fuel[target]
		noteSlotTouched(target, from)
		// Charge visual: the share wave runs fire -> monument (no fuel moves).
		const mons = chargeTargetsOf(target)
		if (mons.length) room.send('fireNetworkShare', { from: target + 1, ids: mons })
		const share = tryShareFeed(target + 1, add, from)
		if (share === 'shared') {
			noteContributor(from, target + 1) // fed a fire (shared with the network)
			if (context?.from) room.send('feedFireFx', { userId: context.from, target, kind: clampWoodKind(kind) })
			return
		}
		if (share === 'full' || !feedFitsFire(prev, kind)) {
			console.log(
				`[Server] hiddenCampfire[${target}]: feed refused from ${from} kind=${clampWoodKind(kind)} ` +
				`${prev.toFixed(1)}s + ${add}s would pass the cap`
			)
			if (context?.from) {
				room.send('feedFireRejected', { kind: clampWoodKind(kind) }, { to: [context.from] })
			}
			return
		}
		noteSlotTouched(target, from)
		noteContributor(from, target + 1) // fed a fire
		const prevTier = hearthTierFromFuel(prev)
		fuel[target]   = prev + add
		const newTier  = hearthTierFromFuel(fuel[target])
		console.log(
			`[Server] hiddenCampfire[${target}]: feed by ${from} kind=${clampWoodKind(kind)} ` +
			`${prev.toFixed(1)}s -> ${fuel[target].toFixed(1)}s (tier ${newTier})`
		)
		// Upward tier crossing -> repaint ring at the wider radius. The
		// ring-refresh tick above would eventually notice, but immediate
		// feedback on feed feels much better.
		if (newTier > prevTier) seedHiddenMeltRing(target)
		broadcastFuel(target)
		if (context?.from) {
			room.send('feedFireFx', {
				userId: context.from,
				target ,
				kind   : clampWoodKind(kind),
			})
		}
	})

	if (isBuildYourOwnFire()) setupBuiltFireHandler()

	// Reset on cycle boundary. Registered here (not in server.ts) so
	// this module owns its own lifecycle.
	onCycleRoll(({ newSeed }) => {
		resetForCycle(newSeed)
	})

	// Initial broadcast for any client that connected before this
	// module registered its handler.
	for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) broadcastOne(i)
}


// MARK: setupBuiltFireHandler
/**
 * Build Your Own Fire: a client with a log and a lit torch asks to
 * build at (x, z). Re-validate with the shared rules, take a free slot,
 * light it with BUILT_FIRE_START_FUEL, and broadcast. From here the slot
 * is an ordinary lit campfire (fuel, feed, network, extinction, reset).
 */
function setupBuiltFireHandler(): void {
	// Shared tail: validate (x, z), take a slot, light it. Returns a
	// verdict string ('ok' on success).
	const tryBuildAt = (x: number, z: number, from: string, startFuel: number = BUILT_FIRE_START_FUEL): string => {
		if (isEmberFailing()) return 'ember'
		if (!Number.isFinite(x) || !Number.isFinite(z)) return 'bounds'
		const count = builtFireCount()
		let free = -1
		for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
			if (!built[i] && !lit[i] && worldX[i] === 0 && worldZ[i] === 0) { free = i; break }
		}
		// Full: recycle the built fire extinguished the longest (never a burning one).
		const recycle = (count >= BUILT_CAP || free < 0) ? recycleCandidate() : -1
		if ((count >= BUILT_CAP || free < 0) && recycle < 0) return 'cap'
		const map = activeTerrain() ?? getTerrain(cycleMazeSeed(currentSeed))
		const fires: { x: number; z: number }[] = []
		for (let i = 0; i < HIDDEN_CAMPFIRE_COUNT; i++) {
			if (i === recycle) continue // the recycled fire never blocks spacing
			if (worldX[i] === 0 && worldZ[i] === 0) continue
			fires.push({ x: worldX[i], z: worldZ[i] })
		}
		const verdict = validateBuiltFireSpot(map, x, z, fires, getStageAtWorld, recycle >= 0 ? count - 1 : count)
		if (verdict !== 'ok') return verdict
		const slot = recycle >= 0 ? recycle : free
		if (recycle >= 0) {
			console.log(`[Server] builtFire[${slot}]: recycled (out ${((Date.now() - extinguishedAt[slot]) / 1000).toFixed(0)}s) at (${worldX[slot].toFixed(1)}, ${worldZ[slot].toFixed(1)})`)
			releaseDiscOutside(worldX[slot], worldZ[slot], 0, hearthRadiusFromFuel(FUEL_MAX))
			lastBroadcastFuel[slot] = -999
			lastBroadcastTier[slot] = -1
			heartbeatClock[slot]    = 0
		}
		extinguishedAt[slot]     = 0
		built[slot]              = true
		worldX[slot]             = x
		worldZ[slot]             = z
		lit[slot]                = true
		secondsSinceIgnite[slot] = 0
		fuel[slot]               = startFuel // wood type sets only the starting size
		noteSlotTouched(slot, from)
		noteContributor(from, slot + 1, true) // built a fire
		console.log(
			`[Server] builtFire[${slot}]: built by ${from} at (${x.toFixed(1)}, ${z.toFixed(1)}) ` +
			`fuel=${startFuel}s (${count + 1}/${BUILT_CAP} built)`,
		)
		if (fireRelitHandler) fireRelitHandler()
		room.send('builtFirePlaced', { seed: currentSeed, index: slot, x, z })
		broadcastFuel(slot)
		broadcastOne(slot)
		broadcastRecycle()
		return 'ok'
	}

	// Light the carried log in front of the player (torch tooltip): spot = player feet + BUILT_FIRE_FRONT_M along their facing.
	room.onMessage('builtFireCarriedRequest', ({ seed, x, z, yaw, kind }, context) => {
		const from = context?.from ?? 'unknown'
		const reject = (reason: string) => {
			console.log(`[Server] builtFire: carried light from ${from} rejected: ${reason}`)
			if (context?.from) room.send('builtFireRejected', { kind: clampWoodKind(kind), reason, carried: 1 }, { to: [context.from] })
		}
		if (!cycleSeedsEqual(seed, currentSeed)) { reject('stale'); return }
		if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(yaw)) { reject('bounds'); return }
		const spot = builtFireFrontSpot(x, z, yaw)
		const v = tryBuildAt(spot.x, spot.z, from, buildStartFuelFor(clampWoodKind(kind)))
		if (v !== 'ok') reject(v)
	})
}