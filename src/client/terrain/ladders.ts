/**
 * ladders.ts — click-to-climb connections between terrain levels.
 *
 * Decentraland has no climbing, so a ladder is an interaction: step up
 * to it, click or tap, and movePlayerTo puts you at the other end. The
 * generator decides where they go (one per region connection, on a
 * straight cliff run); this module draws them and wires the clicks.
 *
 * Both ends are clickable. Dropping off a cliff is still free, so the
 * downward click is only a safer way down for someone carrying wood.
 *
 * Following flagtag's ladderSystem: the visible ladder keeps physics
 * colliders only and a separate oversized invisible box takes the
 * pointer, because a thin ladder mesh swallows taps on mobile.
 */

import {
	ColliderLayer,
	Entity,
	InputAction,
	Material,
	MeshCollider,
	MeshRenderer,
	Transform,
	engine,
	pointerEventsSystem,
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'

import { TERRAIN_LEVEL_STEP_M, groundYForLevel } from 'src/shared/settings'
import {
	DIR_DX,
	DIR_DZ,
	LADDER_FOOT_M,
	TerrainLadder,
	TerrainMap,
} from 'src/shared/terrain/terrainMap'


// MARK: Tuning

const RAIL_WIDTH_M = 1.2
const RAIL_DEPTH_M = 0.35

/** Pointer box footprint. Generous so a tap lands from any angle. */
const CLICK_BOX_XZ_M = 4
const CLICK_MAX_DIST = 12

/** Where the climber ends up, measured out from the cliff edge. */
const ARRIVE_LOOK_AHEAD_M = 6

const LADDER_COLOR = Color4.create(0.52, 0.38, 0.22, 1)

const ladderEntities: Entity[] = []


// MARK: clearLadders
/** Remove every ladder and its click boxes. */
export function clearLadders(): void {
	for (const e of ladderEntities) {
		pointerEventsSystem.removeOnPointerDown(e)
		engine.removeEntity(e)
	}
	ladderEntities.length = 0
}


// MARK: setupLadders
/**
 * Build every ladder in `map`. Call after clearLadders(); the terrain
 * renderer does both as one step.
 */
export function setupLadders(map: TerrainMap): void {
	for (const ladder of map.ladders) spawnLadder(ladder)
	console.log(`ladders: setupLadders: ${map.ladders.length} ladders`)
}


// MARK: spawnLadder
function spawnLadder(ladder: TerrainLadder): void {
	const dx     = DIR_DX[ladder.dir]
	const dz     = DIR_DZ[ladder.dir]
	const baseY  = groundYForLevel(ladder.lowLevel)
	// Stop at the cliff lip (high ground), not above it into the snow.
	const topY   = groundYForLevel(ladder.lowLevel + 1)
	const height = topY - baseY

	// Face of the cliff is LADDER_FOOT_M toward the high cell from the
	// foot. Centre the rail so its inner face sits flush on that outside
	// wall — not buried in the upper slab, not floating off it.
	const faceX = ladder.bottom.x + dx * LADDER_FOOT_M
	const faceZ = ladder.bottom.z + dz * LADDER_FOOT_M
	const railX = faceX - dx * (RAIL_DEPTH_M / 2)
	const railZ = faceZ - dz * (RAIL_DEPTH_M / 2)

	const rail = engine.addEntity()
	ladderEntities.push(rail)
	Transform.create(rail, {
		position: Vector3.create(railX, baseY + height / 2, railZ),
		scale:    Vector3.create(
			dx !== 0 ? RAIL_DEPTH_M : RAIL_WIDTH_M,
			height,
			dz !== 0 ? RAIL_DEPTH_M : RAIL_WIDTH_M,
		),
		rotation: Quaternion.Identity(),
	})
	MeshRenderer.setBox(rail)
	MeshCollider.setBox(rail, ColliderLayer.CL_PHYSICS)
	Material.setPbrMaterial(rail, {
		albedoColor:       LADDER_COLOR,
		roughness:         1.0,
		metallic:          0.0,
		specularIntensity: 0.0,
	})

	// Climb up: stand at the foot, arrive on the lip looking inland.
	addClimbBox(
		ladder.bottom,
		ladder.top,
		{ x: ladder.top.x + dx * ARRIVE_LOOK_AHEAD_M, y: ladder.top.y + 1.2, z: ladder.top.z + dz * ARRIVE_LOOK_AHEAD_M },
		'Climb up',
	)

	// Climb down: stand on the lip, arrive at the foot looking outward.
	addClimbBox(
		ladder.top,
		ladder.bottom,
		{ x: ladder.bottom.x - dx * ARRIVE_LOOK_AHEAD_M, y: ladder.bottom.y + 1.2, z: ladder.bottom.z - dz * ARRIVE_LOOK_AHEAD_M },
		'Climb down',
	)
}


// MARK: addClimbBox
/**
 * Invisible pointer box at `at` that moves the player to `to` facing
 * `look`. Pointer-layer only, so it never blocks walking.
 */
function addClimbBox(
	at:        { x: number; y: number; z: number },
	to:        { x: number; y: number; z: number },
	look:      { x: number; y: number; z: number },
	hoverText: string,
): void {
	const box = engine.addEntity()
	ladderEntities.push(box)
	Transform.create(box, {
		position: Vector3.create(at.x, at.y + TERRAIN_LEVEL_STEP_M / 4, at.z),
		scale:    Vector3.create(CLICK_BOX_XZ_M, TERRAIN_LEVEL_STEP_M / 2, CLICK_BOX_XZ_M),
	})
	MeshCollider.setBox(box, ColliderLayer.CL_POINTER)

	pointerEventsSystem.onPointerDown(
		{
			entity: box,
			opts:   {
				button:      InputAction.IA_POINTER,
				hoverText,
				maxDistance: CLICK_MAX_DIST,
			},
		},
		() => {
			movePlayerTo({
				newRelativePosition: { x: to.x, y: to.y + 0.25, z: to.z },
				cameraTarget:        look,
			}).catch(() => {})
		},
	)
}
