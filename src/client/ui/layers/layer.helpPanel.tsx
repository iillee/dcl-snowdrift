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
 * Copy is the day, the time of day and its countdown on one line,
 * and one line: don't let the fire die.
 */

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { InputAction, PointerEventType, engine, inputSystem } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { formatPhaseCountdown } from 'src/shared/phase'

import { playUiClick } from 'src/client/audio'
import { getDayNumber, getPhaseName, getPhaseRemainingSec, isPhaseHydrated } from 'src/client/phase'
import { UI_THEME } from 'src/client/ui/theme/settings'


const { colors, borderRadius, spacing, fontSizes } = UI_THEME

const WHITE = Color4.White()
const GOLD  = Color4.create(1, 0.8, 0.3, 1)

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

const DAY_FONT     = fontSizes.subhead
const PHASE_FONT   = 24
const TAG_FONT     = 20
const DAY_LINE_H   = DAY_FONT + 4
const PHASE_LINE_H = PHASE_FONT + 2
const TAG_LINE_H   = TAG_FONT + 4
const LINE_GAP     = 2
const PANEL_PAD    = spacing.md
const PANEL_BORDER = 4

// Wide enough for "Don't let the fire die" at TAG_FONT, plus the pad.
const PANEL_W = 280
const PANEL_H =
	PANEL_PAD * 2 +
	PANEL_BORDER * 2 +
	DAY_LINE_H + LINE_GAP +
	PHASE_LINE_H + LINE_GAP * 2 +
	TAG_LINE_H


// MARK: phaseTitle
/** Dawn, Day, Dusk, Night. The clock stores those names in capitals. */
function phaseTitle(name: string): string {
	const word = name.toLowerCase().replace(/_/g, ' ')
	if (!word) return '—'
	return word.charAt(0).toUpperCase() + word.slice(1)
}


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
				<Label
					value     = {isPhaseHydrated()
						? `Day ${getDayNumber()}`
						: 'Day —'}
					fontSize  = {DAY_FONT}
					color     = {GOLD}
					font      = "sans-serif"
					textAlign = "middle-center"
					uiTransform = {{
						width : '100%',
						height: DAY_LINE_H,
						margin: { bottom: LINE_GAP },
					}}
				/>
				<Label
					value     = {isPhaseHydrated()
						? `${phaseTitle(getPhaseName())}: ${formatPhaseCountdown(getPhaseRemainingSec())}`
						: '—'}
					fontSize  = {PHASE_FONT}
					color     = {WHITE}
					font      = "sans-serif"
					textAlign = "middle-center"
					uiTransform = {{
						width : '100%',
						height: PHASE_LINE_H,
						margin: { bottom: LINE_GAP * 2 },
					}}
				/>
				<Label
					value    = "Don't let the fire die"
					fontSize = {TAG_FONT}
					color    = {WHITE}
					font     = "sans-serif"
					textAlign= "middle-center"
					uiTransform = {{ width: '100%', height: TAG_LINE_H }}
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
