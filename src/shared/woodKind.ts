/**
 * woodKind.ts — kindling vs deadwood on the carry slot and in the world.
 *
 * 0 = branch (wilderness scatter). 1 = log (tree feet + rare scatter).
 * Fuel seconds live in hearthFuel so the burn table stays in one file.
 */

export const WOOD_KIND_BRANCH = 0
export const WOOD_KIND_LOG    = 1


// MARK: clampWoodKind
/** Coerce a wire int to a known kind. Unknown values become a log. */
export function clampWoodKind(kind: number): number {
	return kind === WOOD_KIND_BRANCH ? WOOD_KIND_BRANCH : WOOD_KIND_LOG
}

