/**
 * snowSync.ts — server-side PaintTile CRDT buffers for the snow layer.
 *
 * Tiles are created on first melt and then kept. A fully-pristine buffer
 * is published as zeros rather than removeEntity: dropping a fixed
 * tileNetworkId and later recreating it fails to sync, so client melt
 * expires after the optimistic timeout and snow appears to grow back.
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
	SNOW_TILES_X,
	SNOW_TILES_Z,
	STAGE_MELTED,
	localIndexOfCell,
	snowByteFromStage,
	tileKeyOfCell,
} from 'src/shared/snowGrid'

const tileEntities = new Map<number, Entity>()
const tileBuffers  = new Map<number, number[]>()
const dirtyTiles   = new Set<number>()

/**
 * Per-tick publish budget. A world thaw dirties every tile on the map
 * (52x52 = 2704 tiles x 256 cells); publishing them in one tick created
 * thousands of synced entities in a single CRDT burst, which stalled the
 * room and froze the client (torch, ladders, fires, actions). Leftover
 * dirty tiles carry over to the next tick.
 */
const FLUSH_BUDGET_PER_TICK = 32
/**
 * World-thaw melt wave: seconds for the expanding melt radius to travel
 * from the volcano to the farthest tile on the map. Tune here.
 */
export const THAW_WAVE_DURATION_S = 45
/** Hard cap on tiles painted per tick, in case of a long server hitch. */
const THAW_FILL_MAX_PER_TICK = 32
/** Pending world-thaw tile keys, nearest-first, with distance in tiles. */
let thawQueue: number[] = []
let thawDist: number[] = []
let thawQueueHead = 0
let thawStartMs = 0
let thawMaxDist = 1

let coverageEntity: Entity | null = null
let nonZeroCells    = 0
let profileWasReady = false
/** Incremented on a full republish so late joiners receive a real CRDT write. */
let tileStamp       = 1


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
	PaintTile.create(entity, { cells: buf.slice(), tileKey, stamp: tileStamp })
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
	if (byte === 0 && !tileBuffers.has(tileKey)) return false
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
	stepThawFill()
	if (dirtyTiles.size === 0) return 0
	let flushed = 0
	const done: number[] = []
	for (const tileKey of dirtyTiles) {
		if (flushed >= FLUSH_BUDGET_PER_TICK) break
		done.push(tileKey)
		const entity = tileEntities.get(tileKey)
		const buf    = tileBuffers.get(tileKey)
		if (entity === undefined || buf === undefined) {
			console.error(`snowSync: flushDirtySnowTiles: tile ${tileKey} marked dirty but never allocated`)
			continue
		}
		PaintTile.createOrReplace(entity, { cells: buf.slice(), tileKey, stamp: tileStamp })
		trySync(entity, [PaintTile.componentId], tileNetworkId(tileKey))
		flushed++
	}
	for (const k of done) dirtyTiles.delete(k)
	return flushed
}


// MARK: stepThawFill
/** Paint every queued thaw tile the expanding wave radius has reached. */
function stepThawFill(): void {
	if (thawQueueHead >= thawQueue.length) return
	const meltedByte = snowByteFromStage(STAGE_MELTED)
	const radius = thawWaveRadiusTiles()
	let painted = 0
	for (; thawQueueHead < thawQueue.length; thawQueueHead++) {
		if (thawDist[thawQueueHead] > radius) break
		if (painted >= THAW_FILL_MAX_PER_TICK) break
		painted++
		const tileKey = thawQueue[thawQueueHead]
		const buf = ensureTile(tileKey)
		for (let i = 0; i < buf.length; i++) {
			if (buf[i] === 0 && meltedByte !== 0) nonZeroCells++
			else if (buf[i] !== 0 && meltedByte === 0) nonZeroCells--
			buf[i] = meltedByte
		}
		dirtyTiles.add(tileKey)
	}
	if (thawQueueHead >= thawQueue.length) {
		console.log(`snowSync: stepThawFill: thaw fill complete (${thawQueue.length} tiles)`)
		thawQueue = []
		thawDist = []
		thawQueueHead = 0
	}
}


// MARK: thawWaveRadiusTiles
/** Current melt-wave radius in tiles (grows linearly over THAW_WAVE_DURATION_S). */
function thawWaveRadiusTiles(): number {
	const t = (Date.now() - thawStartMs) / (THAW_WAVE_DURATION_S * 1000)
	return t >= 1 ? Number.POSITIVE_INFINITY : Math.max(0, t) * thawMaxDist
}


/** True while a world-thaw fill or a tile backlog is still publishing. */
export function snowPublishBacklog(): number {
	return dirtyTiles.size + (thawQueue.length - thawQueueHead)
}



// MARK: fillAllSnowTilesMelted
/**
 * World thaw: queue every snow tile to be painted melted (stage 0),
 * nearest-first from `centre` (tile coords, e.g. the volcano). The fill
 * and publish follow an expanding radius over THAW_WAVE_DURATION_S
 * (stepThawFill), so the thaw is a visible wave, never one CRDT burst. Returns tile count.
 */
export function fillAllSnowTilesMelted(centre?: { tx: number; tz: number }): number {
	const tileCount = SNOW_TILES_X * SNOW_TILES_Z
	const cx = centre ? centre.tx : (SNOW_TILES_X - 1) / 2
	const cz = centre ? centre.tz : (SNOW_TILES_Z - 1) / 2
	const keys: Array<{ k: number; d: number }> = []
	for (let tileKey = 0; tileKey < tileCount; tileKey++) {
		const tx = tileKey % SNOW_TILES_X
		const tz = (tileKey - tx) / SNOW_TILES_X
		keys.push({ k: tileKey, d: (tx - cx) * (tx - cx) + (tz - cz) * (tz - cz) })
	}
	keys.sort((a, b) => a.d - b.d)
	thawQueue = keys.map((e) => e.k)
	thawDist  = keys.map((e) => Math.sqrt(e.d))
	thawMaxDist = Math.max(1, thawDist[thawDist.length - 1] ?? 1)
	thawStartMs = Date.now()
	thawQueueHead = 0
	console.log(
		`snowSync: fillAllSnowTilesMelted: wave ${tileCount} tiles from ` +
		`(${cx},${cz}) over ${THAW_WAVE_DURATION_S}s (max ${thawMaxDist.toFixed(1)} tiles)`,
	)
	return tileCount
}

// MARK: zeroAllSnowTiles

/** World reset: keep tile entities, zero buffers, mark dirty. */
export function zeroAllSnowTiles(): void {
	thawQueue = []
	thawDist = []
	thawQueueHead = 0
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


// MARK: republishAllSnowTiles

/**
 * Write every allocated tile buffer back onto its entity and retry
 * syncEntity. Used when the profile first becomes ready and again on
 * joinRoster so a preview client does not hydrate from the empty
 * create() snapshot.
 */
export function republishAllSnowTiles(): number {
	tileStamp++
	if (coverageEntity !== null) {
		trySync(coverageEntity, [PaintCoverage.componentId], COVERAGE_NETWORK_ID)
	}
	// Queue rather than write inline: after a world thaw every tile is
	// allocated, and a late joiner's joinRoster/snowResync would otherwise
	// republish all of them in one burst. flushDirtySnowTiles drains it
	// under FLUSH_BUDGET_PER_TICK with the new stamp.
	let n = 0
	for (const tileKey of tileEntities.keys()) {
		if (!tileBuffers.has(tileKey)) {
			console.error(`snowSync: republishAllSnowTiles: tile ${tileKey} has an entity but no buffer`)
			continue
		}
		dirtyTiles.add(tileKey)
		n++
	}
	console.log(`snowSync: republishAllSnowTiles: queued ${n} tiles at stamp ${tileStamp}`)
	return n
}


// MARK: relinkSnowSync

/** Retry syncEntity for every entity created before the profile was ready. */
export function relinkSnowSync(): void {
	if (coverageEntity !== null) {
		trySync(coverageEntity, [PaintCoverage.componentId], COVERAGE_NETWORK_ID)
	}
	for (const [tileKey, entity] of tileEntities) {
		const wasUnlinked = NetworkEntity.getOrNull(entity) === null
		trySync(entity, [PaintTile.componentId], tileNetworkId(tileKey))
		// First successful link after a pre-profile write: republish so the
		// snapshot is the current buffer, not the empty create().
		if (wasUnlinked && NetworkEntity.getOrNull(entity) !== null) {
			const buf = tileBuffers.get(tileKey)
			if (buf !== undefined) {
				PaintTile.createOrReplace(entity, { cells: buf.slice(), tileKey, stamp: tileStamp })
			}
			console.log(`snowSync: relinkSnowSync: linked tile ${tileKey} and republished`)
		}
	}
	// Already-linked tiles can still be holding the empty create()
	// snapshot if they synced before the seed flush. One full republish
	// when the profile first appears closes that hole.
	if (!profileWasReady && myProfile?.networkId) {
		profileWasReady = true
		const n = republishAllSnowTiles()
		console.log(`snowSync: relinkSnowSync: profile ready, republished ${n} tiles`)
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
