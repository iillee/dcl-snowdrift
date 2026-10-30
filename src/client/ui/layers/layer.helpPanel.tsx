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
 * Copy is the day number, then the tagline and obelisk progress,
 * and one line: don't let the fire die.
 */

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { InputAction, PointerEventType, engine, inputSystem } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'


import { playUiClick } from 'src/client/audio'
import { getDayNumber, isPhaseHydrated } from 'src/client/phase'
import { UI_THEME } from 'src/client/ui/theme/settings'
import { getLitObeliskCount, getObeliskTotal } from 'src/client/stationMarkers'
import { closeLeaderboard } from 'src/client/leaderboard'
import {
	cancelNewExpedition, canBeginNewExpedition, hasExpeditionHelpSection, isNewExpeditionCounting, isNewExpeditionMine,
	newExpeditionSecondsLeft, requestNewExpedition,
} from 'src/client/expedition'
import { formatExpeditionClock } from 'src/shared/expedition'


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
const TAG_FONT     = 20
const DAY_LINE_H   = DAY_FONT + 4
const TAG_LINE_H   = TAG_FONT + 4
const LINE_GAP     = 2
const PANEL_PAD    = spacing.md
const PANEL_BORDER = 4

// Wide enough for "Don't let the fire die" at TAG_FONT, plus the pad.
const PANEL_W = 280
const PANEL_H_BASE =
	PANEL_PAD * 2 +
	PANEL_BORDER * 2 +
	DAY_LINE_H + LINE_GAP * 2 +
	TAG_LINE_H + LINE_GAP +
	TAG_LINE_H

// New-expedition section (only after the ending, see src/client/expedition.ts): a status line while a countdown runs,
// and one button (BEGIN, or CANCEL for the player who started it).
const EXP_FONT      = 18
const EXP_STATUS_H  = EXP_FONT + 8
const EXP_BTN_H     = 40
const EXP_GAP       = 8
const EXP_BTN_BG    = Color4.create(0.2, 0.55, 0.9, 0.95)
const EXP_CANCEL_BG = Color4.create(0.55, 0.2, 0.2, 0.95)

/** Panel height: the base card plus the expedition rows that are showing right now. */
function panelHeight(): number {
	if (!hasExpeditionHelpSection()) return PANEL_H_BASE
	const counting = isNewExpeditionCounting()
	const button   = canBeginNewExpedition() || isNewExpeditionMine()
	return PANEL_H_BASE + EXP_GAP + (counting ? EXP_STATUS_H : 0) + (button ? EXP_BTN_H + (counting ? EXP_GAP / 2 : 0) : 0)
}

// MARK: ExpeditionSection
/** BEGIN NEW EXPEDITION / countdown status / CANCEL NEW EXPEDITION (server-validated; nothing here decides anything). */
function ExpeditionSection() {
	if (!hasExpeditionHelpSection()) return null
	const counting = isNewExpeditionCounting()
	const begin    = canBeginNewExpedition()
	const cancel   = isNewExpeditionMine()
	return (
		<UiEntity
			key         = "ui_HelpPanel_expedition"
			uiTransform = {{ width: '100%', margin: { top: EXP_GAP }, flexDirection: 'column', alignItems: 'stretch' }}
		>
			{counting && (
				<Label
					value       = {`NEW EXPEDITION IN ${formatExpeditionClock(newExpeditionSecondsLeft())}`}
					fontSize    = {EXP_FONT}
					color       = {GOLD}
					font        = "monospace"
					textAlign   = "middle-center"
					uiTransform = {{ width: '100%', height: EXP_STATUS_H }}
				/>
			)}
			{(begin || cancel) && (
				<UiEntity
					key          = {begin ? 'ui_HelpPanel_expBegin' : 'ui_HelpPanel_expCancel'}
					uiTransform  = {{
						width         : '100%',
						height        : EXP_BTN_H,
						margin        : { top: counting ? EXP_GAP / 2 : 0 },
						borderRadius  : borderRadius.sm,
						justifyContent: 'center',
						alignItems    : 'center',
					}}
					uiBackground = {{ color: begin ? EXP_BTN_BG : EXP_CANCEL_BG }}
					onMouseDown  = {() => {
						playUiClick()
						if (begin) requestNewExpedition()
						else       cancelNewExpedition()
					}}
				>
					<Label
						value       = {begin ? 'BEGIN NEW EXPEDITION' : 'CANCEL NEW EXPEDITION'}
						fontSize    = {EXP_FONT}
						color       = {WHITE}
						font        = "sans-serif"
						textAlign   = "middle-center"
						uiTransform = {{ width: '100%', height: EXP_BTN_H }}
					/>
				</UiEntity>
			)}
		</UiEntity>
	)
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
					height        : panelHeight(),
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
				onMouseDown  = {() => { cancelHelpAutoClose() }}
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
						margin: { bottom: LINE_GAP * 2 },
					}}
				/>
				<Label
					value    = {`${getLitObeliskCount()}/${getObeliskTotal()} <color=#FFCC4D>obelisks</color> activated`}
					fontSize = {TAG_FONT}
					color    = {WHITE}
					font     = "sans-serif"
					textAlign= "middle-center"
					uiTransform = {{ width: '100%', height: TAG_LINE_H, margin: { bottom: LINE_GAP } }}
				/>
				<Label
					value    = "Don't let the fire die"
					fontSize = {TAG_FONT}
					color    = {WHITE}
					font     = "sans-serif"
					textAlign= "middle-center"
					uiTransform = {{ width: '100%', height: TAG_LINE_H }}
				/>
				<ExpeditionSection />
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
	cancelHelpAutoClose()
	if (helpPanelLayer.visibility.isHidden) closeLeaderboard() // opening: never overlap the leaderboard
	helpPanelLayer.toggle()
}


// MARK: autoOpenHelpPanel
let autoCloseAtMs = 0
let autoCloseInstalled = false
/** Any interaction (click on the panel, help button / key) keeps it open. */
function cancelHelpAutoClose(): void { autoCloseAtMs = 0 }
/** Open the panel and close it after `seconds` unless the player interacts. */
export function autoOpenHelpPanel(seconds: number): void {
	if (!autoCloseInstalled) {
		autoCloseInstalled = true
		engine.addSystem(() => {
			if (autoCloseAtMs === 0 || Date.now() < autoCloseAtMs) return
			autoCloseAtMs = 0
			if (isHelpPanelVisible()) helpPanelLayer.hide()
		})
	}
	if (isHelpPanelVisible()) return // player already has it open: leave it alone
	closeLeaderboard()
	helpPanelLayer.show()
	autoCloseAtMs = Date.now() + seconds * 1000
}


// MARK: initHelpPanelHotkey
/**
 * Desktop hotkey: `4` (IA_ACTION_6) toggles the help panel (1 view, 2 mute, 3 leaderboard,
 * 4 help), matching the top HUD row order (+, -, rotate, eye, mute, star, ?).
 * Skipped on mobile: the native help slot fires the same action, and
 * touchControls.ts handles it there (a second handler would double-toggle).
 */
export function initHelpPanelHotkey(): void {
	if (isMobile()) return
	engine.addSystem(() => {
		if (inputSystem.isTriggered(InputAction.IA_ACTION_6, PointerEventType.PET_DOWN)) { // 4: help (1 view, 2 mute, 3 leaderboard)
			playUiClick()
			toggleHelpPanel()
		}
	})
}
