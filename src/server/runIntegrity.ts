/**
 * runIntegrity.ts - flags a world cycle as "tainted" when a dev / debug
 * shortcut (advance phase, debug thaw, debug monument) was used, so the
 * run never lands on the leaderboard (src/server/leaderboard.ts).
 * Kept dependency-free so phase.ts and stations.ts can import it without
 * an import cycle.
 */

let tainted = false

/** A dev shortcut touched this cycle: its completion must not be recorded. */
export function markRunTainted(why: string): void {
	if (!tainted) console.log(`[Server] runIntegrity: run tainted (${why}) - will not reach the leaderboard`)
	tainted = true
}

export function isRunTainted(): boolean {
	return tainted
}

/** Fresh cycle: clean slate. */
export function resetRunTaint(): void {
	tainted = false
}