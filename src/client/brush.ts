/**
 * brush.ts — melt brush footprint, derived from torch state.
 *
 * Brush size is NOT player-controlled. It is a strict function of the
 * torch AND, when lit, the local cluster tier from torchWarmth.ts:
 *   - Torch unlit / none          -> BRUSH_UNLIT (1x1) stomp footprint
 *   - Torch lit, solo    (tier 0) -> 3x3 melt (BRUSH_TORCH_LIT baseline)
 *   - Torch lit, paired  (tier 1) -> 5x5 melt
 *   - Torch lit, cluster (tier 2) -> 7x7 melt
 *
 * The lit-brush size lives in torchWarmth.TORCH_WARMTH_TIER_BRUSH_CELLS
 * alongside the matching warmth-disc radii, so the "where I melt is
 * where I heat" semantic parity is enforced at a single source of truth.
 *
 * When we later add torch upgrades or double-torch cells per PLAN.md's
 * B1 candidates, add cases here — the accumulation and paint systems
 * only read getBrushCells() and don't care where the number comes from.
 */

import { isTorchLit } from 'src/client/torchEquip'
import {
	TORCH_WARMTH_TIER_BRUSH_CELLS,
	getLocalTorchWarmthTier,
} from 'src/client/torchWarmth'


// MARK: Sizes
/**
 * Melt footprint when the torch flame is burning AND the local player
 * is solo (no other lit torch within CLUSTER_PROXIMITY_M). Kept as an
 * exported const for any downstream module that needs the baseline
 * (currently none outside historical references).
 */
export const BRUSH_TORCH_LIT = TORCH_WARMTH_TIER_BRUSH_CELLS[0]
/**
 * Fallback footprint when the torch is out. Kept above 0 so a
 * torchless player can still crawl home instead of being stranded.
 * Under the paintTick stomp policy (see src/server/paintState.ts) an
 * unlit brush demotes pristine cells to stage 1 rather than fully
 * melting, so this is more of a "trample" footprint than a melt.
 */
export const BRUSH_UNLIT     = 1


// MARK: getBrushCells
/**
 * Current brush footprint as an odd cell count (1, 3, 5, or 7). Read
 * every frame by the painting system. When lit, scales with the local
 * cluster tier from torchWarmth.ts so paired/clustered players carve
 * wider trails than solo ones — measurable cooperation payoff visible
 * in the world's persistent melt state.
 */
export function getBrushCells(): number {
	if (!isTorchLit()) return BRUSH_UNLIT
	const tier = getLocalTorchWarmthTier()
	return TORCH_WARMTH_TIER_BRUSH_CELLS[tier]
}
