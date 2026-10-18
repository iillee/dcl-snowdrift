/**
 * stationMarkers.ts - monument activation sequence (client visuals +
 * melt / ignite interaction). Server state lives in src/server/stations.ts.
 *
 * Sequence per monument (Luke's diagram):
 *   1. DISCOVER: a huge dark slate obelisk (square prism with a pyramid
 *      on each end) is seated in a square socket in the floor of a
 *      shallow one-step recess (terrainRenderer addMonumentPit,
 *      MONUMENT_PIT_* / MONUMENT_SOCKET_* in terrainMap). The recess holds
 *      a mound of ice chunks rising MONUMENT_ICE_TOP_M above the ground
 *      (a wall: too tall to step onto). Snow falls on the ice top like
 *      anywhere else (the snow renderer raises those cells by the ice
 *      height, setSnowCellOffsets), so it reads as a snowy mound and only
 *      the black pyramid tip (seated with its base flush with the ground,
 *      FROZEN_SHAFT_ABOVE_GROUND_M) pokes out of the top of the mound.
 *   2. MELT: the ice is a grid of MONUMENT_ICE_CHUNK_M columns
 *      (src/shared/monumentIce.ts). A LIT torch melts every chunk whose
 *      centre is within MONUMENT_ICE_MELT_RADIUS_M of the player: each
 *      sinks top-down over MONUMENT_ICE_CHUNK_MELT_S (local), then drops
 *      away and the client sends monumentIceMelt. The server owns the
 *      melted-chunk bitmask (monumentIceState: broadcast + late-join
 *      hydration) and clears the snow that lay on each melted chunk.
 *      While any chunk is heating, icemelt.mp3 loops for the melter
 *      (fading out when nothing is melting); other players nearby hear a
 *      positional icemelt hit when the server confirms each chunk.
 *   3. IGNITE: once the server says every chunk is gone, stand near it
 *      with a LIT torch and press E / tap the gold IGNITE MONUMENT bubble
 *      (or the torch button on mobile) -> stationActivate. With the torch
 *      out nothing about ignite is shown and E / tap do nothing. The
 *      server refuses while any ice remains. First wins.
 *   4. RISE: the obelisk slowly rises straight out of its socket (no
 *      rotation) to hover high up: bottom tip MONUMENT_HOVER_ABOVE_TARGET_M
 *      above the beam's volcano target (monumentHoverBottomY), so the
 *      volcano beam always angles slightly DOWN. Only once it is fully up do the very slow bob and spin
 *      ease in from zero (HOVER_EASE_IN_S). The crystal hum loops from a
 *      fixed point on the ground at the socket (not the obelisk).
 *      Once active, the server lets snow regrow over the empty recess;
 *      the snow renderer draws those cells from the recess floor
 *      (setSnowCellOffsets, negative offset) so any snow fills the one
 *      shallow step back to ground level plus the normal layer on top.
 *   5. REDIRECT: once stationary a beam drops from the sky (near the
 *      scene height limit) into its top tip, then a second beam draws from
 *      the BOTTOM tip to the volcano, as if it passed through the obelisk
 *      (Witness-style faded segments). When that beam lands the active
 *      count is pushed to volcano smoke / 3/3 thaw.
 *
 * Everyone else (and late joiners) sees the server's active flag: fresh =
 * full rise + beams + monument.mp3, hydration = snap to hovering with both
 * beams. Monuments give no heat and melt no snow.
 */
import {
	AudioSource,
	ColliderLayer,
	Entity,
	GltfContainer,
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
import { playIceMeltSfxAt, playMonumentSfxAt, unlockAudio } from 'src/client/audio'
import { isItemInputBlocked } from 'src/client/frost/frozenState'
import { paintIce as paintPlayerIce } from 'src/client/frost/rescue'
import { setOptimisticStage } from 'src/client/snow/snowModel'
import { setSnowCellOffsets } from 'src/client/snow/snowRenderer'
import { isTorchLit } from 'src/client/torchEquip'
import { beginVolcanoThaw, setVolcanoLavaVisible } from 'src/client/volcanoCrown'
import { setVolcanoSmokeBoost } from 'src/client/volcanoSmoke'
import { cycleSeedsEqual } from 'src/shared/cycleMazeSeed'
import { room } from 'src/shared/messages'
import { TERRAIN_CELL_M, sceneHeightLimitM } from 'src/shared/settings'
import { SNOW_CELL_M, SNOW_STAGE_HEIGHT_M, STAGE_PRISTINE, worldToCellKey } from 'src/shared/snowGrid'
import {
	MONUMENT_ICE_CHUNK_M,
	MONUMENT_ICE_CHUNK_MELT_S,
	MONUMENT_ICE_CHUNK_REFREEZE_S,
	MONUMENT_ICE_FULL_MASK,
	MONUMENT_ICE_MELT_RADIUS_M,
	MONUMENT_ICE_SLOTS,
	MONUMENT_ICE_TOP_M,
	MONUMENT_MOUND_TOP_M,
	iceChunkAt,
	iceChunkDepth,
	iceChunkHeight,
	iceChunkOffset,
	iceFullyMelted,
	isIceChunk,
	stationHasIce,
	pitDepthAtRing,
} from 'src/shared/monumentIce'
import { activeGroundYAt, activeTerrain } from 'src/shared/terrain/terrainCache'
import {
	MONUMENT_HOVER_BOTTOM_H_M,
	MONUMENT_OBELISK_WIDTH_M,
	MONUMENT_PIT_SIZE_M,
	MONUMENT_SOCKET_DEPTH_M,
	MONUMENT_SOCKET_SIZE_M,
	TerrainMap,
	cellCenterWorld,
	monumentHoverBottomY,
} from 'src/shared/terrain/terrainMap'
import {
	volcanoLavaCentroid,
	volcanoLavaTopY,
	volcanoRimY,
} from 'src/shared/terrain/volcanoCrown'


// MARK: Tuning - obelisk
/** Low-poly flat-shaded parts (scripts/make-obelisk-glb.js), unit-sized. */
const OB_PYRAMID_MODEL = 'assets/models/obelisk_pyramid.glb'
const OB_SHAFT_MODEL   = 'assets/models/obelisk_shaft.glb'
/** Square cross-section width of the shaft = pyramid base (m). */
export const OB_WIDTH_M = MONUMENT_OBELISK_WIDTH_M
/** Straight shaft length (m). */
export const OB_SHAFT_M = 14
/** Height of each end pyramid (m). */
export const OB_TIP_M   = 4
const OB_TOTAL_M = OB_SHAFT_M + 2 * OB_TIP_M

/**
 * Seated (un-risen) obelisk, iced or not: how far the top of the square
 * shaft (= base of the top pyramid) sits above the surrounding ground (m).
 * 0 = flush with the ground and the black border, so only the 4 m top
 * pyramid shows: tip OB_TIP_M above the ground. On the iced monument the
 * 1.5 m mound (MONUMENT_MOUND_TOP_M: 1 m ice + 0.5 m snow) hides the lower
 * 1.5 m of the pyramid, leaving its top 2.5 m above the snow. The shaft runs
 * down through the 1.5 m socket and the dark socket slab (to 14 m below
 * ground, bottom tip 18 m down), hidden inside the terrain. The rise starts
 * from here. Keep terrainGen NEAR_LOS_TIP_M equal to FROZEN_TIP_Y_M.
 */
export const FROZEN_SHAFT_ABOVE_GROUND_M = 0
/** Top tip height above ground while seated (m). */
const FROZEN_TIP_Y_M = OB_TIP_M + FROZEN_SHAFT_ABOVE_GROUND_M

/**
 * Minimum hovering bottom-tip height above local ground (m). The actual
 * hover is target-relative: bottom tip = max(aim Y +
 * MONUMENT_HOVER_ABOVE_TARGET_M, ground + this) + beamLiftM, capped under
 * the scene ceiling (monumentHoverBottomY in terrainMap, shared with
 * terrain gen's beam check). Tune the margin there.
 */
export const HOVER_BOTTOM_H_M = MONUMENT_HOVER_BOTTOM_H_M
/** Keep the hovering top tip at least this far under the height limit (m). */
const HOVER_CEILING_MARGIN_M = 24


// MARK: Tuning - discover / melt / ignite
// Chunk melt timing + torch radius live in src/shared/monumentIce.ts.
/**
 * XZ distance (m) from the monument centre that counts as "at the
 * monument" for the prompts and the ignite: the whole ice mound plus
 * room to stand beside it (you melt it from the side).
 */
export const NEAR_RADIUS_M = MONUMENT_PIT_SIZE_M / 2 + 2.5
const NEAR_RADIUS_SQ_M = NEAR_RADIUS_M * NEAR_RADIUS_M
/** Player must be within this height of the station ground to melt / ignite (m). */
const NEAR_HEIGHT_M = 4
/** Ice chunk XZ: tiny inset so neighbours / walls never z-fight. */
const ICE_CHUNK_XZ_M = MONUMENT_ICE_CHUNK_M - 0.02
/** A melted chunk drops away over this long (s), like a snow leaf. */
const ICE_DROP_S = 0.3
/** Resend an unconfirmed chunk melt after this long (ms). */
const ICE_RESEND_MS = 3000

// MARK: Tuning - rise / hover
/** Rise out of the ground (s). */
export const MONUMENT_RISE_S = 6
/** Pause once stationary before the sky beam drops (s). */
export const MONUMENT_SETTLE_S = 0.6
/** Hover bob amplitude (m) and period (s). Was 0.6 m / 12 s. */
export const HOVER_BOB_M = 2.5
export const HOVER_BOB_PERIOD_S = 10
/** Hover spin (degrees per second). Was 3. */
export const HOVER_SPIN_DEG_S = 5
/**
 * Once fully risen, the bob amplitude and spin speed ease in from 0 to
 * full over this long (s), so hovering starts with no snap. No rotation
 * at all during the rise.
 */
export const HOVER_EASE_IN_S = 4

// MARK: Tuning - melt sound
/** Looping icemelt.mp3 (same clip as a frozen player's thaw) while any chunk melts. */
const ICE_MELT_SFX_SRC = 'assets/sounds/icemelt.mp3'
const ICE_MELT_SFX_VOLUME = 0.3
/** Volume of the one-shot icemelt hit others hear per melted chunk (was 0.8). */
const ICE_MELT_REMOTE_VOLUME = 0.4
/** Fade-out when no chunk is heating any more (s). */
const ICE_MELT_SFX_FADE_S = 0.5
/** Remote players hear a confirmed chunk melt within this XZ distance (m). */
const ICE_MELT_REMOTE_HEAR_M = 40

// MARK: Tuning - beams
/** Sky beam drops down over this long (s). */
export const SKY_BEAM_DROP_S = 1.2
/** Volcano beam draws out over this long (s). */
export const VOLCANO_BEAM_DRAW_S = 1.5
/** Sky beam top stays this far under the scene height limit (m). */
const SKY_BEAM_CEILING_MARGIN_M = 4
/**
 * How far each beam end sits inside its apex (m), so the square end is
 * buried in the tip. Sky beam meets the top apex; the volcano beam leaves
 * the bottom apex. The sky beam bobs with the obelisk (beamRoot); the
 * volcano beam's far end stays fixed in the world and the beam is re-aimed
 * from the live bottom tip every frame (aimVolcanoBeam).
 */
const BEAM_JOINT_INSIDE_TIP_M = 0.4
const BEAM_XZ_M = 0.5
const SKY_BEAM_XZ_M = 0.42
const BEAM_SEGMENTS = 10
const SKY_BEAM_SEGMENTS = 10
/** Volcano beam: fade begins at this fraction (dissolves into the plume). */
const BEAM_FADE_START = 0.72
/** Sky beam: fade begins at this fraction going up (reads as from space). */
const SKY_BEAM_FADE_START = 0.45

// MARK: Tuning - crystal hum
/** Positional loop on every risen / hovering obelisk (not while frozen). */
const CRYSTAL_HUM_SRC = 'assets/sounds/crystal.mp3'
export const CRYSTAL_HUM_VOLUME = 0.7
/** The hum plays from a fixed invisible point this high above the socket (m). */
const CRYSTAL_HUM_HEIGHT_M = 2

// MARK: Tuning - gaze hum
/**
 * Soft 2D (non-positional) crystal loop while the camera looks at an
 * activated obelisk, at any distance. One shared camera-parented voice;
 * the positional ground hum above still plays as well.
 */
/** Half-angle of the look cone around the obelisk centre (deg). */
export const GAZE_CONE_DEG = 12
/** Gaze loop volume when fully faded in. */
export const GAZE_VOLUME = 0.25
/** Fade-in / fade-out times (s). */
export const GAZE_FADE_IN_S  = 1.5
export const GAZE_FADE_OUT_S = 2
/** Skip an obelisk closer than this horizontally (m): the ground hum covers it. */
export const GAZE_MIN_HORIZ_M = 8

// MARK: Colours
const COLOR_BEAM    = Color4.create(0.55, 0.8, 1.0, 1)
const BEAM_EMISSIVE = Color3.create(0.45, 0.72, 1.0)
const BEAM_EMISSIVE_INTENSITY = 5

const STATION_COUNT_MAX = 3


// MARK: Types
type Phase = 'frozen' | 'rising' | 'settle' | 'skyBeam' | 'volcanoBeam' | 'done'

type Beam = {
	segs    : Entity[]
	/** Per segment: centre fraction along the beam and XZ thickness (fade taper). */
	tMid    : number[]
	xz      : number[]
	/** Segment count the beam was built with (segment length = len / segments). */
	segments: number
	/** World end point as built (the volcano target for the volcano beam). */
	end     : Vector3
	/** Bob value the segments were last aimed for (NaN = never). */
	aimedBob: number
	/** Reveal order index per segment (0 shows first). */
	order   : number[]
	shown   : number
}

type Slot = {
	/** True for the one monument with the ice test (icedStationIndex). */
	iced: boolean,
	index   : number
	/** Ice chunk entities by chunk index (null = melted / obelisk column). */
	chunks  : Array<Entity | null>
	/** 0..1 local torch exposure per chunk. */
	heat    : number[]
	/** Chunks gone locally (server-confirmed or optimistic). */
	iceMask : number
	/** Chunks the server has confirmed melted. */
	serverMask: number
	/** Date.now() when each optimistic melt was sent (0 = none). */
	sentAt  : number[]
	rig     : Entity
	parts   : Entity[]
	/** Parent of both beams; moved by the hover bob. */
	beamRoot: Entity
	/** True once the obelisk parts collide (hovering). */
	solid   : boolean
	groundY : number
	x       : number
	z       : number
	lift    : number
	aim     : { x: number; y: number; z: number } | null
	phase   : Phase
	phaseT  : number
	yaw     : number
	hoverT  : number
	active  : boolean
	sky     : Beam | null
	volcano : Beam | null
	/** Looping crystal.mp3 emitter on the ground at the socket; null while frozen. */
	hum     : Entity | null
}

type IceDrop = {
	e      : Entity
	x      : number
	z      : number
	bottomY: number
	h0     : number
	t      : number
}


// MARK: State
const slots: Array<Slot | null> = [null, null, null]
const pendingActive = [false, false, false]
/** Server ice masks received before / across a slot rebuild. */
const pendingIce = [0, 0, 0]
const drops: IceDrop[] = []
let lastMap: TerrainMap | null = null
let currentSeed = 0
let installed = false
let mobile = false
/** Slot whose ice the local player is at with a lit torch (-1 none). */
let meltingIndex = -1
/** Slot whose ice the local player stands at without a lit torch (-1 none). */
let needTorchIndex = -1
/** Ice-free, unlit slot the local player can ignite now (-1 none). */
let readyIgniteIndex = -1
/** Camera-parented looping melt voice (0 until first used). */
let meltSfxEnt: Entity = 0 as Entity
/** True while the melt loop is playing (incl. its fade-out). */
let meltSfxOn = false
let meltSfxVol = 0
/** Seconds into the fade-out, or -1 when not fading. */
let meltSfxFadeS = -1
/** Camera-parented 2D gaze crystal loop (0 until first used). */
let gazeSfxEnt: Entity = 0 as Entity
/** True while the gaze loop is playing (incl. its fade-out). */
let gazeSfxOn = false
/** Current (unrounded) gaze volume and the last value written. */
let gazeVol = 0
let gazeVolWritten = 0
/** Last snow-offset signature pushed to the snow renderer. */
let pitFillSig = ''
/** True once this client has fired the 3/3 thaw for the current cycle. */
let volcanoThawed = false


// MARK: isStationLit
/** True once station `i` (index into map.stations) is lit this cycle. */
export function isStationLit(i: number): boolean {
	if (i < 0 || i >= STATION_COUNT_MAX) return false
	return pendingActive[i] || slots[i]?.active === true
}


// MARK: getActiveStationCount
/** How many stations are currently active (0-3). */
export function getActiveStationCount(): number {
	let n = 0
	for (let i = 0; i < STATION_COUNT_MAX; i++) {
		if (pendingActive[i] || slots[i]?.active) n++
	}
	return Math.min(STATION_COUNT_MAX, n)
}


/**
 * Count of monuments whose volcano beam has landed (drives smoke/lava so
 * the volcano reacts when the beam arrives, not at the click).
 */
function landedCount(): number {
	let n = 0
	for (let i = 0; i < STATION_COUNT_MAX; i++) {
		const s = slots[i]
		if (s) { if (s.active && s.phase === 'done') n++ }
		else if (pendingActive[i]) n++
	}
	return n
}


// MARK: syncVolcanoFromStations
/**
 * Push landed count into smoke + lava.
 *   0-2: smoke ramps; lava hidden (snowy crater).
 *   3: fire thaw once - reveal lava.
 */
function syncVolcanoFromStations(): void {
	const n = landedCount()
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


// MARK: Melt prompt API
/**
 * Text for the hotbar-flush prompt near an unlit monument, else null.
 * Ice left: nothing (no melt / torch hints).
 * Ice gone: "IGNITE MONUMENT" only while the torch is lit; with the torch
 * out nothing at all (no ignite hint).
 */
export function getMonumentPromptText(): string | null {
	const lit = isTorchLit()
	if (readyIgniteIndex >= 0) return lit ? 'IGNITE MONUMENT' : null
	// No melt / torch hints: only IGNITE once all ice is server-confirmed gone.
	return null
}


// MARK: isReadyToIgniteMonument
/** True when E / the prompt / the torch button should ignite a monument. */
export function isReadyToIgniteMonument(): boolean {
	return readyIgniteIndex >= 0 && !isItemInputBlocked() && isTorchLit()
}


// MARK: requestMonumentIgnite
/** Ignite the ice-free monument the player is at with a lit torch. */
export function requestMonumentIgnite(): void {
	if (!isReadyToIgniteMonument()) return
	const i = readyIgniteIndex
	readyIgniteIndex = -1
	requestActivate(i)
}


function chunkCount(mask: number): number {
	let n = 0
	for (let i = 0; i < MONUMENT_ICE_SLOTS; i++) if (isIceChunk(i) && (mask & (1 << i)) !== 0) n++
	return n
}


// MARK: ease
function smoothstep(t: number): number {
	const x = t < 0 ? 0 : t > 1 ? 1 : t
	return x * x * (3 - 2 * x)
}


// MARK: Materials
function paintGlow(e: Entity, col: Color4, emissive: Color3, intensity: number): void {
	if (mobile) {
		Material.setBasicMaterial(e, { diffuseColor: col, castShadows: false })
		return
	}
	const transparent = col.a < 0.99
	Material.setPbrMaterial(e, {
		albedoColor      : col,
		emissiveColor    : emissive,
		emissiveIntensity: intensity,
		roughness        : 1.0,
		metallic         : 0.0,
		transparencyMode : transparent
			? MaterialTransparencyMode.MTM_ALPHA_BLEND
			: MaterialTransparencyMode.MTM_OPAQUE,
		castShadows      : false,
	})
}


// MARK: Geometry helpers
function part(parent: Entity, src: string, pos: Vector3, scale: Vector3, flip: boolean): Entity {
	const e = engine.addEntity()
	Transform.create(e, {
		parent,
		position: pos,
		scale,
		rotation: Quaternion.fromEulerDegrees(flip ? 180 : 0, 0, 0),
	})
	GltfContainer.create(e, {
		src,
		visibleMeshesCollisionMask  : 0,
		invisibleMeshesCollisionMask: 0,
	})
	return e
}

/**
 * Obelisk under `rig` (rig origin = shaft centre): a square prism
 * (OB_WIDTH_M x OB_SHAFT_M x OB_WIDTH_M) with a 4-sided pyramid of height
 * OB_TIP_M on each end. Unit glb parts scaled here; no colliders until
 * it is hovering (a collider rising through players would shove them).
 */
function buildObelisk(slot: Slot): void {
	const W = OB_WIDTH_M
	const half = OB_SHAFT_M / 2
	slot.parts.push(
		part(slot.rig, OB_SHAFT_MODEL,   Vector3.create(0, 0, 0),     Vector3.create(W, OB_SHAFT_M, W), false),
		part(slot.rig, OB_PYRAMID_MODEL, Vector3.create(0, half, 0),  Vector3.create(W, OB_TIP_M, W),   false),
		part(slot.rig, OB_PYRAMID_MODEL, Vector3.create(0, -half, 0), Vector3.create(W, OB_TIP_M, W),   true),
	)
}

/** Turn obelisk physics on/off (on only once it hovers). */
function setObeliskSolid(slot: Slot, solid: boolean): void {
	if (slot.solid === solid) return
	slot.solid = solid
	const mask = solid ? ColliderLayer.CL_PHYSICS : 0
	for (const e of slot.parts) {
		const g = GltfContainer.getMutableOrNull(e)
		if (g) g.visibleMeshesCollisionMask = mask
	}
}


// MARK: Poses
/** Mean hovering top-tip height above ground for a slot (m). */
function hoverTipH(slot: Slot): number {
	// Bottom tip (volcano beam origin) a margin above the beam target so
	// the beam descends to the volcano; same formula terrain gen checked.
	const targetY = slot.aim ? slot.aim.y : volcanoLavaTopY()
	// Never let the top tip (plus bob) climb past the height limit margin.
	const capTopAbs = sceneHeightLimitM() - HOVER_CEILING_MARGIN_M - HOVER_BOB_M
	const bottomY = monumentHoverBottomY(slot.groundY, targetY, slot.lift, capTopAbs - OB_TOTAL_M)
	return Math.max(OB_TOTAL_M + FROZEN_TIP_Y_M + 1, bottomY + OB_TOTAL_M - slot.groundY)
}

function frozenCentreY(slot: Slot): number {
	return slot.groundY + FROZEN_TIP_Y_M - OB_TOTAL_M / 2
}

function hoverCentreY(slot: Slot): number {
	return slot.groundY + hoverTipH(slot) - OB_TOTAL_M / 2
}

/** Sky beam end (world) at the mean hovering top tip (beamRoot adds bob). */
function topBeamJoint(slot: Slot): Vector3 {
	return Vector3.create(slot.x, slot.groundY + hoverTipH(slot) - BEAM_JOINT_INSIDE_TIP_M, slot.z)
}

/** Volcano beam start (world) at the mean hovering bottom tip (beamRoot adds bob). */
function bottomBeamJoint(slot: Slot): Vector3 {
	return Vector3.create(slot.x, slot.groundY + hoverTipH(slot) - OB_TOTAL_M + BEAM_JOINT_INSIDE_TIP_M, slot.z)
}

function applyRig(slot: Slot, y: number): void {
	const tr = Transform.getMutableOrNull(slot.rig)
	if (!tr) return
	tr.position = Vector3.create(slot.x, y, slot.z)
	tr.rotation = Quaternion.fromEulerDegrees(0, slot.yaw * (180 / Math.PI), 0)
}

/** 0 -> 1 ease-in of the hover bob + spin after the rise ends. */
function hoverRamp(slot: Slot): number {
	return smoothstep(slot.hoverT / HOVER_EASE_IN_S)
}

function hoverBob(slot: Slot): number {
	return Math.sin((slot.hoverT / HOVER_BOB_PERIOD_S) * Math.PI * 2) * HOVER_BOB_M * hoverRamp(slot)
}

/** Hovering pose: rig + beams ride the same bob. */
function applyHover(slot: Slot): void {
	const bob = hoverBob(slot)
	applyRig(slot, hoverCentreY(slot) + bob)
	const tr = Transform.getMutableOrNull(slot.beamRoot)
	if (tr) tr.position = Vector3.create(0, bob, 0)
	aimVolcanoBeam(slot, bob)
}


// MARK: Ice
/** World XZ of chunk i's centre for a slot. */
function chunkCentre(slot: Slot, i: number): { x: number; z: number } {
	const o = iceChunkOffset(i)
	return { x: slot.x + o.dx, z: slot.z + o.dz }
}

/**
 * Pose chunk i: a column from the recess floor up to MONUMENT_ICE_TOP_M
 * above the ground, sinking top-down with its local heat (like a frozen
 * player's cube melting) while the bottom stays put.
 */
function applyChunk(slot: Slot, i: number): void {
	const e = slot.chunks[i]
	if (!e) return
	const full = iceChunkHeight(i)
	const h = Math.max(0.05, full * (1 - Math.min(1, slot.heat[i])))
	const bottomY = slot.groundY - iceChunkDepth(i)
	const c = chunkCentre(slot, i)
	const tr = Transform.getMutableOrNull(e)
	if (tr) {
		tr.position = Vector3.create(c.x, bottomY + h / 2, c.z)
		tr.scale    = Vector3.create(ICE_CHUNK_XZ_M, h, ICE_CHUNK_XZ_M)
	}
}

function buildChunks(slot: Slot): void {
	for (let i = 0; i < MONUMENT_ICE_SLOTS; i++) {
		if (!isIceChunk(i) || (slot.iceMask & (1 << i)) !== 0) continue
		const e = engine.addEntity()
		Transform.create(e)
		// Same box + material as a frozen player's cube (rescue.ts).
		paintPlayerIce(e)
		MeshCollider.setBox(e, ColliderLayer.CL_PHYSICS)
		slot.chunks[i] = e
		applyChunk(slot, i)
	}
}

/**
 * Chunk i is gone: drop its collider at once (the recess floor below is
 * walkable), shrink it away over ICE_DROP_S, then remove it. Also clears
 * the local snow that lay on it (the server does the same); the snow
 * renderer drops those cells' ice lift on the next syncSnowOffsets.
 */
function meltChunk(slot: Slot, i: number, animate: boolean): void {
	slot.iceMask |= 1 << i
	slot.heat[i] = 0
	const e = slot.chunks[i]
	slot.chunks[i] = null
	if (!e) return
	if (!animate) { engine.removeEntity(e); return }
	MeshCollider.deleteFrom(e)
	const tr = Transform.getOrNull(e)
	const c = chunkCentre(slot, i)
	const h0 = tr ? tr.scale.y : 0.5
	drops.push({ e, x: c.x, z: c.z, bottomY: slot.groundY - iceChunkDepth(i), h0, t: 0 })
	const half = MONUMENT_ICE_CHUNK_M / 2
	for (let dz = -half + SNOW_CELL_M / 2; dz < half; dz += SNOW_CELL_M) {
		for (let dx = -half + SNOW_CELL_M / 2; dx < half; dx += SNOW_CELL_M) {
			const key = worldToCellKey(c.x + dx, c.z + dz)
			if (key !== null) setOptimisticStage(key, 0)
		}
	}
}

/** Remove every remaining chunk (activation / hydration). */
function removeAllIce(slot: Slot): void {
	for (let i = 0; i < MONUMENT_ICE_SLOTS; i++) {
		if (slot.chunks[i]) meltChunk(slot, i, false)
	}
	slot.iceMask = MONUMENT_ICE_FULL_MASK
}

/** True while any ice chunk is still frozen locally. */
function hasIce(slot: Slot): boolean {
	return !iceFullyMelted(slot.iceMask)
}

/** Apply a server mask: melt newly-confirmed chunks (dropping), keep local pendings. */
function applyServerIce(slot: Slot, mask: number, animate: boolean): void {
	slot.serverMask = mask & MONUMENT_ICE_FULL_MASK
	for (let i = 0; i < MONUMENT_ICE_SLOTS; i++) {
		const bit = 1 << i
		if ((slot.serverMask & bit) === 0) continue
		slot.sentAt[i] = 0
		if ((slot.iceMask & bit) === 0) meltChunk(slot, i, animate)
	}
}

/** Shrink + remove dropping chunks. */
function iceDropSystem(dt: number): void {
	for (let k = drops.length - 1; k >= 0; k--) {
		const d = drops[k]
		d.t += dt
		const u = Math.min(1, d.t / ICE_DROP_S)
		const h = Math.max(0.01, d.h0 * (1 - u * u))
		const tr = Transform.getMutableOrNull(d.e)
		if (tr) {
			tr.position = Vector3.create(d.x, d.bottomY + h / 2, d.z)
			tr.scale    = Vector3.create(ICE_CHUNK_XZ_M * (1 - 0.3 * u), h, ICE_CHUNK_XZ_M * (1 - 0.3 * u))
		}
		if (u >= 1) {
			engine.removeEntity(d.e)
			drops.splice(k, 1)
		}
	}
}

// MARK: playRemoteMeltCue
/**
 * Someone else melted a chunk (server confirmed it, this client had not
 * melted it locally): one positional icemelt hit at that chunk, if the
 * local player is close. Skipped for bulk updates (late-join hydration
 * reporting many chunks at once) so joining is not a burst of sounds.
 */
function playRemoteMeltCue(slot: Slot, beforeMask: number): void {
	const fresh = (slot.iceMask & ~beforeMask) & MONUMENT_ICE_FULL_MASK
	if (fresh === 0 || chunkCount(fresh) > 2) return
	const t = Transform.getOrNull(engine.PlayerEntity)
	if (!t) return
	let chunk = -1
	for (let i = 0; i < MONUMENT_ICE_SLOTS; i++) if ((fresh & (1 << i)) !== 0) { chunk = i; break }
	if (chunk < 0) return
	const c = chunkCentre(slot, chunk)
	const dx = t.position.x - c.x
	const dz = t.position.z - c.z
	if (dx * dx + dz * dz > ICE_MELT_REMOTE_HEAR_M * ICE_MELT_REMOTE_HEAR_M) return
	playIceMeltSfxAt(Vector3.create(c.x, slot.groundY, c.z), ICE_MELT_REMOTE_VOLUME)
}


// MARK: volcanoBeamTarget
/** World point the beam aims at: lava centroid on the lava lid, else marker. */
function volcanoBeamTarget(map: TerrainMap): { x: number; y: number; z: number } | null {
	if (!map.volcano) return null
	const lava = volcanoLavaCentroid(map)
	const fx = lava ? lava.fx : map.volcano.cx
	const fz = lava ? lava.fz : map.volcano.cz
	const origin = cellCenterWorld(0, 0)
	return {
		x: origin.x + fx * TERRAIN_CELL_M,
		y: lava ? volcanoLavaTopY() : volcanoRimY() + 2,
		z: origin.z + fz * TERRAIN_CELL_M,
	}
}


// MARK: Beams
function beamStrengthAt(t: number, fadeStart: number): number {
	if (t <= fadeStart) return 1
	const u = (t - fadeStart) / (1 - fadeStart)
	return 1 - smoothstep(u)
}

function paintBeamSegment(e: Entity, strength: number): void {
	const a = Math.max(0.04, strength)
	paintGlow(
		e,
		Color4.create(COLOR_BEAM.r, COLOR_BEAM.g, COLOR_BEAM.b, Math.min(0.98, a)),
		BEAM_EMISSIVE,
		BEAM_EMISSIVE_INTENSITY * strength,
	)
}

/**
 * Witness-style beam of thin boxes from `start` to `end`, bright for most
 * of the path then fading after `fadeStart`. Segments get Transform +
 * material now; MeshRenderer is added as the beam reveals. `fromEnd`
 * reveals from `end` back toward `start` (sky beam dropping down).
 */
function buildBeam(
	parent: Entity, start: Vector3, end: Vector3, segments: number, thick: number,
	fadeStart: number, fromEnd: boolean,
): Beam | null {
	const dx = end.x - start.x
	const dy = end.y - start.y
	const dz = end.z - start.z
	const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
	if (len < 0.5) return null
	const dir = Vector3.create(dx / len, dy / len, dz / len)
	const rot = Quaternion.fromToRotation(Vector3.Up(), dir)
	const segLen = len / segments
	const beam: Beam = { segs: [], order: [], shown: 0, tMid: [], xz: [], segments, end: Vector3.clone(end), aimedBob: Number.NaN }
	for (let i = 0; i < segments; i++) {
		const tMid = (i + 0.5) / segments
		const strength = beamStrengthAt(tMid, fadeStart)
		if (strength < 0.03) continue
		const xz = thick * (0.3 + 0.7 * strength)
		const e = engine.addEntity()
		Transform.create(e, {
			parent,
			position: Vector3.create(
				start.x + dir.x * tMid * len,
				start.y + dir.y * tMid * len,
				start.z + dir.z * tMid * len,
			),
			scale   : Vector3.create(xz, segLen * 1.02, xz),
			rotation: rot,
		})
		paintBeamSegment(e, strength)
		beam.segs.push(e)
		beam.tMid.push(tMid)
		beam.xz.push(xz)
		beam.order.push(fromEnd ? segments - 1 - i : i)
	}
	return beam
}

/**
 * Re-aim / re-stretch the volcano beam each hover frame: start glued to the
 * live bottom tip (mean joint + bob), far end fixed at the world target.
 * Segments live under beamRoot (offset 0, bob, 0), so the end is written
 * as target - bob in that frame. Fade (per-segment colour + XZ taper) is
 * unchanged; only position / rotation / length move. Skipped when the bob
 * has not changed since the last aim.
 */
function aimVolcanoBeam(slot: Slot, bob: number): void {
	const beam = slot.volcano
	if (!beam || beam.segs.length === 0) return
	if (beam.aimedBob === bob) return
	beam.aimedBob = bob
	const start = bottomBeamJoint(slot)
	const dx = beam.end.x - start.x
	const dy = beam.end.y - bob - start.y
	const dz = beam.end.z - start.z
	const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
	if (len < 0.5) return
	const dir = Vector3.create(dx / len, dy / len, dz / len)
	const rot = Quaternion.fromToRotation(Vector3.Up(), dir)
	const segLen = len / beam.segments
	for (let k = 0; k < beam.segs.length; k++) {
		const tr = Transform.getMutableOrNull(beam.segs[k])
		if (!tr) continue
		const d = beam.tMid[k] * len
		tr.position = Vector3.create(start.x + dir.x * d, start.y + dir.y * d, start.z + dir.z * d)
		tr.rotation = rot
		tr.scale    = Vector3.create(beam.xz[k], segLen * 1.02, beam.xz[k])
	}
}

/** Show segments whose reveal slot is below frac (0..1). Idempotent. */
function revealBeam(beam: Beam | null, frac: number, total: number): void {
	if (!beam) return
	const want = Math.ceil(Math.max(0, Math.min(1, frac)) * total)
	for (let k = 0; k < beam.segs.length; k++) {
		const ord = beam.order[k]
		if (ord < want && !MeshRenderer.has(beam.segs[k])) MeshRenderer.setBox(beam.segs[k])
	}
	beam.shown = want
}

function destroyBeam(beam: Beam | null): void {
	if (!beam) return
	for (const e of beam.segs) engine.removeEntity(e)
}

function ensureBeams(slot: Slot, map: TerrainMap | null): void {
	const top    = topBeamJoint(slot)
	const bottom = bottomBeamJoint(slot)
	if (!slot.sky) {
		// The sky beam rides the bob (beamRoot), so leave room for its peak.
		const topY = sceneHeightLimitM() - SKY_BEAM_CEILING_MARGIN_M - HOVER_BOB_M
		if (topY > top.y + 2) {
			slot.sky = buildBeam(
				slot.beamRoot, top, Vector3.create(top.x, topY, top.z),
				SKY_BEAM_SEGMENTS, SKY_BEAM_XZ_M, SKY_BEAM_FADE_START, true,
			)
		}
	}
	if (!slot.volcano && map) {
		const target = slot.aim ?? volcanoBeamTarget(map)
		if (target) {
			slot.volcano = buildBeam(
				slot.beamRoot, bottom, Vector3.create(target.x, target.y, target.z),
				BEAM_SEGMENTS, BEAM_XZ_M, BEAM_FADE_START, false,
			)
			aimVolcanoBeam(slot, hoverBob(slot))
		}
	}
}


// MARK: Crystal hum
/**
 * Start the looping 3D crystal hum on a risen obelisk. An invisible
 * entity at the socket, CRYSTAL_HUM_HEIGHT_M above the ground, NOT
 * parented to the obelisk (from 50 m up it was inaudible). Created once;
 * never touched per frame (touching AudioSource restarts the loop).
 * Removed in clearAll (cycle reset / layout rebuild).
 */
function startHum(slot: Slot): void {
	if (slot.hum) return
	const e = engine.addEntity()
	Transform.create(e, { position: Vector3.create(slot.x, slot.groundY + CRYSTAL_HUM_HEIGHT_M, slot.z) })
	AudioSource.create(e, {
		audioClipUrl: CRYSTAL_HUM_SRC,
		loop        : true,
		playing     : true,
		global      : false,
		volume      : CRYSTAL_HUM_VOLUME,
	})
	slot.hum = e
}


// MARK: Phase transitions
function setPhase(slot: Slot, phase: Phase): void {
	slot.phase = phase
	slot.phaseT = 0
}

/** Snap a slot to its finished state (hydration / late join). */
function snapDone(slot: Slot): void {
	removeAllIce(slot)
	slot.active = true
	startHum(slot)
	setPhase(slot, 'done')
	slot.yaw = 0
	// Late join: already hovering, so bob + spin at full strength.
	slot.hoverT = HOVER_EASE_IN_S
	applyHover(slot)
	setObeliskSolid(slot, true)
	ensureBeams(slot, activeTerrain())
	revealBeam(slot.sky, 1, SKY_BEAM_SEGMENTS)
	revealBeam(slot.volcano, 1, BEAM_SEGMENTS)
}

/** Begin the rise animation (fresh activation). */
function startRise(slot: Slot): void {
	removeAllIce(slot)
	slot.active = true
	startHum(slot)
	// Seated obelisk is solid; a collider rising through players would shove them.
	setObeliskSolid(slot, false)
	slot.yaw = 0
	slot.hoverT = 0
	setPhase(slot, 'rising')
}


// MARK: finishActivate
function finishActivate(index: number, animate: boolean): void {
	pendingActive[index] = true
	const slot = slots[index]
	if (!slot) return
	// Already active (local optimistic melt or echo): ignore.
	if (slot.active) return
	if (animate) startRise(slot)
	else {
		snapDone(slot)
		syncVolcanoFromStations()
	}
}


// MARK: playIgnitionSfx
/** One-shot monument.mp3 at the monument. Only on a fresh activation. */
function playIgnitionSfx(index: number): void {
	const slot = slots[index]
	if (slot) {
		playMonumentSfxAt(Vector3.create(slot.x, slot.groundY + FROZEN_TIP_Y_M, slot.z))
		return
	}
	const map = activeTerrain()
	const st  = map?.stations[index]
	if (!st) return
	const c = cellCenterWorld(st.cx, st.cz)
	playMonumentSfxAt(Vector3.create(c.x, activeGroundYAt(c.x, c.z) + FROZEN_TIP_Y_M, c.z))
}


// MARK: requestActivate
function requestActivate(index: number): void {
	const slot = slots[index]
	if (slot?.active) return
	if (pendingActive[index]) return
	console.log(`stationMarkers[${index}]: ignited, activate requested (seed=${currentSeed})`)
	playIgnitionSfx(index)
	finishActivate(index, true)
	room.send('stationActivate', { seed: currentSeed, index })
}


// MARK: clearAll
function clearAll(): void {
	for (let i = 0; i < slots.length; i++) {
		const s = slots[i]
		if (!s) continue
		for (const e of s.chunks) if (e) engine.removeEntity(e)
		if (s.hum) engine.removeEntity(s.hum)
		s.hum = null
		for (const e of s.parts) engine.removeEntity(e)
		engine.removeEntity(s.rig)
		destroyBeam(s.sky)
		destroyBeam(s.volcano)
		engine.removeEntity(s.beamRoot)
		slots[i] = null
	}
	for (const d of drops) engine.removeEntity(d.e)
	drops.length = 0
	meltingIndex = -1
	needTorchIndex = -1
	readyIgniteIndex = -1
	setMeltSfx(false, 0)
	stopGazeSfx()
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

		const rig = engine.addEntity()
		Transform.create(rig)
		const beamRoot = engine.addEntity()
		Transform.create(beamRoot)
		const slot: Slot = {
			index: i,
			iced: stationHasIce(map, i),
			chunks: new Array<Entity | null>(MONUMENT_ICE_SLOTS).fill(null),
			heat: new Array<number>(MONUMENT_ICE_SLOTS).fill(0),
			iceMask: 0,
			serverMask: 0,
			sentAt: new Array<number>(MONUMENT_ICE_SLOTS).fill(0),
			rig,
			parts: [],
			beamRoot,
			solid: false,
			groundY,
			x: c.x,
			z: c.z,
			lift: st.beamLiftM ?? 0,
			aim: st.aimX !== undefined && st.aimY !== undefined && st.aimZ !== undefined
				? { x: st.aimX, y: st.aimY, z: st.aimZ }
				: null,
			phase: 'frozen',
			phaseT: 0,
			yaw: 0,
			hoverT: 0,
			active: false,
			sky: null,
			volcano: null,
			hum: null,
		}
		slots[i] = slot
		buildObelisk(slot)

		if (pendingActive[i]) {
			snapDone(slot)
			continue
		}
		// Non-iced monuments start ice-free: no chunks, ignitable at once.
		slot.iceMask = slot.iced ? pendingIce[i] & MONUMENT_ICE_FULL_MASK : MONUMENT_ICE_FULL_MASK
		slot.serverMask = slot.iceMask
		buildChunks(slot)
		applyRig(slot, frozenCentreY(slot))
		// Seated in its socket: solid so you cannot walk through it.
		setObeliskSolid(slot, true)
	}
	syncVolcanoFromStations()
	console.log(
		`stationMarkers: seed ${map.usedSeed}: ${n} frozen monuments, active=${getActiveStationCount()}`,
	)
}


// MARK: meltSystem
/**
 * Local chunk melt + prompt state. Near an unlit monument (NEAR_RADIUS_M,
 * within NEAR_HEIGHT_M of its ground):
 *   - ice left, lit torch: every chunk centre within
 *     MONUMENT_ICE_MELT_RADIUS_M of the player heats up; at full heat it
 *     melts (drops away) and monumentIceMelt goes to the server.
 *   - ice gone (server-confirmed): offer the ignite.
 * Chunks out of reach cool back down over MONUMENT_ICE_CHUNK_REFREEZE_S.
 */
function meltSystem(dt: number): void {
	meltingIndex = -1
	needTorchIndex = -1
	readyIgniteIndex = -1
	let anyHeating = false
	const t = Transform.getOrNull(engine.PlayerEntity)
	const blocked = isItemInputBlocked()
	const lit = isTorchLit()
	const now = Date.now()
	const r2 = MONUMENT_ICE_MELT_RADIUS_M * MONUMENT_ICE_MELT_RADIUS_M
	// Nearest unlit monument in range.
	let near = -1
	let bestD2 = NEAR_RADIUS_SQ_M
	if (t && !blocked) {
		for (let i = 0; i < STATION_COUNT_MAX; i++) {
			const s = slots[i]
			if (!s || s.active || pendingActive[i]) continue
			if (Math.abs(t.position.y - s.groundY) > NEAR_HEIGHT_M) continue
			const dx = t.position.x - s.x
			const dz = t.position.z - s.z
			const d2 = dx * dx + dz * dz
			if (d2 <= bestD2) { bestD2 = d2; near = i }
		}
	}
	for (let i = 0; i < STATION_COUNT_MAX; i++) {
		const s = slots[i]
		if (!s || s.active) continue
		const melting = i === near && lit && hasIce(s)
		for (let c = 0; c < MONUMENT_ICE_SLOTS; c++) {
			// Unconfirmed optimistic melt: nudge the server again.
			if (s.sentAt[c] > 0 && (s.serverMask & (1 << c)) === 0 && now - s.sentAt[c] > ICE_RESEND_MS) {
				s.sentAt[c] = now
				room.send('monumentIceMelt', { seed: currentSeed, index: i, chunk: c })
			}
			if (!s.chunks[c]) continue
			const before = s.heat[c]
			let inReach = false
			if (melting && t) {
				const cc = chunkCentre(s, c)
				const dx = t.position.x - cc.x
				const dz = t.position.z - cc.z
				inReach = dx * dx + dz * dz <= r2
			}
			if (inReach) {
				s.heat[c] = Math.min(1, s.heat[c] + dt / MONUMENT_ICE_CHUNK_MELT_S)
				anyHeating = true
			} else if (s.heat[c] > 0) {
				s.heat[c] = Math.max(0, s.heat[c] - dt / MONUMENT_ICE_CHUNK_REFREEZE_S)
			}
			if (s.heat[c] >= 1) {
				meltChunk(s, c, true)
				s.sentAt[c] = now
				room.send('monumentIceMelt', { seed: currentSeed, index: i, chunk: c })
				continue
			}
			if (s.heat[c] !== before) applyChunk(s, c)
		}
	}
	setMeltSfx(anyHeating, dt)
	if (near < 0) return
	const s = slots[near]!
	if (hasIce(s) || !iceFullyMelted(s.serverMask)) {
		if (lit) meltingIndex = near
		else needTorchIndex = near
	} else if (lit) {
		// Ignite is offered only with a lit torch; unlit = no prompt.
		readyIgniteIndex = near
	}
}


// MARK: Gaze hum
/**
 * True when the camera forward is within GAZE_CONE_DEG of the direction
 * to any activated obelisk's centre (the strongest match decides; all
 * matches drive the same single voice). Obelisks within
 * GAZE_MIN_HORIZ_M horizontally are skipped.
 */
function gazingAtActiveObelisk(): boolean {
	const cam = Transform.getOrNull(engine.CameraEntity)
	if (!cam) return false
	const fwd = Vector3.rotate(Vector3.Forward(), cam.rotation)
	const cosCone = Math.cos(GAZE_CONE_DEG * Math.PI / 180)
	let best = -2
	for (const slot of slots) {
		if (!slot || !slot.active) continue
		const rig = Transform.getOrNull(slot.rig)
		const cx = slot.x
		const cz = slot.z
		const cy = rig ? rig.position.y : hoverCentreY(slot)
		const dx = cx - cam.position.x
		const dy = cy - cam.position.y
		const dz = cz - cam.position.z
		if (Math.hypot(dx, dz) < GAZE_MIN_HORIZ_M) continue
		const len = Math.hypot(dx, dy, dz)
		if (len < 1e-3) continue
		const c = (fwd.x * dx + fwd.y * dy + fwd.z * dz) / len
		if (c > best) best = c
	}
	return best >= cosCone
}

/**
 * Per-frame gaze voice: fade toward GAZE_VOLUME while gazing (over
 * GAZE_FADE_IN_S), toward 0 otherwise (over GAZE_FADE_OUT_S), stop at 0.
 * Never starts unless some obelisk is activated and in the cone. Volume
 * is written only when its 0.01-rounded value changes (rewriting the
 * AudioSource every frame restarts it), as setMeltSfx does.
 */
function gazeSystem(dt: number): void {
	const on = gazingAtActiveObelisk()
	if (!on && !gazeSfxOn) return
	if (on) gazeVol = Math.min(GAZE_VOLUME, gazeVol + (GAZE_VOLUME / GAZE_FADE_IN_S) * dt)
	else    gazeVol = Math.max(0, gazeVol - (GAZE_VOLUME / GAZE_FADE_OUT_S) * dt)
	const vol = Math.round(gazeVol * 100) / 100
	if (!gazeSfxOn) {
		if (vol <= 0) return
		if (!gazeSfxEnt) {
			gazeSfxEnt = engine.addEntity()
			Transform.create(gazeSfxEnt, { parent: engine.CameraEntity })
		}
		unlockAudio()
		AudioSource.createOrReplace(gazeSfxEnt, {
			audioClipUrl: CRYSTAL_HUM_SRC,
			playing     : true,
			loop        : true,
			volume      : vol,
			global      : true,
			currentTime : 0,
		})
		gazeSfxOn = true
		gazeVolWritten = vol
		return
	}
	if (vol <= 0) { stopGazeSfx(); return }
	if (vol !== gazeVolWritten) {
		const a = AudioSource.getMutableOrNull(gazeSfxEnt)
		if (a) a.volume = vol
		gazeVolWritten = vol
	}
}

function stopGazeSfx(): void {
	gazeVol = 0
	gazeVolWritten = 0
	if (!gazeSfxOn) return
	gazeSfxOn = false
	if (gazeSfxEnt && AudioSource.has(gazeSfxEnt)) AudioSource.stopSound(gazeSfxEnt, true)
}


// MARK: setMeltSfx
/**
 * Drive the local looping icemelt voice: start (from the top) when a
 * chunk starts heating, keep looping while any chunk heats, fade out
 * over ICE_MELT_SFX_FADE_S then stop once none does. Volume is written
 * only when it changes (rewriting AudioSource every frame restarts it).
 */
function setMeltSfx(on: boolean, dt: number): void {
	if (on) {
		if (!meltSfxEnt) {
			meltSfxEnt = engine.addEntity()
			Transform.create(meltSfxEnt, { parent: engine.CameraEntity })
		}
		if (!meltSfxOn) {
			unlockAudio()
			AudioSource.createOrReplace(meltSfxEnt, {
				audioClipUrl: ICE_MELT_SFX_SRC,
				playing     : true,
				loop        : true,
				volume      : ICE_MELT_SFX_VOLUME,
				global      : true,
				currentTime : 0,
			})
			meltSfxOn  = true
			meltSfxVol = ICE_MELT_SFX_VOLUME
		} else if (meltSfxFadeS >= 0) {
			const a = AudioSource.getMutableOrNull(meltSfxEnt)
			if (a) a.volume = ICE_MELT_SFX_VOLUME
			meltSfxVol = ICE_MELT_SFX_VOLUME
		}
		meltSfxFadeS = -1
		return
	}
	if (!meltSfxOn) return
	if (meltSfxFadeS < 0) meltSfxFadeS = 0
	meltSfxFadeS += dt
	const k   = Math.max(0, 1 - meltSfxFadeS / ICE_MELT_SFX_FADE_S)
	const vol = Math.round(ICE_MELT_SFX_VOLUME * k * 100) / 100
	if (k > 0 && dt > 0) {
		if (vol !== meltSfxVol) {
			const a = AudioSource.getMutableOrNull(meltSfxEnt)
			if (a) a.volume = vol
			meltSfxVol = vol
		}
		return
	}
	meltSfxOn    = false
	meltSfxFadeS = -1
	meltSfxVol   = 0
	if (meltSfxEnt && AudioSource.has(meltSfxEnt)) AudioSource.stopSound(meltSfxEnt, true)
}


// MARK: Monument snow offsets
/**
 * Depth (m) of the empty recess under the 1 m snow cell whose centre is
 * (dx, dz) from the pit centre: the single recess step, plus the socket
 * depth for cells reaching over the socket (deepest point under them).
 */
function pitCellDepth(dx: number, dz: number): number {
	const ring = Math.max(Math.abs(dx), Math.abs(dz))
	// Outer cells: normal ground (pitDepthAtRing is 0 with no recess).
	let d = pitDepthAtRing(ring)
	// Cells over the socket: snow refills it to ground level.
	if (ring - SNOW_CELL_M / 2 < MONUMENT_SOCKET_SIZE_M / 2) d += MONUMENT_SOCKET_DEPTH_M
	return d
}

/**
 * Push the per-cell snow base offsets for every monument to the snow
 * renderer (cell key -> signed m):
 *   - frozen, ice left: +MONUMENT_ICE_TOP_M on every cell of a chunk still
 *     frozen locally (snow lies on the ice), and on the obelisk column
 *     (none on the obelisk column: no collar round the tip).
 *   - ACTIVE: -recess depth on every recess cell (snow refills the step).
 * Deterministic from the layout + ice masks + the server's active flags
 * (hydrated for late joiners, cleared on cycle reset), so every client
 * draws the same snow. Runs when the signature changes.
 */
function syncSnowOffsets(): void {
	const map = activeTerrain()
	let sig = map ? `${map.usedSeed}:` : 'none:'
	for (let i = 0; i < STATION_COUNT_MAX; i++) {
		const s = slots[i]
		sig += s?.active || pendingActive[i] ? 'A' : s ? s.iceMask.toString(36) : '-'
		sig += ','
	}
	if (sig === pitFillSig) return
	pitFillSig = sig
	const out = new Map<number, number>()
	if (map) {
		const n = Math.min(map.stations.length, STATION_COUNT_MAX)
		const half = MONUMENT_PIT_SIZE_M / 2
		for (let i = 0; i < n; i++) {
			const slot = slots[i]
			const active = slot?.active || pendingActive[i]
			if (!active && !slot) continue
			const st = map.stations[i]
			const c  = cellCenterWorld(st.cx, st.cz)
			const iceLeft = !active && slot !== null && slot !== undefined && hasIce(slot)
			for (let dz = -half + SNOW_CELL_M / 2; dz < half; dz += SNOW_CELL_M) {
				for (let dx = -half + SNOW_CELL_M / 2; dx < half; dx += SNOW_CELL_M) {
					const key = worldToCellKey(c.x + dx, c.z + dz)
					if (key === null) continue
					if (active) {
						const d = pitCellDepth(dx, dz)
						if (d > 0) out.set(key, -d)
						continue
					}
					if (!iceLeft) continue
					const chunk = iceChunkAt(dx, dz)
					if (chunk < 0) continue
					// No lift on the obelisk column: the black shaft comes straight
					// out of the mound cap with no snow collar.
					if (!isIceChunk(chunk)) continue
					// Cells under the obelisk where the four blocks meet: no collar.
					if (Math.abs(dx) < OB_WIDTH_M / 2 && Math.abs(dz) < OB_WIDTH_M / 2) continue
					const frozen = (slot!.iceMask & (1 << chunk)) === 0
					if (frozen) out.set(key, MONUMENT_ICE_TOP_M)
				}
			}
		}
	}
	setSnowCellOffsets(out)
}

// MARK: animSystem
function animSystem(dt: number): void {
	const map = activeTerrain()
	for (let i = 0; i < slots.length; i++) {
		const slot = slots[i]
		if (!slot || !slot.active) continue
		slot.phaseT += dt

		if (slot.phase === 'rising') {
			// Straight up, no rotation: spin + bob only start once hovering.
			const u = Math.min(1, slot.phaseT / MONUMENT_RISE_S)
			const e = smoothstep(u)
			const y0 = frozenCentreY(slot)
			const y1 = hoverCentreY(slot)
			applyRig(slot, y0 + (y1 - y0) * e)
			if (u >= 1) {
				slot.hoverT = 0
				setObeliskSolid(slot, true)
				setPhase(slot, 'settle')
			}
			continue
		}

		// Fully up: spin eases in from 0 with the bob (hoverRamp).
		slot.hoverT += dt
		slot.yaw += dt * HOVER_SPIN_DEG_S * (Math.PI / 180) * hoverRamp(slot)
		if (slot.yaw > Math.PI * 2) slot.yaw -= Math.PI * 2
		applyHover(slot)

		if (slot.phase === 'settle') {
			if (slot.phaseT >= MONUMENT_SETTLE_S) {
				ensureBeams(slot, map)
				setPhase(slot, 'skyBeam')
			}
		} else if (slot.phase === 'skyBeam') {
			revealBeam(slot.sky, slot.phaseT / SKY_BEAM_DROP_S, SKY_BEAM_SEGMENTS)
			if (slot.phaseT >= SKY_BEAM_DROP_S) setPhase(slot, 'volcanoBeam')
		} else if (slot.phase === 'volcanoBeam') {
			revealBeam(slot.volcano, slot.phaseT / VOLCANO_BEAM_DRAW_S, BEAM_SEGMENTS)
			if (slot.phaseT >= VOLCANO_BEAM_DRAW_S) {
				setPhase(slot, 'done')
				syncVolcanoFromStations()
				console.log(`stationMarkers[${i}]: activation complete, beam redirected to volcano`)
			}
		}
	}
}


// MARK: resetForSeed
function resetForSeed(seed: number): void {
	if (cycleSeedsEqual(seed, currentSeed) && currentSeed !== 0) return
	console.log(`stationMarkers: cycle roll ${currentSeed} -> ${seed}, clearing activations`)
	currentSeed = seed
	volcanoThawed = false
	for (let i = 0; i < STATION_COUNT_MAX; i++) { pendingActive[i] = false; pendingIce[i] = 0 }
	// Markers rebuild via activeTerrain watcher when layout changes
	// (clearAll also removes the ground crystal hum emitters).
}


// MARK: setupStationMarkers
/** Install monuments, melt interaction, anim, and network sync. Idempotent. */
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
	engine.addSystem(meltSystem)
	engine.addSystem(iceDropSystem)
	engine.addSystem(animSystem)
	engine.addSystem(syncSnowOffsets)
	engine.addSystem(gazeSystem)

	room.onMessage('monumentIceState', ({ seed, index, mask }) => {
		if (!cycleSeedsEqual(seed, currentSeed)) return
		if (index < 0 || index >= STATION_COUNT_MAX) return
		pendingIce[index] = mask & MONUMENT_ICE_FULL_MASK
		const slot = slots[index]
		if (!slot || slot.active || !slot.iced) return
		const before = slot.iceMask
		applyServerIce(slot, pendingIce[index], true)
		playRemoteMeltCue(slot, before)
	})

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
		// Hydration (fresh=0): snap to hovering + beams. Fresh: rise +
		// beams + SFX, unless this client already played it (local melter).
		const animate = fresh === 1 && !!slot && !slot.active
		if (fresh === 1 && !wasActive) playIgnitionSfx(index)
		finishActivate(index, animate)
	})

	onCycleSeedChange(({ newSeed }) => { resetForSeed(newSeed) })

	console.log('stationMarkers: setupStationMarkers: installed')
}
