/**
 * brush.ts — melt brush footprint, derived from torch fuel and phase.
 *
 *   - Torch unlit / none     -> 1x1 stomp
 *   - Torch lit, fuel > 1/3  -> 3x3 melt
 *   - Torch lit, fuel <= 1/3 -> 1x1 melt (low-fuel tell)
 *   - Dusk and night         -> 1x1 melt (PhaseConfig.meltBrushCap)
 *
 * Being near another player does not change the brush. Chain-light
 * is the only togetherness verb.
 */

import { phaseMeltBrushCells } from 'src/shared/phase'

import { getLivePhaseConfig } from 'src/client/phase'
import { getTorchFuelFraction, isTorchLit } from 'src/client/torchEquip'


// MARK: Sizes
/** Daytime melt while the torch has more than a third of its fuel. */
export const BRUSH_TORCH_LIT = 3
/**
 * Unlit stomp footprint. Demotes pristine cells to stage 1 rather
 * than fully melting (see src/server/snowState.ts).
 */
export const BRUSH_UNLIT = 1
/** Fuel fraction at or below this pinches the day brush to one tile. */
const LOW_FUEL_MELT_FRAC = 1 / 3


// MARK: getBrushCells

/**
 * Current brush footprint as an odd cell count (1 or 3). Night and
 * low fuel both land on one tile.
 */
export function getBrushCells(): number {
	if (!isTorchLit()) return BRUSH_UNLIT
	const cells = getTorchFuelFraction() <= LOW_FUEL_MELT_FRAC
		? BRUSH_UNLIT
		: BRUSH_TORCH_LIT
	return phaseMeltBrushCells(getLivePhaseConfig(), cells)
}
