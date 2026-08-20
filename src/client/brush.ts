/**
 * brush.ts — melt brush footprint, derived from torch state.
 *
 * v1: brush size is NOT player-controlled. It's a strict function of
 * the torch:
 *   - Torch lit -> 3x3 melt footprint (BRUSH_TORCH_LIT cells)
 *   - Torch unlit / not equipped -> 1x1 fallback (BRUSH_UNLIT cells)
 *
 * The old +/- HUD buttons + free-range brush size were dev-time only
 * (see git history). The +/- action-bar layer still imports the old
 * increase/decrease/min/max symbols; they're kept here as harmless
 * no-ops so removing the buttons is a one-file UI change instead of
 * touching the exports too.
 *
 * When we later add "torch upgrades" or "double-torch cells" per
 * PLAN.md's B1 candidates, add cases here \u2014 the accumulation and
 * paint systems only read getBrushCells() and don't care where the
 * number comes from.
 */

import { isTorchLit } from 'src/client/torchEquip'


// MARK: Sizes
/** Melt footprint when the torch flame is burning. */
export const BRUSH_TORCH_LIT = 3
/** Fallback footprint when the torch is out. Kept above 0 so a
 *  torchless player can still crawl home instead of being stranded. */
export const BRUSH_UNLIT     = 1

// Kept exported so the legacy +/- action-bar layer type-checks. Values
// are the current lit/unlit sizes and are otherwise unused now that
// the brush is torch-driven.
export const BRUSH_MIN_CELLS  = BRUSH_UNLIT
export const BRUSH_MAX_CELLS  = BRUSH_TORCH_LIT
export const BRUSH_STEP_CELLS = 2


// MARK: getBrushCells
/**
 * Current melt footprint as an odd cell count (1 or 3). Read every
 * frame by the painting system.
 */
export function getBrushCells(): number {
	return isTorchLit() ? BRUSH_TORCH_LIT : BRUSH_UNLIT
}


// MARK: Legacy +/- shims
// Retained so old imports (layer.brushSize, keybind handlers) compile
// without touching them today. Brush is torch-derived; direct mutation
// is a no-op. Delete these once every call site is gone.

/** DEPRECATED: brush is torch-driven now. No-op. */
export function increaseBrush(): void {}
/** DEPRECATED: brush is torch-driven now. No-op. */
export function decreaseBrush(): void {}
/** DEPRECATED: brush is torch-driven now. No-op. */
export function cycleBrushUp(): void {}
/** DEPRECATED: brush is torch-driven now. No-op. */
export function cycleBrushDown(): void {}
