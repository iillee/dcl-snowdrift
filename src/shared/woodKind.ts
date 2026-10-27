/**
 * woodKind.ts - the carry-slot / world wood kind.
 *
 * Logs are the only wood (1). The old branch / stick kind (0) was removed; the wire still carries a kind int, and
 * clampWoodKind folds anything (an old 0 included) to a log. Fuel seconds live in hearthFuel.
 */

export const WOOD_KIND_LOG = 1


// MARK: clampWoodKind
/** Coerce a wire int to a known kind. Logs are the only kind, so everything becomes a log. */
export function clampWoodKind(_kind: number): number {
	return WOOD_KIND_LOG
}

