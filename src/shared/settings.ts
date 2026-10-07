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


// MARK: Scene / world profile
//
// One generator, two envelopes. Flip WORLD_PROFILE to restore the
// full Live World footprint without forking terrainGen.

export type WorldProfile = 'playtest_52' | 'full_100'

/**
 * Active world envelope.
 * - playtest_52: 52×52 parcels (832 m). Padding squeezed to 0 so the
 *   playfield sits against scene bounds; mountain band lives on the
 *   terrain-grid rim itself.
 * - full_100: 100×100 parcels (1600 m) with 16 m padding/side → 98×98 cells.
 */
export const WORLD_PROFILE: WorldProfile = 'playtest_52'

const WORLD_PROFILE_SPEC: Record<WorldProfile, {
	parcels: number
	/** Meters of empty padding on each side between playfield and scene edge. */
	paddingMeters: number
}> = {
	playtest_52: { parcels: 52, paddingMeters: 0 },
	full_100:    { parcels: 100, paddingMeters: 16 },
}

const _world = WORLD_PROFILE_SPEC[WORLD_PROFILE]

/** Parcel edge length in meters (one unscaled maze tile). */
const PARCEL_METERS = 16

/** Scene X extent in meters. Aligns with parcel X axis. */
export const SCENE_WORLD_SIZE_X_METERS = _world.parcels * PARCEL_METERS

/** Scene Z extent in meters. Aligns with parcel Y axis (world Z). */
export const SCENE_WORLD_SIZE_Z_METERS = _world.parcels * PARCEL_METERS

/**
 * Interior playfield extent in meters. The maze, paint grid, and
 * campfire live inside this playfield. With playtest_52 padding=0 the
 * playfield fills the scene; the generated mountain band is the rim.
 *
 * full_100 keeps 16 m padding/side so scene=1600 → playfield=1568 →
 * 98 × 98 terrain/snow cells.
 */
export const MAZE_PLAYFIELD_METERS =
	SCENE_WORLD_SIZE_X_METERS - 2 * _world.paddingMeters

/**
 * Major grove destination sockets (Low + Mid + High). Hearth home is
 * not a grove. The volcano landmark can share the High shelf with the
 * High grove (separate socket) — it is still not itself a grove.
 */
export const MAJOR_GROVE_COUNT = 3

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


// MARK: Terrain
// Elevation grid shared by client and server. See design/terrain-plan.md.

/** Edge length of one terrain cell in meters (one snow tile). */
export const TERRAIN_CELL_M = MAZE_TILE_WORLD_METERS

/** Terrain grid width (X) in cells. Matches the snow tile grid. */
export const TERRAIN_GRID_W = MAZE_GRID_WIDTH

/** Terrain grid height (Z) in cells. Matches the snow tile grid. */
export const TERRAIN_GRID_H = MAZE_GRID_HEIGHT

/** Vertical distance between terrain levels. Too tall to jump. */
export const TERRAIN_LEVEL_STEP_M = 16

/** Walkable surface height of level 0, matching the old flat ground. */
export const TERRAIN_BASE_SURFACE_Y = 0.25

/** Lowest walkable level (basins, canyons). */
export const TERRAIN_LEVEL_LOW      = 0
/** Hearth level. One level above, one below. */
export const TERRAIN_LEVEL_MID      = 1
/** High plateaus / ridges (below the volcano summit). */
export const TERRAIN_LEVEL_HIGH     = 2
/**
 * Volcano caldera rim — highest walkable (and highest overall) surface.
 * One step above HIGH so ladders still connect High slopes ↔ rim.
 */
export const TERRAIN_LEVEL_VOLCANO_RIM = 3
/**
 * Impassable mountain band base. Starts above the volcano rim index so
 * the summit stays walkable; heights are capped below the rim so the
 * volcano reads as the high point of the map.
 */
export const TERRAIN_LEVEL_MOUNTAIN = 4
/** Extra mountain peak steps above the base rim (levels 5, 6, …). */
export const TERRAIN_MOUNTAIN_PEAK_STEPS = 2
/** Highest mountain peak level index. */
export const TERRAIN_LEVEL_MOUNTAIN_MAX =
	TERRAIN_LEVEL_MOUNTAIN + TERRAIN_MOUNTAIN_PEAK_STEPS
/**
 * Vertical step between mountain peak tiers. Finer than the walkable
 * 16 m step so the horizon reads as jagged rock, not another plateau.
 */
export const TERRAIN_MOUNTAIN_STEP_M = 8
/**
 * Volcano crown: the inner crater lip extruded above the rim. Levels
 * CROWN..CROWN_MAX sit after the mountain tiers, so isMountainLevel()
 * treats them as impassable (no routing, no props, no melt cap) while
 * the slab renderer and snow tiles draw them at their true height.
 */
export const TERRAIN_LEVEL_CROWN      = TERRAIN_LEVEL_MOUNTAIN_MAX + 1
/** Crown height tiers (jagged lip): rim + 5 / 6 / 7 m. */
export const TERRAIN_CROWN_STEPS      = 3
export const TERRAIN_LEVEL_CROWN_MAX  = TERRAIN_LEVEL_CROWN + TERRAIN_CROWN_STEPS - 1
/** Lowest crown tier above the rim surface (m), then +1 m per tier. */
export const TERRAIN_CROWN_BASE_M     = 5
export const TERRAIN_CROWN_STEP_M     = 1
/**
 * Lava lid above the rim surface. Max snow stage is 1.5 m, so the lid
 * hides any snow on the crater cells; ground queries on lava cells
 * report this height (it is the surface you stand on).
 */
export const VOLCANO_LAVA_TOP_ABOVE_RIM_M = 1.7


// MARK: isCrownLevel
/** True for the extruded volcano crown tiers. */
export function isCrownLevel(level: number): boolean {
	return level >= TERRAIN_LEVEL_CROWN && level <= TERRAIN_LEVEL_CROWN_MAX
}


// MARK: isMountainLevel
/**
 * True for the impassable perimeter band and its peak tiers, plus the
 * extruded volcano crown tiers. The volcano rim (VOLCANO_RIM) is
 * walkable and is NOT mountain.
 */
export function isMountainLevel(level: number): boolean {
	return level >= TERRAIN_LEVEL_MOUNTAIN
}


// MARK: groundYForLevel
/**
 * Surface height of a terrain level.
 * Walkable 0..VOLCANO_RIM use the 16 m step (rim = 48.25 m).
 * Mountain peaks sit between HIGH and the rim so the caldera lip is
 * always the highest point on the map.
 */
export function groundYForLevel(level: number): number {
	if (level <= TERRAIN_LEVEL_VOLCANO_RIM) {
		return TERRAIN_BASE_SURFACE_Y + level * TERRAIN_LEVEL_STEP_M
	}
	if (isCrownLevel(level)) {
		// Crown: highest terrain on the map (rim + 5..7 m = 53.25..55.25).
		return TERRAIN_BASE_SURFACE_Y + TERRAIN_LEVEL_VOLCANO_RIM * TERRAIN_LEVEL_STEP_M +
			TERRAIN_CROWN_BASE_M + (level - TERRAIN_LEVEL_CROWN) * TERRAIN_CROWN_STEP_M
	}
	const highY = TERRAIN_BASE_SURFACE_Y + TERRAIN_LEVEL_HIGH * TERRAIN_LEVEL_STEP_M
	const rimY  = TERRAIN_BASE_SURFACE_Y + TERRAIN_LEVEL_VOLCANO_RIM * TERRAIN_LEVEL_STEP_M
	const peak  = Math.max(0, level - TERRAIN_LEVEL_MOUNTAIN)
	const steps = Math.max(1, TERRAIN_MOUNTAIN_PEAK_STEPS)
	// Spread peaks across (HIGH+step) .. (RIM - 2 m).
	const lo = highY + TERRAIN_MOUNTAIN_STEP_M
	const hi = rimY - 2
	return lo + (peak / steps) * (hi - lo)
}


/** Walkable surface height of the hearth level. The scene's default ground. */
export const TERRAIN_HEARTH_SURFACE_Y = groundYForLevel(TERRAIN_LEVEL_MID)


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

/**
 * Spawn tiles whose centre is within this many meters of the local player.
 *
 * Sized as prefetch headroom on top of the visible ring: the sliced cell
 * spawner (paint.ts CELLS_PER_FRAME) takes ~10-15 frames to fully populate
 * a tile, and at ~4-5 m/s walking speed 12 m of extra buffer gives ~2-3 s
 * for that work to finish before the tile is visually relevant. Result:
 * cubes are already in place by the time the player is close enough to
 * distinguish them from the far-plane LOD.
 */
export const CELL_STREAM_IN_RADIUS_M  = 40

/** Despawn tiles whose centre exceeds this many meters from the local player. */
export const CELL_STREAM_OUT_RADIUS_M = 48

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
