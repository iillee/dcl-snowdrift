/**
 * snowState.ts — authoritative snow melt / regrowth state.
 *
 * Clients send cell keys via paintTick; fires melt discs around
 * themselves. Every state change is written through snowSync as a
 * PaintTile byte, and dirty tiles are flushed once per tick by server.ts.
 *
 * Cells absent from `cells` are pristine (stage 3). Fire-protected cells
 * never regrow while protected. The single snow cell under each
 * campfire caps at stage 2: hidden pits start with that dimple, and
 * found fires keep it after they go out so they stay re-findable.
 */

import {
	SNOW_CELL_M,
	SNOW_CELLS_X,
	SNOW_CELLS_Z,
	SNOW_TILE_CELL_COUNT,
	SNOW_TILES_X,
	STAGE_MELTED,
	STAGE_PRISTINE,
	SnowStage,
	cellKey,
	forEachCellInDisc,
	isCellKeyValid,
	snowByteFromStage,
	tileCoordsFromKey,
	tileKeyOfCell,
	worldToCellKey,
} from 'src/shared/snowGrid'
import { HEAT_FRONT_BAND_M, heatFrontRadiusM } from 'src/shared/heatFront'
import { oasisClear, oasisSetBurstReveal } from 'src/shared/terrain/oasis'
import { activeTerrain } from 'src/shared/terrain/terrainCache'
import { levelAtWorld, TerrainMap } from 'src/shared/terrain/terrainMap'
import {
	CRATER_HEAT_RADIUS_M,
	volcanoCraterHeatCenter,
} from 'src/shared/terrain/volcanoCraterHeat'
import { pickSummitMapSeat } from 'src/shared/terrain/summitMapSeat'
import { volcanoLavaCells } from 'src/shared/terrain/volcanoCrown'

import { noteComponentChange } from 'src/server/serverStats'
import { queueThawTiles, isThawTileMelted, publishSnowCoverage, thawMeltedTileCount, writeSnowByte, zeroAllSnowTiles } from 'src/server/snowSync'

// changedAtMs = server clock at the last stage transition (or melt refresh).
type CellState = { stage: 0 | 1 | 2; changedAtMs: number }

const cells          = new Map<number, CellState>()
const protectedCells = new Set<number>()
/** Fire-network path cells (src/server/fireNetwork.ts). Separate from fire rings so releasing one never frees the other. */
const pathProtected  = new Map<number, [number, number, number]>() // per cell: how many links hold it at stage cap 0 / 1 / 2
/** Cells under a campfire that has melted at least once this cycle. */
const scarredCells   = new Set<number>()
/**
 * Permanent heat zones (floating crystals): melted, never regrow, and
 * unlike protectedCells no fire shrink / snuff can release them. The
 * generalised form of the crater always-melt. Cleared on cycle wipe.
 */
const heatZoneCells  = new Set<number>()

let serverClockMs = 0
let coverageDirty = false

/** After 3/3 thaw: cells in tiles the thaw wave reached read melted until cycle wipe. */
function inThawZone(key: number): boolean {
	return isThawTileMelted(tileKeyOfCell(key))
}

// Regrowth ms per stage, keyed by precipitation level. CLEAR (0) freezes.
const STAGE_INTERVAL_MS: Record<number, number | null> = {
	0: null,
	1: 30000,
	2: 20000,
	3: 12000,
}

/** Highest snow stage a scarred cell may reach (never pristine). */
const FIRE_SCAR_MAX_STAGE: 1 | 2 = 2


// MARK: writeStage

function writeStage(
	key:   number,
	stage: SnowStage,
): void {
	if (writeSnowByte(key, snowByteFromStage(stage))) noteComponentChange(1)
}


// MARK: applyMelt

/**
 * Apply a player or fire melt to one cell.
 *   targetStage 0 = full melt (lit torch, fire ring). Always lands at stage 0;
 *                   an already-melted cell just refreshes its regrowth clock.
 *   targetStage 1 = stomp (unlit walk). Only demotes pristine or stage-2 cells.
 * Returns true when the cell's stage changed.
 */
export function applyMelt(
	key:         number,
	targetStage: 0 | 1,
): boolean {
	if (!isCellKeyValid(key)) return false
	if (inThawZone(key)) return false
	const prev = cells.get(key)

	if (targetStage === 1) {
		const current: SnowStage = prev ? prev.stage : STAGE_PRISTINE
		if (current < 2) return false
		cells.set(key, { stage: 1, changedAtMs: serverClockMs })
		writeStage(key, 1)
		coverageDirty = true
		return true
	}

	if (prev && prev.stage === 0) {
		prev.changedAtMs = serverClockMs
		return false
	}
	cells.set(key, { stage: 0, changedAtMs: serverClockMs })
	writeStage(key, 0)
	coverageDirty = true
	return true
}


// MARK: getStageAtWorld

/**
 * Authoritative stage at world (x, z). Missing cells are pristine.
 * Off-playfield reads as pristine so callers never treat a cliff
 * pocket as melted ground.
 */
export function getStageAtWorld(
	x: number,
	z: number,
): SnowStage {
	const key = worldToCellKey(x, z)
	if (key === null) return STAGE_PRISTINE
	if (inThawZone(key)) return STAGE_MELTED
	const state = cells.get(key)
	return state ? state.stage : STAGE_PRISTINE
}


// MARK: meltDisc

/**
 * Melt and heat-protect every cell within `radiusM` of world (cx, cz).
 * Idempotent; returns the count of cells whose stage changed.
 * Also scars a small footprint at the centre so snowfall never fully
 * erases a found campfire this cycle.
 */
export function meltDisc(
	cx:      number,
	cz:      number,
	radiusM: number,
): number {
	let changed = 0
	const map   = activeTerrain()
	// A fire warms the ground it stands on, not the plateau 16 m above
	// it that happens to fall inside the same 2D disc.
	const fireLevel = map === null ? -1 : levelAtWorld(map, cx, cz)
	forEachCellInDisc(cx, cz, radiusM, (key) => {
		if (map !== null && levelOfCell(map, key) !== fireLevel) return
		protectedCells.add(key)
		if (applyMelt(key, 0)) changed++
	})
	markFireScar(cx, cz)
	return changed
}


// MARK: markFireScar
/**
 * Remember the single snow cell under the fire. tickRegrowth will
 * refuse to push it past FIRE_SCAR_MAX_STAGE for the rest of the cycle.
 */
function markFireScar(
	cx: number,
	cz: number,
): void {
	const key = worldToCellKey(cx, cz)
	if (key === null) return
	scarredCells.add(key)
}


// MARK: releaseDimple
/**
 * Item dimple gone (the buried wood was picked up): drop the cell's scar
 * so snowfall refills it to full depth at the normal regrowth rate. The
 * cell keeps its current stage; nothing else is touched.
 */
export function releaseDimple(cx: number, cz: number): void {
	const key = worldToCellKey(cx, cz)
	if (key === null) return
	if (scarredCells.delete(key)) {
		const st = cells.get(key)
		if (st) st.changedAtMs = serverClockMs
	}
}


// MARK: seedFireDimple
/**
 * Put a shallow one-cell dip (stage FIRE_SCAR_MAX_STAGE) under a
 * campfire and scar it so snowfall never fills it flat this cycle.
 * Does not deepen an already-melted cell. Used for unlit hidden pits
 * at cycle start so they read as a findable hollow without a clear ring.
 */
export function seedFireDimple(
	cx: number,
	cz: number,
): void {
	const key = worldToCellKey(cx, cz)
	if (key === null) return
	scarredCells.add(key)
	const prev = cells.get(key)
	if (prev !== undefined && prev.stage <= FIRE_SCAR_MAX_STAGE) return
	cells.set(key, { stage: FIRE_SCAR_MAX_STAGE, changedAtMs: serverClockMs })
	writeStage(key, FIRE_SCAR_MAX_STAGE)
	coverageDirty = true
}


// MARK: levelOfCell
// Terrain level under a snow cell. A snow tile and a terrain cell are
// both 16 m, so one tile lookup answers for every cell inside it.
function levelOfCell(
	map: TerrainMap,
	key: number,
): number {
	const { tx, tz } = tileCoordsFromKey(tileKeyOfCell(key))
	if (tx < 0 || tz < 0 || tx >= map.w || tz >= map.h) return -1
	return map.levels[tz * map.w + tx]
}


// MARK: releaseDiscOutside

/**
 * Release heat protection on cells within `previousRadiusM` of (cx, cz)
 * but outside `radiusM`. Released cells keep their stage and regrow
 * naturally from now. `previousRadiusM` bounds the sweep so shrinking one
 * fire never releases another fire's ring.
 */
export function releaseDiscOutside(
	cx:              number,
	cz:              number,
	radiusM:         number,
	previousRadiusM: number,
): void {
	const r2     = radiusM * radiusM
	let released = 0
	forEachCellInDisc(cx, cz, previousRadiusM, (key, distSq) => {
		if (distSq <= r2) return
		if (protectedCells.delete(key)) released++
	})
	if (released > 0) {
		console.log(`snowState: releaseDiscOutside: ${radiusM.toFixed(1)}m (prev ${previousRadiusM.toFixed(1)}m) released ${released} cells`)
	}
}


// MARK: tickRegrowth

/**
 * Advance the server clock by `dtMs` and move every unprotected cell one
 * stage toward pristine when its elapsed time crosses the next threshold.
 */
export function tickRegrowth(
	dtMs:               number,
	precipitationLevel: number,
): void {
	serverClockMs += dtMs
	const intervalMs = STAGE_INTERVAL_MS[precipitationLevel] ?? null
	if (intervalMs === null) return

	for (const [key, state] of cells) {
		// Thaw zone: the tile is held melted by the volcano campfire.
		if (inThawZone(key)) {
			cells.delete(key)
			continue
		}
		if (protectedCells.has(key) || heatZoneCells.has(key)) {
			state.changedAtMs = serverClockMs
			continue
		}
		const pc = pathProtected.get(key)
		if (pc && state.stage >= pathCapOf(pc)) {
			// Held by a fire-network path at (or below) its terrace depth.
			state.changedAtMs = serverClockMs
			continue
		}
		const nextStage = state.stage + 1
		if (serverClockMs - state.changedAtMs < intervalMs * nextStage) continue

		if (nextStage > FIRE_SCAR_MAX_STAGE && scarredCells.has(key)) {
			// Found-fire scar: stop at the dip stage. Keep the cell in
			// the map so it never collapses back to pristine.
			if (state.stage !== FIRE_SCAR_MAX_STAGE) {
				state.stage = FIRE_SCAR_MAX_STAGE
				writeStage(key, FIRE_SCAR_MAX_STAGE)
				coverageDirty = true
			}
			state.changedAtMs = serverClockMs
			continue
		}
		if (nextStage >= STAGE_PRISTINE) {
			cells.delete(key)
			writeStage(key, STAGE_PRISTINE)
			coverageDirty = true
			continue
		}
		state.stage = nextStage as 1 | 2
		writeStage(key, state.stage)
	}
}


// MARK: meltPathCell / releasePathCell
/** Fire network: melt + hold one cell clear while its link stands. */
function pathCapOf(pc: [number, number, number]): number {
	return pc[0] > 0 ? 0 : pc[1] > 0 ? 1 : 2
}
/** Fire network: hold one cell at no more than stage `cap` (0 = clear, 1 / 2 = terrace step) while its link stands. */
export function meltPathCell(key: number, cap: number = 0): void {
	if (!isCellKeyValid(key)) return
	const c = Math.max(0, Math.min(2, Math.round(cap))) as 0 | 1 | 2
	let pc = pathProtected.get(key)
	if (!pc) { pc = [0, 0, 0]; pathProtected.set(key, pc) }
	pc[c]++
	const want = pathCapOf(pc) as 0 | 1 | 2
	if (want === 0) { applyMelt(key, 0); return }
	if (inThawZone(key)) return
	const prev = cells.get(key)
	const cur = prev ? prev.stage : STAGE_PRISTINE
	if (cur <= want) return
	cells.set(key, { stage: want, changedAtMs: serverClockMs })
	writeStage(key, want)
	coverageDirty = true
}
/** Fire network: stop holding a cell; it keeps its stage and regrows with weather. */
export function releasePathCell(key: number, cap: number = 0): void {
	const pc = pathProtected.get(key)
	if (!pc) return
	const c = Math.max(0, Math.min(2, Math.round(cap)))
	if (pc[c] > 0) pc[c]--
	if (pc[0] + pc[1] + pc[2] === 0) pathProtected.delete(key)
}


// MARK: meltRandomCells

/** Dev load test: fully melt up to `count` random unprotected cells. Returns cells changed. */
export function meltRandomCells(count: number): number {
	let changed  = 0
	let attempts = 0
	const maxAttempts = count * 4
	while (changed < count && attempts < maxAttempts) {
		attempts++
		const key = cellKey(
			Math.floor(Math.random() * SNOW_CELLS_X),
			Math.floor(Math.random() * SNOW_CELLS_Z),
		)
		if (protectedCells.has(key)) continue
		if (applyMelt(key, 0)) changed++
	}
	return changed
}




// MARK: meltVolcanoCraterHeat

/**
 * Keep the volcano caldera (LANDFORM_LAVA tiles) melted + heat-protected
 * like a medium / Warm campfire — even with 0 stations and before thaw.
 * Does not reveal lava meshes; only snow stage + protect.
 * Also clears a Warm pad at the summit map table so the pillar is not
 * buried under 1.5 m pristine snow. Re-apply after clearAllSnow.
 */
export function meltVolcanoCraterHeat(): number {
	const map = activeTerrain()
	if (!map) return 0
	const lava = volcanoLavaCells(map)
	if (lava.length === 0) return 0

	let changed = 0
	for (const i of lava) {
		const cx = i % map.w
		const cz = (i - cx) / map.w
		// Snow tile == terrain cell (both 16 m). Melt every 1 m snow cell
		// inside each lava tile and protect so snowfall cannot refill.
		const tileKey = cz * SNOW_TILES_X + cx
		for (let local = 0; local < SNOW_TILE_CELL_COUNT; local++) {
			const key = tileKey * SNOW_TILE_CELL_COUNT + local
			protectedCells.add(key)
			if (applyMelt(key, 0)) changed++
		}
	}

	// Medium (Warm) heat bloom at the lava centroid.
	const centre = volcanoCraterHeatCenter(map)
	if (centre) {
		changed += meltDisc(centre.x, centre.z, CRATER_HEAT_RADIUS_M)
	}

	// Clear snow around the summit map table (rim seat) so the waist-high
	// pillar is visible — pristine snow is 1.5 m and would bury it.
	const seat = pickSummitMapSeat(map)
	if (seat) {
		changed += meltDisc(seat.x, seat.z, CRATER_HEAT_RADIUS_M)
	}

	if (changed > 0) {
		console.log(
			`[Server] snowState: meltVolcanoCraterHeat lavaTiles=${lava.length} ` +
			`changed=${changed} (Warm ${CRATER_HEAT_RADIUS_M}m bloom + seat pad)`,
		)
	}
	return changed
}


// MARK: meltHeatZone
/**
 * Permanent heat disc of `radiusM` at (cx, cz), every terrain level
 * (a floating crystal warms the whole territory under it). Cells melt
 * now and are held clear against snowfall for the rest of the cycle.
 * Returns cells newly held by this zone.
 */
export function meltHeatZone(cx: number, cz: number, radiusM: number): number {
	let added = 0
	forEachCellInDisc(cx, cz, radiusM, (key) => {
		if (!heatZoneCells.has(key)) { heatZoneCells.add(key); added++ }
		applyMelt(key, 0)
	})
	coverageDirty = true
	console.log(`[Server] snowState: meltHeatZone r=${radiusM}m +${added} cells (heat-zone total ${heatZoneCells.size})`)
	return added
}

// MARK: heat-zone melt front
/**
 * Gradual heat zone (crystal release): a melt front expands from (cx, cz)
 * to radiusM over spreadS. As it passes, each cell steps down its depth
 * stages (2 -> 1 -> 0 over the trailing HEAT_FRONT_BAND_M) and joins the
 * permanent heat zone at 0. Processed per tick by ring (annulus), so a
 * tick only touches cells the front newly reached. Server-authoritative;
 * clients and late joiners see it through the normal snow sync.
 */
interface HeatFront { cx: number; cz: number; R: number; startMs: number; durMs: number; doneR: number; h: number }
const heatFronts: HeatFront[] = []

/**
 * fromHeightM > 0: the front is the ground circle of a sphere centred
 * fromHeightM above the centre whose radius grows linearly 0 -> hypot(R +
 * band, h) (the crystal release burst), so the melt tracks the sphere.
 */
export function startHeatZoneFront(cx: number, cz: number, radiusM: number, spreadS: number, delayS = 0, fromHeightM = 0): void {
	if (spreadS <= 0 && delayS <= 0) { meltHeatZone(cx, cz, radiusM); return }
	heatFronts.push({ cx, cz, R: radiusM, startMs: Date.now() + Math.max(0, delayS) * 1000, durMs: Math.max(1, spreadS * 1000), doneR: 0, h: Math.max(0, fromHeightM) })
	console.log(`[Server] snowState: heat front r=${radiusM}m over ${spreadS}s at (${cx.toFixed(0)}, ${cz.toFixed(0)})`)
}

function lowerCellTo(key: number, want: 0 | 1 | 2): void {
	if (!isCellKeyValid(key) || inThawZone(key)) return
	if (want === 0) { heatZoneCells.add(key); applyMelt(key, 0); return }
	const prev = cells.get(key)
	const cur = prev ? prev.stage : STAGE_PRISTINE
	if (cur <= want) return
	cells.set(key, { stage: want, changedAtMs: serverClockMs })
	writeStage(key, want)
	coverageDirty = true
}

/** Advance every heat front; returns true while any is still running. */
export function tickHeatFronts(nowMs: number): boolean {
	for (let i = heatFronts.length - 1; i >= 0; i--) {
		const f = heatFronts[i]
		if (nowMs < f.startMs) continue // delayed start (crystal still rising)
		const u = Math.min(1, (nowMs - f.startMs) / f.durMs)
		// Front radius runs past R by the band so the edge cells reach 0.
		const r = heatFrontRadiusM(u, f.R, f.h) // shared with the client's predicted melt
		const lo = Math.max(0, f.doneR - HEAT_FRONT_BAND_M)
		const lo2 = lo * lo
		forEachCellInDisc(f.cx, f.cz, Math.min(r, f.R), (key, distSq) => {
			if (distSq < lo2) return
			const lag = r - Math.sqrt(distSq)
			lowerCellTo(key, lag >= HEAT_FRONT_BAND_M ? 0 : lag >= (2 * HEAT_FRONT_BAND_M) / 3 ? 1 : 2)
		})
		f.doneR = r
		oasisSetBurstReveal(f.cx, f.cz, Math.min(r, f.R)) // opens at most OASIS_INNER_M; the rest melts on the oasisTick clock
		if (u >= 1) {
			// Final sweep: everything inside R is held clear.
			meltHeatZone(f.cx, f.cz, f.R)
			heatFronts.splice(i, 1)
		}
	}
	return heatFronts.length > 0
}

/** Cells held by permanent heat zones (crystals). */
export function heatZoneCellCount(): number {
	return heatZoneCells.size
}


// MARK: meltObeliskIceSquare

/**
 * Melt + heat-protect every 1 m snow cell inside the axis-aligned square
 * of edge `sizeM` centred on world (cx, cz). Used when an obelisk ice
 * chunk melts (stations.ts): the snow that lay on that chunk goes with
 * it and never regrows over the now-empty hole this cycle. Snow over
 * frozen ice is left alone, so pits are buried like any other ground.
 * Gives no heat. Returns cells changed.
 */
export function meltObeliskIceSquare(cx: number, cz: number, sizeM: number): number {
	const half = sizeM / 2
	let changed = 0
	for (let dz = -half + SNOW_CELL_M / 2; dz < half; dz += SNOW_CELL_M) {
		for (let dx = -half + SNOW_CELL_M / 2; dx < half; dx += SNOW_CELL_M) {
			const key = worldToCellKey(cx + dx, cz + dz)
			if (key === null) continue
			protectedCells.add(key)
			if (applyMelt(key, 0)) changed++
		}
	}
	return changed
}

// MARK: releaseObeliskPitSquare

/**
 * Drop heat protection on every 1 m snow cell inside the square of edge
 * `sizeM` centred on world (cx, cz). Called once an obelisk activates
 * (stations.ts): the empty pit is no longer kept clear, so its cells
 * keep their current stage and regrow with snowfall like any other
 * ground (clients draw the double-depth pit fill). Returns cells released.
 */
export function releaseObeliskPitSquare(cx: number, cz: number, sizeM: number): number {
	const half = sizeM / 2
	let released = 0
	for (let dz = -half + SNOW_CELL_M / 2; dz < half; dz += SNOW_CELL_M) {
		for (let dx = -half + SNOW_CELL_M / 2; dx < half; dx += SNOW_CELL_M) {
			const key = worldToCellKey(cx + dx, cz + dz)
			if (key === null) continue
			if (protectedCells.delete(key)) released++
		}
	}
	return released
}

// MARK: meltThawZone

/**
 * Staged volcano thaw: hold every snow tile within `toTiles` of the
 * crater tile `centre` melted, painted as the wave radius
 * `radiusTilesAt(Date.now())` reaches it (snowSync.stepThawFill, spread
 * over ticks). Held tiles never regrow or take snowfall until
 * clearAllSnow (cycle roll). Outside the radius snow, regrowth and
 * accumulation carry on as normal. Prefer this over clearAllSnow, which
 * restores pristine snow for a cycle wipe.
 */
export function meltThawZone(
	centre       : { tx: number; tz: number },
	toTiles      : number,
	radiusTilesAt: (nowMs: number) => number,
): void {
	const tiles = queueThawTiles(centre, toTiles, radiusTilesAt)
	coverageDirty = true
	console.log(
		`[Server] snowState: meltThawZone queued=${tiles} ` +
		`radius=${toTiles.toFixed(1)} tiles from tile (${centre.tx},${centre.tz})`,
	)
}

// MARK: clearAllSnow

/** Cycle reset: every cell back to pristine, all protection dropped. */
export function clearAllSnow(): void {
	const cleared = cells.size
	cells.clear()
	protectedCells.clear()
	pathProtected.clear()
	scarredCells.clear()
	heatZoneCells.clear()
	heatFronts.length = 0
	oasisClear()
	zeroAllSnowTiles()
	noteComponentChange(cleared)
	coverageDirty = true
}


// MARK: meltedCellCount

/** Cells that are melted or regrowing (not pristine). */
export function meltedCellCount(): number {
	return cells.size + thawMeltedTileCount() * SNOW_TILE_CELL_COUNT
}


// MARK: publishCoverageIfDirty

/** Publish PaintCoverage when the melted count may have changed. */
export function publishCoverageIfDirty(): void {
	if (!coverageDirty) return
	publishSnowCoverage(meltedCellCount())
	coverageDirty = false
}
