/**
 * ladders.ts — walk-into-climb connections between terrain levels.
 *
 * Decentraland has no climbing, so a ladder is a zone: step into the
 * volume and movePlayerTo puts you on the lip. The generator decides
 * where they go; this module draws the GLB and owns the trigger.
 *
 * Yaw is derived from climb dir (rungs face the low cell). The climb
 * TriggerArea is a child of the GLB so it cannot drift by cardinal.
 * The GLB is visual-only (no physics collider).
 */

import {
	ColliderLayer,
	Entity,
	GltfContainer,
	Transform,
	TriggerArea,
	engine,
	triggerAreaEventsSystem,
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
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

/** Author ladder — ~15.6 m climb in the GLB, baked +90° X so it stands up. */
const LADDER_MODEL_SRC = 'assets/models/ladder2.glb'

/**
 * Native climb length of ladder2.glb (metres). Scale uniformly so the
 * top lands on the TERRAIN_LEVEL_STEP_M cliff lip.
 */
const MODEL_CLIMB_M = 15.604

/**
 * Offset from the cliff face toward the low cell (metres). Positive =
 * sit out in the pit, not buried in the slab.
 */
const GLB_FACE_GAP_M = 0.02

/**
 * Trigger box in world metres. Converted to parent-local by / heightScale.
 * X = across rungs, Y = climb, Z = depth out from wall.
 */
const TRIGGER_W_M = 1.4
const TRIGGER_D_M = 0.7
/** Child-only lateral nudge (world metres). */
const TRIGGER_LOCAL_X_M = 0

/**
 * Yaw so rungs face the low cell (−dir). Index N E S W.
 * Tower-confirmed: only S was still edge-on at 0 → 180.
 */
const YAW_FACE_LOW_BY_DIR: readonly number[] = [0, 90, 180, -90]

/** Where the climber ends up, measured out from the cliff edge. */
const ARRIVE_LOOK_AHEAD_M = 6

type ClimbDest = {
	to:   { x: number; y: number; z: number }
	look: { x: number; y: number; z: number }
}

const ladderEntities: Entity[] = []
const climbDestByTrigger = new Map<Entity, ClimbDest>()
/** How many climb-up TriggerAreas currently contain the local player. */
let insideClimbCount = 0
/** True after leaving every climb volume; false after a successful climb. */
let climbArmed = true


// MARK: yawFacingLow
/** Yaw for climb dir (low → high). */
function yawFacingLow(dx: number, dz: number): number {
	// Recover dir index from unit step (generator only uses cardinals).
	let dir = 0
	if (dx === 1) dir = 1
	else if (dz === -1) dir = 2
	else if (dx === -1) dir = 3
	return YAW_FACE_LOW_BY_DIR[dir] ?? 0
}


// MARK: clearLadders
/** Remove every ladder visual/trigger and reset climb state. */
export function clearLadders(): void {
	for (const e of climbDestByTrigger.keys()) {
		triggerAreaEventsSystem.removeOnTriggerEnter(e)
		triggerAreaEventsSystem.removeOnTriggerExit(e)
	}
	climbDestByTrigger.clear()
	for (const e of ladderEntities) engine.removeEntity(e)
	ladderEntities.length = 0
	insideClimbCount = 0
	climbArmed = true
}


// MARK: setupLadders
/**
 * Build every ladder in `map`. Call after clearLadders(); the terrain
 * renderer does both as one step.
 */
export function setupLadders(map: TerrainMap): void {
	for (const ladder of map.ladders) spawnLadder(ladder)
	console.log(`ladders: setupLadders: ${map.ladders.length} ladders (TriggerArea climb-up)`)
}


// MARK: spawnLadder
function spawnLadder(ladder: TerrainLadder): void {
	const dx    = DIR_DX[ladder.dir]
	const dz    = DIR_DZ[ladder.dir]
	const baseY = groundYForLevel(ladder.lowLevel)

	const faceX = ladder.bottom.x + dx * LADDER_FOOT_M
	const faceZ = ladder.bottom.z + dz * LADDER_FOOT_M
	const glbX  = faceX - dx * GLB_FACE_GAP_M
	const glbZ  = faceZ - dz * GLB_FACE_GAP_M
	const yaw   = yawFacingLow(dx, dz)

	const dest: ClimbDest = {
		to:   { x: ladder.top.x, y: ladder.top.y + 0.25, z: ladder.top.z },
		look: {
			x: ladder.top.x + dx * ARRIVE_LOOK_AHEAD_M,
			y: ladder.top.y + 1.2,
			z: ladder.top.z + dz * ARRIVE_LOOK_AHEAD_M,
		},
	}
	placeLadderVisual(glbX, baseY, glbZ, yaw, dest)
}


// MARK: placeLadderVisual
/** GLB (visual only) + child TriggerArea for walk-in climb. */
function placeLadderVisual(
	faceX: number,
	baseY: number,
	faceZ: number,
	yaw:   number,
	dest:  ClimbDest,
): void {
	const heightScale = TERRAIN_LEVEL_STEP_M / MODEL_CLIMB_M
	const yawQ        = Quaternion.fromEulerDegrees(0, yaw, 0)

	const visual = engine.addEntity()
	ladderEntities.push(visual)
	Transform.create(visual, {
		position: Vector3.create(faceX, baseY, faceZ),
		scale:    Vector3.create(heightScale, heightScale, heightScale),
		rotation: yawQ,
	})
	GltfContainer.create(visual, {
		src:                          LADDER_MODEL_SRC,
		visibleMeshesCollisionMask:   0,
		invisibleMeshesCollisionMask: 0,
	})

	attachClimbVolume(visual, heightScale, dest)
}


// MARK: attachClimbVolume
/** Invisible child TriggerArea on the GLB. */
function attachClimbVolume(
	visual:      Entity,
	heightScale: number,
	dest:        ClimbDest,
): void {
	const sx = TRIGGER_W_M / heightScale
	const sy = MODEL_CLIMB_M
	const sz = TRIGGER_D_M / heightScale
	const lx = TRIGGER_LOCAL_X_M / heightScale
	const ly = MODEL_CLIMB_M / 2

	const trigger = engine.addEntity()
	ladderEntities.push(trigger)
	Transform.create(trigger, {
		parent:   visual,
		position: Vector3.create(lx, ly, 0),
		scale:    Vector3.create(sx, sy, sz),
	})
	TriggerArea.setBox(trigger, ColliderLayer.CL_PLAYER)
	climbDestByTrigger.set(trigger, dest)

	triggerAreaEventsSystem.onTriggerEnter(trigger, (result) => {
		if (result.trigger?.entity !== engine.PlayerEntity) return
		insideClimbCount++
		if (!climbArmed) return
		climbArmed = false
		console.log(
			`ladders: climbUp: TriggerArea teleport to ` +
			`(${dest.to.x.toFixed(1)}, ${dest.to.y.toFixed(1)}, ${dest.to.z.toFixed(1)})`,
		)
		movePlayerTo({
			newRelativePosition: dest.to,
			cameraTarget:        dest.look,
		}).catch(() => {})
	})
	triggerAreaEventsSystem.onTriggerExit(trigger, (result) => {
		if (result.trigger?.entity !== engine.PlayerEntity) return
		insideClimbCount = Math.max(0, insideClimbCount - 1)
		if (insideClimbCount === 0) climbArmed = true
	})
}
