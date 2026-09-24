/**
 * snowSync.ts — server-side PaintTile CRDT buffers for the snow layer.
 *
 * One synced entity per snow tile carries a byte per cell (see
 * snowGrid.snowByteFromStage). Bytes are mutated in memory; only dirty
 * tiles are published, once per engine tick, via flushDirtySnowTiles().
 *
 * syncEntity needs myProfile.networkId, which resolves asynchronously.
 * Entities created before that are retried on every flush and relink.
 */

import { engine, Entity, NetworkEntity } from '@dcl/sdk/ecs'
import { myProfile, syncEntity } from '@dcl/sdk/network'

import { PaintCoverage, PaintTile } from 'src/shared/components'
import { COVERAGE_NETWORK_ID, tileNetworkId } from 'src/shared/networkIds'
import {
	SNOW_TILE_CELL_COUNT,
	localIndexOfCell,
	tileKeyOfCell,
} from 'src/shared/snowGrid'

const tileEntities = new Map<number, Entity>()
const tileBuffers  = new Map<number, number[]>()
const dirtyTiles   = new Set<number>()

let coverageEntity: Entity | null = null
let nonZeroCells   = 0


// MARK: trySync

function trySync(
	entity:       Entity,
	componentIds: number[],
	networkId:    number,
): void {
	if (NetworkEntity.getOrNull(entity) !== null) return
	if (!myProfile?.networkId) return
	try {
		syncEntity(entity, componentIds, networkId)
	} catch (err) {
		console.error(`snowSync: trySync: syncEntity@${networkId} failed:`, err)
	}
}


// MARK: ensureTile

function ensureTile(tileKey: number): number[] {
	let buf = tileBuffers.get(tileKey)
	if (buf !== undefined) return buf
	buf = new Array<number>(SNOW_TILE_CELL_COUNT).fill(0)
	const entity = engine.addEntity()
	PaintTile.create(entity, { cells: buf.slice() })
	tileBuffers.set(tileKey, buf)
	tileEntities.set(tileKey, entity)
	trySync(entity, [PaintTile.componentId], tileNetworkId(tileKey))
	return buf
}


// MARK: initSnowSync

/** Create the coverage singleton. Call once from setupServer. */
export function initSnowSync(): void {
	if (coverageEntity !== null) return
	coverageEntity = engine.addEntity()
	PaintCoverage.create(coverageEntity, { red: 0, blue: 0, total: 0 })
	trySync(coverageEntity, [PaintCoverage.componentId], COVERAGE_NETWORK_ID)
}


// MARK: writeSnowByte

/**
 * Write the wire byte for a cell. Marks its tile dirty on change.
 * Returns true when the byte changed.
 */
export function writeSnowByte(
	key:  number,
	byte: number,
): boolean {
	const tileKey = tileKeyOfCell(key)
	const idx     = localIndexOfCell(key)
	const buf     = ensureTile(tileKey)
	const prev    = buf[idx]
	if (prev === byte) return false
	if (prev === 0 && byte !== 0)      nonZeroCells++
	else if (prev !== 0 && byte === 0) nonZeroCells--
	buf[idx] = byte
	dirtyTiles.add(tileKey)
	return true
}


// MARK: flushDirtySnowTiles

/** Publish every dirty tile buffer. Call once per server tick. Returns tiles flushed. */
export function flushDirtySnowTiles(): number {
	if (dirtyTiles.size === 0) return 0
	let flushed = 0
	for (const tileKey of dirtyTiles) {
		const entity = tileEntities.get(tileKey)
		const buf    = tileBuffers.get(tileKey)
		if (entity === undefined || buf === undefined) {
			console.error(`snowSync: flushDirtySnowTiles: tile ${tileKey} marked dirty but never allocated`)
			continue
		}
		PaintTile.createOrReplace(entity, { cells: buf.slice() })
		trySync(entity, [PaintTile.componentId], tileNetworkId(tileKey))
		flushed++
	}
	dirtyTiles.clear()
	return flushed
}


// MARK: zeroAllSnowTiles

/** Reset every allocated tile to pristine and mark changed tiles dirty. */
export function zeroAllSnowTiles(): void {
	for (const [tileKey, buf] of tileBuffers) {
		let changed = false
		for (let i = 0; i < buf.length; i++) {
			if (buf[i] !== 0) { buf[i] = 0; changed = true }
		}
		if (changed) dirtyTiles.add(tileKey)
	}
	nonZeroCells = 0
}


// MARK: publishSnowCoverage

/** Write the melted-cell count to PaintCoverage (blue = melted, for the legacy HUD). */
export function publishSnowCoverage(meltedCells: number): void {
	if (coverageEntity === null) {
		console.error('snowSync: publishSnowCoverage: called before initSnowSync')
		return
	}
	PaintCoverage.createOrReplace(coverageEntity, { red: 0, blue: meltedCells, total: meltedCells })
}


// MARK: relinkSnowSync

/** Retry syncEntity for every entity created before the profile was ready. */
export function relinkSnowSync(): void {
	if (coverageEntity !== null) {
		trySync(coverageEntity, [PaintCoverage.componentId], COVERAGE_NETWORK_ID)
	}
	for (const [tileKey, entity] of tileEntities) {
		trySync(entity, [PaintTile.componentId], tileNetworkId(tileKey))
	}
}


// MARK: nonZeroSnowCells

/** Cells whose wire byte is non-zero (melted or regrowing). */
export function nonZeroSnowCells(): number {
	return nonZeroCells
}


// MARK: snowTileEntityCount

/** Tile entities allocated so far. */
export function snowTileEntityCount(): number {
	return tileEntities.size
}
