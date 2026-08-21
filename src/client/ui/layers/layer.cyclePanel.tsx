/**
 * layer.cyclePanel.tsx — countdown popover shown next to the ClockButton.
 *
 * The rebuild boundary is midnight UTC, which coincides with the
 * hidden-campfire cycle bucket (HIDDEN_CYCLE_MS = 24 h aligned to the
 * unix epoch, and the epoch itself sits on midnight UTC). We reuse
 * that constant so the visible countdown, the deterministic hidden
 * campfire seed, and the (future) server rollover all agree on the
 * same tick.
 *
 * Rendered inline by ClockButton (see layer.brushSize.tsx) rather than
 * as its own kit Layer, so its position is always anchored to the
 * clock icon regardless of where the HUD cluster ends up. Visibility
 * is module-scoped local state — the button toggles it, the button's
 * own re-render tick redraws the popover.
 */

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'

import { msUntilNextRebuild } from 'src/client/cycle'
import { UI_THEME } from 'src/client/ui/theme/settings'


const { colors, borderRadius, spacing } = UI_THEME

const GOLD  = Color4.create(1.00, 0.80, 0.30, 1)
const WHITE = Color4.create(1, 1, 1, 0.75)

// Panel geometry. Kept as constants so the ClockButton can add a matching
// horizontal offset when it renders the popover as an absolute child.
const PANEL_W        = 240
// Matches BTN_SIZE in layer.brushSize.tsx so the popover sits at the
// same height as the ClockButton (and the rest of the HUD button row).
const PANEL_H        = 72
// Gap between the right edge of the panel and the left edge of the
// clock button. A small nudge so the panel doesn't kiss the button.
export const PANEL_GAP_PX  = 8
export const PANEL_WIDTH   = PANEL_W


// MARK: cyclePanelOpen
let panelOpen = false


// MARK: isCyclePanelVisible
export function isCyclePanelVisible(): boolean {
	return panelOpen
}


// MARK: toggleCyclePanel
/** Flip visibility of the countdown popover (bound to the ClockButton). */
export function toggleCyclePanel(): void {
	panelOpen = !panelOpen
}


// MARK: formatCountdown
/**
 * Format a positive ms duration as `HH:MM:SS`. Values are clamped to
 * zero so a briefly-negative reading (clock skew at the boundary)
 * never renders as `-1:59:59`.
 */
function formatCountdown(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000))
	const h     = Math.floor(total / 3600)
	const m     = Math.floor((total % 3600) / 60)
	const s     = total % 60
	const pad   = (n: number) => (n < 10 ? `0${n}` : `${n}`)
	return `${pad(h)}:${pad(m)}:${pad(s)}`
}


// MARK: CyclePanelPopover
/**
 * Countdown popover panel. Renders nothing when closed. Meant to be
 * dropped as an absolute-positioned child of the ClockButton so its
 * position tracks the icon.
 */
export function CyclePanelPopover() {
	if (!panelOpen) return null
	const remaining = msUntilNextRebuild()
	const text      = formatCountdown(remaining)
	return (
		<UiEntity
			key         = "ui_CyclePanel_root"
			uiTransform = {{
				width        : PANEL_W,
				height       : PANEL_H,
				padding      : { top: 6, bottom: 6, left: spacing.md, right: spacing.md },
				borderRadius : borderRadius.md,
				borderWidth  : 4,
				borderColor  : WHITE,
				flexDirection: 'column',
				alignItems   : 'center',
				justifyContent: 'center',
			}}
			uiBackground = {{ color: colors.statsBg }}
		>
			{/* Countdown — rendered as two overlapping labels offset by 1 px
			   to fake a bold weight (SDK7 Label has no fontWeight prop). */}
			<UiEntity
				key         = "ui_CyclePanel_countdown_wrap"
				uiTransform = {{ width: '100%', height: 44, positionType: 'relative' }}
			>
				<Label
					value    = {text}
					fontSize = {38}
					color    = {GOLD}
					font     = "monospace"
					textAlign= "middle-center"
					uiTransform = {{
						width       : '100%',
						height      : 44,
						positionType: 'absolute',
						position    : { top: 0, left: 0 },
					}}
				/>
				<Label
					value    = {text}
					fontSize = {38}
					color    = {GOLD}
					font     = "monospace"
					textAlign= "middle-center"
					uiTransform = {{
						width       : '100%',
						height      : 44,
						positionType: 'absolute',
						position    : { top: 1, left: 1 },
					}}
				/>
			</UiEntity>
		</UiEntity>
	)
}
