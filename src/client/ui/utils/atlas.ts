/**
 * atlas.ts — UV helpers for icon atlas textures.
 */

// MARK: getUVsForIconAtlasNumber
/**
 * Fetch UVs for a number glyph from the icon atlas (0–12 supported).
 */
export function getUVsForIconAtlasNumber(number: number): number[] {
	var y = 0.5
	if (number >= 8) {
		y = 0
		number = number - 8
	}
	return [
		number * 0.125, y,
		number * 0.125, y + 0.5,
		(number + 1) * 0.125, y + 0.5,
		(number + 1) * 0.125, y,
	]
}


// MARK: getUVsForAtlasTile
/**
 * Fetch UVs for a single tile inside a uniform (cols x rows) sprite
 * atlas. `col` / `row` are 0-indexed with row 0 at the TOP of the
 * image. DCL treats v = 1 as the top of the texture (matches the
 * getUVsForIconAtlasNumber convention), so we invert the row.
 */
export function getUVsForAtlasTile(
	col : number,
	row : number,
	cols: number,
	rows: number,
): number[] {
	const u1 = col       / cols
	const u2 = (col + 1) / cols
	// row 0 (top of image) needs the HIGHEST v — flip.
	const vTop    = (rows - row)     / rows
	const vBottom = (rows - row - 1) / rows
	return [
		u1, vBottom,
		u1, vTop,
		u2, vTop,
		u2, vBottom,
	]
}


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
