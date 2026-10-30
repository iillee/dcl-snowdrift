/**
 * atlas.ts — UV helpers for icon atlas textures.
 */

// MARK: getUVsForIconAtlasRow
/**
 * Fetch UVs for a full row in an icon atlas strip.
 */
export function getUVsForIconAtlasRow(
	number:  number,
	maxRows: number = 8,
): number[] {
	const ROW_HEIGHT = 1 / maxRows

	return [
		0, number * ROW_HEIGHT,
		0, (number + 1) * ROW_HEIGHT,
		1, (number + 1) * ROW_HEIGHT,
		1, number * ROW_HEIGHT,
	]
}
