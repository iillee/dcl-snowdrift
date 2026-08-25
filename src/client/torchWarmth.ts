/**
 * torchWarmth.ts — "torches burn brighter together" mechanic.
 *
 * Every POLL_INTERVAL_S, snapshots the world position + lit state of
 * every torch in the scene (local player + all remote players), then
 * computes each lit torch's cluster tier — how many OTHER lit torches
 * are within CLUSTER_PROXIMITY_M of it. The tier drives:
 *
 *   1. The torch's warmth-disc RADIUS (bigger cluster = wider disc),
 *      consumed by src/client/frost/accumulation.ts to decide whether a
 *      player is protected from frost.
 *   2. The torch's FLAME VISUAL scale (bigger cluster = bigger flame),
 *      consumed by src/client/torch.ts (local) and remoteTorches.ts
 *      (remote) so what players see matches what they get.
 *
 * Design notes (locked 2026-08-25):
 *   - RADIUS TIERING replaces the earlier "protect torchless friend"
 *     framing — chain-lighting already covers the torchless-near-lit
 *     case (a friend in proximity gets auto-relit within one poll), so
 *     the interesting mechanic is amplifying already-lit torches when
 *     they cluster. Rewards being together without giving free heat.
 *   - Tier is a discrete 0/1/2 (solo / paired / cluster) rather than a
 *     smooth curve so the visual flame-swell has clean tier snaps
 *     matching the central hearth's fuel-tier snaps. Cap at 2 keeps
 *     ten-player death-balls from producing a scene-wide warm bubble.
 *   - Fuel drain is UNAFFECTED. Group range is still capped by burn
 *     time; the leash to the central hearth is preserved.
 *   - Snapshot is deterministic across clients given identical torch
 *     positions + lit states (which are already synced), so every
 *     client independently computes the same tiers — no sync needed.
 *   - Proximity uses player-position, not flame-tip. Same rationale as
 *     torchChain.ts: cheap, reliable, and the torch offset from the
 *     body is small compared to CLUSTER_PROXIMITY_M.
 */

import { PlayerIdentityData, Transform, engine } from '@dcl/sdk/ecs'
import { getPlayer } from '@dcl/sdk/players'

import { getRemoteTorchUserIds, isRemoteTorchLit } from 'src/client/remoteTorches'
import { isTorchLit } from 'src/client/torchEquip'


// MARK: Tuning
/**
 * Warmth-disc radius per cluster tier, indexed by
 *   0 — solo (no other lit torch within proximity)
 *   1 — paired (exactly one other lit torch within proximity)
 *   2 — cluster (two or more other lit torches within proximity, capped)
 *
 * Values are chosen to align with the world's 1 m paint-grid rather
 * than continuous meters — everything else in Snow Drift (melt paint,
 * brush size, snow depth sampling) speaks in whole-cell footprints, so
 * warmth should too:
 *
 *   1.5 m radius → 3×3 cells  (9 cells)  — MATCHES TORCH MELT PAINT.
 *                                          Solo warmth == solo melt.
 *                                          "Where I melt is where I heat."
 *   2.5 m radius → 5×5 cells  (~21, corners clipped)
 *   3.5 m radius → 7×7 cells  (~45, corners clipped)
 *
 * At paired/cluster tiers, warmth grows BEYOND the melt footprint —
 * meaning a wood-runner can stand on unmelted deep snow (still slowed
 * by locomotion, still exposed to snow-depth frost) but be baseline-
 * frost-protected by a friend's expanded disc. This is intentional:
 * togetherness relaxes the frost constraint while keeping the movement
 * constraint. "You can go further together, just slower."
 */
export const TORCH_WARMTH_TIER_RADIUS_M: readonly number[] = [
	1.5, // solo    — 3×3 cells (matches brush=3 torch melt paint)
	2.5, // paired  — 5×5 cells
	3.5, // cluster — 7×7 cells
]
/**
 * Torch melt-brush footprint (odd cell count, N×N square) per cluster
 * tier. Consumed by src/client/brush.ts::getBrushCells() so that a lit
 * torch's melt paint grows in lockstep with its warmth disc — keeping
 * the semantic "where I melt is where I heat" true at every tier, not
 * just solo.
 *
 * Gameplay consequence: paired/clustered players carve WIDER trails
 * through the snow than solo players do. This is intentional — group
 * play leaves persistent visible evidence in the world ("someone was
 * here with a friend"), pairs cover more ground per step, and wood
 * chunks / hidden pits under the melt footprint are revealed faster
 * when players travel together. Trades some solo challenge for a
 * legible, measurable cooperation payoff.
 *
 * The scatter density tuning in src/shared/woodScatter.ts and the
 * hidden-pit spacing in src/shared/hiddenCampfire.ts may need a
 * follow-up pass once real playtest data shows how much faster paired
 * play actually surfaces content.
 */
export const TORCH_WARMTH_TIER_BRUSH_CELLS: readonly number[] = [
	3, // solo    — 3×3 brush (unchanged from historical BRUSH_TORCH_LIT)
	5, // paired  — 5×5 brush
	7, // cluster — 7×7 brush
]
/**
 * Flame-visual scale multiplier per cluster tier. Applied on top of the
 * fuel-driven flame shrink (see src/client/torch.ts). Chosen aggressive
 * enough that meeting a friend is an unmissable visual event.
 */
export const TORCH_WARMTH_TIER_FLAME_SCALE: readonly number[] = [
	1.0,
	1.35,
	1.7,
]
/**
 * Flame-emissive multiplier per cluster tier. Stacks with scale so a
 * clustered flame is BOTH bigger AND brighter than a solo one. Base is
 * the solo flame's emissive intensity as set in torch.ts /
 * remoteTorches.ts (currently 1.6); tier 2 pushes to ~2.5 which is
 * still under the tone-mapper's white-out threshold.
 */
export const TORCH_WARMTH_TIER_EMISSIVE_MULT: readonly number[] = [
	1.0,
	1.3,
	1.55,
]
/**
 * Distance in meters between two torch-holders' positions at which
 * they count as "clustered". Deliberately larger than
 * torchChain.CHAIN_LIGHT_RADIUS_M (2 m) so the warmth bonus kicks in
 * before torches are close enough to chain-light — meeting a friend
 * feels warm from a step or two away, ignition is a distinct, more
 * intimate moment.
 */
const CLUSTER_PROXIMITY_M    = 3.0
const CLUSTER_PROXIMITY_SQ_M = CLUSTER_PROXIMITY_M * CLUSTER_PROXIMITY_M
/**
 * Poll cadence. Matches the wood/logs/chain-light polls elsewhere —
 * responsive enough that a two-player meeting reads as instant,
 * cheap enough to run continuously.
 */
const POLL_INTERVAL_S        = 0.15


// MARK: Types
/**
 * A single lit torch's warmth footprint at snapshot time. Consumed by
 * the frost accumulator (radiusSq check) and — indirectly, via the
 * tier — by the flame visual systems.
 */
export interface LitTorchWarmth {
	x       : number
	z       : number
	radiusSq: number
	tier    : 0 | 1 | 2
}


// MARK: Module state
let installed        = false
let pollClock        = 0
let localUserIdLower = ''
// Latest snapshot. Consumers read this via getLitTorchWarmthPositions().
// Rebuilt in place each poll; a fresh array is allocated so consumers
// iterating from a prior tick don't observe partial updates.
let snapshot: LitTorchWarmth[] = []
// Cached local tier for the flame-scale readers (torch.ts). Undefined
// while the local torch is unlit — solo tier is 0 either way, but this
// lets the flame system skip work when there's nothing to render.
let localTier: 0 | 1 | 2 = 0
// Per-remote-userId tier cache for remoteTorches.ts's flame scaler.
// Missing entries default to 0.
const remoteTiers = new Map<string, 0 | 1 | 2>()


// MARK: resolveLocalUserId
// Same lazy-resolve pattern used in remoteTorches.ts and torchChain.ts.
// getPlayer() returns null during early boot; cached once populated.
function resolveLocalUserId(): string {
	if (localUserIdLower !== '') return localUserIdLower
	const id = getPlayer()?.userId
	if (!id) return ''
	localUserIdLower = id.toLowerCase()
	return localUserIdLower
}


// MARK: gatherLitTorchPoints
// Walk the local player + every remote with a torch attached, filter
// down to just those whose torch is currently lit, and read their world
// position. Returns a parallel array of {userId, x, z} — userId is ''
// for the local player (we don't need to key it, we already know which
// entry is ours by position in the array).
interface RawTorchPoint {
	userId: string
	x     : number
	z     : number
}
function gatherLitTorchPoints(): RawTorchPoint[] {
	const points: RawTorchPoint[] = []

	// Local first — we own the ground truth for our own lit state.
	if (isTorchLit()) {
		const t = Transform.getOrNull(engine.PlayerEntity)
		if (t !== null) {
			points.push({ userId: '', x: t.position.x, z: t.position.z })
		}
	}

	// Remotes — iterate the known-torch userIds from remoteTorches.ts,
	// filter to those whose lit mirror is true, then look up their
	// Transform via PlayerIdentityData. Same pattern as torchChain.ts.
	const localId = resolveLocalUserId()
	for (const remoteId of getRemoteTorchUserIds()) {
		if (remoteId === localId)       continue
		if (!isRemoteTorchLit(remoteId)) continue
		for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
			if (identity.address?.toLowerCase() !== remoteId) continue
			const t = Transform.getOrNull(entity)
			if (t === null) break
			points.push({ userId: remoteId, x: t.position.x, z: t.position.z })
			break
		}
	}

	return points
}


// MARK: computeTier
// Count how many OTHER points (excluding self at index `selfIdx`) are
// within CLUSTER_PROXIMITY_M of the point at selfIdx. Clamp to 2 —
// three or more nearby lit torches produce the same tier as two.
function computeTier(points: RawTorchPoint[], selfIdx: number): 0 | 1 | 2 {
	const self = points[selfIdx]
	let nearby = 0
	for (let i = 0; i < points.length; i++) {
		if (i === selfIdx) continue
		const dx = points[i].x - self.x
		const dz = points[i].z - self.z
		if (dx * dx + dz * dz <= CLUSTER_PROXIMITY_SQ_M) {
			nearby++
			if (nearby >= 2) return 2
		}
	}
	return nearby === 1 ? 1 : 0
}


// MARK: rebuildSnapshot
function rebuildSnapshot(): void {
	const points = gatherLitTorchPoints()
	const next: LitTorchWarmth[] = []
	// Reset caches; anyone missing from this snapshot is implicitly tier 0.
	let nextLocalTier: 0 | 1 | 2 = 0
	remoteTiers.clear()

	for (let i = 0; i < points.length; i++) {
		const p      = points[i]
		const tier   = computeTier(points, i)
		const radius = TORCH_WARMTH_TIER_RADIUS_M[tier]
		next.push({
			x       : p.x,
			z       : p.z,
			radiusSq: radius * radius,
			tier,
		})
		if (p.userId === '') {
			nextLocalTier = tier
		} else {
			remoteTiers.set(p.userId, tier)
		}
	}

	snapshot   = next
	localTier  = nextLocalTier
}


// MARK: getLitTorchWarmthPositions
/**
 * Snapshot of every lit torch's current warmth disc. Read every frost
 * poll by src/client/frost/accumulation.ts to test whether the local
 * player is inside any disc. The array reference is stable between
 * polls and replaced atomically each rebuild.
 */
export function getLitTorchWarmthPositions(): readonly LitTorchWarmth[] {
	return snapshot
}


// MARK: getLocalTorchWarmthTier
/**
 * Current cluster tier of the local player's torch. 0 when unlit or
 * solo. Read by src/client/torch.ts to scale the flame visual.
 */
export function getLocalTorchWarmthTier(): 0 | 1 | 2 {
	return localTier
}


// MARK: getRemoteTorchWarmthTier
/**
 * Current cluster tier of the given remote's torch. 0 when unlit,
 * unknown, or solo. Read by src/client/remoteTorches.ts to scale each
 * remote's flame visual.
 */
export function getRemoteTorchWarmthTier(userIdLower: string): 0 | 1 | 2 {
	return remoteTiers.get(userIdLower) ?? 0
}


// MARK: getTorchWarmthDebugInfo
/**
 * Snapshot of raw cluster metrics for the local player — total lit
 * torches in scene, nearby lit count within CLUSTER_PROXIMITY_M of the
 * local player, and the resulting tier. Consumed only by the dev HUD
 * layer (gated by devFlags.SHOW_TORCH_WARMTH_DEBUG); safe to read every
 * frame, no allocation.
 */
export interface TorchWarmthDebugInfo {
	totalLit    : number
	nearbyLit   : number
	localTier   : 0 | 1 | 2
	localRadius : number
	localLit    : boolean
}
export function getTorchWarmthDebugInfo(): TorchWarmthDebugInfo {
	const total     = snapshot.length
	const localLit  = isTorchLit()
	let   nearby    = 0
	if (localLit) {
		const t = Transform.getOrNull(engine.PlayerEntity)
		if (t !== null) {
			const lx = t.position.x
			const lz = t.position.z
			for (const d of snapshot) {
				const dx = d.x - lx
				const dz = d.z - lz
				const dsq = dx * dx + dz * dz
				// Exclude self (distance ~0). Any other lit torch within
				// proximity counts, regardless of the cap that clamps tier.
				if (dsq > 0.01 && dsq <= CLUSTER_PROXIMITY_SQ_M) nearby++
			}
		}
	}
	return {
		totalLit   : total,
		nearbyLit  : nearby,
		localTier  : localTier,
		localRadius: TORCH_WARMTH_TIER_RADIUS_M[localTier],
		localLit,
	}
}


// MARK: setupTorchWarmth
/**
 * Install the polling system. Idempotent — safe to call once from
 * client bootstrap. Depends on setupRemoteTorches() having run so
 * getRemoteTorchUserIds() has entries to iterate; see the ordering in
 * src/client/index.ts (torchWarmth follows the remote-torch setup in
 * the deferred cold-open block).
 */
export function setupTorchWarmth(): void {
	if (installed) {
		console.log('torchWarmth: setupTorchWarmth: already installed, skipping')
		return
	}
	installed = true

	engine.addSystem((dt: number) => {
		pollClock += dt
		if (pollClock < POLL_INTERVAL_S) return
		pollClock = 0
		rebuildSnapshot()
	})

	console.log('torchWarmth: setupTorchWarmth: cluster poll active (proximity=' +
		CLUSTER_PROXIMITY_M + 'm, tiers=' + TORCH_WARMTH_TIER_RADIUS_M.join('/') + 'm)')
}
