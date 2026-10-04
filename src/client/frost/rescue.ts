/**
 * rescue.ts — ice blocks and the torch thaw.
 *
 * Your own cube follows your avatar in world space, which both
 * clients can read. Everyone else's is an AvatarAttach on their
 * hips: a remote player's Transform is not their world position, so
 * a cube placed from it never lands on them, and a child of their
 * player entity is invisible on mobile. FrostDeath itself does not
 * replicate; the server broadcast says who is frozen.
 * Standing inside ICE_RESCUE_RADIUS_M with a lit torch melts the cube
 * from the top, one third per second. The remaining slab sits on the
 * feet: local cubes follow PlayerEntity, remote cubes attach to
 * AAPT_POSITION (the avatar root), and the centre is always
 * feet + half remaining height. Hip attach made shorter avatars and
 * sit poses look like the ice melted upward. Desktop viewers add a
 * small Y nudge for mobile peers (their attach root sits lower on
 * desktop). Everyone draws that height from the server. If the torch
 * leaves early, the cube grows back a third per second. At ICE_THAW_S
 * the cube is gone, the player can move, and their torch can be lit
 * again. A presence heartbeat keeps a disconnect from counting as
 * someone still alive.
 */

import {
	AvatarAnchorPointType,
	AvatarAttach,
	engine,
	Entity,
	Material,
	MaterialTransparencyMode,
	MeshRenderer,
	PlayerIdentityData,
	Transform,
} from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

import { FrostDeath } from 'src/shared/frost/components'
import { ICE_RESCUE_RADIUS_M, ICE_THAW_S } from 'src/shared/frost/tuning'
import { room } from 'src/shared/messages'

import { playIceCubeSfxAt } from 'src/client/audio'
import { grantFrostRescue, noteLocalMelt } from 'src/client/frost/death'
import { isTorchLit } from 'src/client/torchEquip'


const HEARTBEAT_S = 5
const RESCUE_R_SQ = ICE_RESCUE_RADIUS_M * ICE_RESCUE_RADIUS_M

/** Match frost-bar / ground blue (0.42, 0.60, 0.98); denser than the old pale glass. */
const ICE_DIFFUSE  = Color4.create(0.42, 0.60, 0.98, 0.72)
const ICE_ALBEDO   = Color4.create(0.42, 0.60, 0.98, 0.55)
const ICE_EMISSIVE = Color3.create(0.32, 0.48, 0.92)
/** Blue glass with its own alpha. Mobile drops PBR transparency, so that client uses this unlit texture. */
const ICE_TEXTURE  = 'assets/images/ice-alpha.png'
/** Equal sides, tall enough to cover a standing avatar. Centre is half that, so the bottom sits on the feet. */
const ICE_SIZE     = 2.1
const ICE_CENTER_Y = ICE_SIZE / 2
const ICE_SCALE    = Vector3.create(ICE_SIZE, ICE_SIZE, ICE_SIZE)
/**
 * Desktop AvatarAttach AAPT_POSITION sits lower than local PlayerEntity
 * feet, so a remote cube at ICE_CENTER_Y leaves the head uncovered.
 * Local cubes do not use this.
 */
const ICE_REMOTE_OFFSET_Y = 0.4
/**
 * Extra lift when a desktop client draws ice on a mobile peer. Mobile
 * AAPT_POSITION reads a bit lower on desktop; desktop-desktop stays on
 * ICE_REMOTE_OFFSET_Y alone.
 */
const ICE_REMOTE_MOBILE_EXTRA_Y = 0.22

type IceRig = {
	block  : Entity
	player?: Entity
	anchor?: Entity
	/** Last known feet. Local cubes skip a melt until this exists. */
	feetX? : number
	feetY? : number
	feetZ? : number
}

const remoteFrozen = new Map<string, { x: number, z: number }>()
/** Seconds of torch contact already shown on a cube. 0 is full height. */
const meltStep     = new Map<string, number>()
/** Peer Explorers that last heartbeated as mobile (1). */
const remoteMobile = new Set<string>()

let installed  = false
/** Retry a thaw ask if the server never answered. */
const RESCUE_RETRY_S = 2

let heartbeat    = HEARTBEAT_S
let thawTimer    = 0
let pendingId    = ''
let sentFor      = ''
let sentAgo      = 0
let meltSentId   = ''
let meltSentStep = -1
let meltPing     = 0

/** How often a rescuer refreshes the melt hold so a dropped torch is noticed. */
const MELT_PING_S = 0.35

const iceByUser = new Map<string, IceRig>()


// MARK: isRemotePlayerFrozen
/** True when the server has told us this other player is in an ice cube. */
export function isRemotePlayerFrozen(userId: string): boolean {
	return remoteFrozen.has(userId.toLowerCase())
}


// MARK: remoteIceOffsetY
/**
 * AvatarAttach root height for someone else's cube. Desktop viewers
 * lift mobile peers a little; every other pairing keeps the base offset.
 */
function remoteIceOffsetY(userId: string): number {
	if (!isMobile() && remoteMobile.has(userId.toLowerCase())) {
		return ICE_REMOTE_OFFSET_Y + ICE_REMOTE_MOBILE_EXTRA_Y
	}
	return ICE_REMOTE_OFFSET_Y
}


// MARK: localUserId
function localUserId(): string {
	const id = PlayerIdentityData.getOrNull(engine.PlayerEntity)
	return id?.address?.toLowerCase() ?? ''
}


// MARK: ensureIce
/**
 * Glassy cube in world space, moved onto the avatar each frame.
 * No collider, so a rescuer can walk up. Not a child of the player
 * entity: mobile skips those meshes.
 */
function ensureIce(
	userId: string,
	player: Entity,
): void {
	if (iceByUser.has(userId)) return
	const block = engine.addEntity()
	Transform.create(block, {
		position: Vector3.create(0, ICE_CENTER_Y, 0),
		scale   : ICE_SCALE,
	})
	paintIce(block)
	iceByUser.set(userId, { block, player })
	applyMeltScale(userId)
	console.log(`frost/rescue: ensureIce: cube on ${userId}`)
}


// MARK: paintIce
function paintIce(block: Entity): void {
	MeshRenderer.setBox(block)
	if (isMobile()) {
		Material.setBasicMaterial(block, {
			texture     : Material.Texture.Common({ src: ICE_TEXTURE }),
			alphaTexture: Material.Texture.Common({ src: ICE_TEXTURE }),
			diffuseColor: ICE_DIFFUSE,
			castShadows : false,
		})
		return
	}
	Material.setPbrMaterial(block, {
		albedoColor      : ICE_ALBEDO,
		emissiveColor    : ICE_EMISSIVE,
		emissiveIntensity: 0.2,
		roughness        : 0.08,
		metallic         : 0.0,
		transparencyMode : MaterialTransparencyMode.MTM_ALPHA_BLEND,
		castShadows      : false,
	})
}


// MARK: ensureRemoteIce
/**
 * Cube on another avatar. AvatarAttach is what both clients actually
 * draw on someone else. The root (feet) is the melt pivot: shrinking
 * around the hips made the bottom rise on short avatars and sit poses.
 */
function ensureRemoteIce(userId: string): void {
	if (iceByUser.has(userId)) return
	const anchor = engine.addEntity()
	AvatarAttach.create(anchor, {
		avatarId     : userId,
		anchorPointId: AvatarAnchorPointType.AAPT_POSITION,
	})
	Transform.create(anchor, { position: Vector3.Zero(), scale: Vector3.One() })

	const block = engine.addEntity()
	Transform.create(block, {
		parent  : anchor,
		position: Vector3.create(0, ICE_CENTER_Y + remoteIceOffsetY(userId), 0),
		scale   : ICE_SCALE,
	})
	paintIce(block)
	iceByUser.set(userId, { block, anchor })
	applyMeltScale(userId)
	console.log(`frost/rescue: ensureRemoteIce: cube on ${userId}`)
}


// MARK: applyMeltScale
/**
 * Drop the top of the cube. Scale and position are applied together so
 * a missing pose cannot shrink the slab around its old centre (that
 * is the bottom-up melt). Bottom stays on the feet.
 */
function applyMeltScale(userId: string): void {
	const rig = iceByUser.get(userId)
	if (rig === undefined) return
	const step     = meltStep.get(userId) ?? 0
	const fraction = Math.max(0, 1 - step / ICE_THAW_S)
	const height   = ICE_SIZE * fraction
	if (rig.player !== undefined) {
		const src = Transform.getOrNull(rig.player)
		if (src !== null) {
			rig.feetX = src.position.x
			rig.feetY = src.position.y
			rig.feetZ = src.position.z
		}
		if (rig.feetX === undefined || rig.feetY === undefined || rig.feetZ === undefined) {
			console.log(`frost/rescue: applyMeltScale: no pose yet for ${userId}`)
			return
		}
		const blockT = Transform.getMutable(rig.block)
		blockT.scale    = Vector3.create(ICE_SIZE, height, ICE_SIZE)
		blockT.position = Vector3.create(rig.feetX, rig.feetY + height / 2, rig.feetZ)
		return
	}
	const blockT = Transform.getMutable(rig.block)
	blockT.scale    = Vector3.create(ICE_SIZE, height, ICE_SIZE)
	blockT.position = Vector3.create(0, height / 2 + remoteIceOffsetY(userId), 0)
}


// MARK: holdMelt
function holdMelt(
	userId: string,
	step  : number,
): void {
	const same = meltSentId === userId && meltSentStep === step
	if (same && meltPing < MELT_PING_S) return
	const changed = !same
	meltSentId   = userId
	meltSentStep = step
	meltPing     = 0
	room.send('frostMeltRequest', { userId, step, live: 1 })
	if (changed) console.log(`frost/rescue: holdMelt: ${userId} step ${step}`)
}


// MARK: releaseMelt
function releaseMelt(): void {
	if (!meltSentId) {
		meltSentStep = -1
		meltPing     = 0
		return
	}
	const id   = meltSentId
	meltSentId   = ''
	meltSentStep = -1
	meltPing     = 0
	room.send('frostMeltRequest', { userId: id, step: 0, live: 0 })
	console.log(`frost/rescue: releaseMelt: ${id}`)
}


// MARK: dropIce
function dropIce(userId: string): void {
	const rig = iceByUser.get(userId)
	if (rig === undefined) return
	engine.removeEntity(rig.block)
	if (rig.anchor !== undefined) engine.removeEntity(rig.anchor)
	iceByUser.delete(userId)
	meltStep.delete(userId)
	if (sentFor === userId) sentFor = ''
}


// MARK: syncIceBlocks
function syncIceBlocks(me: string): void {
	const live = new Set<string>()
	if (me && remoteFrozen.has(me)) {
		remoteFrozen.delete(me)
		dropIce(me)
	}
	const self = FrostDeath.getOrNull(engine.PlayerEntity)
	if (me && self !== null && !self.awake) {
		live.add(me)
		ensureIce(me, engine.PlayerEntity)
		applyMeltScale(me)
	}
	for (const id of remoteFrozen.keys()) {
		if (id === me) continue
		live.add(id)
		ensureRemoteIce(id)
		applyMeltScale(id)
	}
	const gone: string[] = []
	for (const id of iceByUser.keys()) {
		if (!live.has(id)) gone.push(id)
	}
	for (const id of gone) dropIce(id)
}


// MARK: closestFrozenOther
function closestFrozenOther(me: string): string {
	const self = Transform.getOrNull(engine.PlayerEntity)
	if (self === null) return ''
	let bestId = ''
	let bestD  = RESCUE_R_SQ
	for (const [id, spot] of remoteFrozen) {
		if (id === me) continue
		const dx = self.position.x - spot.x
		const dz = self.position.z - spot.z
		const d  = dx * dx + dz * dz
		if (d > bestD) continue
		bestD  = d
		bestId = id
	}
	return bestId
}


// MARK: tickHeartbeat
function tickHeartbeat(dt: number): void {
	if (!localUserId()) return
	heartbeat += dt
	if (heartbeat < HEARTBEAT_S) return
	heartbeat = 0
	room.send('frostPresence', {
		userId: localUserId(),
		mobile: isMobile() ? 1 : 0,
	})
}


// MARK: tickThaw
function tickThaw(dt: number, me: string): void {
	const selfFrozen = FrostDeath.getOrNull(engine.PlayerEntity)
	if (!isTorchLit() || (selfFrozen !== null && !selfFrozen.awake)) {
		releaseMelt()
		thawTimer = 0
		pendingId = ''
		return
	}
	const target = closestFrozenOther(me)
	if (!target) {
		releaseMelt()
		thawTimer = 0
		pendingId = ''
		return
	}
	const partial = Math.floor(ICE_THAW_S) - 1
	if (sentFor === target) {
		meltPing += dt
		holdMelt(target, partial)
		sentAgo += dt
		if (sentAgo < RESCUE_RETRY_S) return
		sentFor   = ''
		thawTimer = meltStep.get(target) ?? partial
	}
	if (pendingId !== target) {
		releaseMelt()
		pendingId = target
		thawTimer = meltStep.get(target) ?? 0
	}
	thawTimer += dt
	meltPing  += dt
	const step = Math.min(partial, Math.max(0, Math.floor(thawTimer)))
	holdMelt(target, step)
	if (thawTimer < ICE_THAW_S) return
	meltSentId   = ''
	meltSentStep = -1
	meltPing     = 0
	sentFor      = target
	sentAgo      = 0
	thawTimer    = 0
	room.send('frostRescue', { userId: target })
	console.log(`frost/rescue: tickThaw: asked the server to thaw ${target}`)
}


// MARK: setupFrostRescue
/**
 * Draw ice for frozen players and run the torch thaw. Idempotent.
 * Call once from client bootstrap, after setupFrostDeath.
 */
export function setupFrostRescue(): void {
	if (installed) {
		console.log('frost/rescue: setupFrostRescue: already installed, skipping')
		return
	}
	installed = true

	room.onMessage('playerPlatform', ({ userId, mobile }) => {
		const id = userId.toLowerCase()
		if (!id) return
		if (mobile === 1) remoteMobile.add(id)
		else remoteMobile.delete(id)
		if (iceByUser.has(id)) applyMeltScale(id)
	})

	room.onMessage('frostFrozen', ({ userId, x, z, frozen, cue }) => {
		const id = userId.toLowerCase()
		const me = localUserId()
		if (me && id === me) return
		if (frozen === 0) {
			remoteFrozen.delete(id)
			meltStep.delete(id)
			dropIce(id)
			console.log(`frost/rescue: frostFrozen: ${id} thawed`)
			return
		}
		meltStep.delete(id)
		remoteFrozen.set(id, { x, z })
		// cue is 1 only on a fresh freeze. A joiner's hydration of cubes
		// already in the world must not replay the crack.
		if (cue === 1) playIceCubeSfxAt(Vector3.create(x, 1.2, z))
		console.log(`frost/rescue: frostFrozen: ${id} at ${x.toFixed(1)}, ${z.toFixed(1)}`)
	})

	room.onMessage('frostMelt', ({ userId, step, live }) => {
		const id = userId.toLowerCase()
		if (step <= 0) meltStep.delete(id)
		else meltStep.set(id, step)
		applyMeltScale(id)
		if (id === localUserId()) noteLocalMelt(Math.max(0, step), live === 1)
		console.log(`frost/rescue: frostMelt: ${id} step ${step} live ${live}`)
	})

	room.onMessage('frostRescued', ({ userId }) => {
		const id = userId.toLowerCase()
		if (sentFor === id) sentFor = ''
		if (id !== localUserId()) return
		grantFrostRescue()
	})

	engine.addSystem((dt: number) => {
		const me = localUserId()
		tickHeartbeat(dt)
		syncIceBlocks(me)
		tickThaw(dt, me)
	})

	console.log('frost/rescue: setupFrostRescue: installed')
}
