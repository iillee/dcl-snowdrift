/**
 * brush.ts — melt brush footprint, derived from torch state.
 *
 * Brush size is NOT player-controlled. It is a strict function of the
 * torch:
 *   - Torch lit          -> BRUSH_TORCH_LIT (3x3) melt footprint
 *   - Torch unlit / none -> BRUSH_UNLIT     (1x1) stomp footprint
 *
 * When we later add torch upgrades or double-torch cells per PLAN.md's
 * B1 candidates, add cases here — the accumulation and paint systems
 * only read getBrushCells() and don't care where the number comes from.
 */

import { isTorchLit } from 'src/client/torchEquip'


// MARK: Sizes
/** Melt footprint when the torch flame is burning. */
export const BRUSH_TORCH_LIT = 3
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
 * Current brush footprint as an odd cell count (1 or 3). Read every
 * frame by the painting system.
 */
export function getBrushCells(): number {
	return isTorchLit() ? BRUSH_TORCH_LIT : BRUSH_UNLIT
}
