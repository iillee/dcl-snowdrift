/**
 * settings.ts — single source of truth for world / maze / paint knobs.
 *
 * PERFORMANCE TUNING: change only the two constants under
 * "Performance tuning" below. Maze / scene geometry rarely moves; paint
 * resolution is what you dial when measuring CRDT / component load.
 *
 * Names are prefixed (SCENE_ / MAZE_ / PAINT_) so they stay unambiguous
 * when mixed with domain-local aliases (CELL, STEP, etc.).
 *
 * Safe for client and server — pure constants, no engine imports.
 */

// MARK: Debug vars
// Bundler inlines process.env.NODE_ENV when present; guard for runtimes
// (e.g. headless server) where `process` is undefined.
declare var process: { env: { NODE_ENV?: string } } | undefined

export const IS_DEV =
	typeof process !== 'undefined' && process.env?.NODE_ENV === 'development'


// =============================================================================
// MARK: Performance tuning
// Edit THESE when measuring paint / CRDT load.
// Higher PAINT_CELLS_PER_TILE_AXIS → smaller cells → more component updates.
// Brush is in world meters so the painted footprint stays roughly constant
// when you change resolution (cells are derived further down).
// =============================================================================

/**
 * Paint cells along one edge of a maze tile.
 * Cell world size = maze tile world meters / this value.
 *
 * MUST be a multiple of 16 — the tile GLBs bake a 20/32 corridor ratio,
 * and ARM = SIZE * 20/32, LO = SIZE * 3/16 only quantize to integers at
 * multiples of 16. Non-multiples produce fractional mask indices that
 * misalign paint with the physical corridor.
 *
 * Examples (with current 16 m maze tiles at TILE_SCALE=1):
 *   16 → 1 m cells   (canvas baseline, matches pixelwars mask exactly)
 *   32 → 0.5 m cells (finer detail, ~4× entity count)
 */
export const PAINT_CELLS_PER_TILE_AXIS = 16

/**
 * Target brush diameter in world meters. Converted to an odd cell count
 * from the paint cell size so players cover a similar area at any
 * resolution. Baseline matches squareoff's 3×3 at 2 m cells (= 6 m).
 */
export const PAINT_BRUSH_SIZE_METERS = 3

/**
 * Distance in world meters to project the paint brush ahead of the player
 * along their facing direction. Gives the melt a small lead so cells clear
 * just before the player walks over them, rather than under their feet.
 */
export const PAINT_BRUSH_LEAD_METERS = 1.2


// MARK: Scene

/** Scene X extent in meters (16 parcels × 16 m). Aligns with parcel X axis. */
export const SCENE_WORLD_SIZE_X_METERS = 512

/** Scene Z extent in meters (16 parcels × 16 m). Aligns with parcel Y axis (world Z). */
export const SCENE_WORLD_SIZE_Z_METERS = 512

/**
 * Interior playfield extent in meters. The maze, paint grid, and
 * campfire live inside this playfield; the outer scene padding is
 * used by the perimeter (cliffs) ring.
 *
 * Sizing rule for cliff-cap intrusions: perimeter fork caps sit at
 * ~96 m from each scene edge (one perim tile + half-cap). For those
 * caps to actually poke into the playfield (so the maze retreats
 * around them via setReservedCells), this value must be > 320 in a
 * 512 m scene. Below that the caps land flush against the boundary
 * and the reservation set is empty (system dormant).
 *
 *   256 → dormant (empty ring 64 m, caps stop at playfield edge)
 *   320 → mild    (empty ring 32 m, caps intrude 1 edge cell)
 *   384 → strong  (empty ring 0 m,  caps intrude 2 cells deep)
 */
export const MAZE_PLAYFIELD_METERS = 480

/**
 * Back-compat alias for square-scene call sites. Use the axis-specific
 * constants above for anything that touches maze geometry.
 */
export const SCENE_WORLD_SIZE_METERS = SCENE_WORLD_SIZE_X_METERS


// MARK: Maze tiles

/**
 * Uniform scale applied to maze tile GLBs.
 * 1 → 16 m tiles (parcel-sized). 16 m fits both 256 and 144 evenly → no
 * border on either axis. 2 → 32 m tiles (pixelwars original).
 */
export const MAZE_TILE_GLTF_SCALE = 1

/** Unscaled tile footprint in meters (one parcel edge). */
export const MAZE_TILE_UNSCALED_METERS = 16

/** World-space size of one maze tile after GLTF scale. */
export const MAZE_TILE_WORLD_METERS = MAZE_TILE_UNSCALED_METERS * MAZE_TILE_GLTF_SCALE

/** Unscaled ramp floor-to-floor rise baked into the tile GLBs. */
export const MAZE_RAMP_STEP_UNSCALED_METERS = 5.3835

/** World-space Y rise per ramp after GLTF scale. */
export const MAZE_RAMP_STEP_METERS = MAZE_RAMP_STEP_UNSCALED_METERS * MAZE_TILE_GLTF_SCALE

/**
 * Cap on stacked tile Y (meters). Flat canvas: 0 outlaws any ramp (its high
 * side would sit at y+STEP > 0 and canPlace rejects it up front).
 */
export const MAZE_MAX_STACK_Y_METERS = 0

/** Inclusive max stack level index (0 .. this). */
export const MAZE_MAX_LEVEL_INDEX = Math.floor(MAZE_MAX_STACK_Y_METERS / MAZE_RAMP_STEP_METERS)

/** Maze tile grid width (X), derived from playfield X ÷ tile world size. */
export const MAZE_GRID_WIDTH = Math.floor(MAZE_PLAYFIELD_METERS / MAZE_TILE_WORLD_METERS)

/** Maze tile grid height (Z), derived from playfield Z ÷ tile world size. */
export const MAZE_GRID_HEIGHT = Math.floor(MAZE_PLAYFIELD_METERS / MAZE_TILE_WORLD_METERS)

/**
 * World offset applied to every tile position on BOTH axes. Shifts the
 * interior playfield into the centre of the scene so a perimeter ring
 * fits between the playfield and the scene bounds.
 * = (scene - playfield) / 2. With scene=256 and playfield=128, offset=64.
 */
export const MAZE_ORIGIN_OFFSET_METERS = (SCENE_WORLD_SIZE_X_METERS - MAZE_PLAYFIELD_METERS) / 2


// MARK: Playfield bounds
/** Playfield min world coord (both axes — playfield is square). */
export const PLAYFIELD_MIN_M = MAZE_ORIGIN_OFFSET_METERS
/** Playfield max world coord. */
export const PLAYFIELD_MAX_M = MAZE_ORIGIN_OFFSET_METERS + MAZE_PLAYFIELD_METERS

/**
 * True when a world (x, z) sits inside the interior playfield rectangle.
 * Used by the perimeter cliff generator to skip end-caps that would
 * intrude into the snow-tile area — snow tiles are authoritative there.
 */
export function isInsidePlayfield(x: number, z: number): boolean {
	return x >= PLAYFIELD_MIN_M && x <= PLAYFIELD_MAX_M
		&& z >= PLAYFIELD_MIN_M && z <= PLAYFIELD_MAX_M
}


// MARK: Paint (derived from performance knobs + maze tile size)

/** World-space edge length of one paint cell (meters). */
export const PAINT_CELL_SIZE_METERS =
	MAZE_TILE_WORLD_METERS / PAINT_CELLS_PER_TILE_AXIS


// MARK: oddBrushCells

/**
 * Round a meter brush span to an odd cell count (≥ 1) so the footprint
 * stays centered on the player.
 */
function oddBrushCells(
	brushMeters: number,
	cellMeters:  number,
): number {
	const raw = Math.max(1, Math.round(brushMeters / cellMeters))
	return raw % 2 === 0 ? raw + 1 : raw
}

/**
 * Default player brush footprint as an odd square of paint cells
 * (e.g. 3 → 3×3). Derived from PAINT_BRUSH_SIZE_METERS.
 */
export const PAINT_BRUSH_SIZE_CELLS = oddBrushCells(
	PAINT_BRUSH_SIZE_METERS,
	PAINT_CELL_SIZE_METERS,
)

// MARK: Paint cell streaming
//
// Distance-based cell spawn/despawn per tile. Cells only exist while the
// LOCAL player is within IN_RADIUS of the tile centre; they tear down
// past OUT_RADIUS. Hysteresis (OUT > IN) prevents churn at the boundary.
//
// Choose IN comfortably larger than one tile (16 m) so the tile the
// player stands on plus its 8 neighbours are always live. Choose OUT
// large enough that a normal walking speed does not oscillate the gate.

/** Spawn tiles whose centre is within this many meters of the local player. */
export const CELL_STREAM_IN_RADIUS_M  = 28

/** Despawn tiles whose centre exceeds this many meters from the local player. */
export const CELL_STREAM_OUT_RADIUS_M = 36

/**
 * Streaming gate poll frequency (Hz). Cheap — walks a small tile map
 * and does one distance check per tile. 4 Hz is smooth enough that the
 * gate never lags a walking player past OUT_RADIUS before firing.
 */
export const CELL_STREAM_POLL_HZ = 4


/**
 * Client → server paintTick flush rate. Inbound room traffic is capped per
 * peer (~300/s); this stays well under that. Not tied to scene population.
 */
export const PAINT_TICK_HZ = 10

/**
 * Max cell ids per paintTick message. One brush footprint plus headroom.
 * Client chunks the outbox to this size; server drops oversized ticks.
 */
// Sized for the largest runtime brush (11x11 = 121 cells) plus headroom,
// so a single frame's footprint always fits in one paintTick message.
export const PAINT_TICK_MAX_IDS = 11 * 11 + 16


// MARK: Server publish rates
// In-memory game state may change every paintTick; CRDT component writes
// are coalesced to these rates so the sync bus is not saturated.

/**
 * How often the server writes PaintCoverage to the CRDT (Hz).
 * Only publishes when coverage is dirty.
 */
export const PAINT_COVERAGE_PUBLISH_HZ = 5

/** How often the server writes ServerStats to the CRDT (Hz). */
export const SERVER_STATS_PUBLISH_HZ = 1
