/**
 * camp.ts — shared placement + tuning for the distant pilgrimage camp.
 *
 * A single "outskirts" camp sits at a deterministic per-cycle position
 * ~120 m from the central hearth. This is the mid-length goal of the
 * game per docs/gameloop-vision.md §16 — reach the camp before your
 * torch dies, alone or by chain-lighting with strangers.
 *
 * Placement model (mirrors src/shared/hiddenCampfire.ts):
 *   - Direction (angle around central hearth) is derived from the
 *     current cycle seed. Distance is fixed (see CAMP_DISTANCE_M).
 *   - Both server and client compute the same world position locally
 *     from the seed — no network sync needed. On cycle rollover the
 *     seed changes, position derivation returns a new point, and the
 *     client's onCycleSeedChange handler tears down + respawns the
 *     camp entities at the new location.
 *
 * V1 scope: camp is always lit, no ignite state, no burnout. It is a
 * fixture of the world during its cycle. Later work adds arrival
 * detection, snowshoes reward, sign entity, and warm-wind return
 * teleport — none of which are here yet.
 */

import { CAMPFIRE_MELT_RADIUS_M } from 'src/shared/campfire'
import { isPointOnCliff, setPerimeterSeed } from 'src/shared/perimeter'
import {
	MAZE_GRID_HEIGHT,
	MAZE_GRID_WIDTH,
	MAZE_ORIGIN_OFFSET_METERS,
	MAZE_TILE_WORLD_METERS,
	PLAYFIELD_MAX_M,
	PLAYFIELD_MIN_M,
} from 'src/shared/settings'


// MARK: Melt tuning
/**
 * Camp melt-ring radius. Cloned from the central hearth's baseline
 * (`CAMPFIRE_MELT_RADIUS_M`, 8 m == tier 3 "Warm") so arriving at the
 * camp feels equivalent to standing by the central fire. Broken out as
 * a distinct constant so we can tune camp warmth independently later
 * (e.g. narrower to encourage clustering, or wider to make the camp
 * feel like a proper sanctuary) without touching the central hearth.
 */
export const CAMP_MELT_RADIUS_M    = CAMPFIRE_MELT_RADIUS_M
export const CAMP_MELT_RADIUS_SQ_M = CAMP_MELT_RADIUS_M * CAMP_MELT_RADIUS_M


// MARK: Distance tuning
/**
 * Radial distance (metres) from the central hearth to the camp. Sits
 * beyond the mobile fog line (fade at 76 m, full fog at 100 m) so the
 * camp itself is invisible from spawn — only the tall vertical beacon
 * (to be added in P2) will punch through the fog. Vision §16.9 locks
 * the starting value at 120 m; tune based on playtest feel and torch-
 * fuel math before final deploy.
 */
export const CAMP_DISTANCE_M = 240


// MARK: Playfield-inset margin
/**
 * Minimum distance (metres) between the camp centre and the playfield
 * boundary wall. Must cover the camp's melt ring so the warm floor
 * doesn't spill onto cliff tiles, plus a small pad so the base GLB
 * doesn't clip perimeter geometry. The camp's radial distance from
 * the central hearth is clamped to whatever keeps the bearing line
 * inside `playfield − CAMP_EDGE_MARGIN_M`.
 */
const CAMP_EDGE_MARGIN_M = CAMPFIRE_MELT_RADIUS_M + 2


// MARK: Cliff clearance
/**
 * Minimum distance (metres) between the camp centre and any cliff
 * tile face. Separate from the warm-ring radius so we can tune visual
 * breathing room independently of the melt disc — the camp is more
 * than a ring (beacon column, base GLB, future tents / lanterns), so
 * 8 m ring clearance can still read as "overlapping the cliff" from
 * a distance. 24 m gives ~16 m of visible snow between the camp and
 * the nearest cliff face on every bearing.
 */
const CAMP_CLIFF_CLEARANCE_M = 24


// MARK: World-position derivation
/**
 * Deterministic camp world position for a given cycle seed. Same
 * inputs always return the same point; different seeds return
 * different bearings around the central hearth (distance is fixed).
 *
 * Angle bucketing: we snap to 16 compass points (22.5° increments)
 * rather than a continuous angle so the camp lands somewhere legible
 * ("north-northwest today") rather than at odd bearings that make it
 * hard to describe to another player during the cycle.
 */
export function getCampWorldPosition(seed: number): { x: number; y: number; z: number } {
	const centreX = MAZE_ORIGIN_OFFSET_METERS + (MAZE_GRID_WIDTH  * MAZE_TILE_WORLD_METERS) / 2
	const centreZ = MAZE_ORIGIN_OFFSET_METERS + (MAZE_GRID_HEIGHT * MAZE_TILE_WORLD_METERS) / 2

	// Align the perimeter planner to the cycle seed we were called with,
	// so isPointOnCliff() below queries the cliff layout that matches
	// this cycle. Client bootstrap already calls setPerimeterSeed(s) as
	// part of the cycle-seed change handler; we reassert here so the
	// server path (which doesn't spawn a perimeter) and any out-of-order
	// call from either side still gets the right answer. Idempotent when
	// the seed already matches.
	setPerimeterSeed(seed)

	const minC = PLAYFIELD_MIN_M + CAMP_EDGE_MARGIN_M
	const maxC = PLAYFIELD_MAX_M - CAMP_EDGE_MARGIN_M

	// Deterministic start bucket. Bitwise xorshift keeps adjacent seeds
	// from producing adjacent bearings.
	let h = seed | 0
	h ^= h << 13
	h ^= h >>> 17
	h ^= h << 5
	const startBucket = ((h % 16) + 16) % 16

	// Iterate all 16 compass buckets starting at the seeded one. Pick
	// the FIRST bearing whose clamped endpoint doesn't sit on / near a
	// cliff footprint (padded by the camp's warm ring so the whole ring
	// stays on snow). If every bearing is blocked — shouldn't happen in
	// practice, cliffs occupy a small fraction of the playfield edge —
	// fall back to the original seeded bucket rather than throwing, so
	// the camp still exists (just possibly overlapping a cliff, which
	// beats crashing the boot).
	for (let step = 0; step < 16; step++) {
		const bucket   = (startBucket + step) % 16
		const angleRad = (bucket / 16) * Math.PI * 2
		const cosA     = Math.cos(angleRad)
		const sinA     = Math.sin(angleRad)

		// Radial clamp keeps the point inside the playfield inset.
		const rMaxX = cosA >  1e-6 ? (maxC - centreX) /  cosA
		            : cosA < -1e-6 ? (minC - centreX) /  cosA
		            : Infinity
		const rMaxZ = sinA >  1e-6 ? (maxC - centreZ) /  sinA
		            : sinA < -1e-6 ? (minC - centreZ) /  sinA
		            : Infinity
		const r = Math.min(CAMP_DISTANCE_M, rMaxX, rMaxZ)

		const x = centreX + cosA * r
		const z = centreZ + sinA * r

		// Pad by the warm-ring radius so the whole melt disc stays clear
		// of any cliff face, not just the camp's centre point.
		if (!isPointOnCliff(x, z, CAMP_CLIFF_CLEARANCE_M)) {
			return { x, y: 0.25, z }
		}
	}

	// Every bearing blocked — log and fall back to the seeded bucket.
	console.log(
		`camp: getCampWorldPosition: seed=${seed} — every compass bearing ` +
		`collides with a cliff, falling back to bucket ${startBucket}. ` +
		`This shouldn't happen with normal cliff density; check perimeter tuning.`,
	)
	const angleRad = (startBucket / 16) * Math.PI * 2
	const cosA     = Math.cos(angleRad)
	const sinA     = Math.sin(angleRad)
	const rMaxX = cosA >  1e-6 ? (maxC - centreX) /  cosA
	            : cosA < -1e-6 ? (minC - centreX) /  cosA
	            : Infinity
	const rMaxZ = sinA >  1e-6 ? (maxC - centreZ) /  sinA
	            : sinA < -1e-6 ? (minC - centreZ) /  sinA
	            : Infinity
	const r = Math.min(CAMP_DISTANCE_M, rMaxX, rMaxZ)
	return { x: centreX + cosA * r, y: 0.25, z: centreZ + sinA * r }
}
