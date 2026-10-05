/**
 * logsFeedFx.ts — wood jumps from a player into a fire on feed.
 *
 * Mirror of logsPickupFx, but world-space: the piece leaves the feeder
 * and arcs into the hearth (or a lit hidden pit), shrinking as it lands.
 * Pooled so we never churn GltfContainer creates per feed.
 *
 * Motion is a manual lerp (not Tween / TweenSequence). Mobile Explorer
 * often stalls the second TweenSequence phase, leaving wood frozen
 * above the fire; driving Transform ourselves keeps desktop and mobile
 * on one reliable path.
 *
 * Usage:
 *   - setupLogsFeedFx() once from client bootstrap
 *   - spawnLogsFeed(kind, target, playerId?) on a successful feed
 *     (local: omit playerId; remote: pass lowercased wallet)
 */

import {
	Entity,
	GltfContainer,
	PlayerIdentityData,
	Transform,
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
const ARC_UP_S        = 0.18
const ARC_IN_S        = 0.37

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
	root   : Entity
	shrink : Entity
	log    : Entity
	branch : Entity
	timer  : number
	busy   : boolean
	/** Elapsed seconds into the current arc (0..FEED_DURATION_S). */
	elapsed: number
	launch : Vector3
	peak   : Vector3
	end    : Vector3
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
			scale : Vector3.Zero(),
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
		VisibilityComponent.create(log, { visible: false })

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

		pool.push({
			root,
			shrink,
			log,
			branch,
			timer  : 0,
			busy   : false,
			elapsed: 0,
			launch : Vector3.Zero(),
			peak   : Vector3.Zero(),
			end    : Vector3.Zero(),
		})
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
		releaseRig(rig!)
	}

	const launch = Vector3.create(start.x, start.y + LAUNCH_Y, start.z)
	const peak   = Vector3.create(
		(launch.x + end.x) * 0.5,
		Math.max(launch.y, end.y) + ARC_EXTRA_Y,
		(launch.z + end.z) * 0.5,
	)

	rig.busy    = true
	rig.timer   = FEED_DURATION_S
	rig.elapsed = 0
	rig.launch  = launch
	rig.peak    = peak
	rig.end     = end

	Transform.getMutable(rig.root).position = launch
	Transform.getMutable(rig.root).scale    = Vector3.One()
	Transform.getMutable(rig.shrink).scale  = Vector3.One()
	applyFeedVisual(rig, kind)
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
			return Vector3.create(pos.x, pos.y + FIRE_AIM_Y, pos.z)
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


// MARK: easeOutQuad
function easeOutQuad(t: number): number {
	return 1 - (1 - t) * (1 - t)
}


// MARK: easeInQuad
function easeInQuad(t: number): number {
	return t * t
}


// MARK: lerpVec
function lerpVec(a: Vector3, b: Vector3, t: number): Vector3 {
	return Vector3.create(
		a.x + (b.x - a.x) * t,
		a.y + (b.y - a.y) * t,
		a.z + (b.z - a.z) * t,
	)
}


// MARK: tickPool
function tickPool(dt: number): void {
	for (const rig of pool) {
		if (!rig.busy) continue
		rig.elapsed += dt
		rig.timer    = FEED_DURATION_S - rig.elapsed

		if (rig.elapsed >= FEED_DURATION_S) {
			releaseRig(rig)
			continue
		}

		const rootT   = Transform.getMutable(rig.root)
		const shrinkT = Transform.getMutable(rig.shrink)

		if (rig.elapsed <= ARC_UP_S) {
			const u = easeOutQuad(rig.elapsed / ARC_UP_S)
			rootT.position = lerpVec(rig.launch, rig.peak, u)
			shrinkT.scale  = Vector3.One()
		} else {
			const u = easeInQuad(Math.min(1, (rig.elapsed - ARC_UP_S) / ARC_IN_S))
			rootT.position = lerpVec(rig.peak, rig.end, u)
			const s = 1 - u
			shrinkT.scale = Vector3.create(s, s, s)
		}
	}
}


// MARK: releaseRig
function releaseRig(rig: Rig): void {
	rig.busy    = false
	rig.timer   = 0
	rig.elapsed = 0
	Transform.getMutable(rig.root).scale   = Vector3.Zero()
	Transform.getMutable(rig.shrink).scale = Vector3.Zero()
	VisibilityComponent.createOrReplace(rig.log,    { visible: false })
	VisibilityComponent.createOrReplace(rig.branch, { visible: false })
}
