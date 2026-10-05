/**
 * random.ts — deterministic RNG and 2D value noise.
 *
 * Pure integer math so every runtime (QuickJS scene, headless server,
 * Node tools) produces identical sequences for the same seed.
 */


/** Seeded generator returning floats in [0, 1). */
export type Rng = () => number


// MARK: mulberry32
/**
 * Small, fast 32-bit seeded PRNG. Same seed, same sequence on every
 * runtime.
 */
export function mulberry32(seed: number): Rng {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6D2B79F5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}


// MARK: hash2
/**
 * Hash an integer lattice point and seed to a float in [0, 1).
 */
export function hash2(
	x:    number,
	y:    number,
	seed: number,
): number {
	let h = (Math.imul(x | 0, 0x27D4EB2D) ^ Math.imul(y | 0, 0x165667B1) ^ Math.imul(seed | 0, 0x9E3779B1)) >>> 0
	h = Math.imul(h ^ (h >>> 15), 0x85EBCA6B) >>> 0
	h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35) >>> 0
	h = (h ^ (h >>> 16)) >>> 0
	return h / 4294967296
}


// MARK: smoothstep01
function smoothstep01(t: number): number {
	return t * t * (3 - 2 * t)
}


// MARK: valueNoise2
/**
 * Smoothly interpolated value noise in [0, 1). `x` and `y` are in
 * lattice units: one unit is one noise feature.
 */
export function valueNoise2(
	x:    number,
	y:    number,
	seed: number,
): number {
	const x0 = Math.floor(x)
	const y0 = Math.floor(y)
	const fx = smoothstep01(x - x0)
	const fy = smoothstep01(y - y0)
	const a  = hash2(x0,     y0,     seed)
	const b  = hash2(x0 + 1, y0,     seed)
	const c  = hash2(x0,     y0 + 1, seed)
	const d  = hash2(x0 + 1, y0 + 1, seed)
	const top    = a + (b - a) * fx
	const bottom = c + (d - c) * fx
	return top + (bottom - top) * fy
}


// MARK: fractalNoise2
/**
 * Sum of `octaves` value-noise layers, each at double the frequency and
 * `gain` times the amplitude of the last. Normalised to [0, 1).
 */
export function fractalNoise2(
	x:       number,
	y:       number,
	seed:    number,
	octaves: number,
	gain:    number,
): number {
	let sum  = 0
	let amp  = 1
	let norm = 0
	let freq = 1
	for (let i = 0; i < octaves; i++) {
		sum  += valueNoise2(x * freq, y * freq, seed + i * 1013) * amp
		norm += amp
		amp  *= gain
		freq *= 2
	}
	return sum / norm
}


// MARK: randInt
/**
 * Integer in [min, max] inclusive from `rng`.
 */
export function randInt(
	rng: Rng,
	min: number,
	max: number,
): number {
	return min + Math.floor(rng() * (max - min + 1))
}


// MARK: shuffleInPlace
/**
 * Fisher–Yates shuffle driven by `rng`. Returns the same array.
 */
export function shuffleInPlace<T>(
	rng:   Rng,
	items: T[],
): T[] {
	for (let i = items.length - 1; i > 0; i--) {
		const j   = Math.floor(rng() * (i + 1))
		const tmp = items[i]
		items[i]  = items[j]
		items[j]  = tmp
	}
	return items
}
