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
import { InputAction, PointerEventType, engine, inputSystem } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { VERSION } from 'src/shared/data/version'
import { HIDDEN_CAMPFIRE_COUNT } from 'src/shared/hiddenCampfire'

import { playUiClick } from 'src/client/audio'
import { getMainFireFuel } from 'src/client/hearthFuel'
import { getHiddenCampfireWarmthPositions } from 'src/client/hiddenCampfire'
import { getDayNumber, getPhaseLabel, isPhaseHydrated } from 'src/client/phase'
import { UI_THEME } from 'src/client/ui/theme/settings'


const { colors, borderRadius, spacing, fontSizes } = UI_THEME

const WHITE = Color4.White()

// Version chip styling — mirrors layer.version.tsx (retired) so the
// same visual language lands inside the help panel footer.
const VERSION_BG = colors.versionBg
const VERSION_FG = colors.versionFg

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

const DAY_LINE_H    = 40
const DAY_GAP       = 8
const BODY_LINE_H   = 26
const BODY_GAP      = 4
const BODY_COUNT    = 4
const VERSION_H     = 24
const VERSION_GAP   = 8
const PANEL_PAD     = spacing.lg
const PANEL_BORDER  = 4

// Hug the copy: short lines no longer need the old 440 x rebuild-timer box.
const PANEL_W = 340
const PANEL_H =
	PANEL_PAD * 2 +
	PANEL_BORDER * 2 +
	DAY_LINE_H + DAY_GAP +
	BODY_COUNT * BODY_LINE_H + (BODY_COUNT - 1) * BODY_GAP +
	VERSION_GAP + VERSION_H


// Spawn hearth + hidden pits. Spawn can go out; the count is live.
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
					padding       : PANEL_PAD,
					borderRadius  : borderRadius.md,
					borderWidth   : PANEL_BORDER,
					borderColor   : Color4.create(1, 1, 1, 0.75),
					flexDirection : 'column',
					alignItems    : 'stretch',
					justifyContent: 'flex-start',
				}}
				uiBackground = {{ color: colors.statsBg }}
			>
				{/* Day header — calendar day of this run. Larger than the
				   body copy so it reads first when the panel drops. */}
				<Label
					value    = {isPhaseHydrated()
						? `<b><color=#ffcc4d>Day ${getDayNumber()}</color></b>`
						: '<b>Day —</b>'}
					fontSize = {fontSizes.subhead}
					color    = {WHITE}
					font     = "sans-serif"
					textAlign= "middle-center"
					uiTransform = {{ width: '100%', height: DAY_LINE_H, margin: { bottom: DAY_GAP } }}
				/>
				{/* Line 1 — top-level directive. Deliberately terse so it
				   frames the two mechanic lines below as HOW to do it. */}
				<Label
					value    = {'Explore the world'}
					fontSize = {20}
					color    = {WHITE}
					font     = "sans-serif"
					textAlign= "middle-center"
					uiTransform = {{ width: '100%', height: BODY_LINE_H, margin: { bottom: BODY_GAP } }}
				/>
				{/* Line 2 — core loop. "wood" is bold + yellow to mirror the
				   warm-gold fuel bar so the language + colour align. */}
				<Label
					value    = {'Fuel the fire with <b><color=#ffcc4d>wood</color></b>'}
					fontSize = {20}
					color    = {WHITE}
					font     = "sans-serif"
					textAlign= "middle-center"
					uiTransform = {{ width: '100%', height: BODY_LINE_H, margin: { bottom: BODY_GAP } }}
				/>
				{/* Line 3 — objective + progress. Central bonfire counts as 1
				   (always lit at cycle start); hidden ones tick up as they're
				   ignited. Reads from getHiddenCampfireWarmthPositions().length
				   so it stays in lockstep with the frost-warmth signal. */}
				<Label
					value    = {`Fires lit: <b><color=#ffcc4d>${(getMainFireFuel() > 0 ? 1 : 0) + getHiddenCampfireWarmthPositions().length}/${TOTAL_CAMPFIRES}</color></b>`}
					fontSize = {20}
					color    = {WHITE}
					font     = "sans-serif"
					textAlign= "middle-center"
					uiTransform = {{ width: '100%', height: BODY_LINE_H, margin: { bottom: BODY_GAP } }}
				/>
				{/* Line 4 — live phase + countdown from the server clock. */}
				<Label
					value    = {isPhaseHydrated()
						? `Now: <b><color=#ffcc4d>${getPhaseLabel()}</color></b>`
						: 'Now: waiting for day clock'}
					fontSize = {20}
					color    = {WHITE}
					font     = "sans-serif"
					textAlign= "middle-center"
					uiTransform = {{ width: '100%', height: BODY_LINE_H }}
				/>
				{/* Version chip — dedicated row at the bottom of the panel.
				   Wrapper row is flex-centred so the auto-width chip sits in
				   the middle of the panel, matching the other centered lines
				   above. Small top margin separates it from the last info
				   line. Same size + colours as the retired standalone chip. */}
				<UiEntity
					key         = "ui_HelpPanel_versionRow"
					uiTransform = {{
						width         : '100%',
						height        : VERSION_H,
						margin        : { top: VERSION_GAP },
						flexDirection : 'row',
						justifyContent: 'center',
						alignItems    : 'center',
					}}
				>
					<UiEntity
						key         = "ui_HelpPanel_version"
						uiTransform = {{
							width       : 'auto',
							height      : VERSION_H,
							borderRadius: borderRadius.sm,
							padding     : { right: 4, left: 4 },
						}}
						uiText = {{
							value    : VERSION,
							fontSize : fontSizes.md,
							color    : VERSION_FG,
							textAlign: 'middle-center',
						}}
						uiBackground = {{ color: VERSION_BG }}
					/>
				</UiEntity>
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


// MARK: initHelpPanelHotkey
/**
 * Desktop hotkey: `3` (IA_ACTION_5) toggles the help panel, matching
 * the `1` = spectator and `2` = mute pattern already used by the top
 * HUD row. Skip on mobile — there is no on-screen slot bound to
 * ACTION_5 there, and the panel is opened via the touch HelpButton.
 */
export function initHelpPanelHotkey(): void {
	if (isMobile()) return
	engine.addSystem(() => {
		if (inputSystem.isTriggered(InputAction.IA_ACTION_5, PointerEventType.PET_DOWN)) {
			playUiClick()
			toggleHelpPanel()
		}
	})
}
