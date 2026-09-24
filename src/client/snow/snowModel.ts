/**
 * snowModel.ts — client-side snow stage per cell.
 *
 * Two layers, both flat typed arrays indexed by cell key:
 *   server    — last stage observed on the PaintTile CRDT
 *   displayed — what gameplay and the renderer read: server + local
 *               optimistic writes
 *
 * Every PaintTile change is applied straight into these arrays the frame
 * it is observed, independent of any render entity. The renderer reads
 * `displayed` and is told which 16 m roots changed; it never gates model
 * updates, so arrival order between CRDT data and render entities cannot
 * lose a change.
 *
 * Optimistic writes expire after OPTIMISTIC_TIMEOUT_MS: if the server has
 * not moved the cell by then, displayed snaps back to the server value.
 */

import { engine, Entity, NetworkEntity } from '@dcl/sdk/ecs'
import { isStateSyncronized } from '@dcl/sdk/network'

import { PaintTile } from 'src/shared/components'
import { tileKeyFromNetworkId } from 'src/shared/networkIds'
import {
	SNOW_TILE_CELL_COUNT,
	SNOW_TILES_X,
	SNOW_TILES_Z,
	SnowStage,
	STAGE_PRISTINE,
	stageFromSnowByte,
	tileKeyOfCell,
} from 'src/shared/snowGrid'

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
	for (const [entity, tile] of engine.getEntitiesWith(PaintTile)) {
		seen++
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

	if (synced && tileShadow.size > 0 && !hydrated) {
		hydrated = true
		console.log(`snowModel: snowModelSystem: hydrated from ${tileShadow.size} PaintTile entities`)
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
	for (let i = 0; i < len; i++) {
		const byte = cells[i] & 0xff
		if (byte === shadow[i]) continue
		shadow[i] = byte
		const stage = stageFromSnowByte(byte)
		const key   = base + i
		serverStages[key] = stage
		pending.delete(key)
		if (displayedStages[key] !== stage) {
			displayedStages[key] = stage
			changed = true
		}
	}
	if (changed) dirtyRoots.add(tileKey)
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

/** True once the initial CRDT state has been received and applied. */
export function isSnowHydrated(): boolean {
	return hydrated
}
