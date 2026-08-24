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

import { isFeedPromptVisible }    from 'src/client/ui/layers/layer.feedPrompt'
import { isRelightPromptVisible } from 'src/client/ui/layers/layer.relightPrompt'


// Same warm gold as the tooltip body + button active border, so the
// bridge blends into both when they touch.
const BG_GOLD = Color4.create(1.00, 0.80, 0.30, 1)

// Geometry - matches MOBILE_TOOLTIP_H / MOBILE_HOTBAR_HALF_PX from the
// prompt layers. Kept as local constants; if the button size ever
// changes, sync all three files.
const HEIGHT_PX          = 112
// Distance from screen center to the INNER edge of the bridge (i.e.
// how far into the button footprint the bridge reaches). Smaller =
// deeper into the button. 90 puts the bridge's inner edge 38 px
// inside the button (button outer edge is at 128 from center).
const INNER_OFFSET_PX    = 90
// Width of the gold strip. Extends from INNER_OFFSET outward past the
// button/tooltip seam (at 128) and into the tooltip footprint.
const WIDTH_PX           = 80


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
		// Desktop has no hotbar tooltips in this style - render nothing.
		if (!isMobile()) return <UiEntity key="ui_HotbarBridge_hidden" uiTransform={{ display: 'none' }} />

		const showRelight = isRelightPromptVisible()
		const showFeed    = isFeedPromptVisible()

		return (
			<UiEntity
				key         = "ui_HotbarBridge_root"
				uiTransform = {{
					// The zone is a centered flex row; we anchor absolute
					// children off it so the bridges track screen center
					// regardless of what else is in the row.
					positionType : 'absolute',
					position     : { bottom: 0, left: 0, right: 0 },
					height       : HEIGHT_PX,
					pointerFilter: 'none',
				}}
			>
				{/* LEFT bridge - joins the Torch button to the relight
				    tooltip. Right edge anchored at center - INNER_OFFSET,
				    extends leftward for WIDTH. */}
				<UiEntity
					key         = "ui_HotbarBridge_left"
					uiTransform = {{
						positionType : 'absolute',
						position     : { bottom: 0, right: '50%' },
						margin       : { right: INNER_OFFSET_PX },
						width        : WIDTH_PX,
						height       : HEIGHT_PX,
						pointerFilter: 'none',
						display      : showRelight ? 'flex' : 'none',
					}}
					uiBackground = {{ color: BG_GOLD }}
				/>
				{/* RIGHT bridge - joins the Logs button to the feed
				    tooltip. Left edge anchored at center + INNER_OFFSET,
				    extends rightward for WIDTH. */}
				<UiEntity
					key         = "ui_HotbarBridge_right"
					uiTransform = {{
						positionType : 'absolute',
						position     : { bottom: 0, left: '50%' },
						margin       : { left: INNER_OFFSET_PX },
						width        : WIDTH_PX,
						height       : HEIGHT_PX,
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
