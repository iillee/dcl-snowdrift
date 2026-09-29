/**
 * brush.ts — melt brush footprint from the torch.
 *
 *   - Torch unlit / none -> 1x1 stomp
 *   - Torch lit          -> 3x3 melt, day and night, for the whole tank
 *
 * Being near another player does not change the brush. Chain-light
 * is the only togetherness verb.
 */

import { isTorchLit } from 'src/client/torchEquip'


// MARK: Sizes
/** Melt footprint while the torch is lit. */
export const BRUSH_TORCH_LIT = 3
/**
 * Unlit stomp footprint. Demotes pristine cells to stage 1 rather
 * than fully melting (see src/server/snowState.ts).
 */
export const BRUSH_UNLIT = 1


// MARK: getBrushCells

/** Current brush footprint as an odd cell count (1 or 3). */
export function getBrushCells(): number {
	return isTorchLit() ? BRUSH_TORCH_LIT : BRUSH_UNLIT
}
