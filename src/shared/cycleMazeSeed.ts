/**
 * cycleMazeSeed.ts — maze / prop / cliff seed derived from the cycle seed.
 *
 * Cycle seed and layout seed stay separate. The cycle seed is the run
 * id. This mix is what SeedHolder, the cliff ring, and the prop
 * scatter all consume, so consecutive runs do not look like neighbours.
 */


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
