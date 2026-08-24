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

import { playUiClick } from 'src/client/audio'
import { msUntilNextRebuild } from 'src/client/cycle'
import { getHiddenCampfireWarmthPositions } from 'src/client/hiddenCampfire'
import { HIDDEN_CAMPFIRE_COUNT } from 'src/shared/hiddenCampfire'
import { UI_THEME } from 'src/client/ui/theme/settings'
import { VERSION }  from 'src/shared/data/version'


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

const PANEL_W = 440
// Bumped from 152 to make room for a dedicated version-chip row below
// the four info lines. Each info line is ~26 tall + a 4 gap; the chip
// row adds ~28 (24 tall + 4 gap above).
const PANEL_H = 188


// MARK: formatCountdown
/** Format a positive ms duration as `HH:MM:SS`. Mirrors layer.cyclePanel. */
function formatCountdown(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000))
	const h     = Math.floor(total / 3600)
	const m     = Math.floor((total % 3600) / 60)
	const s     = total % 60
	const pad   = (n: number) => (n < 10 ? `0${n}` : `${n}`)
	return `${pad(h)}:${pad(m)}:${pad(s)}`
}

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
				{/* Line 1 — top-level directive. Deliberately terse so it
				   frames the two mechanic lines below as HOW to do it. */}
				<Label
					value    = {'Explore the world'}
					fontSize = {20}
					color    = {WHITE}
					font     = "sans-serif"
					textAlign= "middle-center"
					uiTransform = {{ width: '100%', height: 26, margin: { bottom: 4 } }}
				/>
				{/* Line 2 — core loop. "wood" is bold + yellow to mirror the
				   warm-gold fuel bar so the language + colour align. */}
				<Label
					value    = {'Fuel the fire with <b><color=#ffcc4d>wood</color></b>'}
					fontSize = {20}
					color    = {WHITE}
					font     = "sans-serif"
					textAlign= "middle-center"
					uiTransform = {{ width: '100%', height: 26, margin: { bottom: 4 } }}
				/>
				{/* Line 3 — objective + progress. Central bonfire counts as 1
				   (always lit at cycle start); hidden ones tick up as they're
				   ignited. Reads from getHiddenCampfireWarmthPositions().length
				   so it stays in lockstep with the frost-warmth signal. */}
				<Label
					value    = {`Find and light the hidden campfires: <b><color=#ffcc4d>${1 + getHiddenCampfireWarmthPositions().length}/${TOTAL_CAMPFIRES}</color></b>`}
					fontSize = {20}
					color    = {WHITE}
					font     = "sans-serif"
					textAlign= "middle-center"
					uiTransform = {{ width: '100%', height: 26, margin: { bottom: 4 } }}
				/>
				{/* Line 2 — mirrors the ClockButton countdown (msUntilNextRebuild
				   is the shared source of truth for the 24 h UTC rollover). */}
				<Label
					value    = {`World rebuilds in <b><color=#ffcc4d>${formatCountdown(msUntilNextRebuild())}</color></b>`}
					fontSize = {20}
					color    = {WHITE}
					font     = "sans-serif"
					textAlign= "middle-center"
					uiTransform = {{ width: '100%', height: 26 }}
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
						height        : 24,
						margin        : { top: 8 },
						flexDirection : 'row',
						justifyContent: 'center',
						alignItems    : 'center',
					}}
				>
					<UiEntity
						key         = "ui_HelpPanel_version"
						uiTransform = {{
							width       : 'auto',
							height      : 24,
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
