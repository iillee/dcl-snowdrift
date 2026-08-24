/**
 * layer.hotbarBridge.tsx - mobile-only visual "connector" that fills
 * the seam between the hotbar buttons (Torch / Logs) and their pop-out
 * tooltips (Relight / Feed).
 *
 * Registered in ui/index.tsx BEFORE inventoryHotbarLayer, so the gold
 * strip renders BEHIND both the button and the tooltip. Where the two
 * elements touch, the button's dark background and the tooltip's gold
 * background hide the strip on their own footprints; only the tiny
 * gap between them shows the strip, which reads as one continuous
 * gold shape linking button to tooltip.
 *
 * Pointer-inert (pointerFilter: 'none') so it never interferes with
 * taps on the button or the tooltip. Visibility mirrors each tooltip
 * via isRelightPromptVisible() / isFeedPromptVisible().
 */

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 }             from '@dcl/sdk/math'
import { isMobile }           from '@dcl/sdk/platform'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { isFeedPromptVisible }            from 'src/client/ui/layers/layer.feedPrompt'
import { isHiddenCampfirePromptVisible }  from 'src/client/ui/layers/layer.hiddenCampfirePrompt'
import { isRelightPromptVisible }         from 'src/client/ui/layers/layer.relightPrompt'


// Same warm gold as the tooltip body + button active border, so the
// bridge blends into both when they touch.
const BG_GOLD = Color4.create(1.00, 0.80, 0.30, 1)

// Geometry — matches TOOLTIP_H / HOTBAR_HALF from the prompt layers.
// Kept as local constants; if the button size ever changes, sync all
// three files (relightPrompt, feedPrompt, hotbarBridge).
// Kept in sync with prompt layers: mobile matches slot height exactly
// (112). Desktop uses 71 (see rationale in layer.relightPrompt).
const HEIGHT_MB          = 112
const HEIGHT_DT          = 71
// Distance from screen centre to the INNER edge of the bridge (how
// far into the button footprint the bridge reaches). Smaller = deeper.
// Mobile: 90 = 38 px inside the button (button outer edge at 128).
// Desktop: 56 = 24 px inside the button (button outer edge at 80).
const INNER_OFFSET_MB    = 90
const INNER_OFFSET_DT    = 56
// Width of the gold strip. Extends from INNER_OFFSET outward past the
// button/tooltip seam and into the tooltip footprint.
const WIDTH_MB           = 80
const WIDTH_DT           = 50
// Bottom offset matches the hotbar's own bottom margin per platform.
// Bottom anchor matches the hotbar row's own bottom margin.
const BOTTOM_MB          = 0
const BOTTOM_DT          = 30


// MARK: HotbarBridgeLayer
class HotbarBridgeLayer extends Layer {
	constructor() {
		super({
			id  : 'hotbarBridge',
			zone: ZoneType.BottomCenter,
		})
	}

	// MARK: body
	body() {
		const mobile      = isMobile()
		const height      = mobile ? HEIGHT_MB       : HEIGHT_DT
		const innerOffset = mobile ? INNER_OFFSET_MB : INNER_OFFSET_DT
		const width       = mobile ? WIDTH_MB        : WIDTH_DT
		const bottomPx    = mobile ? BOTTOM_MB       : BOTTOM_DT

		// LEFT bridge shows whenever ANY left-side tooltip is visible —
		// both the relight and hidden-campfire tooltips share that slot
		// (only one at a time; see the yield in layer.relightPrompt).
		const showLeft    = isRelightPromptVisible() || isHiddenCampfirePromptVisible()
		const showFeed    = isFeedPromptVisible()

		return (
			<UiEntity
				key         = "ui_HotbarBridge_root"
				uiTransform = {{
					// The zone is a centred flex row; we anchor absolute
					// children off it so the bridges track screen centre
					// regardless of what else is in the row.
					positionType : 'absolute',
					position     : { bottom: 0, left: 0, right: 0 },
					height       : height,
					pointerFilter: 'none',
				}}
			>
				{/* LEFT bridge — joins the Torch button to the relight
				    tooltip. Right edge anchored at centre - innerOffset,
				    extends leftward for width. */}
				<UiEntity
					key         = "ui_HotbarBridge_left"
					uiTransform = {{
						positionType : 'absolute',
						position     : { bottom: bottomPx, right: '50%' },
						margin       : { right: innerOffset },
						width        : width,
						height       : height,
						pointerFilter: 'none',
						display      : showLeft ? 'flex' : 'none',
					}}
					uiBackground = {{ color: BG_GOLD }}
				/>
				{/* RIGHT bridge — joins the Logs button to the feed
				    tooltip. Left edge anchored at centre + innerOffset,
				    extends rightward for width. */}
				<UiEntity
					key         = "ui_HotbarBridge_right"
					uiTransform = {{
						positionType : 'absolute',
						position     : { bottom: bottomPx, left: '50%' },
						margin       : { left: innerOffset },
						width        : width,
						height       : height,
						pointerFilter: 'none',
						display      : showFeed ? 'flex' : 'none',
					}}
					uiBackground = {{ color: BG_GOLD }}
				/>
			</UiEntity>
		)
	}
}


export const hotbarBridgeLayer = new HotbarBridgeLayer()
