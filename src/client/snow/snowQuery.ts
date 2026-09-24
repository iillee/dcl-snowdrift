/**
 * snowQuery.ts — gameplay reads of the snow layer (frost, locomotion,
 * footsteps). O(1) grid math; no tile or entity lookups.
 */

import {
	SNOW_GROUND_TOP_Y,
	SNOW_STAGE_HEIGHT_M,
	SnowStage,
	STAGE_PRISTINE,
	tileKeyOfCell,
	worldToCellKey,
} from 'src/shared/snowGrid'

import { isTileMasked } from 'src/client/snow/playfieldMask'
import { getDisplayedStage } from 'src/client/snow/snowModel'

// Feet may ride slightly above the visible snow top without counting as airborne.
const FOOT_ABOVE_TOP_TOLERANCE_M = 0.35


// MARK: getSnowStageAtWorld

/**
 * Snow stage under world point (x, y, z):
 *   0 = melted, 1..2 = regrowth, 3 = pristine.
 * Off-playfield and cliff-masked points read as 3. When the point is
 * above the snow top at that cell (jumping), returns 0 so callers treat
 * the player as out of the snow.
 */
export function getSnowStageAtWorld(
	x: number,
	y: number,
	z: number,
): SnowStage {
	const key = worldToCellKey(x, z)
	if (key === null) return STAGE_PRISTINE
	if (isTileMasked(tileKeyOfCell(key))) return STAGE_PRISTINE
	const stage = getDisplayedStage(key)
	if (stage === 0) return 0
	const snowTopY = SNOW_GROUND_TOP_Y + SNOW_STAGE_HEIGHT_M[stage]
	if (y > snowTopY + FOOT_ABOVE_TOP_TOLERANCE_M) return 0
	return stage
}
