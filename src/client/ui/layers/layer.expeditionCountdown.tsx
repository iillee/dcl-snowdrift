/**
 * layer.expeditionCountdown.tsx - persistent, unobtrusive "NEW EXPEDITION IN m:ss" chip under the top HUD row.
 *
 * Shown to every player while the shared new-expedition countdown runs (src/client/expedition.ts); gameplay is untouched. The Help
 * panel and the leaderboard already show the same status in the same spot, so the chip steps aside while either is open.
 */

import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { isNewExpeditionCounting, newExpeditionSecondsLeft } from 'src/client/expedition'
import { isLeaderboardOpen } from 'src/client/leaderboard'
import { isHelpPanelVisible } from 'src/client/ui/layers/layer.helpPanel'
import { UI_THEME } from 'src/client/ui/theme/settings'
import { formatExpeditionClock } from 'src/shared/expedition'

const { colors, borderRadius } = UI_THEME

// Same top offsets / button height as the HUD row (layer.frostBar.tsx BAR_TOP_*, layer.brushSize.tsx BTN_SIZE).
const BAR_TOP_DT = 32
const BAR_TOP_MB = 4
const BAR_H      = 72
const GAP        = 6
const CHIP_H     = 28
const FONT       = 16
const GOLD       = Color4.create(1, 0.8, 0.3, 0.95)

class ExpeditionCountdownLayer extends Layer {
	constructor() {
		super({ id: 'expeditionCountdown', zone: ZoneType.TopCenter })
	}

	body() {
		if (!isNewExpeditionCounting() || isHelpPanelVisible() || isLeaderboardOpen()) return null
		const top = (isMobile() ? BAR_TOP_MB : BAR_TOP_DT) + BAR_H + GAP
		return (
			<UiEntity
				key         = "ui_ExpeditionCountdown_root"
				uiTransform = {{
					height        : CHIP_H,
					margin        : { top },
					padding       : { left: 12, right: 12 },
					borderRadius  : borderRadius.sm,
					justifyContent: 'center',
					alignItems    : 'center',
					pointerFilter : 'none',
				}}
				uiBackground = {{ color: colors.statsBg }}
			>
				<Label
					value       = {`NEW EXPEDITION IN ${formatExpeditionClock(newExpeditionSecondsLeft())}`}
					fontSize    = {FONT}
					color       = {GOLD}
					font        = "monospace"
					textAlign   = "middle-center"
					uiTransform = {{ height: CHIP_H }}
				/>
			</UiEntity>
		)
	}
}

export const expeditionCountdownLayer = new ExpeditionCountdownLayer()