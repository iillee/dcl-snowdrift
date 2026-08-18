/**
 * components.ts — shared ECS component definitions.
 *
 * MUST be statically imported from src/index.ts so defineComponent() runs
 * before main() seals the engine.
 *
 * Schemas are shared. Server-owned entities (PaintCoverage,
 * PaletteEntry, PaintTile) are created + syncEntity'd only on the server.
 * Clients observe replicas — they must not syncEntity those.
 *
 * SeedHolder remains client-authored until seed ownership moves server-side.
 */

import { engine, Schemas } from '@dcl/sdk/ecs'

// MARK: SeedHolder
export const SeedHolder = engine.defineComponent('maze::seed-holder', { seed: Schemas.Int })
export const seedHolder = engine.addEntity()
SeedHolder.create(seedHolder, { seed: 0 })

// MARK: PaintTile
// A single synced entity carries the packed state of ALL cells inside
// one (tx, tz, level) tile chunk. This replaces the previous 1-entity-
// per-painted-cell design that overwhelmed the CRDT transport once
// coverage exceeded a few hundred cells.
//
// cells[i] byte layout:
//   bits 0..1 = stage (0..2). Stage 3 (full snow) is represented by
//               setting index back to 0 and clearing stage — never
//               written explicitly, matching the old per-cell contract.
//   bits 2..7 = palette index (0..MAX_PALETTE_INDEX = 63).
// A zero byte means "unpainted, full snow" — the natural initial state
// of a freshly-created tile buffer.
//
// Local cell index inside the array is `row * PAINT_SIZE + col`, matching
// packCellKey()'s intra-tile ordinal (see paintGrid.ts splitCellKey).
export const PaintTile = engine.defineComponent('paint::tile', {
	cells: Schemas.Array(Schemas.Byte),
})

// MARK: PaletteEntry
export const PaletteEntry = engine.defineComponent('paint::palette-entry', {
	index: Schemas.Byte,
	color: Schemas.Color4,
})

// MARK: PaintCoverage
export const PaintCoverage = engine.defineComponent('paint::coverage', {
	red:   Schemas.Int,
	blue:  Schemas.Int,
	total: Schemas.Int,
})

// MARK: ServerStats
// Rate-limited debug snapshot. Server writes at SERVER_STATS_PUBLISH_HZ;
// clients only read. Not used for gameplay.
export const ServerStats = engine.defineComponent('server::stats', {
	tiles:             Schemas.Int,
	paintResolution:   Schemas.Int,
	activeComponents:  Schemas.Int,
	maxComponents:     Schemas.Int,
	paintedCells:      Schemas.Int,
	totalChanges:      Schemas.Int,
	changesLast1s:     Schemas.Int,
	changesLast10s:    Schemas.Int,
	changesLast60s:    Schemas.Int,
})
