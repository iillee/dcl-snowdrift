/**
 * sceneBoundsDebug.ts — temporary mobile leave-scene debugger.
 *
 * Floating billboard above the player shows world X/Z, live parcel
 * footprint from getSceneInformation (not authored settings), distance
 * to each edge, and whether onLeaveScene just fired. Hidden by default;
 * toggle via the frost-bar "xy" button.
 */

import {
	Billboard,
	engine,
	executeTask,
	TextShape,
	Transform,
	VisibilityComponent,
} from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { getPlayer, onEnterScene, onLeaveScene } from '@dcl/sdk/src/players'
import { getExplorerInformation, getRealm, getSceneInformation } from '~system/Runtime'

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import {
	SCENE_WORLD_SIZE_X_METERS,
	SCENE_WORLD_SIZE_Z_METERS,
} from 'src/shared/settings'


const EDGE_WARN_M  = 32
const LABEL_HEIGHT = 2.4
const UPDATE_EVERY = 0.25


type LiveBounds = {
	minX   : number
	maxX   : number
	minZ   : number
	maxZ   : number
	count  : number
	spanX  : number
	spanZ  : number
	source : string
}

let labelEntity: ReturnType<typeof engine.addEntity> | null = null
let visible     = false
let leftScene   = false
let lastLeaveAt = 0
let lastLeaveX  = 0
let lastLeaveZ  = 0
let accum       = 0
let live: LiveBounds = {
	minX:   0,
	maxX:   SCENE_WORLD_SIZE_X_METERS,
	minZ:   0,
	maxZ:   SCENE_WORLD_SIZE_Z_METERS,
	count:  0,
	spanX:  SCENE_WORLD_SIZE_X_METERS / 16,
	spanZ:  SCENE_WORLD_SIZE_Z_METERS / 16,
	source: 'settings-fallback',
}
let setupDone = false


// MARK: isSceneBoundsDebugVisible
/** True when the floating bounds billboard is shown. */
export function isSceneBoundsDebugVisible(): boolean {
	return visible
}


// MARK: setSceneBoundsDebugVisible
/** Show or hide the floating bounds billboard. */
export function setSceneBoundsDebugVisible(next: boolean): void {
	visible = next
	applyVisibility()
	if (visible) {
		const t = Transform.getOrNull(engine.PlayerEntity)
		if (t) refreshLabel(t.position.x, t.position.y, t.position.z)
		console.log('sceneBoundsDebug: setSceneBoundsDebugVisible: shown')
	} else {
		console.log('sceneBoundsDebug: setSceneBoundsDebugVisible: hidden')
	}
}


// MARK: toggleSceneBoundsDebug
/** Flip the floating bounds billboard on/off. */
export function toggleSceneBoundsDebug(): void {
	setSceneBoundsDebugVisible(!visible)
}


// MARK: setupSceneBoundsDebug
/**
 * Mount the floating bounds HUD (hidden) and wire enter/leave listeners.
 * Safe to call once from client boot.
 */
export function setupSceneBoundsDebug(): void {
	if (setupDone) return
	setupDone = true

	labelEntity = engine.addEntity()
	Transform.create(labelEntity, {
		position: { x: CAMPFIRE_WORLD_X, y: LABEL_HEIGHT, z: CAMPFIRE_WORLD_Z },
	})
	Billboard.create(labelEntity)
	TextShape.create(labelEntity, {
		text:         '',
		fontSize:     2,
		textColor:    Color4.create(1, 1, 0.4, 1),
		outlineColor: Color4.Black(),
		outlineWidth: 0.15,
	})
	VisibilityComponent.create(labelEntity, { visible: false })

	onLeaveScene((userId) => {
		const me = getPlayer()?.userId
		if (me && userId !== me) return
		const t = Transform.getOrNull(engine.PlayerEntity)
		leftScene   = true
		lastLeaveAt = Date.now()
		lastLeaveX  = t?.position.x ?? NaN
		lastLeaveZ  = t?.position.z ?? NaN
		console.log(
			`sceneBoundsDebug: onLeaveScene: userId=${userId} ` +
			`pos=(${fmt(lastLeaveX)}, ${fmt(lastLeaveZ)}) ` +
			`live=${live.spanX}x${live.spanZ} (${live.count}) via ${live.source} ` +
			`edges=${edgeSummary(lastLeaveX, lastLeaveZ)}`,
		)
		if (visible) refreshLabel(lastLeaveX, t?.position.y ?? 0, lastLeaveZ)
	})

	onEnterScene((player) => {
		const me = getPlayer()?.userId
		if (me && player.userId !== me) return
		leftScene = false
		console.log(`sceneBoundsDebug: onEnterScene: userId=${player.userId}`)
	})

	engine.addSystem((dt) => {
		if (!visible) return
		accum += dt
		if (accum < UPDATE_EVERY) return
		accum = 0

		const t = Transform.getOrNull(engine.PlayerEntity)
		if (!t) return
		const { x, y, z } = t.position
		refreshLabel(x, y, z)
		followPlayer(x, y, z)

		const near = Math.min(
			x - live.minX,
			z - live.minZ,
			live.maxX - x,
			live.maxZ - z,
		)
		if (near < EDGE_WARN_M || leftScene) {
			console.log(
				`sceneBoundsDebug: tick: pos=(${fmt(x)}, ${fmt(y)}, ${fmt(z)}) ` +
				`parcel=${parcelOf(x)},${parcelOf(z)} ` +
				`live=${live.spanX}x${live.spanZ} edges=${edgeSummary(x, z)} left=${leftScene}`,
			)
		}
	})

	executeTask(async () => {
		try {
			const [info, realm, explorer] = await Promise.all([
				getSceneInformation({}),
				getRealm({}),
				getExplorerInformation({}),
			])
			const metaJsonLen = info.metadataJson?.length ?? 0
			const meta = JSON.parse(info.metadataJson) as {
				scene?: { parcels?: string[], base?: string }
			}
			const parcels = meta.scene?.parcels ?? []
			const realmName = realm.realmInfo?.realmName ?? '?'
			const preview  = realm.realmInfo?.isPreview === true
			const platform = explorer.platform ?? '?'
			const agent    = explorer.agent ?? '?'

			console.log(
				`sceneBoundsDebug: runtime: platform=${platform} preview=${preview} ` +
				`realm=${realmName} agent=${agent} metadataJsonBytes=${metaJsonLen}`,
			)

			if (parcels.length === 0) {
				console.log(
					'sceneBoundsDebug: getSceneInformation: no parcels in metadataJson; ' +
					`keeping ${live.source}`,
				)
				return
			}

			const first = parcels[0]
			const last  = parcels[parcels.length - 1]
			live = boundsFromParcels(parcels)
			live.source = preview ? 'preview' : 'world'

			console.log(
				`sceneBoundsDebug: getSceneInformation: ${live.count} parcels ` +
				`${live.spanX}x${live.spanZ} ` +
				`meters (${fmt(live.minX)}..${fmt(live.maxX)}, ${fmt(live.minZ)}..${fmt(live.maxZ)}) ` +
				`base=${meta.scene?.base ?? '?'} first=${first} last=${last} ` +
				`authoredSettings=${SCENE_WORLD_SIZE_X_METERS}`,
			)
			if (
				live.spanX * 16 !== SCENE_WORLD_SIZE_X_METERS ||
				live.spanZ * 16 !== SCENE_WORLD_SIZE_Z_METERS
			) {
				console.log(
					`sceneBoundsDebug: MISMATCH: live footprint ${live.spanX}x${live.spanZ} parcels ` +
					`!= authored ${SCENE_WORLD_SIZE_X_METERS / 16}x${SCENE_WORLD_SIZE_Z_METERS / 16}. ` +
					`Same binary on desktop vs mobile means the client/realm served different scene metadata.`,
				)
			}
		} catch (err) {
			console.log(`sceneBoundsDebug: getSceneInformation failed: ${err}`)
		}
	})

	console.log(
		`sceneBoundsDebug: setupSceneBoundsDebug: billboard hidden by default; ` +
		`settings-fallback=${SCENE_WORLD_SIZE_X_METERS}x${SCENE_WORLD_SIZE_Z_METERS}m ` +
		`hearth=(${fmt(CAMPFIRE_WORLD_X)}, ${fmt(CAMPFIRE_WORLD_Z)})`,
	)
}


// MARK: applyVisibility
function applyVisibility(): void {
	if (!labelEntity) return
	VisibilityComponent.createOrReplace(labelEntity, { visible })
	if (!visible) {
		const tx = TextShape.getMutableOrNull(labelEntity)
		if (tx) tx.text = ''
	}
}


// MARK: boundsFromParcels
function boundsFromParcels(parcels: string[]): LiveBounds {
	let minPX = Infinity
	let maxPX = -Infinity
	let minPZ = Infinity
	let maxPZ = -Infinity
	for (const p of parcels) {
		const [xs, zs] = p.split(',')
		const px = Number(xs)
		const pz = Number(zs)
		if (!Number.isFinite(px) || !Number.isFinite(pz)) continue
		minPX = Math.min(minPX, px)
		maxPX = Math.max(maxPX, px)
		minPZ = Math.min(minPZ, pz)
		maxPZ = Math.max(maxPZ, pz)
	}
	const spanX = maxPX - minPX + 1
	const spanZ = maxPZ - minPZ + 1
	return {
		minX:   minPX * 16,
		maxX:   (maxPX + 1) * 16,
		minZ:   minPZ * 16,
		maxZ:   (maxPZ + 1) * 16,
		count:  parcels.length,
		spanX,
		spanZ,
		source: 'getSceneInformation',
	}
}


// MARK: refreshLabel
function refreshLabel(x: number, y: number, z: number): void {
	if (!labelEntity || !visible) return
	const tx = TextShape.getMutableOrNull(labelEntity)
	if (!tx) return

	const px = parcelOf(x)
	const pz = parcelOf(z)
	const dW = x - live.minX
	const dE = live.maxX - x
	const dS = z - live.minZ
	const dN = live.maxZ - z
	const inside =
		x >= live.minX && x < live.maxX &&
		z >= live.minZ && z < live.maxZ

	const status = leftScene
		? `LEFT SCENE @ (${fmt(lastLeaveX)}, ${fmt(lastLeaveZ)})`
		: inside
			? 'IN SCENE'
			: 'OUTSIDE LIVE PARCELS'

	const mismatch =
		(live.source === 'getSceneInformation' || live.source === 'preview' || live.source === 'world') &&
		(live.spanX * 16 !== SCENE_WORLD_SIZE_X_METERS ||
			live.spanZ * 16 !== SCENE_WORLD_SIZE_Z_METERS)

	tx.text =
		`${status}\n` +
		`live ${live.spanX}x${live.spanZ} (${live.count}) ${live.source}` +
		(mismatch ? ' MISMATCH' : '') + `\n` +
		`xyz ${fmt(x)}  ${fmt(y)}  ${fmt(z)}\n` +
		`parcel ${px},${pz}\n` +
		`edge W${fmt(dW)} E${fmt(dE)} S${fmt(dS)} N${fmt(dN)}\n` +
		`hearth Δx ${fmt(x - CAMPFIRE_WORLD_X)} Δz ${fmt(z - CAMPFIRE_WORLD_Z)}\n` +
		`want ${SCENE_WORLD_SIZE_X_METERS / 16}x${SCENE_WORLD_SIZE_Z_METERS / 16}` +
		(leftScene ? `\nleft ${((Date.now() - lastLeaveAt) / 1000).toFixed(1)}s ago` : '')

	tx.textColor = leftScene || !inside || mismatch
		? Color4.create(1, 0.25, 0.25, 1)
		: Math.min(dW, dE, dS, dN) < EDGE_WARN_M
			? Color4.create(1, 0.7, 0.2, 1)
			: Color4.create(0.6, 1, 0.6, 1)
}


// MARK: followPlayer
function followPlayer(x: number, y: number, z: number): void {
	if (!labelEntity) return
	const t = Transform.getMutableOrNull(labelEntity)
	if (!t) return
	t.position.x = x
	t.position.y = y + LABEL_HEIGHT
	t.position.z = z
}


// MARK: parcelOf
function parcelOf(meters: number): number {
	return Math.floor(meters / 16)
}


// MARK: edgeSummary
function edgeSummary(x: number, z: number): string {
	return (
		`W${fmt(x - live.minX)} E${fmt(live.maxX - x)} ` +
		`S${fmt(z - live.minZ)} N${fmt(live.maxZ - z)}`
	)
}


// MARK: fmt
function fmt(n: number): string {
	if (!Number.isFinite(n)) return '?'
	return n.toFixed(1)
}
