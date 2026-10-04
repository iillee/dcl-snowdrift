/**
 * logsFeedFx.ts — wood jumps from a player into a fire on feed.
 *
 * Mirror of logsPickupFx, but world-space: the piece leaves the feeder
 * and arcs into the hearth (or a lit hidden pit), shrinking as it lands.
 * Pooled so we never churn AvatarAttach / GltfContainer creates per feed.
 *
 * Usage:
 *   - setupLogsFeedFx() once from client bootstrap
 *   - spawnLogsFeed(kind, target, playerId?) on a successful feed
 *     (local: omit playerId; remote: pass lowercased wallet)
 */

import {
	EasingFunction,
	Entity,
	GltfContainer,
	PlayerIdentityData,
	Transform,
	Tween,
	TweenSequence,
	VisibilityComponent,
	engine,
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Y, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { clampWoodKind, WOOD_KIND_BRANCH } from 'src/shared/woodKind'

import { getHiddenCampfireWorldPos } from 'src/client/hiddenCampfire'


/** Simultaneous feed arcs. A burst steals the oldest rig. */
const POOL_SIZE = 6

/** Pop up then fly into the fire. */
const FEED_DURATION_S = 0.55
const ARC_UP_MS       = 180
const ARC_IN_MS       = 370

/** How high above the player the piece peaks before diving in. */
const LAUNCH_Y        = 1.55
const ARC_EXTRA_Y     = 0.85
/** Aim slightly above the log pile so it lands in the flame bed. */
const FIRE_AIM_Y      = 0.95

const LOG_MODEL_SRC    = 'assets/models/logs_pickup.glb'
const BRANCH_MODEL_SRC = 'assets/models/branch.glb'
const LOG_SCALE        = 1
const BRANCH_SCALE     = 0.32
const BRANCH_PITCH_X_DEG = 90


interface Rig {
	root  : Entity
	shrink: Entity
	log   : Entity
	branch: Entity
	timer : number
	busy  : boolean
}

const pool: Rig[] = []
let ready = false



// MARK: setupLogsFeedFx
/**
 * Pre-create the pooled feed-arc rigs. Idempotent.
 */
export function setupLogsFeedFx(): void {
	if (ready) {
		console.log('logsFeedFx: setupLogsFeedFx: already installed, skipping')
		return
	}
	ready = true

	for (let i = 0; i < POOL_SIZE; i++) {
		const root = engine.addEntity()
		Transform.create(root, {
			position: Vector3.Zero(),
			scale   : Vector3.Zero(),
		})

		const shrink = engine.addEntity()
		Transform.create(shrink, {
			parent: root,
			scale : Vector3.One(),
		})

		const log = engine.addEntity()
		Transform.create(log, {
			parent  : shrink,
			scale   : Vector3.create(LOG_SCALE, LOG_SCALE, LOG_SCALE),
			rotation: Quaternion.fromEulerDegrees(0, 90, 0),
		})
		GltfContainer.create(log, {
			src                         : LOG_MODEL_SRC,
			visibleMeshesCollisionMask  : 0,
			invisibleMeshesCollisionMask: 0,
		})

		const branch = engine.addEntity()
		Transform.create(branch, {
			parent  : shrink,
			scale   : Vector3.create(BRANCH_SCALE, BRANCH_SCALE, BRANCH_SCALE),
			rotation: Quaternion.fromEulerDegrees(BRANCH_PITCH_X_DEG, 40, 0),
		})
		GltfContainer.create(branch, {
			src                         : BRANCH_MODEL_SRC,
			visibleMeshesCollisionMask  : 0,
			invisibleMeshesCollisionMask: 0,
		})
		VisibilityComponent.create(branch, { visible: false })

		pool.push({ root, shrink, log, branch, timer: 0, busy: false })
	}

	engine.addSystem(tickPool)
	console.log(`logsFeedFx: setupLogsFeedFx: pool size=${POOL_SIZE}`)
}



// MARK: spawnLogsFeed
/**
 * Arc a wood GLB from `playerId` (local if omitted) into fire `target`
 * (-1 main hearth, else a hidden pit index). Cosmetic only.
 */
export function spawnLogsFeed(
	kind    : number,
	target  : number,
	playerId?: string,
): void {
	if (!ready) {
		console.log('logsFeedFx: spawnLogsFeed: pool not ready, skipping')
		return
	}

	let resolvedId = playerId ? playerId.toLowerCase() : undefined
	const me       = getPlayer()?.userId.toLowerCase()
	if (resolvedId && me && resolvedId === me) resolvedId = undefined

	const start = resolveStartPos(resolvedId)
	if (start === null) {
		console.log('logsFeedFx: spawnLogsFeed: no feeder position, skipping')
		return
	}
	const end = resolveFirePos(target)

	let rig: Rig | undefined = pool.find((r) => !r.busy)
	if (!rig) {
		rig = pool[0]
		for (const r of pool) if (r.timer < rig!.timer) rig = r
	}

	rig.busy  = true
	rig.timer = FEED_DURATION_S

	const launch = Vector3.create(start.x, start.y + LAUNCH_Y, start.z)
	const peak   = Vector3.create(
		(launch.x + end.x) * 0.5,
		Math.max(launch.y, end.y) + ARC_EXTRA_Y,
		(launch.z + end.z) * 0.5,
	)

	if (Tween.has(rig.root))                Tween.deleteFrom(rig.root)
	if (TweenSequence.has(rig.root))        TweenSequence.deleteFrom(rig.root)
	if (Tween.has(rig.shrink))              Tween.deleteFrom(rig.shrink)
	if (TweenSequence.has(rig.shrink))      TweenSequence.deleteFrom(rig.shrink)

	Transform.getMutable(rig.root).position = launch
	Transform.getMutable(rig.root).scale    = Vector3.One()
	Transform.getMutable(rig.shrink).scale  = Vector3.One()
	applyFeedVisual(rig, kind)

	// Phase 1: pop up toward the arc peak.
	Tween.createOrReplace(rig.root, {
		mode          : Tween.Mode.Move({ start: launch, end: peak }),
		duration      : ARC_UP_MS,
		easingFunction: EasingFunction.EF_EASEOUTQUAD,
	})
	// Phase 2: dive into the fire.
	TweenSequence.createOrReplace(rig.root, {
		sequence: [{
			mode          : Tween.Mode.Move({ start: peak, end: end }),
			duration      : ARC_IN_MS,
			easingFunction: EasingFunction.EF_EASEINQUAD,
		}],
	})

	// Hold scale on the pop, then shrink away as it lands.
	Tween.createOrReplace(rig.shrink, {
		mode          : Tween.Mode.Scale({ start: Vector3.One(), end: Vector3.One() }),
		duration      : ARC_UP_MS,
		easingFunction: EasingFunction.EF_LINEAR,
	})
	TweenSequence.createOrReplace(rig.shrink, {
		sequence: [{
			mode          : Tween.Mode.Scale({ start: Vector3.One(), end: Vector3.Zero() }),
			duration      : ARC_IN_MS,
			easingFunction: EasingFunction.EF_EASEINQUAD,
		}],
	})
}



// MARK: resolveStartPos
function resolveStartPos(playerIdLower: string | undefined): Vector3 | null {
	if (!playerIdLower) {
		const t = Transform.getOrNull(engine.PlayerEntity)
		if (t === null) return null
		return t.position
	}
	for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
		if (identity.address?.toLowerCase() !== playerIdLower) continue
		const t = Transform.getOrNull(entity)
		if (t === null) return null
		return t.position
	}
	return null
}


// MARK: resolveFirePos
function resolveFirePos(target: number): Vector3 {
	if (target >= 0) {
		const pos = getHiddenCampfireWorldPos(target)
		if (pos !== null) {
			return Vector3.create(pos.x, CAMPFIRE_WORLD_Y + FIRE_AIM_Y, pos.z)
		}
	}
	return Vector3.create(
		CAMPFIRE_WORLD_X,
		CAMPFIRE_WORLD_Y + FIRE_AIM_Y,
		CAMPFIRE_WORLD_Z,
	)
}


// MARK: applyFeedVisual
function applyFeedVisual(
	rig : Rig,
	kind: number,
): void {
	const isBranch = clampWoodKind(kind) === WOOD_KIND_BRANCH
	VisibilityComponent.createOrReplace(rig.log,    { visible: !isBranch })
	VisibilityComponent.createOrReplace(rig.branch, { visible:  isBranch })
}


// MARK: tickPool
function tickPool(dt: number): void {
	for (const rig of pool) {
		if (!rig.busy) continue
		rig.timer -= dt
		if (rig.timer <= 0) releaseRig(rig)
	}
}


// MARK: releaseRig
function releaseRig(rig: Rig): void {
	rig.busy  = false
	rig.timer = 0
	if (Tween.has(rig.root))           Tween.deleteFrom(rig.root)
	if (TweenSequence.has(rig.root))   TweenSequence.deleteFrom(rig.root)
	if (Tween.has(rig.shrink))         Tween.deleteFrom(rig.shrink)
	if (TweenSequence.has(rig.shrink)) TweenSequence.deleteFrom(rig.shrink)
	Transform.getMutable(rig.root).scale   = Vector3.Zero()
	Transform.getMutable(rig.shrink).scale = Vector3.Zero()
}
