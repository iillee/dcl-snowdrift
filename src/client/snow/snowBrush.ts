/**
 * snowBrush.ts — local player's melt / stomp brush and the paintTick outbox.
 *
 * Each frame the brush footprint (NxN cells, projected ahead of the
 * player) is written optimistically into snowModel and queued for the
 * server. Lit torch = melt to stage 0; unlit = stomp to stage 1, which
 * only affects cells at stage 2 or 3 (mirrors the server rule).
 *
 * Melts are re-queued every frame the brush covers a cell, even when it
 * already reads melted, so the server keeps resetting its regrowth timer.
 */

import { engine, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

import { PAINT_BRUSH_LEAD_METERS } from 'src/shared/settings'
import {
	SNOW_CELL_M,
	SNOW_GROUND_TOP_Y,
	tileKeyOfCell,
	worldToCellKey,
} from 'src/shared/snowGrid'

import { getBrushCells } from 'src/client/brush'
import { isTileMasked } from 'src/client/snow/playfieldMask'
import { getDisplayedStage, setOptimisticStage } from 'src/client/snow/snowModel'
import { isTorchLit } from 'src/client/torchEquip'

// Brush only paints while the player is within this height of the ground.
const GROUND_TOLERANCE_M = 0.4

const meltOutbox  = new Set<number>()
const stompOutbox = new Set<number>()

let initialized = false


// MARK: initSnowBrush

/** Register the brush system. Call once at boot. */
export function initSnowBrush(): void {
	if (initialized) return
	initialized = true
	engine.addSystem(snowBrushSystem)
}


// MARK: snowBrushSystem

function snowBrushSystem(): void {
	const brushCells = getBrushCells()
	if (brushCells <= 0) return
	const t = Transform.getOrNull(engine.PlayerEntity)
	if (t === null) return

	const { x, y, z } = t.position
	if (y - SNOW_GROUND_TOP_Y > GROUND_TOLERANCE_M) return

	const fwd         = Vector3.rotate(Vector3.Forward(), t.rotation)
	const sx          = x + fwd.x * PAINT_BRUSH_LEAD_METERS
	const sz          = z + fwd.z * PAINT_BRUSH_LEAD_METERS
	const half        = Math.floor(brushCells / 2)
	const targetStage = isTorchLit() ? 0 : 1

	for (let dz = -half; dz <= half; dz++) {
		for (let dx = -half; dx <= half; dx++) {
			const key = worldToCellKey(sx + dx * SNOW_CELL_M, sz + dz * SNOW_CELL_M)
			if (key === null) continue
			if (isTileMasked(tileKeyOfCell(key))) continue
			if (targetStage === 0) {
				meltOutbox.add(key)
				setOptimisticStage(key, 0)
			} else {
				if (getDisplayedStage(key) < 2) continue
				stompOutbox.add(key)
				setOptimisticStage(key, 1)
			}
		}
	}
}


// MARK: drainSnowOutbox

/** Take up to `max` queued cell keys for one paintTick at `targetStage`. */
export function drainSnowOutbox(
	max:         number,
	targetStage: 0 | 1,
): number[] {
	const box = targetStage === 1 ? stompOutbox : meltOutbox
	if (box.size === 0) return []
	const out: number[] = []
	for (const key of box) {
		out.push(key)
		if (out.length >= max) break
	}
	for (const key of out) box.delete(key)
	return out
}
