/**
 * flameVariant.ts - per-fire flame variety (pure; no engine imports).
 *
 * Ported from flagtag's burning-tree flames (src/shared/treeFire.ts + systems/treeFireSystem.ts): every fire derives a
 * stable variant from a hash of its OWN world position, so neighbouring fires never animate in lockstep, every client
 * sees the same fire the same way, and a rebuilt rig at the same spot looks identical (no pop):
 *   - size      : cluster scale multiplier (flagtag: 1 +/- 0.3)
 *   - speed     : animation clock multiplier (flagtag: 0.75..1.3)
 *   - timeOffset: start offset on the animation clock (flagtag: phase * 10 s)
 *   - per card  : phase offset, period multiplier (flagtag tongues 0.85..1.15, embers 0.8..1.2), plus here a small height /
 *                 yaw / x,z lean jitter, and ember rise height
 * Added beyond flagtag: a small heat (yellow <-> orange) shift per fire and a jitter on the crossed arm's 90 deg yaw.
 */

/** Cluster scale multiplier 1 +/- this (flagtag 0.3; kept a little smaller so fuel tiers still read from size). */
export const FLAME_SIZE_VARIANCE = 0.22
/** Animation clock multiplier range. */
export const FLAME_SPEED_MIN = 0.75
export const FLAME_SPEED_MAX = 1.3
/** Heat (0 yellow .. 1 orange) shift range (+/-) added to every card of a fire. */
export const FLAME_HEAT_SHIFT = 0.12
/** Crossed-arm yaw jitter (+/- deg around 90). */
export const FLAME_ARM_YAW_JITTER_DEG = 14
/** Per-card jitters. */
export const FLAME_TONGUE_PERIOD_VAR = 0.15
export const FLAME_EMBER_PERIOD_VAR = 0.2
export const FLAME_TONGUE_HEIGHT_VAR = 0.12
export const FLAME_TONGUE_YAW_JITTER_DEG = 5
export const FLAME_TONGUE_POS_JITTER_M = 0.02
export const FLAME_EMBER_RISE_VAR = 0.15
/** Max cards per rig the variant provides entries for (tongues x2 arms, embers). */
export const FLAME_MAX_TONGUES = 16
export const FLAME_MAX_EMBERS = 16


/** Deterministic 0..1 hash of a world position + salt (same on every client and reload). Positions are cm-rounded. */
export function flameHash01(x: number, z: number, salt: number): number {
	// Sequential avalanche per input (an xor of three products collided on round-number grids).
	const mix = (h: number, v: number): number => {
		h = Math.imul(h ^ v, 2246822507 | 0)
		h ^= h >>> 15
		h = Math.imul(h, 3266489909 | 0)
		return h ^ (h >>> 13)
	}
	let h = mix(0x9e3779b9 | 0, Math.round(x * 100) | 0)
	h = mix(h, Math.round(z * 100) | 0)
	h = mix(h, salt + 1)
	return (h >>> 0) / 4294967296
}

export interface FlameVariant {
	size      : number
	speed     : number
	/** Seconds added to the animation clock. */
	timeOffset: number
	heatShift : number
	armYawDeg : number
	corePhase : number
	tonguePhase : number[]
	tonguePeriod: number[]
	tongueHeight: number[]
	tongueYaw   : number[]
	tongueDx    : number[]
	tongueDz    : number[]
	emberPhase : number[]
	emberPeriod: number[]
	emberRise  : number[]
}

/** The "no variation" variant (used when a rig has no seed position). */
export const FLAME_NEUTRAL: FlameVariant = {
	size: 1, speed: 1, timeOffset: 0, heatShift: 0, armYawDeg: 90, corePhase: 0,
	tonguePhase : new Array<number>(FLAME_MAX_TONGUES).fill(0),
	tonguePeriod: new Array<number>(FLAME_MAX_TONGUES).fill(1),
	tongueHeight: new Array<number>(FLAME_MAX_TONGUES).fill(1),
	tongueYaw   : new Array<number>(FLAME_MAX_TONGUES).fill(0),
	tongueDx    : new Array<number>(FLAME_MAX_TONGUES).fill(0),
	tongueDz    : new Array<number>(FLAME_MAX_TONGUES).fill(0),
	emberPhase : new Array<number>(FLAME_MAX_EMBERS).fill(0),
	emberPeriod: new Array<number>(FLAME_MAX_EMBERS).fill(1),
	emberRise  : new Array<number>(FLAME_MAX_EMBERS).fill(1),
}


// MARK: flameVariantFor
/** Stable variant for the fire standing at world (x, z). */
export function flameVariantFor(x: number, z: number): FlameVariant {
	const h = (salt: number): number => flameHash01(x, z, salt)
	const sym = (salt: number): number => h(salt) * 2 - 1
	const arr = (n: number, f: (i: number) => number): number[] => { const a: number[] = []; for (let i = 0; i < n; i++) a.push(f(i)); return a }
	return {
		size      : 1 + FLAME_SIZE_VARIANCE * sym(1),
		speed     : FLAME_SPEED_MIN + (FLAME_SPEED_MAX - FLAME_SPEED_MIN) * h(2),
		timeOffset: h(3) * 10,
		heatShift : FLAME_HEAT_SHIFT * sym(4),
		armYawDeg : 90 + FLAME_ARM_YAW_JITTER_DEG * sym(5),
		corePhase : h(6),
		tonguePhase : arr(FLAME_MAX_TONGUES, i => h(10 + i)),
		tonguePeriod: arr(FLAME_MAX_TONGUES, i => 1 + FLAME_TONGUE_PERIOD_VAR * sym(30 + i)),
		tongueHeight: arr(FLAME_MAX_TONGUES, i => 1 + FLAME_TONGUE_HEIGHT_VAR * sym(70 + i)),
		tongueYaw   : arr(FLAME_MAX_TONGUES, i => FLAME_TONGUE_YAW_JITTER_DEG * sym(90 + i)),
		tongueDx    : arr(FLAME_MAX_TONGUES, i => FLAME_TONGUE_POS_JITTER_M * sym(110 + i)),
		tongueDz    : arr(FLAME_MAX_TONGUES, i => FLAME_TONGUE_POS_JITTER_M * sym(130 + i)),
		emberPhase : arr(FLAME_MAX_EMBERS, i => h(50 + i)),
		emberPeriod: arr(FLAME_MAX_EMBERS, i => 1 + FLAME_EMBER_PERIOD_VAR * sym(150 + i)),
		emberRise  : arr(FLAME_MAX_EMBERS, i => 1 + FLAME_EMBER_RISE_VAR * sym(170 + i)),
	}
}

// MARK: flameLightSeed
/** Stable flicker phase (0..1000) for the point light of the fire at (x, z). */
export function flameLightSeed(x: number, z: number): number {
	return flameHash01(x, z, 200) * 1000
}
