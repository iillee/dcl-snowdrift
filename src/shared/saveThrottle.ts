/**
 * saveThrottle.ts - write throttle for the leaderboard's Storage saves (pure; server/leaderboard.ts and scripts/leaderboardThrottleCheck).
 *
 * Every board change used to save on the next tick (a write of the whole board every few seconds while players built fires). Now:
 *   - a normal change waits until SAVE_MIN_INTERVAL_S have passed since the last write (the dirty flag stays, the latest state is written);
 *   - an URGENT change (a monument release / completion, a new player record, a cycle roll) is written on the next tick regardless;
 *   - a failed write retries after SAVE_RETRY_S (Storage.set resolves false rather than throwing), urgent or not;
 *   - nothing is ever dropped: the data written is always the full current board.
 */

/** Minimum seconds between two ordinary leaderboard writes. */
export const SAVE_MIN_INTERVAL_S = 45
/** Seconds before a failed write is retried. */
export const SAVE_RETRY_S = 15

export class SaveThrottle {
	private dirty = false
	private urgent = false
	private lastWriteMs = Number.NEGATIVE_INFINITY
	private retryAtMs = 0

	/** The board changed. `urgent` = flush on the next tick, not after the interval. */
	markDirty(urgent: boolean): void {
		this.dirty = true
		if (urgent) this.urgent = true
	}

	isDirty(): boolean { return this.dirty }

	/** Should a write be started now? */
	shouldSave(nowMs: number): boolean {
		if (!this.dirty || nowMs < this.retryAtMs) return false
		return this.urgent || nowMs - this.lastWriteMs >= SAVE_MIN_INTERVAL_S * 1000
	}

	/** A write finished. `unchanged` = the board still equals what was written (otherwise it stays dirty with the interval restarted). */
	onSaved(nowMs: number, unchanged: boolean): void {
		this.lastWriteMs = nowMs
		this.retryAtMs = 0
		this.urgent = false
		if (unchanged) this.dirty = false
	}

	/** A write failed / returned false: retry soon (urgent state is kept). */
	onFailed(nowMs: number): void {
		this.retryAtMs = nowMs + SAVE_RETRY_S * 1000
	}
}