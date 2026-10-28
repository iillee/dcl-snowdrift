/**
 * snowJoin.ts - one snow-tile republish per join (pure; server.ts and scripts/joinSyncCheck).
 *
 * A joiner needs the snow tiles written AFTER it is listening to the CRDT: a republish at joinRoster usually lands in the empty snapshot it
 * then hydrates (see the old comment in server.ts), so the client asks again with `snowResync` once it is synced, and THAT republish is the one
 * that matters. Doing both meant two full republishes (every allocated tile, to every client) per join. Now:
 *   - joinRoster only records the joiner (`onJoin`); it does NOT republish;
 *   - the joiner's `snowResync` is the single send (`onResync` = true);
 *   - safety net: if no resync arrives within SNOW_JOIN_FALLBACK_MS (old client, lost message, CRDT never synced) the server republishes ONCE
 *     (`tick` = true) so the joiner is never left without snow;
 *   - a resync with no pending join (server restart / silence recovery, `wantResync` on the client) is a genuine recovery: it republishes.
 */

/** Wait this long for the joiner's snowResync before the server republishes on its own (ms). */
export const SNOW_JOIN_FALLBACK_MS = 6000

export class SnowJoinGate {
	/** joiner (lowercase) -> Date.now() after which the fallback republish is due. */
	private readonly pending = new Map<string, number>()

	/** joinRoster from `id` at `nowMs`: remember it, no republish yet. */
	onJoin(id: string, nowMs: number): void {
		const key = id.toLowerCase()
		// A stalled client re-sends joinRoster every few seconds: never push the fallback deadline out.
		if (!this.pending.has(key)) this.pending.set(key, nowMs + SNOW_JOIN_FALLBACK_MS)
	}

	/** snowResync from `id`: always republish (the join's single send, or a recovery); the join is no longer pending. */
	onResync(id: string): boolean {
		this.pending.delete(id.toLowerCase())
		return true
	}

	/** Per-frame: true once when at least one joiner's resync never came (all overdue joiners share this one republish). */
	tick(nowMs: number): boolean {
		if (this.pending.size === 0) return false
		let due = false
		for (const [id, at] of this.pending) {
			if (nowMs < at) continue
			this.pending.delete(id)
			due = true
		}
		return due
	}

	/** Joiners still waiting for their resync. */
	pendingCount(): number {
		return this.pending.size
	}
}