/**
 * leaderboard.ts - shared types + pure helpers for the Cryocene
 * per-player leaderboard (floating-crystals ruleset).
 *
 * Four boards over one stored record per player:
 *   longest   - most days survived in one run the player contributed to
 *   fastest   - best completion (all obelisks): fewest days, then shortest real time
 *   obelisks - lifetime obelisks released in runs they contributed to
 *   firenet   - biggest single connected fire network (campfires) they helped build / feed
 *
 * The server (src/server/leaderboard.ts) is the only writer; clients only
 * receive the compact wire form produced by encodeBoardWire.
 */


/**
 * Scene-storage key (src/server/leaderboard.ts). Bump the suffix on an incompatible format change.
 * Adding the optional n field is compatible: rows stored without it read as 0, so the key stays v2.
 */
import { WORLD_BOARD_SUFFIX, WORLD_IS_COMPACT, WORLD_PROFILE_SPEC, WorldProfile } from 'src/shared/settings'

/** Standard-board storage key. Bump the suffix on an incompatible format change (the profile suffix is added after it). */
export const LEADERBOARD_BASE_KEY = 'cryocene.leaderboard.v2'
/** Storage key of a world profile's board: the standard profiles share the base key unchanged; every other profile has its own key. */
export function leaderboardKeyFor(profile: WorldProfile): string {
	return LEADERBOARD_BASE_KEY + WORLD_PROFILE_SPEC[profile].boardSuffix
}
/** ACTIVE profile's key: 'cryocene.leaderboard.v2' (standard, unchanged) or 'cryocene.leaderboard.v2.compact3' (3-obelisk playtest), so records never mix. */
export const LEADERBOARD_STORAGE_KEY = LEADERBOARD_BASE_KEY + WORLD_BOARD_SUFFIX
/** Panel heading for a non-standard board ('' = standard board, no heading). */
export const LEADERBOARD_HEADING = WORLD_IS_COMPACT ? 'PLAYTEST BOARD - 3 OBELISKS' : ''
/** Players kept in storage. */
export const LEADERBOARD_STORE_MAX = 300
/** Rows per board sent to clients and shown in the panel. */
export const LEADERBOARD_SHOW = 10
/** Longest display name kept (characters). */
export const LEADERBOARD_NAME_MAX = 24


/** A player's stored stats. */
export type LeaderboardPlayer = {
	/** Lowercase wallet address. */
	a  : string
	/** Display name ('' = unknown). */
	n  : string
	/** Most days survived in a single run they contributed to (0 = none). */
	d  : number
	/** Fewest days of a completed (all obelisks) run (0 = never completed). */
	td : number
	/** Real seconds of that fastest completion (tie-break after td). */
	ts : number
	/** Lifetime obelisks released in runs they contributed to. */
	mon: number
	/** Most campfires in one connected fire network they contributed to (0 = none; networks of 2+ only). */
	fn : number
}

// The 'monuments' board key predates the monument -> obelisk rename; it is part of the board wire JSON
// (decodeBoardWire accepts old payloads), so the key value is kept.
export type BoardKind = 'longest' | 'fastest' | 'monuments' | 'firenet'

/** One row as clients receive it (name already resolved by the server). */
export type LeaderboardRow = {
	a   : string
	name: string
	/** longest: days. fastest: days. monuments: count. firenet: campfires. */
	v   : number
	/** fastest only: real seconds. */
	ts  : number
}

export type LeaderboardBoards = {
	longest  : LeaderboardRow[]
	fastest  : LeaderboardRow[]
	monuments: LeaderboardRow[]
	firenet  : LeaderboardRow[]
}


// MARK: newPlayer
export function newPlayer(a: string, n = ''): LeaderboardPlayer {
	return { a, n, d: 0, td: 0, ts: 0, mon: 0, fn: 0 }
}


// MARK: comparators
const byAddr = (x: LeaderboardPlayer, y: LeaderboardPlayer) => (x.a < y.a ? -1 : x.a > y.a ? 1 : 0)

/** Most days; ties: more obelisks, then address (stable). */
export function compareLongest(x: LeaderboardPlayer, y: LeaderboardPlayer): number {
	return (y.d - x.d) || (y.mon - x.mon) || byAddr(x, y)
}
/** Fewest days, then least time; ties by address. Only meaningful for td > 0. */
export function compareFastest(x: LeaderboardPlayer, y: LeaderboardPlayer): number {
	return (x.td - y.td) || (x.ts - y.ts) || byAddr(x, y)
}
/** Most obelisks; ties: more days survived, then address. */
export function compareObelisks(x: LeaderboardPlayer, y: LeaderboardPlayer): number {
	return (y.mon - x.mon) || (y.d - x.d) || byAddr(x, y)
}


/** Most campfires in one network; ties: more days, then address. */
export function compareFirenet(x: LeaderboardPlayer, y: LeaderboardPlayer): number {
	return (y.fn - x.fn) || (y.d - x.d) || byAddr(x, y)
}


// MARK: networkCredits
/**
 * Biggest connected fire network per contributor. ids = every burning fire,
 * edges = live fire-to-fire links (obelisks never appear in either). Each
 * connected component of 2+ fires credits every player in who(fireId) with
 * its size; a player keeps the max over components. Returns wallet -> size.
 */
export function networkCredits(
	ids  : Iterable<number>,
	edges: ReadonlyArray<readonly [number, number]>,
	who  : (fireId: number) => Iterable<string>,
): Map<string, number> {
	const parent = new Map<number, number>()
	for (const id of ids) parent.set(id, id)
	const find = (x: number): number => {
		let r = x
		while (parent.get(r) !== r) r = parent.get(r)!
		while (parent.get(x) !== r) { const n = parent.get(x)!; parent.set(x, r); x = n }
		return r
	}
	for (const [a, b] of edges) {
		if (!parent.has(a) || !parent.has(b)) continue // a link end that is not burning
		parent.set(find(a), find(b))
	}
	const members = new Map<number, number[]>()
	for (const id of parent.keys()) {
		const r = find(id)
		const m = members.get(r)
		if (m) m.push(id); else members.set(r, [id])
	}
	const out = new Map<string, number>()
	for (const m of members.values()) {
		if (m.length < 2) continue
		const people = new Set<string>()
		for (const id of m) for (const a of who(id)) people.add(a)
		for (const a of people) if (m.length > (out.get(a) ?? 0)) out.set(a, m.length)
	}
	return out
}


// MARK: improveThaw
/** Offer a completion (days, seconds). True if it beats the player's stored fastest (or is their first). */
export function improveThaw(p: LeaderboardPlayer, days: number, ts: number): boolean {
	const better = p.td <= 0 || days < p.td || (days === p.td && ts < p.ts)
	if (!better) return false
	p.td = days
	p.ts = ts
	return true
}


// MARK: trimPlayers
/**
 * Keep at most `max` players. The ones dropped are the least notable:
 * a completion outweighs everything, then obelisks, then days.
 */
export function trimPlayers(list: LeaderboardPlayer[], max: number = LEADERBOARD_STORE_MAX): LeaderboardPlayer[] {
	if (list.length <= max) return list
	const score = (p: LeaderboardPlayer) => (p.td > 0 ? 1e9 : 0) + p.mon * 1e4 + p.fn * 20 + p.d
	return list.slice().sort((x, y) => score(y) - score(x) || byAddr(x, y)).slice(0, max)
}


// MARK: cleanName
/** Strip control chars / markup, collapse spaces, cap length. '' if nothing usable. */
export function cleanName(raw: unknown): string {
	if (typeof raw !== 'string') return ''
	let s = ''
	for (let i = 0; i < raw.length; i++) {
		const code = raw.charCodeAt(i)
		if (code < 32 || code === 127) continue
		const ch = raw[i]
		if (ch === '<' || ch === '>') continue // rich-text tags in Labels
		s += ch
	}
	s = s.replace(/\s+/g, ' ').trim()
	if (s.length > LEADERBOARD_NAME_MAX) s = s.slice(0, LEADERBOARD_NAME_MAX)
	return s
}


// MARK: shortAddress
/** 0x1e93e534c5e2... -> "0x1e93...a52b" (with a real ellipsis). Short ids pass through. */
export function shortAddress(addr: string): string {
	if (addr.length <= 12) return addr
	return `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`
}


// MARK: playerLabel
export function playerLabel(p: { a: string; n: string }): string {
	return p.n ? p.n : shortAddress(p.a)
}


// MARK: parseStoredBoard
/**
 * Validate whatever Storage returned (a JSON string, or the parsed object)
 * into a clean, de-duplicated player list. Malformed rows are dropped.
 */
export function parseStoredBoard(raw: unknown): LeaderboardPlayer[] {
	let data: unknown = raw
	if (typeof raw === 'string') {
		try { data = JSON.parse(raw) } catch { return [] }
	}
	const list = (data && typeof data === 'object' && Array.isArray((data as { players?: unknown }).players))
		? (data as { players: unknown[] }).players
		: []
	const seen = new Map<string, LeaderboardPlayer>()
	const num = (v: unknown) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0 }
	for (const item of list) {
		if (!item || typeof item !== 'object') continue
		const r = item as Record<string, unknown>
		if (typeof r.a !== 'string' || !r.a) continue
		const a = r.a.toLowerCase()
		const p: LeaderboardPlayer = { a, n: cleanName(r.n), d: num(r.d), td: num(r.td), ts: num(r.ts), mon: num(r.mon), fn: num(r.fn) }
		if (p.td === 0) p.ts = 0
		if (p.d === 0 && p.td === 0 && p.mon === 0 && p.fn === 0) continue
		const old = seen.get(a)
		if (!old) { seen.set(a, p); continue }
		// Duplicate address: keep the best of each stat.
		old.d = Math.max(old.d, p.d)
		old.mon = Math.max(old.mon, p.mon)
		old.fn = Math.max(old.fn, p.fn)
		if (p.td > 0) improveThaw(old, p.td, p.ts)
		old.n = old.n || p.n
	}
	return trimPlayers([...seen.values()])
}


// MARK: serializeBoard
/** Standard board writes the bytes it always did; a profile board also carries its tag (b) so a wrong-board blob is recognised on load. */
export function serializeBoard(list: LeaderboardPlayer[], boardSuffix: string = WORLD_BOARD_SUFFIX): string {
	return JSON.stringify(boardSuffix ? { v: 2, b: boardSuffix, players: list } : { v: 2, players: list })
}

/** Board tag of a stored blob ('' = standard / untagged). Used on load to refuse a blob that belongs to another profile's board. */
export function storedBoardTag(raw: unknown): string {
	let data: unknown = raw
	if (typeof raw === 'string') {
		try { data = JSON.parse(raw) } catch { return '' }
	}
	const b = data && typeof data === 'object' ? (data as { b?: unknown }).b : undefined
	return typeof b === 'string' ? b : ''
}


// MARK: buildBoards
/** Top LEADERBOARD_SHOW per board (only players with a value on that board). */
export function buildBoards(list: LeaderboardPlayer[]): LeaderboardBoards {
	const top = (items: LeaderboardPlayer[], cmp: (x: LeaderboardPlayer, y: LeaderboardPlayer) => number, row: (p: LeaderboardPlayer) => LeaderboardRow) =>
		items.slice().sort(cmp).slice(0, LEADERBOARD_SHOW).map(row)
	return {
		longest  : top(list.filter((p) => p.d > 0), compareLongest, (p) => ({ a: p.a, name: playerLabel(p), v: p.d, ts: 0 })),
		fastest  : top(list.filter((p) => p.td > 0), compareFastest, (p) => ({ a: p.a, name: playerLabel(p), v: p.td, ts: p.ts })),
		monuments: top(list.filter((p) => p.mon > 0), compareObelisks, (p) => ({ a: p.a, name: playerLabel(p), v: p.mon, ts: 0 })),
		firenet  : top(list.filter((p) => p.fn > 0), compareFirenet, (p) => ({ a: p.a, name: playerLabel(p), v: p.fn, ts: 0 })),
	}
}


// MARK: encodeBoardWire
/** All four boards as one JSON string for the leaderboardState message (well under the 13 KB cap). */
export function encodeBoardWire(list: LeaderboardPlayer[]): string {
	return JSON.stringify(buildBoards(list))
}


// MARK: decodeBoardWire
export function decodeBoardWire(json: string): LeaderboardBoards {
	const empty: LeaderboardBoards = { longest: [], fastest: [], monuments: [], firenet: [] }
	let data: unknown
	try { data = JSON.parse(json) } catch { return empty }
	if (!data || typeof data !== 'object') return empty
	const d = data as Record<string, unknown>
	const rows = (x: unknown): LeaderboardRow[] => {
		if (!Array.isArray(x)) return []
		const out: LeaderboardRow[] = []
		for (const item of x) {
			if (!item || typeof item !== 'object') continue
			const r = item as Record<string, unknown>
			const v = Number(r.v), ts = Number(r.ts)
			if (typeof r.a !== 'string' || !Number.isFinite(v)) continue
			out.push({ a: r.a.toLowerCase(), name: typeof r.name === 'string' ? r.name : shortAddress(r.a), v, ts: Number.isFinite(ts) ? ts : 0 })
			if (out.length >= LEADERBOARD_SHOW) break
		}
		return out
	}
	return { longest: rows(d.longest), fastest: rows(d.fastest), monuments: rows(d.monuments), firenet: rows(d.firenet) }
}


// MARK: formatElapsed
/** 3725 -> "1h 02m"; 754 -> "12m 34s"; 42 -> "42s" (input in SECONDS). */
export function formatElapsed(totalSeconds: number): string {
	const total = Math.max(0, Math.floor(totalSeconds))
	const h = Math.floor(total / 3600)
	const m = Math.floor((total % 3600) / 60)
	const s = total % 60
	const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`)
	if (h > 0) return `${h}h ${pad(m)}m`
	if (m > 0) return `${m}m ${pad(s)}s`
	return `${s}s`
}


// MARK: clipName
/** Clip to `maxLen` characters with an ellipsis. */
export function clipName(s: string, maxLen: number): string {
	return s.length > maxLen ? `${s.slice(0, maxLen - 1)}\u2026` : s
}