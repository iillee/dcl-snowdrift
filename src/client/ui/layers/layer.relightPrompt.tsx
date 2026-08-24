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
import { isHiddenCampfirePromptVisible }                                   from 'src/client/ui/layers/layer.hiddenCampfirePrompt'
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

// Solid warm gold background with black text — reads as a bright,
// opaque call-to-action anchored to the hotbar slot. Shared by mobile
// and desktop now that both platforms use the same tooltip design.
const BG_GOLD     = Color4.create(1.00, 0.80, 0.30, 1)
const FG_BLACK    = Color4.create(0, 0, 0, 1)
// Warm gold border shared with the Torch hotbar slot's lit state
// (TORCH_BORDER_ON in layer.brushSize). Ties the tooltip to the button
// it pops out of — same colour language for "this thing is live now".
const BORDER_GOLD = Color4.create(1.00, 0.80, 0.30, 0.95)

// Per-platform sizing derived from the hotbar button geometry so the
// tooltip always sits at the same row height as the button it emerges
// from. Mobile: slotSize() = 112. Desktop: BTN_SIZE = 72. Both use
// (BTN_SIZE/2 + BTN_MARGIN_X) as the half-row offset so the tooltip's
// inner edge kisses the button's outer edge.
// Mobile height matches slotSize() = 112 exactly — the mobile layout
// was flush before the desktop-tooltip work; leaving it at 112 keeps
// it that way.
// Desktop uses 71 (not BTN_SIZE = 72) as the least-bad compromise:
// Yoga rounds absolute-positioned boxes on a different sub-pixel grid
// than the in-flow hotbar row, so no integer pair for (height, bottom)
// lines both edges up exactly. At h72/b30 the tooltip's top is 1 px
// above the button top; at h71/b30 the top is ~0.5 px shy of the
// button top and the bottom is flush. Sub-pixel-shy on the top is
// invisible in practice; a 1-px overshoot is not.
const TOOLTIP_H_MB    = 112
const TOOLTIP_H_DT    = 71
const HOTBAR_HALF_MB  = 128  // 112/2 + 8 margin + 8 breathing
const HOTBAR_HALF_DT  = 80   // 72/2 + 8 margin = 44 to inner button edge; button outer edge is at (8 + 72) = 80 from center
const BOTTOM_MB       = 0    // pinned to safe-area bottom (mobile was flush at this value)
const BOTTOM_DT       = 30   // matches MARGIN_BOTTOM_DT in inventoryHotbar
const BORDER_W_MB     = 4
const BORDER_W_DT     = 3
const PADDING_X_MB    = 20
const PADDING_X_DT    = 14


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
	// Yield the flush hotbar slot to the hidden-campfire tooltip when
	// it would show on the same frame — igniting the buried pit is the
	// higher-value action, so it takes precedence over the top-off /
	// relight prompt.
	if (isHiddenCampfirePromptVisible()) return false
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

		const mobile     = isMobile()
		// Sizing scales with the underlying hotbar button so mobile and
		// desktop share one visual language, only the pixel budget changes.
		const height     = mobile ? TOOLTIP_H_MB   : TOOLTIP_H_DT
		const halfRow    = mobile ? HOTBAR_HALF_MB : HOTBAR_HALF_DT
		const bottomPx   = mobile ? BOTTOM_MB : BOTTOM_DT
		const borderW    = mobile ? BORDER_W_MB    : BORDER_W_DT
		const padX       = mobile ? PADDING_X_MB   : PADDING_X_DT
		// Mobile uses 2x font for arm's-length reading; desktop scales the
		// font off its (smaller) button so text fills the tooltip similarly.
		const fontPx     = mobile ? fontSizes.md * 2 : fontSizes.md * 1.25
		const labelH     = Math.round(fontPx * 1.6)

		// Both platforms escape the zone's centred flex row (positionType
		// absolute) and anchor the tooltip's RIGHT edge to screen centre,
		// then push left by halfRow so the inner edge kisses the Torch
		// button's outer edge. bottomPx matches the hotbar's own bottom
		// margin so both sit on the same row.
		return (
			<UiEntity
				key         = "ui_RelightPrompt_root"
				uiTransform = {{
					positionType : 'absolute',
					position     : { bottom: bottomPx, right: '50%' },
					margin       : { right: halfRow },
					height       : height,
					flexDirection: 'row',
					alignItems   : 'center',
					padding      : { top: 0, bottom: 0, left: padX, right: padX },
					borderRadius : borderRadius.md,
					borderWidth  : borderW,
					borderColor  : BORDER_GOLD,
				}}
				uiBackground = {{ color: BG_GOLD }}
				// Clicking the tooltip also relights on both platforms — it's
				// the big visible thing next to the button, so it must be a
				// live tap target.
				onMouseDown = {relightTorch}
			>
				{/* Desktop uses <b> rich-text markup for a bolder read; the
				   hitbox/paint mismatch that markup causes (see
				   docs/bug-reports/react-ecs-richtext-hitbox-mismatch.md)
				   only meaningfully affects touch input, so mobile stays
				   on the plain string. */}
				<Label
					key         = "ui_RelightPrompt_label"
					value       = {mobile ? 'LIGHT TORCH' : '<b>LIGHT TORCH</b>'}
					fontSize    = {fontPx}
					color       = {FG_BLACK}
					font        = "sans-serif"
					textAlign   = "middle-left"
					uiTransform = {{ width: 'auto', height: labelH }}
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
