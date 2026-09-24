/**
 * networkIds.ts — fixed syncEntity ids for server-owned singletons and
 * the snow tile band.
 *
 * Ranges must not overlap — syncEntity rejects duplicate ids. Smart Items
 * auto-claim 8001+ for composite items, so snow tiles use a high band.
 *   3000       SeedHolder (transitional client sync)
 *   3100       PaintCoverage
 *   3101       ServerStats
 *   200000+    PaintTile (one per snow tile, created on first write)
 */

export const SEED_NETWORK_ID     = 3000
export const COVERAGE_NETWORK_ID = 3100
export const STATS_NETWORK_ID    = 3101
export const TILE_NETWORK_BASE   = 200000


// MARK: tileNetworkId

/** Stable syncEntity id for a snow tile key. */
export function tileNetworkId(tileKey: number): number {
	return TILE_NETWORK_BASE + tileKey
}


// MARK: tileKeyFromNetworkId

/** Reverse of tileNetworkId. Null when the id is outside the snow tile band. */
export function tileKeyFromNetworkId(networkId: number): number | null {
	const key = networkId - TILE_NETWORK_BASE
	if (key < 0) return null
	return key
}
