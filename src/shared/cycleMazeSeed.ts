/**
 * cycleMazeSeed.ts — cycle seed helpers + maze mix.
 *
 * Cycle seed and layout seed stay separate. The cycle seed is the run
 * id. This mix is what SeedHolder, the cliff ring, and the prop
 * scatter all consume, so consecutive runs do not look like neighbours.
 *
 * Cycle seed travels over Schemas.Int (signed 32-bit). Mixing with
 * `>>> 0` used to emit the full unsigned range, so about half of
 * worlds wrapped to a negative on the wire and the server rejected
 * pickup / ignite as a stale seed. New ids stay in 1..0x7FFFFFFF.
 * Equality still compares the 32-bit pattern so a wrapped live id
 * matches the unsigned value the server kept.
 */


/** Largest positive value Schemas.Int can round-trip. */
export const CYCLE_SEED_INT_MAX = 0x7fffffff


// MARK: cycleSeedsEqual

/**
 * True when `a` and `b` are the same 32-bit layout id, whether the
 * value arrived signed (wire) or unsigned (`>>> 0` on the server).
 */
export function cycleSeedsEqual(a: number, b: number): boolean {
	return (a >>> 0) === (b >>> 0)
}


// MARK: clampCycleSeed

/**
 * Force a layout id into the Schemas.Int positive range. 0 is unset
 * on SeedHolder, so a zero mix becomes 1.
 */
export function clampCycleSeed(seed: number): number {
	const n = (seed >>> 0) & CYCLE_SEED_INT_MAX
	return n === 0 ? 1 : n
}


// MARK: cycleMazeSeed

/**
 * Deterministic layout seed for a cycle seed. SeedHolder treats 0 as
 * unset, so a zero mix is clamped to 1.
 */
export function cycleMazeSeed(cycleSeed: number): number {
	let s = (cycleSeed ^ 0x9E3779B1) >>> 0
	s = Math.imul(s ^ (s >>> 16), 0x85EBCA6B) >>> 0
	s = Math.imul(s ^ (s >>> 13), 0xC2B2AE35) >>> 0
	s = (s ^ (s >>> 16)) >>> 0
	return s === 0 ? 1 : s
}
