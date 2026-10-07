/**
 * snowQuery.ts — gameplay reads of the snow layer (frost, locomotion,
 * footsteps). O(1) grid math; no tile or entity lookups.
 */

import {
	SNOW_STAGE_HEIGHT_M,
	SnowStage,
	STAGE_PRISTINE,
	worldToCellKey,
} from 'src/shared/snowGrid'
import { activeGroundYAt, activeIsLavaAt } from 'src/shared/terrain/terrainCache'

import { getDisplayedStage } from 'src/client/snow/snowModel'

// Feet may ride slightly above the visible snow top without counting as airborne.
const FOOT_ABOVE_TOP_TOLERANCE_M = 0.35


// MARK: getSnowStageAtWorld

/**
 * Snow stage under world point (x, y, z):
 *   0 = melted, 1..2 = regrowth, 3 = pristine.
 * Off-playfield points read as 3. When the point is above the snow top
 * at that cell (jumping, or standing on a cliff), returns 0 so callers
 * treat the player as out of the snow.
 */
export function getSnowStageAtWorld(
	x: number,
	y: number,
	z: number,
): SnowStage {
	const key = worldToCellKey(x, z)
	if (key === null) return STAGE_PRISTINE
	// The lava lid covers the crater's snow; nobody wades there.
	if (activeIsLavaAt(x, z)) return 0
	const stage = getDisplayedStage(key)
	if (stage === 0) return 0
	const snowTopY = activeGroundYAt(x, z) + SNOW_STAGE_HEIGHT_M[stage]
	if (y > snowTopY + FOOT_ABOVE_TOP_TOLERANCE_M) return 0
	return stage
}
