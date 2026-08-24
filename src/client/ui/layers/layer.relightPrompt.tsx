/**
 * layer.relightPrompt.tsx — proximity tooltip: "Press E to light" /
 * "Press E to top off".
 *
 * Visible when ALL of the following are true:
 *   - torch is equipped
 *   - local player is inside the campfire heat ring
 *   - torch is either NOT lit, OR is lit but not at full fuel
 *     (so the player can walk back to the fire and re-press E to
 *     top off before heading out again).
 *
 * The player still has to press E — this layer is only the affordance
 * hint. The actual light/refill happens in src/client/torchInput.ts,
 * whose E-press handler already calls relightTorch() unconditionally
 * inside the radius, and relightTorch() refills fuel to max.
 *
 * Body is re-evaluated per frame by the UI kit, so we sample the
 * player Transform + torch state inline. Cheap: 3 subs, 2 mults, one
 * compare.
 */

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { Transform, engine } from '@dcl/sdk/ecs'
import { isMobile } from '@dcl/sdk/platform'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { CAMPFIRE_RELIGHT_RADIUS_SQ_M, CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { isInHiddenRelightRange }                                          from 'src/client/hiddenCampfire'
import { getTorchFuelFraction, isTorchEquipped, isTorchLit, relightTorch } from 'src/client/torchEquip'
import { UI_THEME }                                                      from 'src/client/ui/theme/settings'
import { getUVsForAtlasTile }                                            from 'src/client/ui/utils/atlas'


// Font-awesome atlas from the UI component kit — same asset the mobile
// pointer-button glyph uses. Kept in sync so the tooltip icon reads as
// the same affordance the player is meant to tap.
const ATLAS_SRC     = 'assets/images/ui-component-kit/atlas-icons-font-awesome.png'
const ATLAS_COLS    = 16
const ATLAS_ROWS    = 16
const HAND_TILE_COL = 2
const HAND_TILE_ROW = 11


const { fontSizes, borderRadius } = UI_THEME

const BG        = Color4.create(0, 0, 0, 0.65)
const FG        = Color4.create(1, 0.95, 0.85, 1)
const KEY_BG    = Color4.create(1, 0.75, 0.35, 0.95)
const KEY_FG    = Color4.create(0.1, 0.05, 0, 1)
// Warm gold border shared with the Torch hotbar slot's lit state
// (TORCH_BORDER_ON in layer.brushSize). Ties the tooltip to the button
// it pops out of — same colour language for "this thing is live now".
const BORDER_GOLD = Color4.create(1.00, 0.80, 0.30, 0.95)
// Hotbar button on mobile is 112 px tall (slotSize()); match it so the
// tooltip sits at the same row height as the button it emerges from.
const MOBILE_TOOLTIP_H = 112


// Fuel fraction above which a lit torch is considered "full enough"
// that the top-off prompt hides. Just below 1.0 so the prompt vanishes
// the instant after a successful top-off press.
const TOP_OFF_HIDE_THRESHOLD = 0.98


// MARK: shouldShowPrompt
/**
 * Visibility gates in one place. Returns false early on any failed
 * condition to keep the per-frame cost minimal when hidden (the
 * common case).
 */
function shouldShowPrompt(): boolean {
	if (!isTorchEquipped()) return false
	// Lit AND essentially full — nothing to gain from another E-press.
	if (isTorchLit() && getTorchFuelFraction() >= TOP_OFF_HIDE_THRESHOLD) return false

	const t = Transform.getOrNull(engine.PlayerEntity)
	if (t === null) return false

	const dx = t.position.x - CAMPFIRE_WORLD_X
	const dz = t.position.z - CAMPFIRE_WORLD_Z
	if (dx * dx + dz * dz <= CAMPFIRE_RELIGHT_RADIUS_SQ_M) return true

	// Second valid source once the hidden campfire has been ignited —
	// same prompt, same affordance, just a different fire.
	return isInHiddenRelightRange()
}


// MARK: RelightPromptLayer
/**
 * Bottom-center tooltip that appears above the hotbar when the player
 * is standing in the fire's heat ring holding an unlit torch. Empty
 * body when hidden — zero UI cost while not shown.
 */
class RelightPromptLayer extends Layer {
	constructor() {
		super({
			id         : 'relightPrompt',
			zone       : ZoneType.BottomCenter,
			// Start hidden so the tooltip crawls in when the player enters
			// the fire ring instead of appearing pre-mounted. `showFrom:
			// right` slides the zone in from the right side of the screen,
			// which lands the tooltip travelling LEFTWARD into its rest
			// position on the left of the hotbar — reads as "popping out
			// leftward from behind the Torch button".
			canBeHidden: true,
			startHidden: true,
			showFrom   : 'right',
		})
	}

	body() {
		// Visibility is now driven externally by setupRelightPromptVisibility()
		// via layer.show() / layer.hide(), which lets the kit slide the panel
		// in/out instead of the previous instant show/hide. The body renders
		// unconditionally so it stays present through the whole tween.

		const mobile = isMobile()
		// Mobile uses a 2x scale on every intrinsic size (chip, icon, label
		// height, padding, font) so the tooltip reads at arm's length on a
		// phone screen. Desktop values are unchanged.
		const S = mobile ? 2 : 1
		// Mobile bubble matches the hotbar button height and gets a gold
		// border that ties it to the Torch slot's lit-state border.
		const mobileHeight = MOBILE_TOOLTIP_H
		const borderW      = mobile ? 4 : 0
		const borderCol    = mobile ? BORDER_GOLD : Color4.create(0, 0, 0, 0)

		// Placement:
		//   Desktop — floats mid-screen above the hotbar (~720 up from
		//   bottom) as a sibling in the BottomCenter flex row.
		//   Mobile  — escapes the zone's centred flex (positionType
		//   'absolute') and anchors its RIGHT edge to the zone midpoint
		//   (which coincides with screen centre and hotbar-row centre),
		//   then pushes further left by TORCH_BTN_HALF + gap so it pops
		//   out of the LEFT side of the Torch (E) hotbar button.
		//   The button itself is the tap affordance, so the key chip +
		//   hand icon are dropped; only the label bubble renders.
		const MOBILE_HOTBAR_HALF_PX = 128  // 112 (button) + 8 (margin) + 8 (breathing) ≈ half-row width

		return (
			<UiEntity
				key         = "ui_RelightPrompt_root"
				uiTransform = {mobile ? {
					positionType : 'absolute',
					// bottom: 0 matches the hotbar's MARGIN_BOTTOM_MB so the
					// tooltip's baseline sits on the same row as the buttons
					// at the very bottom of the safe area.
					position     : { bottom: 0, right: '50%' },
					margin       : { right: MOBILE_HOTBAR_HALF_PX },
					height       : mobileHeight,
					flexDirection: 'row',
					alignItems   : 'center',
					padding      : { top: 0, bottom: 0, left: 20, right: 20 },
					borderRadius : borderRadius.md,
					borderWidth  : borderW,
					borderColor  : borderCol,
				} : {
					margin      : { bottom: 720, left: 0 },
					flexDirection: 'row',
					alignItems  : 'center',
					padding     : { top: 8, bottom: 8, left: 12, right: 14 },
					borderRadius: borderRadius.sm,
				}}
				uiBackground = {{ color: BG }}
				// Tapping / clicking the prompt itself also relights. Desktop
				// players still have E; mobile players have the hotbar button,
				// but the tooltip staying tappable is a harmless fallback.
				// Safe even outside the fire ring — the prompt only renders
				// while shouldShowPrompt() is true, which enforces the ring.
				onMouseDown = {relightTorch}
			>
				{/* Desktop-only key chip. Mobile shows just the label bubble
				   because the Torch hotbar button is now the affordance. */}
				{mobile ? null : (
					<UiEntity
						key         = "ui_RelightPrompt_key"
						uiTransform = {{
							width        : 26,
							height       : 26,
							margin       : { right: 10 },
							borderRadius : borderRadius.sm,
							justifyContent: 'center',
							alignItems   : 'center',
						}}
						uiBackground = {{ color: KEY_BG }}
					>
						<Label
							value    = "E"
							fontSize = {fontSizes.md}
							color    = {Color4.White()}
							font     = "sans-serif"
							textAlign= "middle-center"
							uiTransform = {{
								width : '100%',
								height: '100%',
								margin: { top: -2, left: 2 },
							}}
						/>
					</UiEntity>
				)}
				<UiEntity
					key         = "ui_RelightPrompt_label"
					uiTransform = {{ width: 'auto', height: 26 * S }}
					uiText      = {{
						value    : 'Light torch',
						fontSize : fontSizes.md * S,
						color    : FG,
						textAlign: 'middle-left',
					}}
				/>
			</UiEntity>
		)
	}
}


export const relightPromptLayer = new RelightPromptLayer()


// MARK: setupRelightPromptVisibility
/**
 * Drive the layer's slide-in / slide-out animation from the proximity
 * check. Previously the body() returned an empty UiEntity when out of
 * range, which showed/hid instantly; using the kit visibility API lets
 * the panel crawl in from the right (settling on the LEFT side of the
 * hotbar) when the player enters the fire ring, and crawl back out
 * when they leave.
 *
 * Edge-triggered off shouldShowPrompt() so we don't spam the tween
 * every frame. Idempotent — safe to call once from client bootstrap.
 */
let _relightPromptInstalled = false
let _relightPromptVisible   = false
export function setupRelightPromptVisibility(): void {
	if (_relightPromptInstalled) return
	_relightPromptInstalled = true
	engine.addSystem((_dt: number) => {
		const want = shouldShowPrompt()
		if (want === _relightPromptVisible) return
		_relightPromptVisible = want
		if (want) relightPromptLayer.show()
		else      relightPromptLayer.hide()
	})
}
