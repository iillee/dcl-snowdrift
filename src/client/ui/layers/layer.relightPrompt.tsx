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
// Mobile tooltip: solid warm gold background with black text — reads
// as a bright, opaque call-to-action anchored to the hotbar slot.
const BG_MB     = Color4.create(1.00, 0.80, 0.30, 1)
const FG_MB     = Color4.create(0, 0, 0, 1)
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
			id  : 'relightPrompt',
			zone: ZoneType.BottomCenter,
			// No slide animation — the bridge (layer.hotbarBridge) needs to
			// pop in/out in the same frame as the tooltip so the two read as
			// one crisp shape. Animation is gated by shouldShowPrompt() in
			// body() instead of the kit's show/hide tween.
		})
	}

	body() {
		// Hard visibility gate so bridge + tooltip snap on/off together.
		if (!shouldShowPrompt()) return <UiEntity key="ui_RelightPrompt_hidden" uiTransform={{ display: 'none' }} />

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
				uiBackground = {{ color: mobile ? BG_MB : BG }}
				// Tapping / clicking the prompt itself also relights. On mobile
				// the bubble IS the primary tap target (it's the big visible
				// thing next to the button), so it must stay live.
				onMouseDown = {relightTorch}
			>
				{/* Mobile-only visual bridge — a solid-gold rectangle that
				   extends from the tooltip's RIGHT edge toward the Torch
				   button, covering the seam so the two elements read as one
				   continuous shape. pointerFilter: 'none' keeps taps falling
				   through to whatever is beneath (the button owns its area,
				   the tooltip owns its own). Height matches the tooltip so
				   the top/bottom edges align; slight overlap into both sides
				   hides the borderRadius corner on that seam. */}
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
				{/* <Label> (not raw uiText) so <b> markup renders bold on
				   mobile. uiText on a bare UiEntity doesn't parse rich-text
				   tags — they'd show as literal characters. */}
				<Label
					key         = "ui_RelightPrompt_label"
					// Plain string (no <b>) on mobile: rich-text measurement
					// mismatch was making the parent's hitbox narrower than the
					// painted gold rectangle, so taps on the outer edge did
					// nothing. Larger fontSize (2x) already reads as prominent.
					value       = {mobile ? 'LIGHT TORCH' : 'Light torch'}
					fontSize    = {fontSizes.md * S}
					color       = {mobile ? FG_MB : FG}
					font        = "sans-serif"
					textAlign   = "middle-left"
					uiTransform = {{ width: 'auto', height: 26 * S }}
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
// MARK: isRelightPromptVisible
/** True while the relight tooltip is (or is animating into) view. Read by
 *  the hotbar-bridge layer to know when to draw its gold connector. */
export function isRelightPromptVisible(): boolean { return _relightPromptVisible }
export function setupRelightPromptVisibility(): void {
	if (_relightPromptInstalled) return
	_relightPromptInstalled = true
	engine.addSystem((_dt: number) => {
		const want = shouldShowPrompt()
		if (want === _relightPromptVisible) return
		_relightPromptVisible = want
		// No show/hide call — body() gates on shouldShowPrompt() directly
		// so the tooltip snaps in the same frame the bridge does.
	})
}
