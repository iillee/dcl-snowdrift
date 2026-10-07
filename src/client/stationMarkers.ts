/**
 * stationMarkers.ts — ignition station stumps, debug beacons, click-
 * to-activate grow/spin, and Witness-style beams to the volcano.
 *
 * Monuments ignite with a carried flame: stand within IGNITE_RADIUS_M
 * holding a LIT torch and press E (or tap the IGNITE MONUMENT prompt),
 * same gate as lighting a hidden campfire. Once lit the stone keeps its
 * grey colour (red tint off, MONUMENT_LIT_RED_TINT) with an eternal Warm
 * flame on top (heat + melt, no fuel).
 * On activate it grows to 1.5×
 * height while spinning 180° over ~2 s, then a magenta beam shoots
 * from its top toward the lava centre. State is server-authoritative
 * (stationActivate / stationState), matching the hidden-campfire
 * pattern. No tablet, no wood cost.
 *
 * STATION_DEBUG_BEACONS still draws the tall find-me columns; they
 * shrink/dim once that station activates so the real beam takes over.
 */

import {
	ColliderLayer,
	Entity,
	Material,
	MaterialTransparencyMode,
	MeshCollider,
	MeshRenderer,
	Transform,
	engine,
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

import { onCycleSeedChange, getCurrentCycleSeed } from 'src/client/cycle'
import { playMonumentSfxAt } from 'src/client/audio'
import { createFlameRig, FlameRig } from 'src/client/flameBillboards'
import { isTorchLit } from 'src/client/torchEquip'
import { beginVolcanoThaw, setVolcanoLavaVisible } from 'src/client/volcanoCrown'
import { setVolcanoSmokeBoost } from 'src/client/volcanoSmoke'
import { cycleSeedsEqual } from 'src/shared/cycleMazeSeed'
import { room } from 'src/shared/messages'
import { CRATER_HEAT_FUEL, CRATER_HEAT_RADIUS_M } from 'src/shared/terrain/volcanoCraterHeat'
import { TERRAIN_CELL_M } from 'src/shared/settings'
import { SNOW_STAGE_HEIGHT_M, STAGE_PRISTINE } from 'src/shared/snowGrid'
import { activeGroundYAt, activeTerrain } from 'src/shared/terrain/terrainCache'
import {
	TerrainMap,
	cellCenterWorld,
} from 'src/shared/terrain/terrainMap'
import {
	volcanoLavaCentroid,
	volcanoLavaTopY,
	volcanoRimY,
} from 'src/shared/terrain/volcanoCrown'


// MARK: Flags
/**
 * Temporary: tall glowing column above each station so they can be
 * found from across the map. Visual only. Set false when real beams
 * are enough on their own. Dimmed automatically once a station activates.
 */
export const STATION_DEBUG_BEACONS = false


// MARK: Tuning
const SNOW_MAX_DEPTH_M   = SNOW_STAGE_HEIGHT_M[STAGE_PRISTINE]
const STUMP_ABOVE_SNOW_M = 2
/** Idle stump height above ground (m): snow max + 2 m clear. */
const STUMP_H_M      = SNOW_MAX_DEPTH_M + STUMP_ABOVE_SNOW_M
/** Activated stump height = idle × 1.5 (~5.25 m). */
const STUMP_ACTIVE_H_M = STUMP_H_M * 1.5
const STUMP_XZ_M     = 0.85
const STUMP_SINK_M   = 0.05
const COLOR_STONE    = Color4.create(0.32, 0.30, 0.28, 1)

const BEACON_H_M  = 150
const BEACON_XZ_M = 1.2
const BEACON_XZ_DIM_M = 0.35
const COLOR_BEACON    = Color4.create(1.0, 0.2, 0.85, 1)
const BEACON_EMISSIVE = Color3.create(1.0, 0.2, 0.85)
const BEACON_EMISSIVE_INTENSITY = 4
const BEACON_DIM_INTENSITY = 0.6

/** Grow + spin window (s). */
const ANIM_DURATION_S = 2.0
/** Yaw spun during the grow (radians). */
const ANIM_YAW_RAD    = Math.PI

const BEAM_XZ_M = 0.55
/** How many thin boxes make up one beam (cheap Witness fade). */
const BEAM_SEGMENTS = 10
/**
 * Fraction of path length where fade begins. Last ~28% softens into
 * the plume / lava so the beam does not read as a hard bar into the mountain.
 */
const BEAM_FADE_START = 0.72
const COLOR_BEAM    = Color4.create(1.0, 0.25, 0.9, 1)
const BEAM_EMISSIVE = Color3.create(1.0, 0.25, 0.9)
const BEAM_EMISSIVE_INTENSITY = 5

/** XZ distance (m) from stump centre within which a lit torch can ignite it. */
const IGNITE_RADIUS_M    = 3.5
const IGNITE_RADIUS_SQ_M = IGNITE_RADIUS_M * IGNITE_RADIUS_M
/** Warm-tier heat ring around a lit monument (same as crater / opening hearth). */
export const MONUMENT_HEAT_RADIUS_M    = CRATER_HEAT_RADIUS_M
const MONUMENT_HEAT_RADIUS_SQ_M        = MONUMENT_HEAT_RADIUS_M * MONUMENT_HEAT_RADIUS_M
/** Lit stone: ember red, glowing. */
const COLOR_STONE_LIT    = Color4.create(0.45, 0.10, 0.06, 1)
const EMBER_EMISSIVE     = Color3.create(1.0, 0.22, 0.05)
const EMBER_EMISSIVE_INTENSITY = 1.6
/** Ember-red tint + glow on lit stone. Off for now: lit = normal stone + flame. */
const MONUMENT_LIT_RED_TINT = false
const STATION_COUNT_MAX = 3


// MARK: Types
type Slot = {
	stump   : Entity
	beacon  : Entity | null
	beams   : Entity[]
	groundY : number
	cx      : number
	cz      : number
	/** 0 idle → 1 finished. */
	animT   : number
	animating: boolean
	active  : boolean
	baseYaw : number
	/** Eternal flame on the stump top (null until lit). */
	flame   : FlameRig | null
	flameAnchor: Entity | null
}


// MARK: State
const slots: Array<Slot | null> = [null, null, null]
const pendingActive = [false, false, false]
let lastMap: TerrainMap | null = null
let currentSeed = 0
let installed = false
let mobile = false


// MARK: isStationLit
/** True once station `i` (index into map.stations) is lit this cycle. */
export function isStationLit(i: number): boolean {
	if (i < 0 || i >= STATION_COUNT_MAX) return false
	return pendingActive[i] || slots[i]?.active === true
}


// MARK: getActiveStationCount
/** How many stations are currently active (0–3). */
export function getActiveStationCount(): number {
	let n = 0
	for (const s of slots) if (s?.active) n++
	for (let i = 0; i < STATION_COUNT_MAX; i++) {
		if (!slots[i] && pendingActive[i]) n++
	}
	return Math.min(STATION_COUNT_MAX, n)
}


/** True once this client has fired the 3/3 thaw for the current cycle. */
let volcanoThawed = false


// MARK: syncVolcanoFromStations
/**
 * Push active count into smoke + lava.
 *   0–2: smoke ramps; lava entities destroyed (snowy crater).
 *   3: fire thaw once — reveal lava; smoke already at max.
 */
function syncVolcanoFromStations(): void {
	const n = getActiveStationCount()
	setVolcanoSmokeBoost(n)
	if (n >= 3) {
		if (!volcanoThawed) {
			volcanoThawed = true
			beginVolcanoThaw()
		} else {
			setVolcanoLavaVisible(true)
		}
	} else {
		volcanoThawed = false
		setVolcanoLavaVisible(false)
	}
}


// MARK: ease
function smoothstep(t: number): number {
	const x = t < 0 ? 0 : t > 1 ? 1 : t
	return x * x * (3 - 2 * x)
}


// MARK: applyStumpPose
function applyStumpPose(slot: Slot, height: number, yaw: number): void {
	const tr = Transform.getMutableOrNull(slot.stump)
	if (tr === null) return
	const h = height + STUMP_SINK_M
	const c = cellCenterWorld(slot.cx, slot.cz)
	tr.position = Vector3.create(c.x, slot.groundY - STUMP_SINK_M + h / 2, c.z)
	tr.scale    = Vector3.create(STUMP_XZ_M, h, STUMP_XZ_M)
	tr.rotation = Quaternion.fromEulerDegrees(0, yaw * (180 / Math.PI), 0)
}


// MARK: setBeaconDim
function setBeaconDim(slot: Slot, dim: boolean): void {
	if (slot.beacon === null) return
	const tr = Transform.getMutableOrNull(slot.beacon)
	if (tr !== null) {
		const xz = dim ? BEACON_XZ_DIM_M : BEACON_XZ_M
		tr.scale = Vector3.create(xz, BEACON_H_M, xz)
	}
	if (mobile) {
		Material.setBasicMaterial(slot.beacon, {
			diffuseColor: dim
				? Color4.create(0.55, 0.15, 0.5, 0.55)
				: COLOR_BEACON,
			castShadows: false,
		})
	} else {
		Material.setPbrMaterial(slot.beacon, {
			albedoColor      : dim
				? Color4.create(0.55, 0.15, 0.5, 0.55)
				: COLOR_BEACON,
			emissiveColor    : BEACON_EMISSIVE,
			emissiveIntensity: dim ? BEACON_DIM_INTENSITY : BEACON_EMISSIVE_INTENSITY,
			roughness        : 1.0,
			metallic         : 0.0,
			castShadows      : false,
		})
	}
}


// MARK: volcanoBeamTarget
/** World point the beam aims at: lava centroid on the lava lid, else marker. */
function volcanoBeamTarget(map: TerrainMap): { x: number; y: number; z: number } | null {
	if (!map.volcano) return null
	const lava = volcanoLavaCentroid(map)
	// lava.fx/fz are fractional cell indices (centroid of integer cells).
	const fx = lava ? lava.fx : map.volcano.cx
	const fz = lava ? lava.fz : map.volcano.cz
	const origin = cellCenterWorld(0, 0)
	return {
		x: origin.x + fx * TERRAIN_CELL_M,
		y: lava ? volcanoLavaTopY() : volcanoRimY() + 2,
		z: origin.z + fz * TERRAIN_CELL_M,
	}
}


// MARK: clearBeams
function clearBeams(slot: Slot): void {
	for (const e of slot.beams) engine.removeEntity(e)
	slot.beams.length = 0
}


// MARK: beamStrengthAt
/** 1 along most of the path; smooth falloff over the final fade window. */
function beamStrengthAt(t: number): number {
	if (t <= BEAM_FADE_START) return 1
	const u = (t - BEAM_FADE_START) / (1 - BEAM_FADE_START)
	return 1 - smoothstep(u)
}


// MARK: paintBeamSegment
function paintBeamSegment(e: Entity, strength: number): void {
	const a = Math.max(0.04, strength)
	const col = Color4.create(COLOR_BEAM.r, COLOR_BEAM.g, COLOR_BEAM.b, a)
	if (mobile) {
		Material.setBasicMaterial(e, { diffuseColor: col, castShadows: false })
		return
	}
	Material.setPbrMaterial(e, {
		albedoColor      : col,
		emissiveColor    : BEAM_EMISSIVE,
		emissiveIntensity: BEAM_EMISSIVE_INTENSITY * strength,
		roughness        : 1.0,
		metallic         : 0.0,
		transparencyMode : MaterialTransparencyMode.MTM_ALPHA_BLEND,
		castShadows      : false,
	})
}


// MARK: spawnBeam
/**
 * Witness-style beam: several thin boxes from stump top toward the
 * lava. Bright for most of the path; last ~(1-BEAM_FADE_START) softens
 * alpha, emissive and thickness so it dissolves into the plume.
 */
function spawnBeam(slot: Slot, map: TerrainMap): void {
	clearBeams(slot)
	const target = volcanoBeamTarget(map)
	if (!target) return
	const c = cellCenterWorld(slot.cx, slot.cz)
	const start = Vector3.create(c.x, slot.groundY + STUMP_ACTIVE_H_M, c.z)
	const end   = Vector3.create(target.x, target.y, target.z)
	const dx = end.x - start.x
	const dy = end.y - start.y
	const dz = end.z - start.z
	const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
	if (len < 1) return
	const dir = Vector3.create(dx / len, dy / len, dz / len)
	const rot = Quaternion.fromToRotation(Vector3.Up(), dir)
	const segLen = len / BEAM_SEGMENTS

	for (let i = 0; i < BEAM_SEGMENTS; i++) {
		const t0 = i / BEAM_SEGMENTS
		const t1 = (i + 1) / BEAM_SEGMENTS
		const tMid = (t0 + t1) * 0.5
		const strength = beamStrengthAt(tMid)
		if (strength < 0.03) continue
		const xz = BEAM_XZ_M * (0.3 + 0.7 * strength)
		const mid = Vector3.create(
			start.x + dir.x * tMid * len,
			start.y + dir.y * tMid * len,
			start.z + dir.z * tMid * len,
		)
		const e = engine.addEntity()
		slot.beams.push(e)
		Transform.create(e, {
			position: mid,
			scale   : Vector3.create(xz, segLen * 1.02, xz), // tiny overlap hides seams
			rotation: rot,
		})
		MeshRenderer.setBox(e)
		paintBeamSegment(e, strength)
	}
}


// MARK: finishActivate
function finishActivate(index: number, animate: boolean): void {
	pendingActive[index] = true
	const slot = slots[index]
	if (!slot) return
	// Already active or mid-anim (local optimistic click): ignore echoes.
	if (slot.active || slot.animating) return

	if (!animate) {
		slot.active = true
		slot.animating = false
		slot.animT = 1
		applyStumpPose(slot, STUMP_ACTIVE_H_M, slot.baseYaw + ANIM_YAW_RAD)
		applyLitVisuals(slot, STUMP_ACTIVE_H_M)
		setBeaconDim(slot, true)
		const map = activeTerrain()
		if (map) spawnBeam(slot, map)
		syncVolcanoFromStations()
		return
	}

	slot.active = true
	slot.animating = true
	slot.animT = 0
	applyLitVisuals(slot, STUMP_H_M)
}


// MARK: paintStump
function paintStump(slot: Slot, lit: boolean): void {
	if (!lit || !MONUMENT_LIT_RED_TINT) {
		Material.setPbrMaterial(slot.stump, {
			albedoColor      : COLOR_STONE,
			roughness        : 1.0,
			metallic         : 0.0,
			specularIntensity: 0.0,
		})
		return
	}
	Material.setPbrMaterial(slot.stump, {
		albedoColor      : COLOR_STONE_LIT,
		emissiveColor    : EMBER_EMISSIVE,
		emissiveIntensity: mobile ? EMBER_EMISSIVE_INTENSITY * 0.6 : EMBER_EMISSIVE_INTENSITY,
		roughness        : 1.0,
		metallic         : 0.0,
		specularIntensity: 0.0,
	})
}


// MARK: applyLitVisuals
/** Lit stone paint + campfire flame rig riding the stump top. Idempotent. */
function applyLitVisuals(slot: Slot, height: number): void {
	paintStump(slot, true)
	const c = cellCenterWorld(slot.cx, slot.cz)
	if (slot.flameAnchor === null) {
		const a = engine.addEntity()
		Transform.create(a, { position: Vector3.create(c.x, slot.groundY + height, c.z) })
		slot.flameAnchor = a
	} else {
		const tr = Transform.getMutableOrNull(slot.flameAnchor)
		if (tr) tr.position = Vector3.create(c.x, slot.groundY + height, c.z)
	}
	if (slot.flame === null) {
		slot.flame = createFlameRig(slot.flameAnchor, { spots: false })
		slot.flame.setScale(1) // Warm tier, never decays.
	}
}


// MARK: getReadyIgniteIndex
/** Unlit monument the local player can ignite now (lit torch + in range), else -1. */
function getReadyIgniteIndex(): number {
	if (!isTorchLit()) return -1
	const t = Transform.getOrNull(engine.PlayerEntity)
	if (t === null) return -1
	let best = -1
	let bestD2 = IGNITE_RADIUS_SQ_M
	for (let i = 0; i < STATION_COUNT_MAX; i++) {
		const s = slots[i]
		if (!s || s.active || s.animating || pendingActive[i]) continue
		const c = cellCenterWorld(s.cx, s.cz)
		const dx = t.position.x - c.x
		const dz = t.position.z - c.z
		const d2 = dx * dx + dz * dz
		if (d2 <= bestD2) { bestD2 = d2; best = i }
	}
	return best
}


// MARK: isReadyToIgniteMonument
/** True when E / the prompt should ignite a monument. */
export function isReadyToIgniteMonument(): boolean {
	return getReadyIgniteIndex() !== -1
}


// MARK: requestMonumentIgnite
/** Ignite the monument the player is standing at with a lit torch. */
export function requestMonumentIgnite(): void {
	const index = getReadyIgniteIndex()
	if (index === -1) return
	requestActivate(index)
}


// MARK: getLitMonumentWarmthPositions
/** Lit monuments as eternal Warm campfires for frost warmth. */
export function getLitMonumentWarmthPositions(): { x: number; z: number; radiusSq: number; fuel: number }[] {
	const out: { x: number; z: number; radiusSq: number; fuel: number }[] = []
	for (const s of slots) {
		if (!s || !s.active) continue
		const c = cellCenterWorld(s.cx, s.cz)
		out.push({ x: c.x, z: c.z, radiusSq: MONUMENT_HEAT_RADIUS_SQ_M, fuel: CRATER_HEAT_FUEL })
	}
	return out
}


// MARK: playIgnitionSfx
/** One-shot monument.mp3 at the stump top. Only on a fresh ignite. */
function playIgnitionSfx(index: number): void {
	const map = activeTerrain()
	const st  = map?.stations[index]
	if (!st) return
	const c = cellCenterWorld(st.cx, st.cz)
	playMonumentSfxAt(Vector3.create(c.x, activeGroundYAt(c.x, c.z) + STUMP_H_M, c.z))
}


// MARK: requestActivate
function requestActivate(index: number): void {
	const slot = slots[index]
	if (slot?.active || slot?.animating) return
	if (pendingActive[index]) return
	console.log(`stationMarkers[${index}]: activate requested (seed=${currentSeed})`)
	playIgnitionSfx(index)
	finishActivate(index, true)
	room.send('stationActivate', { seed: currentSeed, index })
}


// MARK: clearAll
function clearAll(): void {
	for (let i = 0; i < slots.length; i++) {
		const s = slots[i]
		if (!s) continue
		if (s.flame) s.flame.dispose()
		if (s.flameAnchor) engine.removeEntity(s.flameAnchor)
		engine.removeEntity(s.stump)
		if (s.beacon) engine.removeEntity(s.beacon)
		for (const e of s.beams) engine.removeEntity(e)
		slots[i] = null
	}
}


// MARK: paintBeacon
function paintBeacon(e: Entity, dim: boolean): void {
	if (mobile) {
		Material.setBasicMaterial(e, {
			diffuseColor: dim ? Color4.create(0.55, 0.15, 0.5, 0.55) : COLOR_BEACON,
			castShadows: false,
		})
	} else {
		Material.setPbrMaterial(e, {
			albedoColor      : dim ? Color4.create(0.55, 0.15, 0.5, 0.55) : COLOR_BEACON,
			emissiveColor    : BEACON_EMISSIVE,
			emissiveIntensity: dim ? BEACON_DIM_INTENSITY : BEACON_EMISSIVE_INTENSITY,
			roughness        : 1.0,
			metallic         : 0.0,
			castShadows      : false,
		})
	}
}


// MARK: buildForMap
function buildForMap(map: TerrainMap | null): void {
	clearAll()
	if (!map) {
		syncVolcanoFromStations()
		return
	}
	mobile = isMobile()
	const n = Math.min(map.stations.length, STATION_COUNT_MAX)
	for (let i = 0; i < n; i++) {
		const st = map.stations[i]
		const c  = cellCenterWorld(st.cx, st.cz)
		const groundY = activeGroundYAt(c.x, c.z)
		const wantActive = pendingActive[i]

		const stump = engine.addEntity()
		Transform.create(stump)
		MeshRenderer.setBox(stump)
		MeshCollider.setBox(stump, ColliderLayer.CL_PHYSICS)

		let beacon: Entity | null = null
		if (STATION_DEBUG_BEACONS) {
			beacon = engine.addEntity()
			const top = groundY + (wantActive ? STUMP_ACTIVE_H_M : STUMP_H_M)
			Transform.create(beacon, {
				position: Vector3.create(c.x, top + BEACON_H_M / 2, c.z),
				scale   : Vector3.create(
					wantActive ? BEACON_XZ_DIM_M : BEACON_XZ_M,
					BEACON_H_M,
					wantActive ? BEACON_XZ_DIM_M : BEACON_XZ_M,
				),
			})
			MeshRenderer.setBox(beacon)
			paintBeacon(beacon, wantActive)
		}

		const slot: Slot = {
			stump,
			beacon,
			beams    : [],
			groundY,
			cx       : st.cx,
			cz       : st.cz,
			animT    : wantActive ? 1 : 0,
			animating: false,
			active   : wantActive,
			baseYaw  : 0,
			flame    : null,
			flameAnchor: null,
		}
		slots[i] = slot
		applyStumpPose(
			slot,
			wantActive ? STUMP_ACTIVE_H_M : STUMP_H_M,
			wantActive ? ANIM_YAW_RAD : 0,
		)
		paintStump(slot, false)
		if (wantActive) applyLitVisuals(slot, STUMP_ACTIVE_H_M)


		if (wantActive) {
			spawnBeam(slot, map)
		}
	}
	syncVolcanoFromStations()
	console.log(
		`stationMarkers: seed ${map.usedSeed}: ${n} stumps` +
		(STATION_DEBUG_BEACONS ? ' + debug beacons' : '') +
		`, active=${getActiveStationCount()}`,
	)
}


// MARK: animSystem
function animSystem(dt: number): void {
	const map = activeTerrain()
	for (let i = 0; i < slots.length; i++) {
		const slot = slots[i]
		if (!slot || !slot.animating) continue
		slot.animT = Math.min(1, slot.animT + dt / ANIM_DURATION_S)
		const e = smoothstep(slot.animT)
		const h = STUMP_H_M + (STUMP_ACTIVE_H_M - STUMP_H_M) * e
		const yaw = slot.baseYaw + ANIM_YAW_RAD * e
		applyStumpPose(slot, h, yaw)
		applyLitVisuals(slot, h)
		// Keep beacon seated on the rising stump top.
		if (slot.beacon) {
			const tr = Transform.getMutableOrNull(slot.beacon)
			if (tr) {
				const c = cellCenterWorld(slot.cx, slot.cz)
				tr.position = Vector3.create(c.x, slot.groundY + h + BEACON_H_M / 2, c.z)
			}
		}
		if (slot.animT >= 1) {
			slot.animating = false
			setBeaconDim(slot, true)
			if (map) spawnBeam(slot, map)
			syncVolcanoFromStations()
			console.log(`stationMarkers[${i}]: activation complete, beam fired`)
		}
	}
}


// MARK: resetForSeed
function resetForSeed(seed: number): void {
	if (cycleSeedsEqual(seed, currentSeed) && currentSeed !== 0) return
	console.log(`stationMarkers: cycle roll ${currentSeed} → ${seed}, clearing activations`)
	currentSeed = seed
	volcanoThawed = false
	for (let i = 0; i < STATION_COUNT_MAX; i++) pendingActive[i] = false
	// Markers rebuild via activeTerrain watcher when layout changes.
}


// MARK: setupStationMarkers
/** Install markers, click handlers, anim, and network sync. Idempotent. */
export function setupStationMarkers(): void {
	if (installed) return
	installed = true
	currentSeed = getCurrentCycleSeed()
	mobile = isMobile()

	engine.addSystem(() => {
		const map = activeTerrain()
		if (map === lastMap) return
		lastMap = map
		buildForMap(map)
	})
	engine.addSystem(animSystem)

	room.onMessage('stationState', ({ seed, index, active, fresh }) => {
		if (!cycleSeedsEqual(seed, currentSeed)) {
			console.log(
				`stationMarkers: ignore stationState seed=${seed} (have ${currentSeed})`,
			)
			return
		}
		if (index < 0 || index >= STATION_COUNT_MAX) return
		if (active !== 1) return
		const wasActive = pendingActive[index]
		pendingActive[index] = true
		const slot = slots[index]
		// Hydration (fresh=0): snap silently. Fresh ignite: animate + SFX,
		// unless this client already played it (local igniter's echo).
		const animate = fresh === 1 && !!slot && !slot.active
		if (fresh === 1 && !wasActive) playIgnitionSfx(index)
		finishActivate(index, animate)
	})

	onCycleSeedChange(({ newSeed }) => { resetForSeed(newSeed) })

	console.log('stationMarkers: setupStationMarkers: installed')
}
