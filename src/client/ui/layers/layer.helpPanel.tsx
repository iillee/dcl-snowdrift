/**
 * layer.helpPanel.tsx — how-to-play panel that slides down from the
 * top of the screen when the HelpButton (?) is clicked.
 *
 * Anchored to the TopCenter zone so the slide animation only travels
 * a short distance (the kit's off-screen offset for TopCenter is just
 * past the top edge), and offset with margin.top so the panel lands
 * immediately BELOW the HUD button row (BAR_TOP + BTN_SIZE + gap)
 * instead of overlapping the buttons themselves.
 *
 * Content is placeholder text for now — the panel's plumbing (open
 * from HelpButton, close by clicking again, kit-driven slide) is the
 * point of this pass.
 */

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { getHiddenCampfireWarmthPositions } from 'src/client/hiddenCampfire'
import { HIDDEN_CAMPFIRE_COUNT } from 'src/shared/hiddenCampfire'
import { UI_THEME } from 'src/client/ui/theme/settings'


const { colors, borderRadius, spacing, fontSizes } = UI_THEME

const WHITE = Color4.White()

// Layout: land the panel just below the top HUD button row.
// Mirrors BAR_TOP_DT (32) / BAR_TOP_MB (4) + BTN_SIZE (72) from
// layer.frostBar.tsx, plus a small breathing gap. Kept as local
// constants so touching the HUD spacing doesn't accidentally couple
// the two files.
const BAR_TOP_DT       = 32
const BAR_TOP_MB       = 4
const BTN_SIZE         = 72
// Match the horizontal gap between HUD buttons (BTN_MARGIN_X = 8 on
// each side of every button in layer.brushSize.tsx, so adjacent
// buttons sit 16 px apart) so the vertical breathing room below the
// bar reads as the same rhythm as the row itself.
const GAP_BELOW_BAR_PX = 16

const PANEL_W = 440
const PANEL_H = 92

// One central bonfire is always lit from cycle start; the three hidden
// ones toggle as players ignite them. Total = 1 + HIDDEN_CAMPFIRE_COUNT.
const TOTAL_CAMPFIRES = 1 + HIDDEN_CAMPFIRE_COUNT


// MARK: HelpPanelLayer
class HelpPanelLayer extends Layer {
	constructor() {
		super({
			id         : 'helpPanel',
			zone       : ZoneType.TopCenter,
			canBeHidden: true,
			startHidden: true,
			// Slide down from just above the visible area. TopCenter's
			// off-screen offset is the panel's own bounding box past the
			// top edge, so the animation travels a short, snappy distance
			// rather than the full viewport height.
			showFrom   : 'top',
		})
	}

	body() {
		const mobile = isMobile()
		const barTop = mobile ? BAR_TOP_MB : BAR_TOP_DT
		const top    = barTop + BTN_SIZE + GAP_BELOW_BAR_PX
		return (
			<UiEntity
				key         = "ui_HelpPanel_root"
				uiTransform = {{
					width         : PANEL_W,
					height        : PANEL_H,
					margin        : { top },
					padding       : spacing.lg,
					borderRadius  : borderRadius.md,
					borderWidth   : 4,
					borderColor   : Color4.create(1, 1, 1, 0.75),
					flexDirection : 'column',
					alignItems    : 'stretch',
					justifyContent: 'flex-start',
				}}
				uiBackground = {{ color: colors.statsBg }}
			>
				<Label
					value    = "Find and light the hidden campfires"
					fontSize = {fontSizes.lg}
					color    = {WHITE}
					font     = "sans-serif"
					textAlign= "middle-center"
					uiTransform = {{ width: '100%', height: 28, margin: { bottom: 4 } }}
				/>
				{/* Progress line — central bonfire counts as 1 (always lit at
				   cycle start), hidden ones tick up as they're ignited. Reads
				   from getHiddenCampfireWarmthPositions().length so it stays in
				   lockstep with the frost-warmth signal instead of maintaining
				   its own count. */}
				<Label
					value    = {`Campfires lit: ${1 + getHiddenCampfireWarmthPositions().length}/${TOTAL_CAMPFIRES}`}
					fontSize = {fontSizes.lg}
					color    = {WHITE}
					font     = "sans-serif"
					textAlign= "middle-center"
					uiTransform = {{ width: '100%', height: 28 }}
				/>
			</UiEntity>
		)
	}
}


export const helpPanelLayer = new HelpPanelLayer()


// MARK: isHelpPanelVisible
export function isHelpPanelVisible(): boolean {
	return !helpPanelLayer.visibility.isHidden
}


// MARK: toggleHelpPanel
/** Flip visibility of the help panel (bound to the HelpButton). */
export function toggleHelpPanel(): void {
	helpPanelLayer.toggle()
}
