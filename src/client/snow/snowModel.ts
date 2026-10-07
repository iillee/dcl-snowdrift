/**
 * snowModel.ts — client-side snow stage per cell.
 *
 * Two layers, both flat typed arrays indexed by cell key:
 *   server    — last stage observed on the PaintTile CRDT
 *   displayed — what gameplay and the renderer read: server + local
 *               optimistic writes
 *
 * Every PaintTile change is applied straight into these arrays the frame
 * it is observed, independent of any render entity. A missing PaintTile
 * means that tile is pristine. The renderer reads `displayed` and is
 * told which 16 m roots changed; it never gates model updates, so
 * arrival order between CRDT data and render entities cannot lose a
 * change.
 *
 * While the spawn hearth is lit, its melt ring is also forced locally
 * so late joiners do not draw pristine snow over the fire before
 * PaintTile CRDT arrives. When the hearth is out, that force-melt
 * stops and snowfall can bury the logs again. Hidden pits are never
 * force-cleared — they start buried and only melt when lit. The volcano
 * crater is always force-cleared (Warm pad) so caldera heat reads before
 * PaintTile CRDT arrives.
 *
 * Optimistic writes expire after OPTIMISTIC_TIMEOUT_MS: if the server has
 * not moved the cell by then, displayed snaps back to the server value.
 */

import { engine, Entity, NetworkEntity } from '@dcl/sdk/ecs'
import { isStateSyncronized } from '@dcl/sdk/network'

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { PaintTile } from 'src/shared/components'
import { hearthRadiusFromFuel } from 'src/shared/hearthFuel'
import { tileKeyFromNetworkId } from 'src/shared/networkIds'
import {
	SNOW_TILE_CELL_COUNT,
	SNOW_TILES_X,
	SNOW_TILES_Z,
	SnowStage,
	STAGE_MELTED,
	STAGE_PRISTINE,
	forEachCellInDisc,
	stageFromSnowByte,
	tileCoordsFromKey,
	tileKeyOfCell,
} from 'src/shared/snowGrid'
import { activeTerrain } from 'src/shared/terrain/terrainCache'
import { levelAtWorld } from 'src/shared/terrain/terrainMap'
import {
	CRATER_HEAT_RADIUS_M,
	volcanoCraterHeatCenter,
} from 'src/shared/terrain/volcanoCraterHeat'
import { pickSummitMapSeat } from 'src/shared/terrain/summitMapSeat'
import { volcanoLavaCells } from 'src/shared/terrain/volcanoCrown'

import { getMainFireFuel } from 'src/client/hearthFuel'

const OPTIMISTIC_TIMEOUT_MS = 3000
const CELL_COUNT            = SNOW_TILES_X * SNOW_TILES_Z * SNOW_TILE_CELL_COUNT

const serverStages    = new Uint8Array(CELL_COUNT).fill(STAGE_PRISTINE)
const displayedStages = new Uint8Array(CELL_COUNT).fill(STAGE_PRISTINE)

// Per-entity byte shadow. The CRDT replica often mutates `tile.cells` in
// place, so reference equality cannot detect a write — we must diff bytes.
const tileShadow   = new Map<Entity, Uint8Array>()
const tileKeyByEnt = new Map<Entity, number>()
// Optimistic cell key -> expiry time (model clock ms).
const pending      = new Map<number, number>()
const dirtyRoots   = new Set<number>()
const urgentRoots  = new Set<number>()

let initialized = false
let hydrated    = false
let clockMs     = 0
let skipNetLogs = 0
let lastDiagMs  = 0
const SKIP_NET_LOG_CAP = 8
const DIAG_INTERVAL_MS = 5000


// MARK: initSnowModel

/** Register the CRDT observer system. Call once at boot. */
export function initSnowModel(): void {
	if (initialized) return
	initialized = true
	engine.addSystem(snowModelSystem)
}


// MARK: snowModelSystem

function snowModelSystem(dt: number): void {
	clockMs += dt * 1000
	const synced = isStateSyncronized()

	let seen = 0
	let empty = 0
	let unresolved = 0
	const live = new Set<Entity>()
	for (const [entity, tile] of engine.getEntitiesWith(PaintTile)) {
		seen++
		live.add(entity)
		const incoming = tile.cells
		if (!incoming || incoming.length === 0) {
			empty++
			continue
		}

		let tileKey = tileKeyByEnt.get(entity)
		if (tileKey === undefined) {
			const resolved = resolveTileKey(entity, tile.tileKey)
			if (resolved === null) {
				unresolved++
				continue
			}
			tileKey = resolved
			tileKeyByEnt.set(entity, tileKey)
		}

		applyTileBytes(entity, tileKey, incoming)
	}

	pruneGoneTiles(live)
	// After CRDT apply / prune: keep the lit spawn ring open for late
	// joiners. Dead hearth / unlit hidden pits are left to snowfall.
	ensureHearthClearing()
	ensureCraterClearing()

	if (!hydrated && synced) {
		hydrated = true
		console.log(
			`snowModel: snowModelSystem: hydrated paintTiles=${tileShadow.size} ` +
			`synced=${synced}`
		)
	}

	if (!hydrated && clockMs - lastDiagMs >= DIAG_INTERVAL_MS) {
		lastDiagMs = clockMs
		console.log(
			`snowModel: snowModelSystem: waiting ` +
			`synced=${synced} paintTiles=${seen} empty=${empty} unresolved=${unresolved} applied=${tileShadow.size}`
		)
	}

	if (pending.size > 0) expirePending()
}


/** Cells held melted by ensureHearthClearing (displayed only). */
const hearthClearingKeys = new Set<number>()


// MARK: ensureHearthClearing
/**
 * While the spawn hearth is lit, force-melt its live fuel radius in
 * displayed stages so late joiners see the ring before PaintTiles
 * arrive. Displayed-only — do not poison serverStages, or a dead
 * hearth can never be buried by snowfall after the force-melt stops.
 * When fuel hits zero (or the ring shrinks), released cells snap back
 * to the last CRDT stage and regrow with the rest of the field.
 */
function ensureHearthClearing(): void {
	const fuel = getMainFireFuel()
	const next = new Set<number>()
	if (fuel > 0) {
		collectClearingKeys(
			CAMPFIRE_WORLD_X,
			CAMPFIRE_WORLD_Z,
			hearthRadiusFromFuel(fuel),
			next,
		)
	}
	for (const key of hearthClearingKeys) {
		if (next.has(key)) continue
		pending.delete(key)
		if (displayedStages[key] === serverStages[key]) continue
		displayedStages[key] = serverStages[key]
		const tileKey = tileKeyOfCell(key)
		dirtyRoots.add(tileKey)
		urgentRoots.add(tileKey)
	}
	for (const key of next) {
		pending.delete(key)
		if (displayedStages[key] === STAGE_MELTED) continue
		displayedStages[key] = STAGE_MELTED
		const tileKey = tileKeyOfCell(key)
		dirtyRoots.add(tileKey)
		urgentRoots.add(tileKey)
	}
	hearthClearingKeys.clear()
	for (const key of next) hearthClearingKeys.add(key)
}


/** Cells held melted by ensureCraterClearing (displayed only). */
const craterClearingKeys = new Set<number>()
/** Cached crater melt footprint for the active terrain seed. */
const craterClearingTemplate = new Set<number>()
let craterClearingSeed = -1


// MARK: ensureCraterClearing
/**
 * Always force-melt the volcano caldera (lava tiles + Warm bloom at the
 * centroid + Warm pad at the summit map seat). Matches server
 * meltVolcanoCraterHeat so late joiners see crater heat before CRDT.
 * Displayed-only — does not poison serverStages.
 */
function ensureCraterClearing(): void {
	const map = activeTerrain()
	const next = new Set<number>()
	if (map) {
		if (map.usedSeed !== craterClearingSeed || craterClearingTemplate.size === 0) {
			craterClearingSeed = map.usedSeed
			craterClearingTemplate.clear()
			for (const i of volcanoLavaCells(map)) {
				const cx = i % map.w
				const cz = (i - cx) / map.w
				const tileKey = cz * SNOW_TILES_X + cx
				for (let local = 0; local < SNOW_TILE_CELL_COUNT; local++) {
					craterClearingTemplate.add(tileKey * SNOW_TILE_CELL_COUNT + local)
				}
			}
			const centre = volcanoCraterHeatCenter(map)
			if (centre) {
				collectClearingKeys(centre.x, centre.z, CRATER_HEAT_RADIUS_M, craterClearingTemplate)
			}
			const seat = pickSummitMapSeat(map)
			if (seat) {
				collectClearingKeys(seat.x, seat.z, CRATER_HEAT_RADIUS_M, craterClearingTemplate)
			}
		}
		for (const key of craterClearingTemplate) next.add(key)
	}
	for (const key of craterClearingKeys) {
		if (next.has(key)) continue
		pending.delete(key)
		if (displayedStages[key] === serverStages[key]) continue
		displayedStages[key] = serverStages[key]
		const tileKey = tileKeyOfCell(key)
		dirtyRoots.add(tileKey)
		urgentRoots.add(tileKey)
	}
	for (const key of next) {
		pending.delete(key)
		if (displayedStages[key] === STAGE_MELTED) continue
		displayedStages[key] = STAGE_MELTED
		const tileKey = tileKeyOfCell(key)
		dirtyRoots.add(tileKey)
		urgentRoots.add(tileKey)
	}
	craterClearingKeys.clear()
	for (const key of next) craterClearingKeys.add(key)
}



// MARK: collectClearingKeys
/** Add every same-level snow cell in the disc to `out`. */
function collectClearingKeys(
	cx     : number,
	cz     : number,
	radiusM: number,
	out    : Set<number>,
): void {
	const map       = activeTerrain()
	const fireLevel = map === null ? -1 : levelAtWorld(map, cx, cz)
	forEachCellInDisc(cx, cz, radiusM, (key) => {
		if (map !== null) {
			const { tx, tz } = tileCoordsFromKey(tileKeyOfCell(key))
			if (tx < 0 || tz < 0 || tx >= map.w || tz >= map.h) return
			if (map.levels[tz * map.w + tx] !== fireLevel) return
		}
		out.add(key)
	})
}


// MARK: resolveTileKey

function resolveTileKey(
	entity:        Entity,
	componentKey:  number,
): number | null {
	const max = SNOW_TILES_X * SNOW_TILES_Z
	if (Number.isInteger(componentKey) && componentKey >= 0 && componentKey < max) {
		return componentKey
	}
	const net = NetworkEntity.getOrNull(entity)
	if (net === null) return null
	const raw = Number(net.entityId)
	const key = tileKeyFromNetworkId(raw)
	if (key !== null && key < max) return key
	if (skipNetLogs < SKIP_NET_LOG_CAP) {
		skipNetLogs++
		console.log(`snowModel: resolveTileKey: tileKey=${componentKey} entityId=${raw}`)
	}
	return null
}


// MARK: applyTileBytes

function applyTileBytes(
	entity:  Entity,
	tileKey: number,
	cells:   readonly number[],
): void {
	const base = tileKey * SNOW_TILE_CELL_COUNT
	const len  = Math.min(cells.length, SNOW_TILE_CELL_COUNT)
	let shadow = tileShadow.get(entity)
	if (shadow === undefined || shadow.length !== len) {
		shadow = new Uint8Array(len)
		tileShadow.set(entity, shadow)
	}

	let changed = false
	let melted  = false
	for (let i = 0; i < len; i++) {
		const byte = cells[i] & 0xff
		if (byte === shadow[i]) continue
		shadow[i] = byte
		const stage = stageFromSnowByte(byte)
		const key   = base + i
		serverStages[key] = stage
		pending.delete(key)
		if (displayedStages[key] !== stage) {
			// Stage drop = another player's torch / a fire ring. Mark
			// urgent so the renderer does not park the rebuild behind
			// CREATE_BUDGET_PER_FRAME (local melts already use urgent
			// via setOptimisticStage; remotes used to look a beat late).
			if (stage < displayedStages[key]) melted = true
			displayedStages[key] = stage
			changed = true
		}
	}
	if (changed) dirtyRoots.add(tileKey)
	if (melted)  urgentRoots.add(tileKey)
}


// MARK: resetTileToPristine

function resetTileToPristine(tileKey: number): void {
	const base = tileKey * SNOW_TILE_CELL_COUNT
	let changed = false
	for (let i = 0; i < SNOW_TILE_CELL_COUNT; i++) {
		const key = base + i
		pending.delete(key)
		serverStages[key] = STAGE_PRISTINE
		if (displayedStages[key] !== STAGE_PRISTINE) {
			displayedStages[key] = STAGE_PRISTINE
			changed = true
		}
	}
	if (changed) dirtyRoots.add(tileKey)
}


// MARK: pruneGoneTiles

function pruneGoneTiles(live: Set<Entity>): void {
	for (const [entity, tileKey] of tileKeyByEnt) {
		if (live.has(entity)) continue
		tileKeyByEnt.delete(entity)
		tileShadow.delete(entity)
		resetTileToPristine(tileKey)
	}
}


// MARK: expirePending

function expirePending(): void {
	for (const [key, expiresAt] of pending) {
		if (clockMs < expiresAt) continue
		pending.delete(key)
		if (displayedStages[key] === serverStages[key]) continue
		displayedStages[key] = serverStages[key]
		dirtyRoots.add(tileKeyOfCell(key))
	}
}


// MARK: setOptimisticStage

/**
 * Locally show `stage` for a cell ahead of the server echo. Marks the
 * owning root urgent so the renderer handles it first. Returns true
 * when the displayed stage changed.
 */
export function setOptimisticStage(
	key:   number,
	stage: SnowStage,
): boolean {
	if (displayedStages[key] === stage) return false
	displayedStages[key] = stage
	pending.set(key, clockMs + OPTIMISTIC_TIMEOUT_MS)
	const tileKey = tileKeyOfCell(key)
	dirtyRoots.add(tileKey)
	urgentRoots.add(tileKey)
	return true
}


// MARK: getDisplayedStage

/** Stage shown for a cell (server + optimistic). */
export function getDisplayedStage(key: number): SnowStage {
	return displayedStages[key] as SnowStage
}


// MARK: getDisplayedStages

/** Backing array of displayed stages, indexed by cell key. Treat as read-only. */
export function getDisplayedStages(): Uint8Array {
	return displayedStages
}


// MARK: drainDirtyRoots

/** Move pending dirty / urgent root keys into the caller's sets. */
export function drainDirtyRoots(
	dirtyOut:  Set<number>,
	urgentOut: Set<number>,
): void {
	for (const k of dirtyRoots)  dirtyOut.add(k)
	for (const k of urgentRoots) urgentOut.add(k)
	dirtyRoots.clear()
	urgentRoots.clear()
}


// MARK: isSnowHydrated

/** True once CRDT state is synchronized. Missing PaintTiles count as pristine. */
export function isSnowHydrated(): boolean {
	return hydrated
}


// MARK: resetSnowToPristine

/**
 * World death: locally clear melt, then re-read live PaintTiles.
 * The hearth ring is often byte-identical after a reseed, so CRDT
 * will not send a new write — skipping that re-read left spawn snowed.
 */
export function resetSnowToPristine(): void {
	for (let i = 0; i < CELL_COUNT; i++) {
		if (serverStages[i] === STAGE_PRISTINE && displayedStages[i] === STAGE_PRISTINE) continue
		serverStages[i]    = STAGE_PRISTINE
		displayedStages[i] = STAGE_PRISTINE
		dirtyRoots.add(tileKeyOfCell(i))
	}
	pending.clear()
	tileShadow.clear()
	let reapplied = 0
	for (const [entity, tile] of engine.getEntitiesWith(PaintTile)) {
		const incoming = tile.cells
		if (!incoming || incoming.length === 0) continue
		let tileKey = tileKeyByEnt.get(entity)
		if (tileKey === undefined) {
			const resolved = resolveTileKey(entity, tile.tileKey)
			if (resolved === null) continue
			tileKey = resolved
			tileKeyByEnt.set(entity, tileKey)
		}
		applyTileBytes(entity, tileKey, incoming)
		reapplied++
	}
	ensureHearthClearing()
	console.log(`snowModel: resetSnowToPristine: reapplied ${reapplied} PaintTiles`)
}

