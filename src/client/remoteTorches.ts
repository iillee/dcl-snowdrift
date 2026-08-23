/**
 * remoteTorches.ts — held-torch visuals for every OTHER player in the
 * scene.
 *
 * Simplified port of flagtag's handBoomerangSetup + remoteBoomerangSystem:
 *
 *   * Only one prop (torch) — no colors, no left hand, no charge/orbit VFX.
 *   * Torch attachment is DRIVEN by presence, not by an "equip" message:
 *     since every player is v1-equipped with a torch, we attach one to
 *     every remote avatar we see and destroy it when they leave. A
 *     periodic reconcile against PlayerIdentityData catches join/leave
 *     even when we miss the initial event.
 *   * The only piece of state we sync per-player is a single lit bit
 *     (`torchLitFrom`, relayed by the auth server) which toggles the
 *     flame sphere's visibility on that remote's torch. Fuel level and
 *     smoke are not synced — the flame is either on or off.
 *
 * Pattern mirrors src/client/torch.ts's two-layer AvatarAttach setup:
 *   Anchor (AvatarAttach, right hand)   <-- Bevy propagates bone
 *     Model (STATIC child, offsets set once)
 *     Flame (STATIC child, VisibilityComponent toggled)
 *
 * The anchor's Transform is written once and never mutated after
 * AvatarAttach.create — same race caveat as torch.ts.
 */

import {
	AvatarAnchorPointType,
	AvatarAttach,
	Entity,
	GltfContainer,
	Material,
	MeshRenderer,
	PlayerIdentityData,
	Transform,
	VisibilityComponent,
	engine,
} from '@dcl/sdk/ecs'
import { getPlayer } from '@dcl/sdk/players'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'

import { room } from 'src/shared/messages'


// MARK: Tuning
// Kept identical to src/client/torch.ts so the local and remote torches
// read as the same prop. If you tune torch offsets over there, mirror
// the change here (or later refactor to share a constants module).
const TORCH_MODEL       = 'assets/asset-packs/large_log/Log_Large_01/Log_Large_01.glb'
const TORCH_SCALE       = 0.09
const TORCH_OFFSET      = Vector3.create(0.04, 0.12, 0.10)
const TORCH_ROTATION    = Quaternion.fromEulerDegrees(90, -30, 90)
const TORCH_MODEL_SCALE = Vector3.create(TORCH_SCALE, TORCH_SCALE * 2, TORCH_SCALE * 2)

const FLAME_LOCAL_POS   = Vector3.create(-0.11, 0.10, 0.28)
const FLAME_SIZE        = 0.16
const FLAME_COLOR_HOT   = Color4.create(1.00, 0.80, 0.30, 1)
const FLAME_EMISSIVE    = 1.6

// Reconcile-against-PlayerIdentityData cadence. Fast enough that a
// join/leave feels instant, cheap enough that the query itself is a
// non-event: PlayerIdentityData is a small set (typical rooms <20
// players), and the body only allocates when a diff exists.
const RECON_INTERVAL_S  = 1.0


// MARK: State
interface RemoteTorch {
	anchor: Entity
	model : Entity
	flame : Entity
}

const remoteTorches       = new Map<string, RemoteTorch>()
let   installed           = false
let   reconClock          = 0
let   localUserIdLower    = ''


// MARK: resolveLocalUserId
// getPlayer() returns null during early boot; re-poll until we have an
// address. Cached in localUserIdLower so we don't hit the helper every
// frame after resolution.
function resolveLocalUserId(): string {
	if (localUserIdLower !== '') return localUserIdLower
	const id = getPlayer()?.userId
	if (!id) return ''
	localUserIdLower = id.toLowerCase()
	return localUserIdLower
}


// MARK: createRemoteTorch
function createRemoteTorch(userIdLower: string): void {
	if (remoteTorches.has(userIdLower)) return

	const anchor = engine.addEntity()
	AvatarAttach.create(anchor, {
		avatarId     : userIdLower,
		anchorPointId: AvatarAnchorPointType.AAPT_RIGHT_HAND,
	})
	Transform.create(anchor, { position: Vector3.Zero(), scale: Vector3.One() })

	const model = engine.addEntity()
	Transform.create(model, {
		parent  : anchor,
		position: TORCH_OFFSET,
		rotation: TORCH_ROTATION,
		scale   : TORCH_MODEL_SCALE,
	})
	GltfContainer.create(model, {
		src                         : TORCH_MODEL,
		visibleMeshesCollisionMask  : 0,
		invisibleMeshesCollisionMask: 0,
	})

	const flame = engine.addEntity()
	Transform.create(flame, {
		parent  : anchor,
		position: FLAME_LOCAL_POS,
		scale   : Vector3.create(FLAME_SIZE, FLAME_SIZE, FLAME_SIZE),
	})
	MeshRenderer.setSphere(flame)
	Material.setPbrMaterial(flame, {
		albedoColor      : FLAME_COLOR_HOT,
		emissiveColor    : FLAME_COLOR_HOT,
		emissiveIntensity: FLAME_EMISSIVE,
		roughness        : 1.0,
	})
	// Start hidden. Server hydrates lit state via `torchLitFrom` on
	// join, and every subsequent change edge on that remote's client
	// pushes another update through the same channel.
	VisibilityComponent.create(flame, { visible: false })

	remoteTorches.set(userIdLower, { anchor, model, flame })
	console.log(`remoteTorches: attached torch to ${userIdLower}`)
}


// MARK: removeRemoteTorch
function removeRemoteTorch(userIdLower: string): void {
	const rt = remoteTorches.get(userIdLower)
	if (!rt) return
	engine.removeEntity(rt.flame)
	engine.removeEntity(rt.model)
	engine.removeEntity(rt.anchor)
	remoteTorches.delete(userIdLower)
	console.log(`remoteTorches: removed torch for ${userIdLower}`)
}


// MARK: setRemoteLit
function setRemoteLit(userIdLower: string, lit: boolean): void {
	const rt = remoteTorches.get(userIdLower)
	if (!rt) {
		// Message arrived before reconcile spotted them (rare — hydration
		// from the server on join runs before our first reconcile). Create
		// the torch now so the flame edge doesn't get lost, then re-apply.
		createRemoteTorch(userIdLower)
	}
	const target = remoteTorches.get(userIdLower)
	if (!target) return
	const vis = VisibilityComponent.getMutableOrNull(target.flame)
	if (vis !== null && vis.visible !== lit) vis.visible = lit
}


// MARK: reconcileRemoteTorches
// Sweep every PlayerIdentityData entity in the scene, attaching torches
// to newcomers and cleaning up ones whose owner left. Cheap enough to
// run every second — the query is O(n) in player count and typical
// rooms are small.
function reconcileRemoteTorches(): void {
	const localId = resolveLocalUserId()
	const seen    = new Set<string>()

	for (const [, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
		const addr = identity.address?.toLowerCase()
		if (!addr || addr === localId) continue
		seen.add(addr)
		if (!remoteTorches.has(addr)) createRemoteTorch(addr)
	}

	// Anyone we're tracking who isn't in the scene anymore -> tear down.
	remoteTorches.forEach((_rt, id) => {
		if (!seen.has(id)) removeRemoteTorch(id)
	})
}


// MARK: setupRemoteTorches
/**
 * Install the remote-torch renderer. Idempotent — safe to call once
 * from client bootstrap. Subscribes to `torchLitFrom` (relay from the
 * auth server) for flame toggles, and runs a 1 Hz reconcile against
 * PlayerIdentityData to attach/detach torches as players join and leave.
 */
export function setupRemoteTorches(): void {
	if (installed) {
		console.log('remoteTorches: setupRemoteTorches: already installed, skipping')
		return
	}
	installed = true

	room.onMessage('torchLitFrom', ({ userId, lit }) => {
		if (!userId) return
		const id = userId.toLowerCase()
		if (id === resolveLocalUserId()) return  // ignore our own echo
		setRemoteLit(id, lit === 1)
	})

	engine.addSystem((dt: number) => {
		reconClock += dt
		if (reconClock < RECON_INTERVAL_S) return
		reconClock = 0
		reconcileRemoteTorches()
	})

	console.log('remoteTorches: setupRemoteTorches: reconcile + torchLitFrom relay active')
}
