/**
 * obeliskMaterial.ts - shared matte deep-black material for the obelisk
 * stone: the obelisk glb parts (GltfNodeModifiers override in
 * stationMarkers.ts), the socket border slabs and the socket bottom
 * (terrainRenderer.ts addObeliskPit). No reflectivity of any kind:
 * metallic 0, roughness 1, specular 0, black reflectivity colour. The
 * beams keep their own emissive material (stationMarkers paintGlow).
 *
 * Gem state: once the sky beam lands in an obelisk's top tip it blends
 * over OBELISK_GEM_FADE_S into a semi-transparent glowing gem
 * (obeliskGemPbr). One colour per obelisk from a sunset gradient
 * (station 0 rose-red, 1 magenta-violet, 2 violet-blue). Socket border
 * and bottom stay matte black. Lit gems rest at GEM_ALPHA_REST and every
 * GEM_DIP_INTERVAL_MIN_S..MAX_S dip to GEM_ALPHA_LOW and back (glow
 * scales with alpha); timing is deterministic per obelisk (gemDipAt).
 */

import { MaterialTransparencyMode } from '@dcl/sdk/ecs'
import { Color3, Color4 } from '@dcl/sdk/math'


// MARK: Tuning
/** Deep black albedo for the obelisk and its socket border / bottom. */
export const OBELISK_BLACK = Color4.create(0.02, 0.02, 0.02, 1)

/** PBR fields for every obelisk stone surface (Material.setPbrMaterial / GltfNodeModifiers). */
export const OBELISK_MATTE_PBR = {
	albedoColor      : OBELISK_BLACK,
	metallic         : 0,
	roughness        : 1,
	specularIntensity: 0,
	reflectivityColor: Color3.create(0, 0, 0),
}


// MARK: Gem (lit obelisk)
/**
 * Master switch for the gem fade-in and dips. false = lit obelisks stay
 * matte deep black (OBELISK_MATTE_PBR, shadows on) like seated ones and
 * no gem material writes run. Code kept for a later pass.
 */
export const GEM_ENABLED = false
/** Seconds for matte black -> gem after the sky beam lands. */
export const OBELISK_GEM_FADE_S = 2.5
/** Gem resting opacity (alpha blend). */
export const GEM_ALPHA_REST = 0.8
/** Gem opacity at the bottom of a dip. */
export const GEM_ALPHA_LOW  = 0.1
/** Seconds between dips (end of one to start of the next), random in range. */
export const GEM_DIP_INTERVAL_MIN_S = 20
export const GEM_DIP_INTERVAL_MAX_S = 45
/** Dip shape: ease down, hold low (random in range), ease back up. */
export const GEM_DIP_DOWN_S     = 2
export const GEM_DIP_HOLD_MIN_S = 0.5
export const GEM_DIP_HOLD_MAX_S = 1
export const GEM_DIP_UP_S       = 2
/** Gem surface: no metal, fairly glossy, subtle reflections. */
export const OBELISK_GEM_ROUGHNESS = 0.25
export const OBELISK_GEM_SPECULAR  = 0.35
export const OBELISK_GEM_REFLECT   = 0.08
export const OBELISK_GEM_EMISSIVE_INTENSITY = 1.6
/**
 * Sunset gradient per station index (base albedo + emissive glow):
 * rose-red, magenta-violet, violet-blue. Indices past 2 wrap.
 */
export const OBELISK_GEM_COLORS: ReadonlyArray<{ base: Color3; glow: Color3 }> = [
	{ base: Color3.create(0.62, 0.12, 0.32), glow: Color3.create(0.90, 0.20, 0.42) },
	{ base: Color3.create(0.55, 0.15, 0.60), glow: Color3.create(0.80, 0.20, 0.70) },
	{ base: Color3.create(0.30, 0.18, 0.66), glow: Color3.create(0.42, 0.30, 0.95) },
]


// MARK: obeliskGemPbr
/**
 * PBR fields for an obelisk at gem blend `k` (0 = matte black, 1 = gem)
 * for station `index`. Alpha blend from the first non-zero k so the mode
 * never flips mid-fade; shadows stop once it is mostly glass.
 */
export function obeliskGemPbr(index: number, k: number, alpha: number = GEM_ALPHA_REST) {
	const t   = Math.max(0, Math.min(1, k))
	if (t <= 0) return { ...OBELISK_MATTE_PBR }
	const col = OBELISK_GEM_COLORS[((index % OBELISK_GEM_COLORS.length) + OBELISK_GEM_COLORS.length) % OBELISK_GEM_COLORS.length]
	const b   = OBELISK_BLACK
	const lerp = (a: number, c: number): number => a + (c - a) * t
	const rf  = OBELISK_GEM_REFLECT * t
	return {
		albedoColor      : Color4.create(lerp(b.r, col.base.r), lerp(b.g, col.base.g), lerp(b.b, col.base.b), lerp(1, alpha)),
		emissiveColor    : col.glow,
		// Glow fades with opacity (proportional to the resting alpha).
		emissiveIntensity: OBELISK_GEM_EMISSIVE_INTENSITY * t * (alpha / GEM_ALPHA_REST),
		metallic         : 0,
		roughness        : lerp(1, OBELISK_GEM_ROUGHNESS),
		specularIntensity: OBELISK_GEM_SPECULAR * t,
		reflectivityColor: Color3.create(rf, rf, rf),
		transparencyMode : MaterialTransparencyMode.MTM_ALPHA_BLEND,
		castShadows      : t < 0.5,
	}
}


// MARK: gemDipAt
type GemDip = { start: number; down: number; hold: number; up: number }
/** Cached current / next dip per obelisk key. */
const dipCache = new Map<string, GemDip>()

function hash32(a: number, b: number, c: number): number {
	let h = (a ^ Math.imul(b, 0x9E3779B1) ^ Math.imul(c, 0x85EBCA77)) >>> 0
	h = Math.imul(h ^ (h >>> 16), 0x7FEB352D) >>> 0
	h = Math.imul(h ^ (h >>> 15), 0x846CA68B) >>> 0
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Dip that follows one starting at `prevStart` (deterministic chain). */
function nextDip(seed: number, index: number, prevEnd: number): GemDip {
	const r1 = hash32(seed, index + 1, Math.floor(prevEnd * 10))
	const r2 = hash32(seed ^ 0x5bd1e995, index + 7, Math.floor(prevEnd * 10))
	const gap = GEM_DIP_INTERVAL_MIN_S + (GEM_DIP_INTERVAL_MAX_S - GEM_DIP_INTERVAL_MIN_S) * r1
	return {
		start: prevEnd + gap,
		down : GEM_DIP_DOWN_S,
		hold : GEM_DIP_HOLD_MIN_S + (GEM_DIP_HOLD_MAX_S - GEM_DIP_HOLD_MIN_S) * r2,
		up   : GEM_DIP_UP_S,
	}
}

/**
 * Gem opacity for obelisk `index` at wall-clock seconds `nowS`, plus
 * whether a dip is running. The dip chain is walked from an hour anchor
 * with a seeded hash of (cycle seed, index, previous dip end), so every
 * client with a roughly synced clock sees the same dips.
 */
export function gemDipAt(seed: number, index: number, nowS: number): { alpha: number; dipping: boolean } {
	const key = `${seed}:${index}`
	let d = dipCache.get(key)
	if (!d || nowS < d.start - GEM_DIP_INTERVAL_MAX_S - 1 || nowS > d.start + d.down + d.hold + d.up + GEM_DIP_INTERVAL_MAX_S + 1) {
		// (Re)walk from a stable anchor (start of the hour, minus a minute).
		let end = Math.floor((nowS - 60) / 3600) * 3600
		d = nextDip(seed, index, end)
		while (d.start + d.down + d.hold + d.up < nowS) {
			end = d.start + d.down + d.hold + d.up
			d = nextDip(seed, index, end)
		}
		dipCache.set(key, d)
	}
	const dipEnd = d.start + d.down + d.hold + d.up
	if (nowS >= dipEnd) {
		d = nextDip(seed, index, dipEnd)
		dipCache.set(key, d)
	}
	const t = nowS - d.start
	if (t <= 0) return { alpha: GEM_ALPHA_REST, dipping: false }
	const ease = (u: number): number => { const c = Math.max(0, Math.min(1, u)); return c * c * (3 - 2 * c) }
	let vis: number
	if (t < d.down)                  vis = 1 - ease(t / d.down)
	else if (t < d.down + d.hold)    vis = 0
	else                             vis = ease((t - d.down - d.hold) / d.up)
	return { alpha: GEM_ALPHA_LOW + (GEM_ALPHA_REST - GEM_ALPHA_LOW) * vis, dipping: t < d.down + d.hold + d.up }
}
