/**
 * hearthBillboard.ts - reusable 3D fuel bar factory for any hearth.
 *
 * The MAIN hearth spawns one billboard at boot (setupHearthBillboard)
 * that also owns the hearthMax celebration hook. HIDDEN fires spawn
 * their own via spawnHearthBillboard() when they light + destroy them
 * (destroyHearthBillboard) when they snuff.
 *
 * Entity tree (per instance):
 *
 *   root (Billboard Y, parked ~4.5 m above fire)
 *     +-- whiteBorder      (thin white plane, forms the outer frame)
 *     +-- darkBackdrop     (dark plane, forms the inset "empty" bar)
 *     +-- fillPivot        (invisible, sits at the bar bottom)
 *     |     +-- fill       (warm-gold plane, scale.y = fuel fraction)
 *     +-- tickN            (thin white notches at each tier boundary)
 *     +-- multiplier       (TextShape "xN.N", hidden when 1 player)
 *     +-- sfxEmitter       (audio origin at fire base for max burst)
 *
 * A per-frame system reads the rig's fuelGetter + playerCountGetter
 * and mutates the fill scale + multiplier text. Colour is constant
 * (frost-bar match) - tier is communicated by fill height + ticks.
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
const BAR_Y_OFFSET = 4.5
const BAR_WIDTH    = 1.0
const BAR_HEIGHT   = 2.0
const BORDER_W     = 0.06
const TICK_HEIGHT  = 0.03
const TICK_WIDTH   = BAR_WIDTH + BORDER_W * 2

const MULT_FONT_SIZE = 3
const MULT_Y_OFFSET  = BAR_HEIGHT / 2 + BORDER_W + 0.35

const MAX_FLASH_DURATION_S = 0.8
const MAX_BURST_SFX        = 'assets/sounds/pop.mp3'


// MARK: Colours
const COL_BORDER     = Color4.create(1, 1, 1, 1)
const COL_BACKDROP   = Color4.create(0, 0, 0, 0.75)
const COL_FILL       = Color4.create(1.00, 0.80, 0.30, 1.00)
const COL_FLASH      = Color4.create(1.00, 1.00, 0.95, 1.00)
const COL_TICK       = Color4.create(1, 1, 1, 0.55)
const COL_MULT_TEXT  = Color4.create(1, 1, 1, 1)
const COL_MULT_STROKE = Color4.create(0, 0, 0, 1)


// MARK: BillboardRig
/**
 * A single billboard instance. Held in the module-level `rigs` set so
 * the shared per-frame system iterates every live rig. `fuelGetter`
 * and `playerCountGetter` are closures that let hidden-fire billboards
 * bind to per-index state without extra plumbing.
 */
interface BillboardRig {
	root            : Entity
	fill            : Entity
	multiplier      : Entity
	sfxEmitter      : Entity
	fuelGetter      : () => number
	playerCountGetter: () => number
	lastPlayers     : number
	flashTimer      : number
}


const rigs: Set<BillboardRig> = new Set()
let systemInstalled           = false
let mainRig: BillboardRig | null = null


// MARK: spawnHearthBillboard
/**
 * Create a billboard instance floating BAR_Y_OFFSET metres above
 * (worldX, worldY, worldZ). Returns a handle that must be passed to
 * destroyHearthBillboard() when the fire snuffs, otherwise the
 * entities leak until scene teardown.
 *
 * The per-frame update system is installed on first call.
 */
export function spawnHearthBillboard(
	worldX          : number,
	worldY          : number,
	worldZ          : number,
	fuelGetter      : () => number,
	playerCountGetter: () => number,
): BillboardRig {
	const root = engine.addEntity()
	Transform.create(root, {
		position: Vector3.create(worldX, worldY + BAR_Y_OFFSET, worldZ),
	})
	Billboard.create(root, { billboardMode: BillboardMode.BM_Y })

	// White border (outermost plane).
	const border = engine.addEntity()
	Transform.create(border, {
		parent  : root,
		position: Vector3.Zero(),
		scale   : Vector3.create(BAR_WIDTH + BORDER_W * 2, BAR_HEIGHT + BORDER_W * 2, 1),
	})
	MeshRenderer.setPlane(border)
	Material.setPbrMaterial(border, {
		albedoColor      : COL_BORDER,
		transparencyMode : MaterialTransparencyMode.MTM_OPAQUE,
		castShadows      : false,
	})

	// Dark backdrop just in front of the border.
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

	// Fill pivot + fill (bottom-anchored, grows upward).
	const fillPivot = engine.addEntity()
	Transform.create(fillPivot, {
		parent  : root,
		position: Vector3.create(0, -BAR_HEIGHT / 2, -0.010),
	})

	const fill = engine.addEntity()
	Transform.create(fill, {
		parent  : fillPivot,
		position: Vector3.Zero(),
		scale   : Vector3.create(BAR_WIDTH, 0, 1),
	})
	MeshRenderer.setPlane(fill)
	Material.setPbrMaterial(fill, {
		albedoColor      : COL_FILL,
		transparencyMode : MaterialTransparencyMode.MTM_OPAQUE,
		castShadows      : false,
	})

	// Interior tier ticks.
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

	// Multiplier chip.
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

	// SFX emitter parked at fire base so celebration audio comes from
	// the flame, not the billboard height.
	const sfxEmitter = engine.addEntity()
	Transform.create(sfxEmitter, {
		parent  : root,
		position: Vector3.create(0, -BAR_Y_OFFSET, 0),
	})

	const rig: BillboardRig = {
		root, fill, multiplier, sfxEmitter,
		fuelGetter, playerCountGetter,
		lastPlayers: -1,   // force first-frame text refresh
		flashTimer : 0,
	}
	rigs.add(rig)

	if (!systemInstalled) {
		systemInstalled = true
		engine.addSystem(updateAllBillboards)
	}

	return rig
}


// MARK: destroyHearthBillboard
/**
 * Tear down a billboard rig. Safe to call multiple times - drops the
 * rig from the render set on the first call, no-ops after.
 */
export function destroyHearthBillboard(rig: BillboardRig | null): void {
	if (rig === null) return
	if (!rigs.has(rig)) return
	rigs.delete(rig)
	// Children are auto-removed when the root goes.
	engine.removeEntity(rig.root)
}


// MARK: setupHearthBillboard
/**
 * Spawn the MAIN hearth's billboard and wire the hearthMax celebration.
 * Idempotent - safe to call once during client bootstrap.
 */
export function setupHearthBillboard(): void {
	if (mainRig !== null) {
		console.log('hearthBillboard: setupHearthBillboard: already installed, skipping')
		return
	}
	mainRig = spawnHearthBillboard(
		CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Y, CAMPFIRE_WORLD_Z,
		getMainFireFuel, getHearthPlayerCount,
	)

	// Celebration hook - flash the main-hearth fill white + whoosh SFX.
	room.onMessage('hearthMax', () => {
		if (mainRig === null) return
		mainRig.flashTimer = MAX_FLASH_DURATION_S
		AudioSource.createOrReplace(mainRig.sfxEmitter, {
			audioClipUrl: MAX_BURST_SFX,
			playing     : true,
			loop        : false,
			volume      : 1.0,
			global      : false,
		})
		console.log('hearthBillboard: MAX BURST celebration!')
	})

	console.log('hearthBillboard: setupHearthBillboard: spawned above main hearth')
}


// MARK: updateAllBillboards
/**
 * Per-frame paint pass. Iterates every live rig and updates its
 * fill/multiplier/flash from that rig's own getters. Cheap - a
 * Transform mutation per rig, plus TextShape/Material only on change.
 */
function updateAllBillboards(dt: number): void {
	for (const rig of rigs) {
		const fuel    = rig.fuelGetter()
		const players = rig.playerCountGetter()

		// Fill height.
		const frac = Math.max(0, Math.min(1, fuel / FUEL_MAX))
		const h    = BAR_HEIGHT * frac
		const ft   = Transform.getMutable(rig.fill)
		ft.scale.y    = h
		ft.position.y = h / 2

		// Max-burst flash decay (main hearth only - hidden fires never
		// receive hearthMax, so their flashTimer stays 0).
		if (rig.flashTimer > 0) {
			rig.flashTimer = Math.max(0, rig.flashTimer - dt)
			const t = rig.flashTimer / MAX_FLASH_DURATION_S
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
}


// MARK: BillboardHandle
/** Public opaque handle - callers only need to pass it back to
 *  destroyHearthBillboard when the fire snuffs. */
export type BillboardHandle = BillboardRig
