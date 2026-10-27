/**
 * ruleset.ts - which Cryocene ruleset this build runs, plus the
 * "Build Your Own Fire" (BYOF) tunables.
 *
 * 'classic'             : hidden campfires are found and lit (original game).
 * 'build-your-own-fire' : no hidden campfires; a player carrying a log with
 *                         a lit torch presses E to build a lit campfire.
 *
 * One-line switch: change RULESET below. Classic behaviour is untouched
 * when RULESET = 'classic'. Server and client read the same constant, so
 * both sides must be rebuilt / restarted together.
 *
 * Built fires reuse the hidden-campfire slots (src/server/hiddenCampfire.ts):
 * same model, warmth, melt ring, fuel, feeding, fire-network links, shared
 * fuel, extinction check and cycle reset.
 */

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { LOG_FUEL_SECONDS, TIER_FUEL } from 'src/shared/hearthFuel'
import { isInsidePlayfield, TERRAIN_LEVEL_MOUNTAIN } from 'src/shared/settings'
import { SnowStage } from 'src/shared/snowGrid'
import { volcanoCraterHeatCenter, CRATER_HEAT_RADIUS_M } from 'src/shared/terrain/volcanoCraterHeat'
import {
	cellIndex,
	cellOfWorld,
	groundYAtWorld,
	inGrid,
	isLavaAtWorld,
	LANDFORM_LAVA,
	levelAtWorld,
	nearStation,
	TerrainMap,
} from 'src/shared/terrain/terrainMap'
import { WOOD_KIND_LOG } from 'src/shared/woodKind'


// MARK: Ruleset switch
export type Ruleset = 'classic' | 'build-your-own-fire' | 'floating-crystals'
/**
 * <- one-line switch:
 *   'classic'             hidden campfires + volcano beams (original)
 *   'build-your-own-fire' player-built fires, volcano objective
 *   'floating-crystals'   built fires charge monuments into floating
 *                         heat crystals; no volcano objective
 */
export const RULESET: Ruleset = 'floating-crystals'

/** Player-built fires, no hidden pits (true for both newer rulesets). */
export function isBuildYourOwnFire(): boolean {
	const r = RULESET as Ruleset
	return r === 'build-your-own-fire' || r === 'floating-crystals'
}

/** Floating Crystal Monument ruleset (layered on build-your-own-fire). */
export function isFloatingCrystals(): boolean {
	return (RULESET as Ruleset) === 'floating-crystals'
}


// MARK: Floating crystal tunables
/** Monuments per world in floating-crystals mode (classic / build-your-own-fire keep 3). Max 8. */
export const MONUMENT_COUNT = 6
/**
 * Distance bands (fraction of the farthest reachable route from the
 * hearth) world gen fills first, one monument each, after the near
 * monument; the rest fill by the usual score. Some near, some far.
 */
export const MONUMENT_DISTANCE_BANDS: ReadonlyArray<readonly [number, number]> = [
	[0.15, 0.3], [0.3, 0.5], [0.5, 0.7], [0.7, 0.85], [0.85, 1.0],
]
/** Min angle (deg) between monuments as seen from the hearth (classic: 45). */
export const MONUMENT_MIN_ANGLE_DEG = 35
/** Last-resort spacing (fraction of the classic monument spacing) if all N don't fit. */
export const MONUMENT_RELAX_SEP_FRAC = 0.6
/** Monument link range (m): a lit fire this close with a live (routed, kept) link to the monument charges it. */
export const MONUMENT_LINK_RANGE_M = 40
/** @deprecated alias: the charge range is the monument link range. */
export const CHARGE_RING_M = MONUMENT_LINK_RANGE_M
/** Contribution at the ring edge vs the centre: w = 1 - FALLOFF * d / R. */
export const CHARGE_DISTANCE_FALLOFF = 0.5
/** Superlinear fire-count curve: rate ~ (sum of weights) ^ EXP. */
export const CHARGE_COUNT_EXP = 1.6
/** Target: full charge in this many seconds with the reference setup. */
export const CHARGE_TARGET_S = 60 // TEST VALUE for playtesting (design target 210)
/** Reference setup for the target: CHARGE_REF_FIRES fires at CHARGE_REF_DIST_M. */
export const CHARGE_REF_FIRES = 3
export const CHARGE_REF_DIST_M = 20
export const CHARGE_REF_WEIGHT = 1 - CHARGE_DISTANCE_FALLOFF * (CHARGE_REF_DIST_M / MONUMENT_LINK_RANGE_M)
/**
 * Fire-network node ids for monuments (charge links): base + station
 * index. Never a fuel node (no shared fuel, no burn multiplier); orbs
 * treat the monument end as a full-strength fire.
 */
export const MONUMENT_NODE_ID_BASE = 1000
export function isMonumentNodeId(id: number): boolean {
	return id >= MONUMENT_NODE_ID_BASE
}
/** Charge links end this far (m) outside the monument pit edge. */
export const CHARGE_LINK_EDGE_PAD_M = 0.75 // no monument ice in this mode: trail ends ~0.75 m off the base edge
/** Fires contributing to a charge burn this much faster. */
export const CHARGE_FIRE_DRAIN_MUL = 1.5
/** Charge decay when no fire contributes (off for the prototype). */
export const CHARGE_DECAY_ENABLED = false
export const CHARGE_DECAY_PER_S = 1 / 600
/** Ice is fully gone at this charge (it recedes linearly before). */
export const CHARGE_ICE_GONE_AT = 0.9
/** Pre-release vibrate + pre-lift. false (Luke): the monument stays still until release. */
export const CHARGE_SHAKE_ENABLED = false
/** Vibrate + pre-lift starts at this charge (when CHARGE_SHAKE_ENABLED). */
export const CHARGE_SHAKE_FROM = 0.8
/** Pre-release lift (m) at full charge, and gem glow before release. */
export const CHARGE_PRE_LIFT_M = 0.8
export const CHARGE_PRE_GLOW = 0.7
/** Released crystal: bottom tip height above its ground (m). */
export const CRYSTAL_FLOAT_HEIGHT_M = 25
/** Crystal release: the heat zone thaws outward from the crystal over this many seconds (0 = instant). */
export const CRYSTAL_THAW_SPREAD_S = 7
/**
 * Charging monument heat (floating crystals): acts like a campfire whose
 * tier steps with charge. Below CHARGE_HEAT_TIER_AT[0] -> Low, below [1]
 * -> Warm (medium), else Bright (high). Only while charge > 0; kept while
 * charging is paused (charge is retained). No fuel node / shared fuel.
 */
export const CHARGE_HEAT_ENABLED = true
export const CHARGE_HEAT_TIER_AT: readonly [number, number] = [1 / 3, 2 / 3]
/** Fuel equivalent per heat step (mid-tier of Low / Warm / Bright in TIER_FUEL). */
export const CHARGE_HEAT_FUEL: readonly [number, number, number] = [
	(TIER_FUEL[1] + TIER_FUEL[2]) / 2, (TIER_FUEL[2] + TIER_FUEL[3]) / 2, (TIER_FUEL[3] + TIER_FUEL[4]) / 2,
]
/** Campfire-equivalent fuel for a charging monument (0 = no heat). */
export function chargeHeatFuel(charge: number): number {
	// charge >= 1 keeps Bright: the release tick used to drop this to 0, so
	// the server released the whole charge-heat ring and snow regrew over
	// it until the laser thaw melted it again. The ring now stays held and
	// the crystal heat zone simply covers it (seamless hand-off).
	if (!CHARGE_HEAT_ENABLED || !isFloatingCrystals() || !(charge > 0)) return 0
	return charge < CHARGE_HEAT_TIER_AT[0] ? CHARGE_HEAT_FUEL[0] : charge < CHARGE_HEAT_TIER_AT[1] ? CHARGE_HEAT_FUEL[1] : CHARGE_HEAT_FUEL[2]
}
/**
 * Release sequence (all viewers, client): hold seated while the final pulse
 * + flash play, rise to float height, then the laser draws down to the
 * ground. The server starts the thaw front exactly at the laser hit.
 */
export const CRYSTAL_RELEASE_HOLD_S = 2
/** Rise to float height; the sky beam drops over the last CRYSTAL_SKY_DROP_S and lands in the top tip as it ends. */
export const CRYSTAL_RISE_S = 4
export const CRYSTAL_SKY_DROP_S = 1.4
/** Charging from the sky beam (crystal brightens, pulses run down the beam); the camera zooms out + down over this. */
export const CRYSTAL_CHARGE_S = 5
/** Gap between charging ending and the laser (s). 0: the sky beam stays on permanently; no lift-away step. */
export const CRYSTAL_SKY_OFF_S = 0
/** Laser draws down into the earth, then is held before the thaw starts. */
export const CRYSTAL_LASER_DRAW_S = 0.15 // near-instant shot crystal -> ground (was 0.6)
export const CRYSTAL_LASER_HOLD_S = 2
/** Thaw front start after release (server, all players) = end of the laser hold. */
export const CRYSTAL_THAW_DELAY_S = CRYSTAL_RELEASE_HOLD_S + CRYSTAL_RISE_S + CRYSTAL_CHARGE_S + CRYSTAL_SKY_OFF_S + CRYSTAL_LASER_DRAW_S + CRYSTAL_LASER_HOLD_S
/** Floating crystals: idle volcano look from the start (never reacts to monuments). */
export const CRYSTAL_IDLE_LAVA_COVER    = 0.25
export const CRYSTAL_IDLE_LAVA_TOP_M    = 0.04
export const CRYSTAL_IDLE_LAVA_EMISSIVE = 0.5
export const CRYSTAL_IDLE_LAVA_HEAT     = 0.15
/** Thin smoke, as a fraction of the stage-1 plume (rate, size, alpha). */
export const CRYSTAL_IDLE_SMOKE_RATE  = 0.5
export const CRYSTAL_IDLE_SMOKE_SIZE  = 0.8
export const CRYSTAL_IDLE_SMOKE_ALPHA = 0.7
/** Floating crystals: nearest-spawn monument target distance from the hearth (m). */
export const CRYSTAL_NEAR_MONUMENT_TARGET_M = 95
/** Floating crystals: summit map tablet clearance beyond the crater heat radius (m from lava centre). */
export const CRYSTAL_MAP_LAVA_CLEAR_M = 6
/** Floating crystals: summit map tablet clearance from a rim ladder landing (m). */
export const CRYSTAL_MAP_LADDER_CLEAR_M = 4
/** Released crystal permanent heat zone radius (m). */
export const CRYSTAL_HEAT_RADIUS_M = 50
/** Warmth at the zone edge as a fraction of the centre (1 = flat). */
export const CRYSTAL_WARMTH_EDGE_FRAC = 0.6
/** Extra loose logs near every monument (crystals mode only). */
export const WOOD_MONUMENT_LOG_COUNT = 6
export const WOOD_MONUMENT_MIN_M = 12
export const WOOD_MONUMENT_MAX_M = 40

/** sum(w)^EXP scale so CHARGE_REF_FIRES at CHARGE_REF_WEIGHT hit CHARGE_TARGET_S. */
const CHARGE_K = 1 / (CHARGE_TARGET_S * Math.pow(CHARGE_REF_FIRES * CHARGE_REF_WEIGHT, CHARGE_COUNT_EXP))

/** Weight of one lit fire at distance d (0 outside the ring). */
export function chargeWeight(d: number): number {
	if (d > MONUMENT_LINK_RANGE_M) return 0
	return 1 - CHARGE_DISTANCE_FALLOFF * (d / MONUMENT_LINK_RANGE_M)
}

/** Charge per second (0..1 scale) for lit fires at these distances. */
export function chargeRatePerS(dists: ReadonlyArray<number>): number {
	let sum = 0
	for (const d of dists) sum += chargeWeight(d)
	return chargeRateFromWeight(sum)
}

/** Charge per second for a summed fire weight (same superlinear curve). */
export function chargeRateFromWeight(sum: number): number {
	return sum <= 0 ? 0 : CHARGE_K * Math.pow(sum, CHARGE_COUNT_EXP)
}


// MARK: Chain charging
/**
 * Chain charging (floating crystals): lit fires up to CHARGE_CHAIN_MAX_HOPS
 * network hops from an unreleased monument charge it. Hop 1 = a fire with
 * a live charge link (distance falloff, chargeWeight); hop h >= 2 = relay
 * fire, weight CHARGE_CHAIN_BASE_WEIGHT * CHARGE_HOP_FACTOR[h-1] (no
 * distance term: relays sit anywhere along the network). Each fire counts
 * once per monument at its shortest hop (loops add nothing). A fire may
 * charge several monuments (each monument counts it independently).
 */
export const CHARGE_CHAIN_ENABLED = true
export const CHARGE_CHAIN_MAX_HOPS = 3
/** Weight factor per hop (index 0 = hop 1). Hops past the list get 0. */
export const CHARGE_HOP_FACTOR: readonly number[] = [1, 0.6, 0.35]
/** Relay base weight: a hop-1 fire at the reference distance (0.75 at 20 m). */
export const CHARGE_CHAIN_BASE_WEIGHT = CHARGE_REF_WEIGHT
/** Charging drain multiplier applies to hop-1 fires only (relays already burn at the linked rate). */
export const CHARGE_CHAIN_DRAIN_HOP1_ONLY = true

/** Weight of a charging fire at hop (hop 1 uses distance d). */
export function chargeHopWeight(hop: number, d: number): number {
	if (hop <= 1) return chargeWeight(d)
	if (!CHARGE_CHAIN_ENABLED || hop > CHARGE_CHAIN_MAX_HOPS) return 0
	return CHARGE_CHAIN_BASE_WEIGHT * (CHARGE_HOP_FACTOR[hop - 1] ?? 0)
}

/**
 * Shortest hop per fire id from hop-1 seeds over undirected fire edges
 * (BFS, capped at CHARGE_CHAIN_MAX_HOPS). ok(id) filters relays (lit).
 */
export function chainHops(seeds: Iterable<number>, edges: ReadonlyArray<readonly [number, number]>, ok: (id: number) => boolean = () => true): Map<number, number> {
	const hop = new Map<number, number>()
	const q: number[] = []
	for (const s of seeds) if (!hop.has(s)) { hop.set(s, 1); q.push(s) }
	const max = CHARGE_CHAIN_ENABLED ? CHARGE_CHAIN_MAX_HOPS : 1
	for (let qi = 0; qi < q.length; qi++) {
		const c = q[qi], h = hop.get(c)!
		if (h >= max) continue
		for (const [a, b] of edges) {
			const o = a === c ? b : b === c ? a : -1
			if (o < 0 || hop.has(o) || isMonumentNodeId(o) || !ok(o)) continue
			hop.set(o, h + 1); q.push(o)
		}
	}
	return hop
}


// MARK: Build tunables
/** Wood kind a build consumes (single-slot carry, so cost is 1 piece). */
export const BUILT_FIRE_COST_KIND = WOOD_KIND_LOG
/** Pieces per build. The carry slot holds one, so only 1 is supported today. */
export const BUILT_FIRE_COST_COUNT = 1
/** Fuel (s) a fresh built fire starts with. 1 log = 120 s (Ember tier). */
export const BUILT_FIRE_START_FUEL = LOG_FUEL_SECONDS
/**
 * Test 2 switch. true = built fires never drain (fuel stays put) and
 * shared fuel skips them (they report as full). false for Test 1.
 */
export const BUILT_FIRE_PERMANENT = false
/** Min distance (m) from any other fire (hearth, built, lit or dead). */
export const BUILT_FIRE_MIN_SPACING_M = 18
/** Max built fires per world (server enforced). Clamped to the slot count. */
export const BUILT_FIRE_MAX = 40
/** Slope check: sample ring radius (m) around the spot. */
export const BUILT_FIRE_SLOPE_SAMPLE_M = 1.5
/** Slope check: max ground height difference (m) across the sample ring. */
export const BUILT_FIRE_MAX_SLOPE_DY_M = 0.3
/**
 * Deepest snow stage allowed at the spot (0 melted, 1 = 0.5 m, 2 = 1 m,
 * 3 = pristine 1.5 m). 1 = cleared or shallow: the torch melts its way
 * there, so building in deep powder needs one torch sweep first.
 */
export const BUILT_FIRE_MAX_SNOW_STAGE: SnowStage = 1
/** Extra keep-out (m) around monument pits on top of STATION_CLEAR_M. */
export const BUILT_FIRE_MONUMENT_CLEAR_M = 2
/** Extra keep-out (m) around the volcano crater heat disc. */
export const BUILT_FIRE_CRATER_CLEAR_M = 4


// MARK: Frontier wood tunables (BYOF only)
/** Pool per hearth->monument route; pieces sampled along the route. */
export const WOOD_FRONTIER_ROUTE_POOL = 40
/** Active per route at cycle start. */
export const WOOD_FRONTIER_ROUTE_ACTIVE = 14
/** Route span sampled, as a fraction of hearth->monument distance. */
export const WOOD_FRONTIER_ROUTE_T_MIN = 0.25
export const WOOD_FRONTIER_ROUTE_T_MAX = 1.0
/** Lateral scatter (m) either side of the straight route line. */
export const WOOD_FRONTIER_ROUTE_SPREAD_M = 24
/** General frontier ring (outside the classic outer band). */
export const WOOD_FRONTIER_RING_MIN_M = 140
export const WOOD_FRONTIER_RING_MAX_M = 320
export const WOOD_FRONTIER_RING_POOL = 80
export const WOOD_FRONTIER_RING_ACTIVE = 30
/** Chance a frontier piece is a log (the build currency) not a branch. */
export const WOOD_FRONTIER_LOG_CHANCE = 0.6
/** Guaranteed cluster near the frozen (iced) monument, replacing the
 *  classic guaranteed campfire there. Always active, all logs. */
export const WOOD_ICED_CLUSTER_COUNT = 5
export const WOOD_ICED_CLUSTER_MIN_M = 25
export const WOOD_ICED_CLUSTER_MAX_M = 60
/** Scatter radius (m) of the iced cluster around its centre. */
export const WOOD_ICED_CLUSTER_SPREAD_M = 4
/**
 * Fraction of active frontier pieces that get a shallow snow dimple at
 * cycle start, so not all frontier wood sits under full-depth snow
 * (the torch still has to finish the melt before pickup).
 */
export const WOOD_FRONTIER_DIMPLE_FRACTION = 0.5


// MARK: Validation
export type BuildFireVerdict =
	| 'ok'
	| 'bounds'
	| 'steep'
	| 'lava'
	| 'monument'
	| 'spacing'
	| 'snow'
	| 'cap'
	| 'stick'

/** Short player-facing reason for an invalid ghost. */
export function buildVerdictText(v: BuildFireVerdict): string {
	switch (v) {
		case 'ok'      : return 'LIGHT CAMPFIRE'
		case 'bounds'  : return "CAN'T LIGHT HERE"
		case 'steep'   : return 'TOO STEEP'
		case 'lava'    : return 'TOO HOT'
		case 'monument': return 'NEAR MONUMENT'
		case 'spacing' : return 'TOO CLOSE TO FIRE'
		case 'snow'    : return 'TOO MUCH SNOW'
		case 'cap'     : return 'FIRE LIMIT REACHED'
		case 'stick'   : return 'NEEDS A LOG'
	}
}

/**
 * Pure placement check shared by the client ghost and the server.
 * `fires` = every existing fire centre (hearth + all placed slots,
 * lit or dead). `stageAt` reads the snow stage at a world point.
 */
export function validateBuiltFireSpot(
	map      : TerrainMap,
	x        : number,
	z        : number,
	fires    : ReadonlyArray<{ x: number; z: number }>,
	stageAt  : (x: number, z: number) => number,
	builtCount: number,
): BuildFireVerdict {
	if (builtCount >= BUILT_FIRE_MAX) return 'cap'
	if (!isInsidePlayfield(x, z)) return 'bounds'
	const { cx, cz } = cellOfWorld(x, z)
	if (!inGrid(cx, cz)) return 'bounds'
	if (levelAtWorld(map, x, z) >= TERRAIN_LEVEL_MOUNTAIN) return 'bounds'
	if (isLavaAtWorld(map, x, z) || map.landforms[cellIndex(cx, cz)] === LANDFORM_LAVA) return 'lava'
	const crater = volcanoCraterHeatCenter(map)
	if (crater) {
		const r = CRATER_HEAT_RADIUS_M + BUILT_FIRE_CRATER_CLEAR_M
		if ((x - crater.x) ** 2 + (z - crater.z) ** 2 < r * r) return 'lava'
	}
	// Slope: ground height sampled on a small ring (terrain is stepped,
	// so this mostly rejects cliff lips and ramps).
	const y0 = groundYAtWorld(map, x, z)
	const r  = BUILT_FIRE_SLOPE_SAMPLE_M
	for (let i = 0; i < 8; i++) {
		const a = (i / 8) * Math.PI * 2
		const sx = x + Math.cos(a) * r, sz = z + Math.sin(a) * r
		if (levelAtWorld(map, sx, sz) >= TERRAIN_LEVEL_MOUNTAIN) return 'steep'
		if (isLavaAtWorld(map, sx, sz)) return 'lava'
		if (Math.abs(groundYAtWorld(map, sx, sz) - y0) > BUILT_FIRE_MAX_SLOPE_DY_M) return 'steep'
	}
	if (nearStation(map, x, z, BUILT_FIRE_MONUMENT_CLEAR_M)) return 'monument'
	const sp2 = BUILT_FIRE_MIN_SPACING_M * BUILT_FIRE_MIN_SPACING_M
	if ((x - CAMPFIRE_WORLD_X) ** 2 + (z - CAMPFIRE_WORLD_Z) ** 2 < sp2) return 'spacing'
	for (const f of fires) {
		if ((x - f.x) ** 2 + (z - f.z) ** 2 < sp2) return 'spacing'
	}
	if (stageAt(x, z) > BUILT_FIRE_MAX_SNOW_STAGE) return 'snow'
	return 'ok'
}