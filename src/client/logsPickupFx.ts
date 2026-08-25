/**
 * logsPickupFx.ts - cosmetic "log bounces above your head" effect on
 * wood pickup. Pooled rigs (anchor -> shrinkParent -> log GLB) are
 * pre-created once and re-anchored via AvatarAttach on demand, so we
 * never churn entities per pickup (avatar-attach + entity create/destroy
 * cycles are a known engine failure class - see flagtag's
 * coinPickupSystem.ts for the reference implementation).
 *
 * Usage:
 *   - Call setupLogsPickupFx() once during client bootstrap AFTER
 *     initial scene composites are done loading (rigs contain a
 *     GltfContainer whose src matches other scene wood; we don't want
 *     early scanners to sweep our pool entities up by mistake).
 *   - Call spawnLogsBounce(playerId) whenever any player - local or
 *     remote - picks up a log. The playerId must be the lowercased
 *     wallet address (matches getPlayer().userId).
 */

import {
	AvatarAnchorPointType, AvatarAttach, EasingFunction, Entity, GltfContainer,
	Transform, Tween, TweenLoop, TweenSequence, engine,
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { getPlayer }           from '@dcl/sdk/players'


/** How many simultaneous head-bounce FX can play. A burst >POOL_SIZE
 *  steals the oldest rig - a clipped frame of a cosmetic effect is
 *  imperceptible. */
const POOL_SIZE = 6

/** Total seconds a rig stays busy. Matches the pop (200ms) + fall +
 *  shrink (350ms) = 550ms so the YOYO shrink loop never gets a chance
 *  to grow the log back up before the rig is parked. */
const BOUNCE_DURATION_S = 0.6

/** Placeholder log model - same GLB the world piles + scatter chunks
 *  use. Swap to a single-log GLB when we have one. */
const LOG_MODEL_SRC = 'assets/models/logs_pickup.glb'

/** Uniform scale of the bouncing log. The world pile GLB is roughly
 *  full-log size; shrunk here so it reads as a cartoon "+1 log" pop
 *  over the head without dwarfing the avatar. */
const LOG_SCALE = 0.6

/** Local Y positions relative to the head anchor. HEAD anchor sits at
 *  the top of the avatar's head, so we launch just above and pop up
 *  ~1m higher. */
const START_Y = 0.4
const PEAK_Y  = 1.4
const FALL_Y  = 0.7

const POP_UP_MS   = 200
const FALL_MS     = 350


interface Rig {
	anchor      : Entity
	shrinkParent: Entity
	log         : Entity
	timer       : number
	busy        : boolean
}


const pool: Rig[] = []
let ready = false


// MARK: setupLogsPickupFx
/**
 * Pre-create the pooled rigs. Idempotent; call once from client
 * bootstrap after composites have loaded. Safe to call earlier - the
 * rigs are hidden until first use - but delaying avoids one-shot
 * scene scanners misclassifying the pool entities.
 */
export function setupLogsPickupFx(): void {
	if (ready) {
		console.log('logsPickupFx: setupLogsPickupFx: already installed, skipping')
		return
	}
	ready = true

	for (let i = 0; i < POOL_SIZE; i++) {
		const anchor       = engine.addEntity()
		Transform.create(anchor, { position: Vector3.Zero() })

		const shrinkParent = engine.addEntity()
		Transform.create(shrinkParent, {
			parent  : anchor,
			position: Vector3.Zero(),
			scale   : Vector3.Zero(), // parked hidden
		})

		const log          = engine.addEntity()
		Transform.create(log, {
			parent  : shrinkParent,
			position: Vector3.create(0, START_Y, 0),
			scale   : Vector3.create(LOG_SCALE, LOG_SCALE, LOG_SCALE),
			rotation: Quaternion.fromEulerDegrees(0, 90, 0),
		})
		GltfContainer.create(log, {
			src                          : LOG_MODEL_SRC,
			visibleMeshesCollisionMask   : 0,
			invisibleMeshesCollisionMask : 0,
		})

		pool.push({ anchor, shrinkParent, log, timer: 0, busy: false })
	}

	engine.addSystem(tickPool)
	console.log(`logsPickupFx: setupLogsPickupFx: pool size=${POOL_SIZE} model=${LOG_MODEL_SRC}`)
}


// MARK: spawnLogsBounce
/**
 * Attach a bouncing log to a player's head and play the two-phase
 * pop/fall+shrink animation.
 *
 * IMPORTANT: for the LOCAL player, pass playerId=undefined (or omit).
 * AvatarAttach on the local avatar MUST omit avatarId - passing it
 * explicitly fails silently and the anchor stays at Vector3.Zero(),
 * leaving the FX rig orphaned at world (0, 0, 0). This is the same
 * pattern used by torch.ts for the local torch attach.
 *
 * For REMOTE players (woodChunkRemoved handler), pass the picker's
 * lowercased wallet address so the FX shows over their avatar.
 */
export function spawnLogsBounce(playerId?: string): void {
	if (!ready) {
		console.log('logsPickupFx: spawnLogsBounce: pool not ready, skipping (call setupLogsPickupFx first)')
		return
	}

	// Normalise playerId. Two failure modes we're guarding against:
	//   1. Caller passed the LOCAL player's own userId (e.g. wood.ts
	//      seeing the server echo its own woodChunkRemoved when
	//      getPlayer() returned null and the me-check fell through).
	//      Explicit avatarId on the local avatar fails silently and
	//      orphans the rig at world (0,0,0) — the "log floating at
	//      scene origin" bug that reads as a teleport.
	//   2. Caller passed a non-lowercased id. Avatar ids are always
	//      lowercased in this codebase; if we hand AvatarAttach a
	//      mixed-case id it silently fails to bind, same orphan
	//      symptom.
	let resolvedId = playerId ? playerId.toLowerCase() : undefined
	const me       = getPlayer()?.userId.toLowerCase()
	if (resolvedId && me && resolvedId === me) {
		console.log('logsPickupFx: spawnLogsBounce: caller passed local userId, treating as local (dropping avatarId)')
		resolvedId = undefined
	}

	// Acquire a free rig, or steal the one that will free soonest.
	let rig: Rig | undefined = pool.find(r => !r.busy)
	if (!rig) {
		rig = pool[0]
		for (const r of pool) if (r.timer < rig.timer) rig = r
	}

	rig.busy  = true
	rig.timer = BOUNCE_DURATION_S

	// Local (no playerId) -> omit avatarId so AvatarAttach binds to the
	// local avatar automatically. Remote -> explicit avatarId.
	if (resolvedId) {
		AvatarAttach.createOrReplace(rig.anchor, {
			avatarId     : resolvedId,
			anchorPointId: AvatarAnchorPointType.AAPT_HEAD,
		})
	} else {
		AvatarAttach.createOrReplace(rig.anchor, {
			anchorPointId: AvatarAnchorPointType.AAPT_HEAD,
		})
	}

	// Reset transforms before restarting tweens (rig may have been
	// reused mid-animation from a previous burst).
	Transform.getMutable(rig.shrinkParent).scale = Vector3.One()
	const lt = Transform.getMutable(rig.log)
	lt.position = Vector3.create(0, START_Y, 0)
	lt.scale    = Vector3.create(LOG_SCALE, LOG_SCALE, LOG_SCALE)
	lt.rotation = Quaternion.fromEulerDegrees(0, 90, 0)

	// Phase 1: pop up fast.
	Tween.createOrReplace(rig.log, {
		mode          : Tween.Mode.Move({
			start: Vector3.create(0, START_Y, 0),
			end  : Vector3.create(0, PEAK_Y, 0),
		}),
		duration      : POP_UP_MS,
		easingFunction: EasingFunction.EF_EASEOUTQUAD,
	})
	// Phase 2: fall back down (YOYO loop is bounded by the park timer).
	TweenSequence.createOrReplace(rig.log, {
		sequence: [{
			mode          : Tween.Mode.Move({
				start: Vector3.create(0, PEAK_Y, 0),
				end  : Vector3.create(0, FALL_Y, 0),
			}),
			duration      : FALL_MS,
			easingFunction: EasingFunction.EF_EASEINQUAD,
		}],
		loop    : TweenLoop.TL_YOYO,
	})

	// Hold full scale during pop, shrink to zero during fall.
	Tween.createOrReplace(rig.shrinkParent, {
		mode          : Tween.Mode.Scale({ start: Vector3.One(), end: Vector3.One() }),
		duration      : POP_UP_MS,
		easingFunction: EasingFunction.EF_LINEAR,
	})
	TweenSequence.createOrReplace(rig.shrinkParent, {
		sequence: [{
			mode          : Tween.Mode.Scale({ start: Vector3.One(), end: Vector3.Zero() }),
			duration      : FALL_MS,
			easingFunction: EasingFunction.EF_EASEINQUAD,
		}],
		loop    : TweenLoop.TL_YOYO,
	})
}


// MARK: tickPool
/**
 * Park rigs whose animation has completed. Runs every frame; cost is
 * O(POOL_SIZE) and negligible.
 */
function tickPool(dt: number): void {
	for (const rig of pool) {
		if (!rig.busy) continue
		rig.timer -= dt
		if (rig.timer <= 0) releaseRig(rig)
	}
}


// MARK: releaseRig
/**
 * Stop the rig's tweens, detach from the avatar, and hide it. The rig
 * stays in the pool for the next pickup.
 */
function releaseRig(rig: Rig): void {
	rig.busy  = false
	rig.timer = 0
	if (Tween.has(rig.log))                  Tween.deleteFrom(rig.log)
	if (TweenSequence.has(rig.log))          TweenSequence.deleteFrom(rig.log)
	if (Tween.has(rig.shrinkParent))         Tween.deleteFrom(rig.shrinkParent)
	if (TweenSequence.has(rig.shrinkParent)) TweenSequence.deleteFrom(rig.shrinkParent)
	if (AvatarAttach.has(rig.anchor))        AvatarAttach.deleteFrom(rig.anchor)
	Transform.getMutable(rig.shrinkParent).scale = Vector3.Zero()
}
