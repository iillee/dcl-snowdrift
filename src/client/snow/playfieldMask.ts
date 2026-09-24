/**
 * playfieldMask.ts — which snow tiles are covered by perimeter cliffs.
 *
 * The mask is tile-granular (16 m): a masked tile renders no snow, has no
 * ground slab, and reads as pristine for gameplay queries. It is derived
 * from the perimeter reservation set, which depends on the synced seed,
 * so it is unknown until the first seed arrives.
 */

import {
	SNOW_TILES_X,
	SNOW_TILES_Z,
} from 'src/shared/snowGrid'

const masked = new Uint8Array(SNOW_TILES_X * SNOW_TILES_Z)

let ready   = false
let version = 0

export type OpenRect = { tx: number; tz: number; w: number; h: number }


// MARK: setMaskedTiles

/** Replace the mask with the given reserved tiles. Bumps the mask version. */
export function setMaskedTiles(tiles: Array<{ tx: number; tz: number }>): void {
	masked.fill(0)
	let applied = 0
	for (const t of tiles) {
		if (t.tx < 0 || t.tx >= SNOW_TILES_X || t.tz < 0 || t.tz >= SNOW_TILES_Z) {
			console.log(`playfieldMask: setMaskedTiles: ignoring out-of-range tile (${t.tx}, ${t.tz})`)
			continue
		}
		masked[t.tz * SNOW_TILES_X + t.tx] = 1
		applied++
	}
	ready = true
	version++
	console.log(`playfieldMask: setMaskedTiles: ${applied} tiles masked (version ${version})`)
}


// MARK: isMaskReady

/** True once setMaskedTiles has been called at least once. */
export function isMaskReady(): boolean {
	return ready
}


// MARK: maskVersion

/** Increments on every mask change. */
export function maskVersion(): number {
	return version
}


// MARK: isTileMasked

/** True when the tile is covered by cliffs. */
export function isTileMasked(tileKey: number): boolean {
	return masked[tileKey] === 1
}


// MARK: computeOpenRects

/**
 * Cover every unmasked tile with as few axis-aligned rectangles as a
 * greedy row-run merge allows. Used to build the ground slabs.
 */
export function computeOpenRects(): OpenRect[] {
	const used  = new Uint8Array(masked.length)
	const rects: OpenRect[] = []
	for (let tz = 0; tz < SNOW_TILES_Z; tz++) {
		for (let tx = 0; tx < SNOW_TILES_X; tx++) {
			const i = tz * SNOW_TILES_X + tx
			if (masked[i] === 1 || used[i] === 1) continue

			let w = 1
			while (tx + w < SNOW_TILES_X) {
				const j = tz * SNOW_TILES_X + tx + w
				if (masked[j] === 1 || used[j] === 1) break
				w++
			}

			let h = 1
			while (tz + h < SNOW_TILES_Z && isRunOpen(tx, tz + h, w, used)) h++

			for (let dz = 0; dz < h; dz++) {
				for (let dx = 0; dx < w; dx++) used[(tz + dz) * SNOW_TILES_X + tx + dx] = 1
			}
			rects.push({ tx, tz, w, h })
		}
	}
	return rects
}


// MARK: isRunOpen

function isRunOpen(
	tx:   number,
	tz:   number,
	w:    number,
	used: Uint8Array,
): boolean {
	for (let dx = 0; dx < w; dx++) {
		const i = tz * SNOW_TILES_X + tx + dx
		if (masked[i] === 1 || used[i] === 1) return false
	}
	return true
}
