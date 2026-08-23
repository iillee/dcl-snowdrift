/**
 * hearthBillboard.ts - 3D fuel bar floating above the main hearth.
 *
 * Styled to match layer.frostBar (COL_BORDER_WHITE outer + COL_WARM
 * gold fill) so the top-HUD frost bar and the world-space hearth bar
 * read as members of the same visual family. Note: 3D Planes don't
 * support borderRadius, so corners are square. Swap the backdrop
 * mesh for a rounded-rect texture with alpha when we author one.
 *
 * Entity tree:
 *
 *   root (Billboard Y, parked ~4.5 m above fire)
 *     +-- whiteBorder      (thin white plane, forms the outer frame)
 *     +-- darkBackdrop     (dark plane, forms the inset "empty" bar)
 *     +-- fillPivot        (invisible, sits at the bar bottom)
 *     |     +-- fill       (warm-gold plane, scale.y = fuel fraction)
 *     +-- tickN            (thin white notches at each tier boundary)
 *     +-- heatIcon         (torch.png glyph at the top)
 *     +-- multiplier       (TextShape "xN.N", hidden when 1 player)
 *
 * A per-frame system reads hearthFuel getters and mutates the fill's
 * scale + position, plus the multiplier text when the roster changes.
 * Colour is CONSTANT now (frost-bar match) - tier is communicated by
 * fill height alone, punctuated by the tier ticks.
 */

import {
	AudioSource, Billboard, BillboardMode, Entity, Material, MaterialTransparencyMode,
	MeshRenderer, TextAlignMode, TextShape, Transform, VisibilityComponent, engine,
} from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Y, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { FUEL_MAX, TIER_FUEL } from 'src/shared/hearthFuel'
import { room } from 'src/shared/messages'
import {
	getHearthPlayerCount, getMainFireFuel,
} from 'src/client/hearthFuel'


// MARK: Layout constants
/** Height above the fire's world Y. Clears the flame column so the
 *  bar reads as the fire's HUD without occluding the flames. */
const BAR_Y_OFFSET = 4.5

/** Physical inner bar dimensions in metres. */
const BAR_WIDTH  = 1.0
const BAR_HEIGHT = 2.0

/** White border thickness (metres). Applied as a slightly larger
 *  outer plane behind the dark backdrop - fakes a stroke without
 *  needing a UI borderWidth prop (unavailable on 3D Planes). */
const BORDER_W = 0.06

/** Thin white tier-boundary notches. */
const TICK_HEIGHT = 0.03
const TICK_WIDTH  = BAR_WIDTH + BORDER_W * 2   // extend past the bar edges

/** Multiplier text metrics. TextShape units are (metres * fontSize),
 *  chosen empirically to read from ~30 m. */
const MULT_FONT_SIZE = 3
const MULT_Y_OFFSET  = BAR_HEIGHT / 2 + BORDER_W + 0.35

/** Total seconds the fill stays washed-out toward COL_FLASH after a
 *  hearthMax broadcast. Short - a celebratory zap, not a strobe. */
const MAX_FLASH_DURATION_S = 0.8

/** Global whoosh played when the hearth first hits FUEL_MAX. Uses an
 *  existing SFX file so no new asset is needed for the prototype. */
const MAX_BURST_SFX = 'assets/sounds/pop.mp3'


// MARK: Colours - matched to layer.frostBar
/** White frame stroke - fully opaque so it reads as a crisp outline
 *  against the snow / sky rather than tinting through them. */
const COL_BORDER     = Color4.create(1, 1, 1, 1)
/** Dark bar backdrop - reads as an empty gauge with the border. */
const COL_BACKDROP   = Color4.create(0, 0, 0, 0.75)
/** Warm-gold fill - identical to frost bar's COL_WARM. */
const COL_FILL       = Color4.create(1.00, 0.80, 0.30, 1.00)
/** White-hot flash colour played on the fill during the max-burst
 *  celebration. Blends back to COL_FILL over MAX_FLASH_DURATION_S. */
const COL_FLASH      = Color4.create(1.00, 1.00, 0.95, 1.00)
/** Tick notches - subtle white so they read against both the empty
 *  backdrop and the gold fill without shouting. */
const COL_TICK       = Color4.create(1, 1, 1, 0.55)
const COL_MULT_TEXT  = Color4.create(1, 1, 1, 1)
const COL_MULT_STROKE = Color4.create(0, 0, 0, 1)


interface BillboardRig {
	root      : Entity
	fill      : Entity
	multiplier: Entity
	lastPlayers: number
	/** Seconds remaining on the max-burst white flash. 0 = idle. */
	flashTimer: number
	/** Dedicated audio-emitter child so the whoosh plays spatially
	 *  from the hearth. */
	sfxEmitter: Entity
}


let rig      : BillboardRig | null = null
let installed = false


// MARK: setupHearthBillboard
/**
 * Spawn the fuel-bar billboard above the main hearth and register the
 * per-frame updater. Idempotent.
 */
export function setupHearthBillboard(): void {
	if (installed) {
		console.log('hearthBillboard: setupHearthBillboard: already installed, skipping')
		return
	}
	installed = true

	// Root: sits above the fire, billboards on Y so it stays upright.
	const root = engine.addEntity()
	Transform.create(root, {
		position: Vector3.create(
			CAMPFIRE_WORLD_X,
			CAMPFIRE_WORLD_Y + BAR_Y_OFFSET,
			CAMPFIRE_WORLD_Z,
		),
	})
	Billboard.create(root, { billboardMode: BillboardMode.BM_Y })

	// White border - the outermost plane, slightly larger than the
	// backdrop on each axis by BORDER_W. Read as a stroke.
	const border = engine.addEntity()
	Transform.create(border, {
		parent  : root,
		position: Vector3.create(0, 0, 0),
		scale   : Vector3.create(BAR_WIDTH + BORDER_W * 2, BAR_HEIGHT + BORDER_W * 2, 1),
	})
	MeshRenderer.setPlane(border)
	Material.setPbrMaterial(border, {
		albedoColor      : COL_BORDER,
		transparencyMode : MaterialTransparencyMode.MTM_OPAQUE,
		castShadows      : false,
	})

	// Dark backdrop sits just in front of the white border so the
	// border shows as a stroke around it.
	const backdrop = engine.addEntity()
	Transform.create(backdrop, {
		parent  : root,
		position: Vector3.create(0, 0, -0.005),
		scale   : Vector3.create(BAR_WIDTH, BAR_HEIGHT, 1),
	})
	MeshRenderer.setPlane(backdrop)
	Material.setPbrMaterial(backdrop, {
		albedoColor      : COL_BACKDROP,
		transparencyMode : MaterialTransparencyMode.MTM_ALPHA_BLEND,
		castShadows      : false,
	})

	// Fill pivot: invisible anchor at the bottom of the bar so the
	// child fill plane can grow upward by scaling y + positioning at
	// (0, scale/2, 0).
	const fillPivot = engine.addEntity()
	Transform.create(fillPivot, {
		parent  : root,
		position: Vector3.create(0, -BAR_HEIGHT / 2, -0.010),
	})

	const fill = engine.addEntity()
	Transform.create(fill, {
		parent  : fillPivot,
		position: Vector3.create(0, 0, 0),
		scale   : Vector3.create(BAR_WIDTH, 0, 1),
	})
	MeshRenderer.setPlane(fill)
	Material.setPbrMaterial(fill, {
		albedoColor      : COL_FILL,
		transparencyMode : MaterialTransparencyMode.MTM_OPAQUE,
		castShadows      : false,
	})

	// Tier tick notches at each interior TIER_FUEL boundary (skip 0
	// and MAX - those are the bar's own edges). Layered above the fill
	// so they remain visible against the gold.
	for (let i = 1; i < TIER_FUEL.length - 1; i++) {
		const frac = TIER_FUEL[i] / FUEL_MAX
		const tick = engine.addEntity()
		Transform.create(tick, {
			parent  : root,
			position: Vector3.create(0, -BAR_HEIGHT / 2 + BAR_HEIGHT * frac, -0.020),
			scale   : Vector3.create(TICK_WIDTH, TICK_HEIGHT, 1),
		})
		MeshRenderer.setPlane(tick)
		Material.setPbrMaterial(tick, {
			albedoColor      : COL_TICK,
			transparencyMode : MaterialTransparencyMode.MTM_ALPHA_BLEND,
			castShadows      : false,
		})
	}

	// Multiplier chip above the bar. Hidden by default; shown only
	// when player count > 1 (see updateBillboard).
	const multiplier = engine.addEntity()
	Transform.create(multiplier, {
		parent  : root,
		position: Vector3.create(0, MULT_Y_OFFSET, -0.020),
	})
	TextShape.create(multiplier, {
		text         : '',
		fontSize     : MULT_FONT_SIZE,
		textAlign    : TextAlignMode.TAM_MIDDLE_CENTER,
		textColor    : COL_MULT_TEXT,
		outlineColor : COL_MULT_STROKE,
		outlineWidth : 0.2,
	})
	VisibilityComponent.create(multiplier, { visible: false })

	// Dedicated audio emitter parented to the root so max-burst sounds
	// come from the hearth position rather than the billboard height.
	// Sits at Y=0 (the fire base) so the whoosh reads as coming from
	// the flame, not the sky.
	const sfxEmitter = engine.addEntity()
	Transform.create(sfxEmitter, {
		parent  : root,
		position: Vector3.create(0, -BAR_Y_OFFSET, 0),
	})

	rig = {
		root, fill, multiplier, sfxEmitter,
		lastPlayers: 1,
		flashTimer : 0,
	}

	// Celebration hook: server broadcasts hearthMax when the fire is
	// first fed to FUEL_MAX. We flash the fill white and play a whoosh.
	room.onMessage('hearthMax', () => {
		if (rig === null) return
		rig.flashTimer = MAX_FLASH_DURATION_S
		AudioSource.createOrReplace(rig.sfxEmitter, {
			audioClipUrl: MAX_BURST_SFX,
			playing     : true,
			loop        : false,
			volume      : 1.0,
			global      : false, // spatial from the hearth
		})
		console.log('hearthBillboard: MAX BURST celebration!')
	})

	engine.addSystem(updateBillboard)
	console.log('hearthBillboard: setupHearthBillboard: spawned above main hearth')
}


// MARK: updateBillboard
/**
 * Per-frame paint pass. Reads live fuel + player count and mutates
 * the fill scale + multiplier text. Cheap: 1 Transform mutation per
 * frame + a TextShape mutation only when the player count changes.
 * Material is no longer touched at runtime (constant colour now).
 */
function updateBillboard(dt: number): void {
	if (rig === null) return

	const fuel    = getMainFireFuel()
	const players = getHearthPlayerCount()

	// Fill height (every frame). Bottom-anchored via the fillPivot; the
	// child's local position moves up by half its scale as it grows.
	const frac = Math.max(0, Math.min(1, fuel / FUEL_MAX))
	const h    = BAR_HEIGHT * frac
	const ft   = Transform.getMutable(rig.fill)
	ft.scale.y    = h
	ft.position.y = h / 2

	// Max-burst flash decay. Blend from COL_FLASH back to COL_FILL over
	// MAX_FLASH_DURATION_S. Material rewrite is only issued while the
	// timer is active + one final time to snap back to COL_FILL.
	if (rig.flashTimer > 0) {
		rig.flashTimer = Math.max(0, rig.flashTimer - dt)
		const t = rig.flashTimer / MAX_FLASH_DURATION_S // 1 = full flash, 0 = idle
		const r = COL_FILL.r + (COL_FLASH.r - COL_FILL.r) * t
		const g = COL_FILL.g + (COL_FLASH.g - COL_FILL.g) * t
		const b = COL_FILL.b + (COL_FLASH.b - COL_FILL.b) * t
		Material.setPbrMaterial(rig.fill, {
			albedoColor      : Color4.create(r, g, b, 1),
			transparencyMode : MaterialTransparencyMode.MTM_OPAQUE,
			castShadows      : false,
		})
	}

	// Multiplier text (only on change).
	if (players !== rig.lastPlayers) {
		const show = players > 1
		VisibilityComponent.getMutable(rig.multiplier).visible = show
		if (show) {
			const rate = 1 + Math.log2(Math.max(1, players))
			TextShape.getMutable(rig.multiplier).text = `x${rate.toFixed(1)}`
		}
		rig.lastPlayers = players
	}
}
