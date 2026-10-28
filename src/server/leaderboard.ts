/**
 * leaderboard.ts (server) - per-player leaderboard, four boards:
 *   longest   - most days survived in one run the player contributed to
 *   fastest   - best completion of ALL monuments (fewest days, then shortest real time)
 *   monuments - lifetime monuments released in runs they contributed to
 *   firenet   - most campfires in one connected fire network they contributed to
 *
 * Contributors = wallets that did a meaningful action THIS run: picked up
 * wood, built a fire, fed a fire, or released a crystal. Tracked in memory
 * per cycle; cleared on every cycle roll (cycle reset / hearth death), and
 * a server restart starts a new world anyway.
 *
 *  - Joining the contributors lifts their `longest` to the current day.
 *  - Each day tick lifts every contributor's `longest` (in-progress runs count).
 *  - Each monument release credits every contributor +1 monument.
 *  - The last release (all monuments) offers every contributor a completion
 *    for `fastest`.
 *  - Firenet: recordFireNetworks (fireNetwork.ts, every tick) finds the connected
 *    components of fully drawn fire-fire links (monuments never count); each of 2+
 *    fires credits everyone who built or fed one of its fires with its size, kept
 *    as a personal best. Recomputed only when the links or the per-fire contributors
 *    change, at most every FIRENET_MIN_S seconds.
 * A run that used a dev shortcut (runIntegrity) is excluded from all four.
 *
 * Persistence: scene Storage (`Storage` from @dcl/sdk/server), one key PER WORLD PROFILE
 * (LEADERBOARD_STORAGE_KEY: the standard game keeps 'cryocene.leaderboard.v2', the 3-monument
 * playtest uses '...v2.compact3', so their records never mix), one record per player (capped). Survives the ~2 min empty-server
 * shutdown and redeploys. Writes are throttled (shared/saveThrottle.ts: at most one per SAVE_MIN_INTERVAL_S = 45 s; a release,
 * completion, new player record or cycle roll is flushed at once) and retried after a failure because
 * Storage.set resolves false rather than throwing. Clients never write:
 * they only receive `leaderboardState`.
 */

import { engine } from '@dcl/sdk/ecs'
import { Storage } from '@dcl/sdk/server'

import { onCycleRoll } from 'src/server/cycle'
import { getDayNumber, getRunStartedAtMs, onPhaseChange } from 'src/server/phase'
import { isRunTainted, resetRunTaint } from 'src/server/runIntegrity'
import {
	LEADERBOARD_STORAGE_KEY,
	LEADERBOARD_STORE_MAX,
	storedBoardTag,
	LeaderboardPlayer,
	cleanName,
	encodeBoardWire,
	improveThaw,
	networkCredits,
	newPlayer,
	parseStoredBoard,
	serializeBoard,
	trimPlayers,
} from 'src/shared/leaderboard'
import { isFloatingCrystals } from 'src/shared/ruleset'
import { SaveThrottle } from 'src/shared/saveThrottle'
import { WORLD_BOARD_SUFFIX } from 'src/shared/settings'
import { room } from 'src/shared/messages'


/** Retry cadence for a failed load / save (seconds) and cap on load attempts. */
const RETRY_S = 15
const MAX_LOAD_ATTEMPTS = 6
/** Display names remembered per server run (wallet -> name). */
const NAMES_MAX = 500

const players = new Map<string, LeaderboardPlayer>()
/** Storage has been read. Saves wait for this. */
let loaded = false
/** Gave up loading: keep working in memory, never save. */
let gaveUp = false
let loadAttempts = 0
let loadInFlight = false
/** Write throttle (shared/saveThrottle.ts): ordinary changes at most every SAVE_MIN_INTERVAL_S (45 s), releases / new records / cycle rolls flush at once. */
const throttle = new SaveThrottle()
/** Set by an update op that created a brand-new player record: that save is not delayed. */
let urgentOnce = false
let saveInFlight = false
let retryClock = 0
/** Updates made before the load finished; replayed on top of the stored data. */
let pendingOps: Array<() => void> = []

const names = new Map<string, string>()
/** wallet -> true, insertion-ordered: this run's contributors. */
const contributors = new Map<string, true>()
/** Fire node id (0 hearth, slot + 1) -> wallets that built or fed that fire. Reset per cycle / when a slot is rebuilt. */
const fireContributors = new Map<number, Set<string>>()
/** Min seconds between firenet recomputes. */
const FIRENET_MIN_S = 2
let firenetSig = ''
let firenetDirty = false
let firenetAtMs = 0


// MARK: wire
function list(): LeaderboardPlayer[] { return [...players.values()] }

function broadcastBoard(to?: string): void {
	const payload = { json: encodeBoardWire(list()) }
	if (to !== undefined) room.send('leaderboardState', payload, { to: [to] })
	else room.send('leaderboardState', payload)
}

/** Joiner hydration (server.ts joinRoster). */
export function sendLeaderboardTo(userId: string): void {
	if (!isFloatingCrystals()) return
	broadcastBoard(userId)
}

function markChanged(urgent: boolean): void {
	throttle.markDirty(urgent)
	broadcastBoard()
}


// MARK: update
function playerFor(a: string): LeaderboardPlayer {
	let p = players.get(a)
	if (!p) {
		p = newPlayer(a, names.get(a) ?? '')
		players.set(a, p)
	}
	if (!p.n && names.has(a)) p.n = names.get(a) ?? ''
	return p
}

/**
 * Run `op` against the player table (queued until Storage has loaded so
 * stored data is never clobbered). `op` returns true if anything changed.
 */
function update(op: () => boolean, urgent = false): void {
	const run = () => {
		urgentOnce = false
		if (op()) {
			// Over the cap: drop the least notable players.
			if (players.size > LEADERBOARD_STORE_MAX) {
				const keep = new Set(trimPlayers(list()).map((p) => p.a))
				for (const a of [...players.keys()]) if (!keep.has(a)) players.delete(a)
			}
			markChanged(urgent || urgentOnce)
		}
		urgentOnce = false
	}
	if (loaded || gaveUp) run()
	else pendingOps.push(run)
}

function liftDays(a: string, day: number): boolean {
	const p = playerFor(a)
	if (day <= p.d) return false
	p.d = day
	return true
}


// MARK: noteContributor
/** `address` did a meaningful action this run. No-op for unknown senders. */
export function noteContributor(address: string | undefined, fireId?: number, built = false): void {
	if (!isFloatingCrystals() || !address || address === 'unknown') return
	const a = address.toLowerCase()
	if (fireId !== undefined) noteFireContributor(a, fireId, built)
	if (contributors.has(a)) return
	contributors.set(a, true)
	console.log(`[Server] leaderboard: contributor ${a} (${contributors.size} this run)`)
	if (isRunTainted()) return
	const day = Math.max(1, getDayNumber())
	update(() => {
		if (!players.has(a)) urgentOnce = true // a new player record is written at once
		return liftDays(a, day)
	})
}


// MARK: noteFireContributor
/**  (lowercase) built (uilt = fresh fire, drops older credit for that id) or fed fire ireId. */
function noteFireContributor(a: string, fireId: number, built: boolean): void {
	let s = fireContributors.get(fireId)
	if (!s || built) { s = new Set(); fireContributors.set(fireId, s) }
	if (!s.has(a)) { s.add(a); firenetDirty = true }
	if (built) firenetDirty = true
}


// MARK: forgetFireContributors
/** A fire was removed (spent + timed out): its builder / feeder credit goes with it (the slot is reused). */
export function forgetFireContributors(fireId: number): void {
	if (fireContributors.delete(fireId)) firenetDirty = true
}


// MARK: recordFireNetworks
/**
 * Called every network tick with the burning fire ids and the fully drawn
 * fire-fire links (no monument ends). Credits each network's contributors
 * with its size when that beats their stored best.
 */
export function recordFireNetworks(ids: ReadonlyArray<number>, edges: ReadonlyArray<readonly [number, number]>): void {
	if (!isFloatingCrystals() || isRunTainted()) return
	const sig = edges.map(([x, y]) => (x < y ? `${x}-${y}` : `${y}-${x}`)).sort().join(',')
	if (sig === firenetSig && !firenetDirty) return
	const now = Date.now()
	if (now - firenetAtMs < FIRENET_MIN_S * 1000) return // stays dirty / changed: picked up on a later tick
	firenetSig = sig
	firenetDirty = false
	firenetAtMs = now
	if (edges.length === 0 || fireContributors.size === 0) return
	const credits = networkCredits(ids, edges, (id) => fireContributors.get(id) ?? [])
	if (credits.size === 0) return
	update(() => {
		let changed = false
		for (const [a, size] of credits) {
			const p = playerFor(a)
			if (size > p.fn) { p.fn = size; changed = true }
		}
		return changed
	})
}


// MARK: setPlayerName
export function setPlayerName(address: string | undefined, raw: unknown): void {
	if (!address) return
	const name = cleanName(raw)
	if (!name) return
	const a = address.toLowerCase()
	if (!names.has(a) && names.size >= NAMES_MAX) return
	names.set(a, name)
	// Keep an existing row's name fresh; never creates a row.
	update(() => {
		const p = players.get(a)
		if (!p || p.n === name) return false
		p.n = name
		return true
	})
}


// MARK: recordDayTick
/** The day number advanced: in-progress runs lift every contributor's longest. */
function recordDayTick(): void {
	if (!isFloatingCrystals() || contributors.size === 0 || isRunTainted()) return
	const day = Math.max(1, getDayNumber())
	const who = [...contributors.keys()]
	update(() => {
		let changed = false
		for (const a of who) if (liftDays(a, day)) changed = true
		return changed
	})
}


// MARK: recordRunProgress
/**
 * A monument was just released (`released` of `total`). Credit every
 * contributor +1 monument; on the last one, offer each a completion.
 * Skipped for a tainted (dev-shortcut) run.
 */
export function recordRunProgress(released: number, total: number): void {
	if (!isFloatingCrystals()) return
	if (isRunTainted()) {
		console.log('[Server] leaderboard: release not recorded - run used a dev shortcut')
		return
	}
	const day = Math.max(1, getDayNumber())
	const started = getRunStartedAtMs()
	const ts = started > 0 ? Math.max(0, Math.round((Date.now() - started) / 1000)) : 0
	const complete = released >= total && total > 0
	const who = [...contributors.keys()]
	console.log(
		`[Server] leaderboard: release ${released}/${total} at day ${day} (${ts}s), ${who.length} contributors` +
		(complete ? ' - COMPLETE' : ''),
	)
	update(() => {
		let changed = who.length > 0
		for (const a of who) {
			const p = playerFor(a)
			p.mon++
			liftDays(a, day)
			if (complete) improveThaw(p, day, ts)
		}
		return changed
	}, true) // a release / completion is a record: written on the next tick, never held back by the throttle
}


// MARK: load / save
async function loadBoard(): Promise<void> {
	if (loadInFlight || loaded || gaveUp) return
	loadInFlight = true
	loadAttempts++
	try {
		const raw = await Storage.get<unknown>(LEADERBOARD_STORAGE_KEY, { fresh: true })
		// Belt and braces: a blob tagged for another profile's board is never loaded or overwritten.
		const tag = storedBoardTag(raw)
		if (raw && tag !== WORLD_BOARD_SUFFIX && (tag !== '' || parseStoredBoard(raw).length > 0)) {
			gaveUp = true
			console.log(`[Server] leaderboard: stored board tag '${tag}' != active '${WORLD_BOARD_SUFFIX}' - not loading, saves disabled`)
			const ops = pendingOps
			pendingOps = []
			for (const op of ops) op()
			return
		}
		for (const p of parseStoredBoard(raw)) players.set(p.a, p)
		loaded = true
		console.log(`[Server] leaderboard: loaded ${players.size} players from storage`)
		// Replay anything that happened while loading on top of the stored data.
		const ops = pendingOps
		pendingOps = []
		for (const op of ops) op()
		broadcastBoard()
	} catch (err) {
		console.log(`[Server] leaderboard: load failed (attempt ${loadAttempts}/${MAX_LOAD_ATTEMPTS}): ${err}`)
		if (loadAttempts >= MAX_LOAD_ATTEMPTS) {
			// Do not overwrite stored data we could not read.
			gaveUp = true
			console.log('[Server] leaderboard: giving up on loading - results stay in memory only this run (saves disabled)')
			const ops = pendingOps
			pendingOps = []
			for (const op of ops) op()
		}
	} finally {
		loadInFlight = false
	}
}

async function saveBoard(): Promise<void> {
	if (saveInFlight || !throttle.isDirty() || !loaded) return
	saveInFlight = true
	const snapshot = serializeBoard(list())
	try {
		const ok = await Storage.set(LEADERBOARD_STORAGE_KEY, snapshot, { skipIfUnchanged: false })
		if (ok) {
			// Changes made while the write was in flight stay dirty.
			throttle.onSaved(Date.now(), serializeBoard(list()) === snapshot)
			console.log(`[Server] leaderboard: saved ${players.size} players`)
		} else {
			throttle.onFailed(Date.now())
			console.log('[Server] leaderboard: Storage.set returned false - will retry')
		}
	} catch (err) {
		throttle.onFailed(Date.now())
		console.log(`[Server] leaderboard: save failed: ${err} - will retry`)
	} finally {
		saveInFlight = false
	}
}


// MARK: setupLeaderboardServer
export function setupLeaderboardServer(): void {
	if (!isFloatingCrystals()) return

	room.onMessage('playerName', ({ name }, context) => {
		setPlayerName(context?.from, name)
	})

	onCycleRoll(() => {
		if (throttle.isDirty()) throttle.markDirty(true) // flush whatever the last world earned before the new one starts
		contributors.clear()
		fireContributors.clear()
		firenetSig = ''
		firenetDirty = false
		resetRunTaint()
	})

	// Day counter ticks at sunrise; only act when the number really moved.
	let lastDay = 0
	onPhaseChange(() => {
		const day = getDayNumber()
		if (day === lastDay) return
		lastDay = day
		recordDayTick()
	})

	void loadBoard()
	retryClock = 0
	engine.addSystem((dt: number) => {
		if (!loaded && !gaveUp) {
			retryClock += dt
			if (retryClock < RETRY_S) return
			retryClock = 0
			void loadBoard()
			return
		}
		if (loaded && !saveInFlight && throttle.shouldSave(Date.now())) void saveBoard()
	}, undefined, 'leaderboardPersistSystem')
	console.log(`[Server] leaderboard: ready (storage key ${LEADERBOARD_STORAGE_KEY})`)
}
