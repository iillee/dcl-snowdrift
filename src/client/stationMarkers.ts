/**
 * stationMarkers.ts - obelisk activation sequence (client visuals +
 * melt / ignite interaction). Server state lives in src/server/stations.ts.
 *
 * Sequence per obelisk (Luke's diagram):
 *   1. DISCOVER: a huge dark slate obelisk (square prism with a pyramid
 *      on each end) is seated in a square socket in the floor of a
 *      shallow one-step recess (terrainRenderer addObeliskPit,
 *      OBELISK_PIT_* / OBELISK_SOCKET_* in terrainMap). The recess holds
 *      a mound of ice chunks rising OBELISK_ICE_TOP_M above the ground
 *      (a wall: too tall to step onto). Snow falls on the ice top like
 *      anywhere else (the snow renderer raises those cells by the ice
 *      height, setSnowCellOffsets), so it reads as a snowy mound and only
 *      the black pyramid tip (seated with its base flush with the ground,
 *      FROZEN_SHAFT_ABOVE_GROUND_M) pokes out of the top of the mound.
 *   2. MELT: the ice is a grid of OBELISK_ICE_CHUNK_M columns
 *      (src/shared/obeliskIce.ts). A LIT torch melts every chunk whose
 *      centre is within OBELISK_ICE_MELT_RADIUS_M of the player: each
 *      sinks top-down over OBELISK_ICE_CHUNK_MELT_S (local), then drops
 *      away and the client sends monumentIceMelt. The server owns the
 *      melted-chunk bitmask (monumentIceState: broadcast + late-join
 *      hydration) and clears the snow that lay on each melted chunk.
 *      While any chunk is heating, icemelt.mp3 loops for the melter
 *      (fading out when nothing is melting); other players nearby hear a
 *      positional icemelt hit when the server confirms each chunk.
 *   3. IGNITE: once the server says every chunk is gone, stand near it
 *      with a LIT torch and press E / tap the gold IGNITE OBELISK bubble
 *      (or the torch button on mobile) -> stationActivate. With the torch
 *      out nothing about ignite is shown and E / tap do nothing. The
 *      server refuses while any ice remains. First wins.
 *   4. RISE: the obelisk slowly rises straight out of its socket (no
 *      rotation) to hover high up: bottom tip OBELISK_HOVER_ABOVE_TARGET_M
 *      above the beam's volcano target (obeliskHoverBottomY), so the
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
 * full rise + beams + obelisk.mp3, hydration = snap to hovering with both
 * beams. Obelisks give no heat and melt no snow.
 */
import {
	AudioSource,
	ColliderLayer,
	Entity,
	GltfContainer,
	GltfNodeModifiers,
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
import { playBeamSfx, playIceMeltSfxAt, playObeliskSfxAt, unlockAudio } from 'src/client/audio'
import { isItemInputBlocked } from 'src/client/frost/frozenState'
import { paintIce as paintPlayerIce } from 'src/client/frost/rescue'
import { predictHeatFrontMelt, releaseHeatFrontPrediction, setOptimisticStage } from 'src/client/snow/snowModel'
import { HEAT_FRONT_BAND_M, heatFrontRadiusM } from 'src/shared/heatFront'
import { FINALE_BEAM_XZ_M, finaleWarmRadiusM } from 'src/shared/finale'
import { oasisClear, oasisFinalePulseMs, oasisNoteRelease, oasisRelease, oasisSetBurstReveal } from 'src/shared/terrain/oasis'
import { setSnowCellOffsets } from 'src/client/snow/snowRenderer'
import {
	CINE_SETTLE_S,
	CINE_SKY_DROP_S,
	CINE_VOLCANO_DRAW_S,
	abortObeliskCinematic,
	startObeliskCinematic,
} from 'src/client/obeliskCinematic'
import { GEM_ALPHA_REST, GEM_ENABLED, OBELISK_GEM_FADE_S, OBELISK_MATTE_PBR, gemDipAt, obeliskGemPbr } from 'src/client/obeliskMaterial'
import { isTorchLit } from 'src/client/torchEquip'
import { clearSocketLava, updateSocketLava } from 'src/client/socketLava'
import { setVolcanoLavaStage } from 'src/client/volcanoCrown'
import { DEBUG_VOLCANO_STAGE_OVERRIDE } from 'src/client/devFlags'
import { Billboard, BillboardMode } from '@dcl/sdk/ecs'
import {
	CHARGE_PRE_GLOW,
	CRYSTAL_HEAT_RADIUS_M,
	CRYSTAL_WARMTH_EDGE_FRAC,
	isFloatingCrystals,
	chargeHeatFuel,
	CRYSTAL_RELEASE_HOLD_S,
	CRYSTAL_RISE_S,
	CRYSTAL_LASER_DRAW_S,
	CRYSTAL_LASER_ENABLED,
	CRYSTAL_SKY_IDLE_PULSE_PERIOD_S,
	CRYSTAL_SKY_IDLE_PULSE_AMP,
	CRYSTAL_SKY_IDLE_PULSE_TRAVEL_S,
	CRYSTAL_SKY_IDLE_PULSE_WIDTH,
	CRYSTAL_SPHERE_MAX_M,
	CRYSTAL_BURST_S,
	CRYSTAL_THAW_SPREAD_S,
	CRYSTAL_SKY_DROP_S,
	CRYSTAL_CHARGE_S,
	CRYSTAL_SKY_OFF_S,
	CRYSTAL_LASER_HOLD_S,
} from 'src/shared/ruleset'
import { setVolcanoSmokeBoost } from 'src/client/volcanoSmoke'
import { hearthRadiusFromFuel } from 'src/shared/hearthFuel'
import { fireFinalChargePulse, obeliskHasChargeLink } from 'src/client/fireNetworkGlow'
import { clearObeliskChargeHums, stopObeliskChargeHum, updateObeliskChargeHum } from 'src/client/obeliskChargeHum'
import { cycleSeedsEqual } from 'src/shared/cycleMazeSeed'
import { room } from 'src/shared/messages'
import { crystalFloatAboveGround } from 'src/shared/crystalFloat'
import { announceCinematic, announceWithoutCinematic, igniterName } from 'src/client/obeliskAnnounce'
import { isFrostDying } from 'src/client/frost/death'
import { isEmberFailing } from 'src/client/emberFail'
import { isWorldCovered } from 'src/client/ui/layers/layer.loadingSplash'
import { TERRAIN_CELL_M, sceneHeightLimitM } from 'src/shared/settings'
import { SNOW_CELL_M, worldToCellKey } from 'src/shared/snowGrid'
import {
	OBELISK_ICE_CHUNK_M,
	OBELISK_ICE_CHUNK_MELT_S,
	OBELISK_ICE_FULL_MASK,
	OBELISK_ICE_MELT_RADIUS_M,
	OBELISK_ICE_SLOTS,
	OBELISK_ICE_TOP_M,
	iceChunkAt,
	iceChunkDepth,
	iceChunkHeight,
	iceChunkOffset,
	iceFullyMelted,
	isIceChunk,
	stationHasIce,
	pitDepthAtRing,
} from 'src/shared/obeliskIce'
import { activeGroundYAt, activeTerrain } from 'src/shared/terrain/terrainCache'
import { groundYForLevel } from 'src/shared/settings'
import {
	OBELISK_WIDTH_M,
	OBELISK_PIT_SIZE_M,
	OBELISK_SOCKET_DEPTH_M,
	obeliskSocketDepth,
	OBELISK_SOCKET_SIZE_M,
	TerrainMap,
	cellCenterWorld,
	obeliskHoverBottomY,
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
export const OB_WIDTH_M = OBELISK_WIDTH_M
/** Straight shaft length (m). */
export const OB_SHAFT_M = 14
/** Height of each end pyramid (m). */
export const OB_TIP_M   = 4
const OB_TOTAL_M = OB_SHAFT_M + 2 * OB_TIP_M

/**
 * Seated (un-risen) obelisk, iced or not: how far the top of the square
 * shaft (= base of the top pyramid) sits above the surrounding ground (m).
 * 0 = flush with the ground and the black border, so only the 4 m top
 * pyramid shows: tip OB_TIP_M above the ground. On the iced obelisk the
 * 1.5 m mound (OBELISK_MOUND_TOP_M: 1 m ice + 0.5 m snow) hides the lower
 * 1.5 m of the pyramid, leaving its top 2.5 m above the snow. The shaft runs
 * down through the 1.5 m socket and the dark socket slab (to 14 m below
 * ground, bottom tip 18 m down), hidden inside the terrain. The rise starts
 * from here. Keep terrainGen NEAR_LOS_TIP_M equal to FROZEN_TIP_Y_M.
 */
export const FROZEN_SHAFT_ABOVE_GROUND_M = 0
/** Top tip height above ground while seated (m). */
const FROZEN_TIP_Y_M = OB_TIP_M + FROZEN_SHAFT_ABOVE_GROUND_M

/** Keep the hovering top tip at least this far under the height limit (m). */
const HOVER_CEILING_MARGIN_M = 24


// MARK: Tuning - discover / melt / ignite
// Chunk melt timing + torch radius live in src/shared/obeliskIce.ts.
/**
 * XZ distance (m) from the obelisk centre that counts as "at the
 * obelisk" for the prompts and the ignite: the whole ice mound plus
 * room to stand beside it (you melt it from the side).
 */
export const NEAR_RADIUS_M = OBELISK_PIT_SIZE_M / 2 + 2.5
const NEAR_RADIUS_SQ_M = NEAR_RADIUS_M * NEAR_RADIUS_M
/** Player must be within this height of the station ground to melt / ignite (m). */
const NEAR_HEIGHT_M = 4
/** Ice chunk XZ: tiny inset so neighbours / walls never z-fight. */
const ICE_CHUNK_XZ_M = OBELISK_ICE_CHUNK_M - 0.02
/** A melted chunk drops away over this long (s), like a snow leaf. */
const ICE_DROP_S = 0.3
/** Resend an unconfirmed chunk melt after this long (ms). */
const ICE_RESEND_MS = 3000

// MARK: Tuning - rise / hover
/** Rise out of the ground (s). Applies to every client's rise animation. Was 6. */
export const OBELISK_RISE_S = 10
// Floating crystals release timing (hold / rise / laser) lives in src/shared/ruleset.ts (server thaw timing shares it).
/** Laser retracts into the crystal over this many seconds once the thaw ring is full. */
const CRYSTAL_LASER_RETRACT_S = 1.2
/** Flash fires this long before the hold ends (s); grows over CRYSTAL_FLASH_S. */
const CRYSTAL_FLASH_LEAD_S = 0.25
const CRYSTAL_FLASH_S = 0.45
const CRYSTAL_FLASH_MAX_M = 7
function riseHoldS(): number { return isFloatingCrystals() ? CRYSTAL_RELEASE_HOLD_S : 0 }
function riseDurS(): number { return isFloatingCrystals() ? CRYSTAL_RISE_S : OBELISK_RISE_S }
/** Pause once stationary before the sky beam drops (s). */
export const OBELISK_SETTLE_S = 0.6
/** Hover bob amplitude (m) and period (s): barely noticeable. Was 2.5 m (before that 0.6 m / 12 s). */
export const HOVER_BOB_M = 0.3
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
/**
 * beam.wav one-shot (non-positional, camera-parented) for the igniting
 * player only, the moment the volcano beam starts drawing out of the
 * bottom tip. Plays whether or not the cinematic was skipped.
 */
export const BEAM_SFX_VOLUME = 0.45
/** beam.wav fades in from silence over this long (s), so the attack is not piercing. */
export const BEAM_SFX_FADE_IN_S = 0.8
/** The orb burst / pulse cue (playBeamSfx at fireBurst): was BEAM_SFX_VOLUME 0.45, now about half. */
export const BURST_SFX_VOLUME = 0.22
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
/** The vertical (sky) obelisk beam; the finale ring beams use the very same thickness (shared FINALE_BEAM_XZ_M). */
const SKY_BEAM_XZ_M = FINALE_BEAM_XZ_M
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
/** The buried-obelisk charge hum emitter sits this high above the ground (m). */
const CHARGE_HUM_HEIGHT_M = 2

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

const STATION_COUNT_MAX = 8 // array capacity; live count = map.stations.length (3 classic, OBELISK_COUNT crystals)


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
	/** True for the one obelisk with the ice test (icedStationIndex). */
	iced: boolean,
	/** True while the local ignite cinematic runs for this slot (stretched beam phases). */
	cine: boolean,
	/** Local ignite: play beam.wav when the volcano beam starts (once). */
	beamSfx: boolean,
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
	/** Gem blend 0 (matte black) .. 1 (glowing gem); starts when the sky beam lands. */
	gemK    : number
	/** True once the gem fade has started. */
	gemOn   : boolean
	/** Last opacity written to the gem (resting / dipping). */
	gemAlpha: number
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
const pendingActive: boolean[] = new Array<boolean>(8).fill(false)
/** Server ice masks received before / across a slot rebuild. */
const pendingIce: number[] = new Array<number>(8).fill(0)
const drops: IceDrop[] = []
let lastMap: TerrainMap | null = null
let currentSeed = 0
let installed = false
let mobile = false
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
 * Count of obelisks whose volcano beam has landed (drives smoke/lava so
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
 * Push the landed count (volcano stage 0..3) into smoke + lava, which
 * blend to the stage look (src/shared/volcanoStages.ts). The thaw radius
 * / heat is server-driven (worldThaw.ts) and starts when the beam lands.
 */
function syncVolcanoFromStations(): void {
	// Floating crystals: the volcano is not the objective (stays at stage 0).
	const n = DEBUG_VOLCANO_STAGE_OVERRIDE >= 0 ? DEBUG_VOLCANO_STAGE_OVERRIDE
		: isFloatingCrystals() ? 0 : landedCount()
	setVolcanoSmokeBoost(n)
	setVolcanoLavaStage(n)
}


// MARK: Melt prompt API
/**
 * Text for the hotbar-flush prompt near an unlit obelisk, else null.
 * Ice left: nothing (no melt / torch hints).
 * Ice gone: "IGNITE OBELISK" only while the torch is lit; with the torch
 * out nothing at all (no ignite hint).
 */
export function getObeliskPromptText(): string | null {
	const lit = isTorchLit()
	if (readyIgniteIndex >= 0) return lit ? 'IGNITE OBELISK' : null
	// No melt / torch hints: only IGNITE once all ice is server-confirmed gone.
	return null
}


// MARK: isReadyToIgniteObelisk
/** True when E / the prompt / the torch button should ignite an obelisk. */
export function isReadyToIgniteObelisk(): boolean {
	return readyIgniteIndex >= 0 && !isItemInputBlocked() && isTorchLit()
}


// MARK: requestObeliskIgnite
/** Ignite the ice-free obelisk the player is at with a lit torch. */
export function requestObeliskIgnite(): void {
	if (!isReadyToIgniteObelisk()) return
	const i = readyIgniteIndex
	readyIgniteIndex = -1
	requestActivate(i)
}


function chunkCount(mask: number): number {
	let n = 0
	for (let i = 0; i < OBELISK_ICE_SLOTS; i++) if (isIceChunk(i) && (mask & (1 << i)) !== 0) n++
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


// MARK: Gem
/** GltfNodeModifiers writes per second while a gem fade runs. */
const GEM_WRITE_HZ = 15
let gemWriteClock = 0

/** Push the slot's gem blend + opacity into every obelisk part (global node modifier). */
function applyGem(slot: Slot): void {
	const pbr = obeliskGemPbr(slot.index, slot.gemK, slot.gemAlpha)
	for (const e of slot.parts) {
		GltfNodeModifiers.createOrReplace(e, {
			modifiers: [{ path: '', material: { material: { $case: 'pbr', pbr: { ...pbr } } } }],
		})
	}
}

/** Sky beam landed in the top tip: begin matte -> gem (idempotent). */
function startGem(slot: Slot): void {
	if (!GEM_ENABLED) return
	if (slot.gemOn) return
	slot.gemOn = true
	// Floating crystals: continue from the charge pre-glow.
	if (!isFloatingCrystals()) slot.gemK = 0
}

/** Already-lit obelisk (late join / hydration): straight to the gem. */
function snapGem(slot: Slot): void {
	if (!GEM_ENABLED) return
	slot.gemOn = true
	slot.gemK  = 1
	applyGem(slot)
}

/**
 * Advance gem fade-ins and the periodic opacity dips. Material writes are
 * throttled to GEM_WRITE_HZ and only happen while a fade-in or dip runs;
 * each ends with one exact write at rest.
 */
function gemSystem(dt: number): void {
	if (!GEM_ENABLED) return
	gemWriteClock += dt
	const write = gemWriteClock >= 1 / GEM_WRITE_HZ
	if (write) gemWriteClock = 0
	const nowS = Date.now() / 1000
	for (const slot of slots) {
		if (!slot || !slot.gemOn) continue
		if (slot.gemK < 1) {
			slot.gemK = Math.min(1, slot.gemK + dt / OBELISK_GEM_FADE_S)
			slot.gemAlpha = GEM_ALPHA_REST
			if (write || slot.gemK >= 1) applyGem(slot)
			continue
		}
		const dip = gemDipAt(currentSeed, slot.index, nowS)
		if (dip.dipping) {
			slot.gemAlpha = dip.alpha
			if (write) applyGem(slot)
		} else if (slot.gemAlpha !== GEM_ALPHA_REST) {
			slot.gemAlpha = GEM_ALPHA_REST
			applyGem(slot)
		}
	}
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
	// Matte deep black, no reflectivity: override every node's glb material
	// (path '' = global modifier) so it matches the socket border exactly.
	GltfNodeModifiers.create(e, {
		modifiers: [{ path: '', material: { material: { $case: 'pbr', pbr: { ...OBELISK_MATTE_PBR } } } }],
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
	if (isFloatingCrystals()) {
		// Shared float: every bottom tip at the same world Y (crystalFloat.ts).
		const capTop = sceneHeightLimitM() - HOVER_CEILING_MARGIN_M - HOVER_BOB_M - slot.groundY
		return Math.max(OB_TOTAL_M + FROZEN_TIP_Y_M + 1, Math.min(crystalFloatAboveGround(activeTerrain(), slot.groundY) + OB_TOTAL_M, capTop))
	}
	// Bottom tip (volcano beam origin) a margin above the beam target so
	// the beam descends to the volcano; same formula terrain gen checked.
	const targetY = slot.aim ? slot.aim.y : volcanoLavaTopY()
	// Never let the top tip (plus bob) climb past the height limit margin.
	const capTopAbs = sceneHeightLimitM() - HOVER_CEILING_MARGIN_M - HOVER_BOB_M
	const bottomY = obeliskHoverBottomY(slot.groundY, targetY, slot.lift, capTopAbs - OB_TOTAL_M)
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
 * Pose chunk i: a column from the recess floor up to OBELISK_ICE_TOP_M
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
	for (let i = 0; i < OBELISK_ICE_SLOTS; i++) {
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
	const half = OBELISK_ICE_CHUNK_M / 2
	for (let dz = -half + SNOW_CELL_M / 2; dz < half; dz += SNOW_CELL_M) {
		for (let dx = -half + SNOW_CELL_M / 2; dx < half; dx += SNOW_CELL_M) {
			const key = worldToCellKey(c.x + dx, c.z + dz)
			if (key !== null) setOptimisticStage(key, 0)
		}
	}
}

/** Remove every remaining chunk (activation / hydration). */
function removeAllIce(slot: Slot): void {
	for (let i = 0; i < OBELISK_ICE_SLOTS; i++) {
		if (slot.chunks[i]) meltChunk(slot, i, false)
	}
	slot.iceMask = OBELISK_ICE_FULL_MASK
}

/** True while any ice chunk is still frozen locally. */
function hasIce(slot: Slot): boolean {
	return !iceFullyMelted(slot.iceMask)
}

/** Apply a server mask: melt newly-confirmed chunks (dropping), keep local pendings. */
function applyServerIce(slot: Slot, mask: number, animate: boolean): void {
	slot.serverMask = mask & OBELISK_ICE_FULL_MASK
	for (let i = 0; i < OBELISK_ICE_SLOTS; i++) {
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
	const fresh = (slot.iceMask & ~beforeMask) & OBELISK_ICE_FULL_MASK
	if (fresh === 0 || chunkCount(fresh) > 2) return
	const t = Transform.getOrNull(engine.PlayerEntity)
	if (!t) return
	let chunk = -1
	for (let i = 0; i < OBELISK_ICE_SLOTS; i++) if ((fresh & (1 << i)) !== 0) { chunk = i; break }
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
	// Floating crystals: no volcano beam (finale beams: crystalFinale).
	if (!slot.volcano && map && !isFloatingCrystals()) {
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
 * Start the looping 3D crystal hum (crystal.mp3) when the sky beam lands in the risen obelisk's tip (start of the charge), or at once on a late-join snap (snapDone). An invisible
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
	// Floating crystals: hydrated / late-joined release = the finished oasis (terrain cap already gone).
	const oMap = isFloatingCrystals() ? activeTerrain() : null
	if (oMap) oasisRelease(oMap, slot.x, slot.z, Number.POSITIVE_INFINITY)
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
	snapGem(slot)
}

/** Begin the rise animation (fresh activation). */
function startRise(slot: Slot): void {
	removeAllIce(slot)
	slot.active = true
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
	if (animate) {
		startRise(slot)
		if (isFloatingCrystals()) fireFinalChargePulse(index)
	} else {
		snapDone(slot)
		syncVolcanoFromStations()
	}
}


// MARK: playIgnitionSfx
/** One-shot obelisk.mp3 at the obelisk. Only on a fresh activation. */
function playIgnitionSfx(index: number): void {
	const slot = slots[index]
	if (slot) {
		playObeliskSfxAt(Vector3.create(slot.x, slot.groundY + FROZEN_TIP_Y_M, slot.z))
		return
	}
	const map = activeTerrain()
	const st  = map?.stations[index]
	if (!st) return
	const c = cellCenterWorld(st.cx, st.cz)
	playObeliskSfxAt(Vector3.create(c.x, activeGroundYAt(c.x, c.z) + FROZEN_TIP_Y_M, c.z))
}


// MARK: requestActivate
function requestActivate(index: number): void {
	const slot = slots[index]
	if (slot?.active) return
	if (pendingActive[index]) return
	console.log(`stationMarkers[${index}]: ignited, activate requested (seed=${currentSeed})`)
	playIgnitionSfx(index)
	finishActivate(index, true)
	// This player ignited it: beam.wav when the volcano beam starts (even if the cinematic is skipped).
	if (slots[index]) slots[index]!.beamSfx = true
	room.send('stationActivate', { seed: currentSeed, index })
	if (startIgniteCinematic(index)) announceCinematic(igniterName(''))
	else announceWithoutCinematic()
}


// MARK: canWatchCinematic
/** Remote viewers skip the cinematic while frozen/dying, covered (loading / rebuild) or in ember-fail. */
export function canWatchCinematic(): boolean {
	return !isWorldCovered() && !isEmberFailing() && !isFrostDying() && !isItemInputBlocked()
}


// MARK: startIgniteCinematic
/**
 * Local-only cinematic for the player who just ignited obelisk `index`.
 * Never called from stationState (remote ignites / hydration), so late
 * joiners and reloads never replay it. Stretches this slot's settle /
 * sky-beam / volcano-beam phases (client-side only) until it ends.
 */
function startIgniteCinematic(index: number): boolean {
	const slot = slots[index]
	if (!slot || slot.phase !== 'rising') return false
	const map = activeTerrain()
	// Floating crystals: no volcano beam; frame the crystal against a
	// point on the ground between it and the map centre (camera look-at).
	const aim = isFloatingCrystals()
		? { x: slot.x * 0.85, y: slot.groundY, z: slot.z * 0.85 }
		: slot.aim ?? (map ? volcanoBeamTarget(map) : null)
	if (!aim) return false
	slot.cine = true
	startObeliskCinematic({
		x           : slot.x,
		z           : slot.z,
		groundY     : slot.groundY,
		hoverCentreY: hoverCentreY(slot),
		halfLen     : OB_TOTAL_M / 2,
		aim         : Vector3.create(aim.x, aim.y, aim.z),
		riseS       : riseHoldS() + riseDurS(),
		crystal     : isFloatingCrystals() ? {
			holdS: CRYSTAL_RELEASE_HOLD_S, riseS: CRYSTAL_RISE_S, chargeS: CRYSTAL_CHARGE_S,
			// Burst mode: thaw starts the moment the charge ends (no laser draw / hold).
			skyOffS: CRYSTAL_LASER_ENABLED ? CRYSTAL_SKY_OFF_S : 0, laserS: CRYSTAL_LASER_ENABLED ? CRYSTAL_LASER_DRAW_S : 0, laserHoldS: CRYSTAL_LASER_ENABLED ? CRYSTAL_LASER_HOLD_S : 0, spreadS: CRYSTAL_THAW_SPREAD_S,
			thawR: CRYSTAL_HEAT_RADIUS_M,
		} : undefined,
		rigPos      : () => {
			const tr = Transform.getOrNull(slot.rig)
			return tr ? Vector3.clone(tr.position) : Vector3.create(slot.x, hoverCentreY(slot), slot.z)
		},
		onEnd       : () => { slot.cine = false },
	})
	return true
}


// MARK: getLitObeliskCount
/** Obelisks lit this cycle (server stationState + local optimistic). */
export function getLitObeliskCount(): number {
	let n = 0
	for (let i = 0; i < STATION_COUNT_MAX; i++) if (isStationLit(i)) n++
	return n
}

/** Obelisks in this layout (3 normally). */
export function getObeliskTotal(): number {
	const map = activeTerrain()
	return map ? Math.min(map.stations.length, STATION_COUNT_MAX) : STATION_COUNT_MAX
}


// MARK: clearAll
function clearAll(): void {
	abortObeliskCinematic()
	oasisClear()
	clearSocketLava()
	clearFinalePulses()
	clearObeliskChargeHums()
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
		destroyBeam(lasers[i])
		lasers[i] = null
		clearSphere(i)
		skyCalm[i] = false
		laserHitT[i] = -1
		removeCrystalFx(i)
		engine.removeEntity(s.beamRoot)
		slots[i] = null
	}
	for (const d of drops) engine.removeEntity(d.e)
	drops.length = 0
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
			cine: false,
			beamSfx: false,
			chunks: new Array<Entity | null>(OBELISK_ICE_SLOTS).fill(null),
			heat: new Array<number>(OBELISK_ICE_SLOTS).fill(0),
			iceMask: 0,
			serverMask: 0,
			sentAt: new Array<number>(OBELISK_ICE_SLOTS).fill(0),
			rig,
			parts: [],
			gemK: 0,
			gemOn: false,
			gemAlpha: GEM_ALPHA_REST,
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
		// Non-iced obelisks start ice-free: no chunks, ignitable at once.
		slot.iceMask = slot.iced ? pendingIce[i] & OBELISK_ICE_FULL_MASK : OBELISK_ICE_FULL_MASK
		slot.serverMask = slot.iceMask
		buildChunks(slot)
		applyRig(slot, frozenCentreY(slot))
		// Seated in its socket: solid so you cannot walk through it.
		setObeliskSolid(slot, true)
	}
	syncVolcanoFromStations()
	console.log(
		`stationMarkers: seed ${map.usedSeed}: ${n} frozen obelisks, active=${getActiveStationCount()}`,
	)
}


// MARK: meltSystem
/**
 * Local chunk melt + prompt state. Near an unlit obelisk (NEAR_RADIUS_M,
 * within NEAR_HEIGHT_M of its ground):
 *   - ice left, lit torch: every chunk centre within
 *     OBELISK_ICE_MELT_RADIUS_M of the player heats up; at full heat it
 *     melts (drops away) and monumentIceMelt goes to the server.
 *   - ice gone (server-confirmed): offer the ignite.
 * Heated chunks keep their heat when out of reach (no refreeze).
 */
function meltSystem(dt: number): void {
	readyIgniteIndex = -1
	if (isFloatingCrystals()) {
		// Charge (server) melts the ice; no torch melt or ignite prompt.
		setMeltSfx(false, dt)
		return
	}
	let anyHeating = false
	const t = Transform.getOrNull(engine.PlayerEntity)
	const blocked = isItemInputBlocked()
	const lit = isTorchLit()
	const now = Date.now()
	const r2 = OBELISK_ICE_MELT_RADIUS_M * OBELISK_ICE_MELT_RADIUS_M
	// Nearest unlit obelisk in range.
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
		for (let c = 0; c < OBELISK_ICE_SLOTS; c++) {
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
				s.heat[c] = Math.min(1, s.heat[c] + dt / OBELISK_ICE_CHUNK_MELT_S)
				anyHeating = true
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
	if (lit && !hasIce(s) && iceFullyMelted(s.serverMask)) {
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
		if (!slot || !slot.active || !slot.hum) continue // slot.hum = the beam has landed (crystal.mp3 started)
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


// MARK: Obelisk snow offsets
/**
 * Depth (m) of the empty recess under the 1 m snow cell whose centre is
 * (dx, dz) from the pit centre: the single recess step, plus the socket
 * depth for cells reaching over the socket (deepest point under them).
 */
function pitCellDepth(dx: number, dz: number, socketDepth: number = OBELISK_SOCKET_DEPTH_M): number {
	const ring = Math.max(Math.abs(dx), Math.abs(dz))
	// Outer cells: normal ground (pitDepthAtRing is 0 with no recess).
	let d = pitDepthAtRing(ring)
	// Cells over the socket: snow refills it to ground level.
	if (ring - SNOW_CELL_M / 2 < OBELISK_SOCKET_SIZE_M / 2) d += socketDepth
	return d
}

/**
 * Push the per-cell snow base offsets for every obelisk to the snow
 * renderer (cell key -> signed m):
 *   - frozen, ice left: +OBELISK_ICE_TOP_M on every cell of a chunk still
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
		const half = OBELISK_PIT_SIZE_M / 2
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
						// Floating crystals: never sink the snow into the socket. A
						// client that thought a seated crystal was active (local /
						// stale flag) drew the socket snow 1.5 m down to ground level,
						// so the pit looked open with the tip poking out. A released
						// crystal's 50 m heat zone keeps it clear anyway.
						if (isFloatingCrystals()) continue
						const d = pitCellDepth(dx, dz, obeliskSocketDepth(groundYForLevel(map.levels[st.cz * map.w + st.cx])))
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
					if (frozen) out.set(key, OBELISK_ICE_TOP_M)
				}
			}
		}
	}
	setSnowCellOffsets(out)
}

// MARK: socketLavaSystem
/**
 * Released obelisks leave lava on the floor of their socket (client/socketLava.ts, shared/socketLava.ts): a permanent torch relight
 * source. Driven only by the server-synced release (slot.active) and the crystal's own pose, so late joiners and every other client agree.
 */
function socketLavaSystem(dt: number): void {
	if (!isFloatingCrystals()) return
	for (let i = 0; i < slots.length; i++) {
		const slot = slots[i]
		if (!slot) continue
		const rig = Transform.getOrNull(slot.rig)
		const bottomY = rig ? rig.position.y - OB_TOTAL_M / 2 : Number.NEGATIVE_INFINITY
		updateSocketLava(i, slot.x, slot.z, slot.groundY, slot.active, bottomY, dt)
	}
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
			const hold = riseHoldS()
			const flashAt = hold - CRYSTAL_FLASH_LEAD_S
			if (hold > 0 && slot.phaseT >= flashAt && slot.phaseT - dt < flashAt) spawnReleaseFlash(slot)
			const u = Math.max(0, Math.min(1, (slot.phaseT - hold) / riseDurS()))
			const e = smoothstep(u)
			const y0 = frozenCentreY(slot)
			const y1 = hoverCentreY(slot)
			applyRig(slot, y0 + (y1 - y0) * e)
			// Ignition cinematic only: the sky beam drops during the last
			// CINE_SKY_DROP_S of the rise and lands in the top tip (at its
			// hover position) exactly as the rise ends.
			// Floating crystals (all viewers): the sky beam drops onto the top tip over the end of the rise.
			if (isFloatingCrystals() && slot.phaseT >= hold + riseDurS() - CRYSTAL_SKY_DROP_S) {
				if (!slot.sky) buildSkyBeam(slot)
				revealBeam(slot.sky, (slot.phaseT - (hold + riseDurS() - CRYSTAL_SKY_DROP_S)) / CRYSTAL_SKY_DROP_S, SKY_BEAM_SEGMENTS)
			}
			if (slot.cine && !isFloatingCrystals()) {
				const dropT0 = OBELISK_RISE_S - CINE_SKY_DROP_S
				if (slot.phaseT >= dropT0) {
					ensureBeams(slot, map)
					revealBeam(slot.sky, (slot.phaseT - dropT0) / CINE_SKY_DROP_S, SKY_BEAM_SEGMENTS)
				}
			}
			if (u >= 1) {
				slot.hoverT = 0
				setObeliskSolid(slot, true)
				// Cinematic: the sky beam has just landed in the top tip.
				if (slot.cine && !isFloatingCrystals()) startGem(slot)
				// The sky beam just landed in the top tip = start of the charge (once: the phase moves on): the looping crystal.mp3 starts now.
				startHum(slot)
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
			if (isFloatingCrystals() || slot.phaseT >= (slot.cine ? CINE_SETTLE_S : OBELISK_SETTLE_S)) {
				// Floating crystals: the laser fires straight down to the ground point
				// (thaw front starts server-side at the same moment), then done.
				if (isFloatingCrystals()) { crystalAfterRise(slot, i, dt); continue }
				ensureBeams(slot, map)
				if (slot.cine) {
					// Sky beam already landed during the rise: straight to the volcano beam.
					revealBeam(slot.sky, 1, SKY_BEAM_SEGMENTS)
					startVolcanoBeam(slot)
				} else {
					setPhase(slot, 'skyBeam')
				}
			}
		} else if (slot.phase === 'skyBeam') {
			const dropS = slot.cine ? CINE_SKY_DROP_S : SKY_BEAM_DROP_S
			revealBeam(slot.sky, slot.phaseT / dropS, SKY_BEAM_SEGMENTS)
			if (slot.phaseT >= dropS) startVolcanoBeam(slot)
		} else if (slot.phase === 'volcanoBeam') {
			const drawS = slot.cine ? CINE_VOLCANO_DRAW_S : VOLCANO_BEAM_DRAW_S
			revealBeam(slot.volcano, slot.phaseT / drawS, BEAM_SEGMENTS)
			if (slot.phaseT >= drawS) {
				setPhase(slot, 'done')
				syncVolcanoFromStations()
				console.log(`stationMarkers[${i}]: activation complete, beam redirected to volcano`)
			}
		}
	}
}


// MARK: startVolcanoBeam
/** Enter the volcano-beam phase; the igniting player hears beam.wav once. */
function startVolcanoBeam(slot: Slot): void {
	// Sky beam has landed in the top tip (non-cinematic path; idempotent).
	startGem(slot)
	if (isFloatingCrystals()) {
		// No volcano beam: the crystal just floats and glows.
		setPhase(slot, 'done')
		return
	}
	setPhase(slot, 'volcanoBeam')
	if (slot.beamSfx) {
		slot.beamSfx = false
		playBeamSfx(BEAM_SFX_VOLUME, BEAM_SFX_FADE_IN_S)
	}
}


// MARK: resetForSeed
function resetForSeed(seed: number): void {
	if (cycleSeedsEqual(seed, currentSeed) && currentSeed !== 0) return
	console.log(`stationMarkers: cycle roll ${currentSeed} -> ${seed}, clearing activations`)
	currentSeed = seed
	oasisClear()
	for (let i = 0; i < STATION_COUNT_MAX; i++) { pendingActive[i] = false; pendingIce[i] = 0; pendingCharge[i] = 0 }
	// Markers rebuild via activeTerrain watcher when layout changes
	// (clearAll also removes the ground crystal hum emitters).
}


// MARK: setupStationMarkers
/** Install obelisks, melt interaction, anim, and network sync. Idempotent. */
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
	engine.addSystem(gemSystem)
	engine.addSystem(syncSnowOffsets)
	engine.addSystem(gazeSystem)
	engine.addSystem(socketLavaSystem)
	if (isFloatingCrystals()) { engine.addSystem(crystalSystem); engine.addSystem(laserSystem); engine.addSystem(burstSystem); engine.addSystem(finalePulseSystem); engine.addSystem(skyIdlePulseSystem) }

	room.onMessage('monumentCharge', ({ seed, index, charge }) => {
		if (!cycleSeedsEqual(seed, currentSeed)) return
		if (index < 0 || index >= STATION_COUNT_MAX) return
		pendingCharge[index] = Math.max(0, Math.min(1, Number(charge) || 0))
	})

	room.onMessage('monumentIceState', ({ seed, index, mask }) => {
		if (!cycleSeedsEqual(seed, currentSeed)) return
		if (index < 0 || index >= STATION_COUNT_MAX) return
		pendingIce[index] = mask & OBELISK_ICE_FULL_MASK
		const slot = slots[index]
		if (!slot || slot.active || !slot.iced) return
		const before = slot.iceMask
		applyServerIce(slot, pendingIce[index], true)
		playRemoteMeltCue(slot, before)
	})

	room.onMessage('stationState', ({ seed, index, active, fresh, by, ageMs }) => {
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
		// Release clock for the oasis melt + regrowth: the server's age, so a late joiner lands mid-growth.
		if (slot && typeof ageMs === 'number' && ageMs >= 0) oasisNoteRelease(slot.x, slot.z, Date.now() - ageMs)
		// Hydration (fresh=0): snap to hovering + beams. Fresh: rise +
		// beams + SFX, unless this client already played it (local melter).
		const animate = fresh === 1 && !!slot && !slot.active
		if (fresh === 1 && !wasActive) playIgnitionSfx(index)
		finishActivate(index, animate)
		// Remote ignite: everyone in the scene watches (skippable per player).
		// Hydration (fresh=0) never plays, so mid-cinematic joiners don't get it.
		if (animate) {
			if (canWatchCinematic() && startIgniteCinematic(index)) announceCinematic(igniterName(by ?? ''))
			else announceWithoutCinematic()
		}
	})

	onCycleSeedChange(({ newSeed }) => { resetForSeed(newSeed) })

	console.log('stationMarkers: setupStationMarkers: installed')
}


// MARK: Floating crystals - charge visuals
/** Charge 0..1 per obelisk from the server (monumentCharge). */
const pendingCharge: number[] = new Array<number>(8).fill(0)
/** Seconds since all three crystals were up (finale beams), -1 = not yet. */
const BAR_W_M = 4
const BAR_H_M = 0.35
const BAR_Y_M = 7
const CHARGE_COL = Color4.create(1.0, 0.55, 0.15, 1)
const CHARGE_EMI = Color3.create(1.0, 0.5, 0.1)

type CrystalFx = { ring: Entity[]; bar: Entity; fill: Entity; shownCharge: number; glowAcc: number }
const fx: Array<CrystalFx | null> = []

function removeCrystalFx(i: number): void {
	const f = fx[i]
	if (!f) return
	for (const e of f.ring) engine.removeEntity(e)
	engine.removeEntity(f.fill)
	engine.removeEntity(f.bar)
	fx[i] = null
}

function buildCrystalFx(slot: Slot): CrystalFx {
	// No charge-radius ring posts any more (the links show what charges).
	const ring: Entity[] = []
	const bar = engine.addEntity()
	Transform.create(bar, { position: Vector3.create(slot.x, slot.groundY + BAR_Y_M, slot.z) })
	Billboard.create(bar, { billboardMode: BillboardMode.BM_Y })
	const bg = engine.addEntity()
	Transform.create(bg, { parent: bar, scale: Vector3.create(BAR_W_M + 0.15, BAR_H_M + 0.15, 1) })
	MeshRenderer.setPlane(bg)
	Material.setBasicMaterial(bg, { diffuseColor: Color4.create(0.05, 0.05, 0.08, 0.85), castShadows: false })
	ring.push(bg)
	const fill = engine.addEntity()
	Transform.create(fill, { parent: bar, position: Vector3.create(0, 0, -0.02), scale: Vector3.create(0.001, BAR_H_M, 1) })
	MeshRenderer.setPlane(fill)
	paintGlow(fill, CHARGE_COL, CHARGE_EMI, 2)
	return { ring, bar, fill, shownCharge: -1, glowAcc: 0 }
}

function crystalSystem(dt: number): void {
	for (let i = 0; i < slots.length; i++) {
		const slot = slots[i]
		if (!slot) continue
		if (slot.active) {
			stopObeliskChargeHum(i, slot.x, slot.groundY + CHARGE_HUM_HEIGHT_M, slot.z, dt) // fade out on release
			removeCrystalFx(i)
			continue
		}
		const ch = pendingCharge[i] ?? 0
		let f = fx[i]
		// Looping 3D hum while buried and receiving heat from the fire network (live charge link, not full, not released).
		if (ch >= 1 || pendingActive[i]) stopObeliskChargeHum(i, slot.x, slot.groundY + CHARGE_HUM_HEIGHT_M, slot.z, dt)
		else updateObeliskChargeHum(i, slot.x, slot.groundY + CHARGE_HUM_HEIGHT_M, slot.z, obeliskHasChargeLink(i), dt)
		// Bar hidden until charging starts (charge > 0 or a live charge link);
		// once it has charge it stays until release.
		const started = ch > 0 || obeliskHasChargeLink(i)
		if (!started) { if (f) removeCrystalFx(i); continue }
		if (!f) { f = buildCrystalFx(slot); fx[i] = f }
		// Progress bar fill grows from the left.
		if (Math.abs(ch - f.shownCharge) > 0.001) {
			f.shownCharge = ch
			const w = Math.max(0.001, BAR_W_M * ch)
			const tr = Transform.getMutable(f.fill)
			tr.scale = Vector3.create(w, BAR_H_M, 1)
			tr.position = Vector3.create(-BAR_W_M / 2 + w / 2, 0, -0.02)
		}
		// Pre-glow: the crystal brightens with charge (throttled writes).
		f.glowAcc += dt
		if (GEM_ENABLED && f.glowAcc >= 0.25) {
			f.glowAcc = 0
			const k = ch * CHARGE_PRE_GLOW
			if (Math.abs(k - slot.gemK) > 0.01) { slot.gemK = k; applyGem(slot) }
		}
	}
}

// MARK: obeliskChargeHeatAt
/**
 * Campfire-equivalent fuel of the strongest CHARGING obelisk whose tier
 * ring (hearthRadiusFromFuel) covers (x, z); 0 = none. Charge comes from
 * the server (monumentCharge, also sent to late joiners). Released
 * obelisks hand over to crystalHeatAt.
 */
export function obeliskChargeHeatAt(x: number, z: number): number {
	if (!isFloatingCrystals()) return 0
	let best = 0
	for (let i = 0; i < slots.length; i++) {
		const s = slots[i]
		if (!s || pendingActive[i]) continue
		const fuel = chargeHeatFuel(pendingCharge[i] ?? 0)
		if (fuel <= best) continue
		const r = hearthRadiusFromFuel(fuel)
		if ((x - s.x) ** 2 + (z - s.z) ** 2 <= r * r) best = fuel
	}
	return best
}

// MARK: Finale hooks (crystalFinale.ts)
/**
 * Every obelisk's top-tip beam joint (the sky beam's origin, mean hover height) and socket ground point, station
 * order; null until every slot exists (map / layout not built yet).
 */
export function finaleAnchors(): Array<{ tip: Vector3; ground: Vector3 }> | null {
	const map = activeTerrain()
	if (!map || map.stations.length === 0) return null
	const out: Array<{ tip: Vector3; ground: Vector3 }> = []
	for (let i = 0; i < map.stations.length; i++) {
		const s = slots[i]
		if (!s) return null
		out.push({ tip: topBeamJoint(s), ground: Vector3.create(s.x, s.groundY, s.z) })
	}
	return out
}

/** The obelisk beam look (same glow colour / emissive) on a finale beam entity. */
export function paintFinaleBeam(e: Entity): void {
	paintGlow(e, COLOR_BEAM, BEAM_EMISSIVE, BEAM_EMISSIVE_INTENSITY)
}

// MARK: crystalHeatAt
/**
 * Warmth factor 0..1 at (x, z) from released crystals (floating-crystals
 * ruleset): 1 at a crystal, CRYSTAL_WARMTH_EDGE_FRAC at
 * the warm radius, 0 outside. The warm radius is CRYSTAL_HEAT_RADIUS_M and grows with the finale pulse (finaleWarmRadiusM)
 * to cover the enlarged melted area. Uses the server active flag
 * (pendingActive) so warmth starts at release, not after the rise.
 */
export function crystalHeatAt(x: number, z: number): number {
	if (!isFloatingCrystals()) return 0
	let best = 0
	const warmR = finaleWarmRadiusM(oasisFinalePulseMs(), Date.now())
	const r2 = warmR * warmR
	for (let i = 0; i < slots.length; i++) {
		const s = slots[i]
		if (!s || !pendingActive[i]) continue
		const dx = x - s.x
		const dz = z - s.z
		const d2 = dx * dx + dz * dz
		if (d2 > r2) continue
		const t = Math.sqrt(d2) / warmR
		const h = 1 - (1 - CRYSTAL_WARMTH_EDGE_FRAC) * t
		if (h > best) best = h
	}
	return best
}

// MARK: Release flash (floating crystals)
type Flash = { e: Entity; t: number }
const flashes: Flash[] = []
/** Bright burst at the seated crystal as the final pulse lands. */
function spawnReleaseFlash(slot: Slot): void {
	const tr = Transform.getOrNull(slot.rig)
	const p = tr ? tr.position : Vector3.create(slot.x, slot.groundY + 2, slot.z)
	const e = engine.addEntity()
	Transform.create(e, { position: Vector3.create(p.x, p.y, p.z), scale: Vector3.create(0.5, 0.5, 0.5) })
	MeshRenderer.setSphere(e)
	flashes.push({ e, t: 0 })
	paintFlash(e, 1)
	if (flashes.length === 1) engine.addSystem(flashSystem, undefined, 'crystalReleaseFlash')
}
function paintFlash(e: Entity, a: number): void {
	Material.setPbrMaterial(e, {
		albedoColor      : Color4.create(1, 0.95, 0.75, 0.85 * a),
		emissiveColor    : Color3.create(1, 0.9, 0.6),
		emissiveIntensity: 6 * a,
		transparencyMode : MaterialTransparencyMode.MTM_ALPHA_BLEND,
		castShadows      : false,
	})
}
function flashSystem(dt: number): void {
	for (let i = flashes.length - 1; i >= 0; i--) {
		const f = flashes[i]
		f.t += dt
		const u = Math.min(1, f.t / CRYSTAL_FLASH_S)
		const s = 0.5 + (CRYSTAL_FLASH_MAX_M - 0.5) * (1 - (1 - u) * (1 - u))
		Transform.getMutable(f.e).scale = Vector3.create(s, s, s)
		paintFlash(f.e, 1 - u)
		if (u >= 1) { engine.removeEntity(f.e); flashes.splice(i, 1) }
	}
	if (flashes.length === 0) engine.removeSystem('crystalReleaseFlash')
}


// MARK: Crystal laser (floating crystals release)
/** Seconds since the laser hit the ground per obelisk (-1 = none / gone). */
const laserHitT: number[] = new Array<number>(8).fill(-1)
/** Downward laser per obelisk (the sky beam lives in slot.sky). */
const lasers: Array<Beam | null> = new Array<Beam | null>(8).fill(null)
/** Sky beam pulse scale reset after charging (per obelisk). */
const skyCalm: boolean[] = new Array<boolean>(8).fill(false)

/** Same sky beam as the classic activation: from high above down into the top tip. */
function buildSkyBeam(slot: Slot): void {
	const top = topBeamJoint(slot)
	const topY = sceneHeightLimitM() - SKY_BEAM_CEILING_MARGIN_M - HOVER_BOB_M
	if (topY <= top.y + 2) return
	slot.sky = buildBeam(slot.beamRoot, top, Vector3.create(top.x, topY, top.z), SKY_BEAM_SEGMENTS, SKY_BEAM_XZ_M, SKY_BEAM_FADE_START, true)
}

/**
 * After the rise (phase 'settle', phaseT from the sky beam landing):
 *   0 .. CHARGE        crystal charges from the sky beam (brightens, pulses run down it)
 *   .. + SKY_OFF       pause (0 now: the sky beam stays on permanently, steady glow)
 *   .. + LASER_DRAW    laser draws down into the earth (beam sfx)
 * then 'done'; the server thaw starts LASER_HOLD later (CRYSTAL_THAW_DELAY_S).
 */
function crystalAfterRise(slot: Slot, i: number, _dt: number): void {
	const t = slot.phaseT
	const tOff = CRYSTAL_CHARGE_S
	const tLaser = tOff + CRYSTAL_SKY_OFF_S
	if (!slot.sky) { buildSkyBeam(slot); revealBeam(slot.sky, 1, SKY_BEAM_SEGMENTS) }
	if (t < tOff) {
		const u = t / CRYSTAL_CHARGE_S
		const k = CHARGE_PRE_GLOW + (1 - CHARGE_PRE_GLOW) * u
		if (GEM_ENABLED && Math.abs(k - slot.gemK) > 0.01) { slot.gemK = k; applyGem(slot) }
		// Pulse crest runs from the sky (tMid 1) down into the tip (tMid 0).
		const sky = slot.sky
		if (sky) {
			// Same slow synced crest as the permanent idle beam (Luke: no fast charge pulse).
			const P = Math.max(0.2, CRYSTAL_SKY_IDLE_PULSE_PERIOD_S)
			const inCycle = ((Date.now() / 1000) % P + P) % P
			const uu = inCycle / Math.max(0.1, CRYSTAL_SKY_IDLE_PULSE_TRAVEL_S)
			const W = Math.max(0.02, CRYSTAL_SKY_IDLE_PULSE_WIDTH)
			const front = uu <= 1 ? 1 + W * 2 - uu * (1 + W * 4) : -10
			for (let k2 = 0; k2 < sky.segs.length; k2++) {
				const tr = Transform.getMutableOrNull(sky.segs[k2])
				if (!tr) continue
				const s = 1 + CRYSTAL_SKY_IDLE_PULSE_AMP * Math.exp(-(((sky.tMid[k2] - front) / W) ** 2))
				tr.scale = Vector3.create(sky.xz[k2] * s, tr.scale.y, sky.xz[k2] * s)
			}
		}
		return
	}
	// Charging over: the sky beam stays on permanently at a steady glow
	// (pulse scale reset once). It clears only on the cycle reset.
	const sky = slot.sky
	if (sky && !skyCalm[i]) {
		skyCalm[i] = true
		for (let k2 = 0; k2 < sky.segs.length; k2++) {
			const tr = Transform.getMutableOrNull(sky.segs[k2])
			if (tr) tr.scale = Vector3.create(sky.xz[k2], tr.scale.y, sky.xz[k2])
		}
	}
	if (!CRYSTAL_LASER_ENABLED) {
		// Burst: the charge sphere releases outward (thaw front tracks it).
		startBurst(slot, i)
		startVolcanoBeam(slot) // -> 'done'
		return
	}
	if (t < tLaser) return
	if (!lasers[i]) {
		lasers[i] = buildBeam(slot.beamRoot, bottomBeamJoint(slot), Vector3.create(slot.x, slot.groundY, slot.z), BEAM_SEGMENTS, BEAM_XZ_M, BEAM_FADE_START, false)
		playBeamSfx(BEAM_SFX_VOLUME, BEAM_SFX_FADE_IN_S)
	}
	revealBeam(lasers[i], (t - tLaser) / CRYSTAL_LASER_DRAW_S, BEAM_SEGMENTS)
	if (t - tLaser >= CRYSTAL_LASER_DRAW_S) {
		laserHitT[i] = 0
		startVolcanoBeam(slot) // -> 'done' + gem on (already full)
	}
}

// MARK: Release sphere + burst
/** Burst per obelisk: entity + seconds since release (-1 = none). */
const bursts: Array<{ e: Entity; t: number; endR: number; cx: number; cz: number; h: number; doneR: number; stepAcc: number } | null> = new Array(8).fill(null)
/** Predicted-melt step (s): the client melts the cells the sphere edge has newly crossed this often. */
const BURST_MELT_STEP_S = 0.05
/** Sphere centre: the bottom tip at float height (same point the server thaw front uses). */
function sphereCentre(slot: Slot): Vector3 {
	return Vector3.create(slot.x, slot.groundY + crystalFloatAboveGround(activeTerrain(), slot.groundY), slot.z)
}
function paintEnergy(e: Entity, a: number, glow: number): void {
	Material.setPbrMaterial(e, {
		albedoColor      : Color4.create(0.78, 0.6, 1, 0.55 * a),
		emissiveColor    : Color3.create(0.7, 0.45, 1),
		emissiveIntensity: glow * a,
		transparencyMode : MaterialTransparencyMode.MTM_ALPHA_BLEND,
		castShadows      : false,
	})
}
function startBurst(slot: Slot, i: number): void {
	if (bursts[i]) return
	const e = engine.addEntity()
	Transform.create(e, { position: sphereCentre(slot), scale: Vector3.create(CRYSTAL_SPHERE_MAX_M, CRYSTAL_SPHERE_MAX_M, CRYSTAL_SPHERE_MAX_M) })
	MeshRenderer.setSphere(e)
	paintEnergy(e, 1, 3)
	const h = crystalFloatAboveGround(activeTerrain(), slot.groundY)
	bursts[i] = { e, t: 0, endR: Math.hypot(CRYSTAL_HEAT_RADIUS_M + HEAT_FRONT_BAND_M, h), cx: slot.x, cz: slot.z, h, doneR: 0, stepAcc: 0 }
	// The oasis exists from the burst; its terrain cap melts away ring by ring behind the front (burstSystem).
	const oMap = activeTerrain()
	if (oMap) oasisRelease(oMap, slot.x, slot.z, 0)
	playBeamSfx(BURST_SFX_VOLUME, 0.05)
}
/* Burst radius 0 -> hypot(R + 3 m band, this crystal's float height above ground) over CRYSTAL_BURST_S (per burst endR); alpha 1 -> 0. */
/** Synced idle pulse on every released crystal's sky beam (shared epoch clock). */
function skyIdlePulseSystem(): void {
	const P = Math.max(0.2, CRYSTAL_SKY_IDLE_PULSE_PERIOD_S)
	const inCycle = ((Date.now() / 1000) % P + P) % P
	const u = inCycle / Math.max(0.1, CRYSTAL_SKY_IDLE_PULSE_TRAVEL_S)
	const W = Math.max(0.02, CRYSTAL_SKY_IDLE_PULSE_WIDTH)
	// Crest from just above the sky end (tMid 1) to just past the tip (tMid 0).
	const front = u <= 1 ? 1 + W * 2 - u * (1 + W * 4) : -10
	for (const slot of slots) {
		// Only once released and settled ('done'): the charge pulse owns the beam before.
		if (!slot || slot.phase !== 'done' || !slot.sky) continue
		const sky = slot.sky
		for (let k = 0; k < sky.segs.length; k++) {
			const tr = Transform.getMutableOrNull(sky.segs[k])
			if (!tr) continue
			const s = 1 + CRYSTAL_SKY_IDLE_PULSE_AMP * Math.exp(-(((sky.tMid[k] - front) / W) ** 2))
			tr.scale = Vector3.create(sky.xz[k] * s, tr.scale.y, sky.xz[k] * s)
		}
	}
}
function burstSystem(dt: number): void {
	for (let i = 0; i < bursts.length; i++) {
		const b = bursts[i]
		if (!b) continue
		b.t += dt
		const u = Math.min(1, b.t / CRYSTAL_BURST_S)
		const d = Math.max(CRYSTAL_SPHERE_MAX_M, 2 * b.endR * u)
		Transform.getMutable(b.e).scale = Vector3.create(d, d, d)
		const a = Math.pow(1 - u, 1.5)
		paintEnergy(b.e, a, 3)
		// Predicted melt: the cells under the sphere's ground circle melt locally, in step with its edge
		// (same linear sphere growth + geometry as the server front), so the thaw does not wait on
		// 10 Hz / bursty PaintTile sync. The server's tiles reconcile it (snowModel.predictHeatFrontMelt).
		b.stepAcc += dt
		if (u >= 1 || b.stepAcc >= BURST_MELT_STEP_S) {
			b.stepAcc = 0
			const r = Math.min(heatFrontRadiusM(u, CRYSTAL_HEAT_RADIUS_M, b.h), CRYSTAL_HEAT_RADIUS_M)
			if (r > b.doneR) { predictHeatFrontMelt(b.cx, b.cz, b.doneR, r); oasisSetBurstReveal(b.cx, b.cz, r); b.doneR = r }
		}
		if (u >= 1) { oasisSetBurstReveal(b.cx, b.cz, Number.POSITIVE_INFINITY); engine.removeEntity(b.e); bursts[i] = null }
	}
}
// MARK: Finale pulse
/**
 * The ending's synchronized pulse: every obelisk releases the same larger energy flash at once (the release burst's look: a bright
 * translucent sphere that grows from the crystal and fades, existing burst sound). The ground / snow / vegetation follow the same radial
 * front through the oasis (shared/terrain/oasis.ts finale pulse) and the server heat front; this is only the visual.
 */
const finalePulses: Array<{ e: Entity; t: number; durS: number; endD: number }> = []
export function startFinalePulse(durS: number, radiusM: number): void {
	const map = activeTerrain()
	for (const slot of slots) {
		if (!slot) continue
		const h = crystalFloatAboveGround(map, slot.groundY)
		const e = engine.addEntity()
		Transform.create(e, { position: sphereCentre(slot), scale: Vector3.create(CRYSTAL_SPHERE_MAX_M, CRYSTAL_SPHERE_MAX_M, CRYSTAL_SPHERE_MAX_M) })
		MeshRenderer.setSphere(e)
		paintEnergy(e, 1, 5)
		finalePulses.push({ e, t: 0, durS: Math.max(1, durS), endD: 2 * Math.hypot(radiusM + HEAT_FRONT_BAND_M, h) })
	}
	playBeamSfx(BURST_SFX_VOLUME, 0.05)
}
function finalePulseSystem(dt: number): void {
	for (let i = finalePulses.length - 1; i >= 0; i--) {
		const p = finalePulses[i]
		p.t += dt
		const u = Math.min(1, p.t / p.durS)
		const d = Math.max(CRYSTAL_SPHERE_MAX_M, p.endD * u)
		Transform.getMutable(p.e).scale = Vector3.create(d, d, d)
		paintEnergy(p.e, Math.pow(1 - u, 1.5), 5)
		if (u >= 1) { engine.removeEntity(p.e); finalePulses.splice(i, 1) }
	}
}
function clearFinalePulses(): void {
	for (const p of finalePulses) engine.removeEntity(p.e)
	finalePulses.length = 0
}

function clearSphere(i: number): void {
	const b = bursts[i]
	if (b) { engine.removeEntity(b.e); if (b.doneR < CRYSTAL_HEAT_RADIUS_M) releaseHeatFrontPrediction() }
	bursts[i] = null
}

/** Hold the laser through the laser hold + the thaw spread, then retract it into the crystal and remove it. */
function laserSystem(dt: number): void {
	for (let i = 0; i < laserHitT.length; i++) {
		if (laserHitT[i] < 0) continue
		const b = lasers[i]
		if (!slots[i] || !b) { laserHitT[i] = -1; continue }
		laserHitT[i] += dt
		const u = (laserHitT[i] - CRYSTAL_LASER_HOLD_S - CRYSTAL_THAW_SPREAD_S) / CRYSTAL_LASER_RETRACT_S
		if (u <= 0) continue
		const keep = Math.ceil((1 - Math.min(1, u)) * BEAM_SEGMENTS)
		for (let k = 0; k < b.segs.length; k++) {
			if (b.order[k] >= keep && MeshRenderer.has(b.segs[k])) MeshRenderer.deleteFrom(b.segs[k])
		}
		if (u >= 1) { destroyBeam(b); lasers[i] = null; laserHitT[i] = -1 }
	}
}