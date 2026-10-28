/**
 * layer.expeditionCountdown.tsx - on-screen NEW EXPEDITION controls under the top HUD row.
 *
 * Once the world is complete and restored (the same server-side eligibility as the Help panel button, src/client/expedition.ts):
 *   - BEGIN NEW EXPEDITION: a small tap-friendly button (44 px high).
 *   - while the shared countdown runs: a "NEW EXPEDITION IN m:ss" chip for everyone, and CANCEL NEW EXPEDITION for the initiator only.
 * Gameplay is untouched. The Help panel keeps the same copy / buttons, so this steps aside while it (or the leaderboard) is open:
 * they sit in the same spot under the top row.
 */

import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { playUiClick } from 'src/client/audio'
import {
	cancelNewExpedition, canBeginNewExpedition, isNewExpeditionCounting, isNewExpeditionMine, newExpeditionSecondsLeft,
	requestNewExpedition,
} from 'src/client/expedition'
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
/** Mobile-friendly tap height. */
export const EXPEDITION_BTN_H = 44
const BTN_GAP    = 4
const GOLD       = Color4.create(1, 0.8, 0.3, 0.95)
const WHITE      = Color4.White()
const BEGIN_BG   = Color4.create(0.2, 0.55, 0.9, 0.95)
const CANCEL_BG  = Color4.create(0.55, 0.2, 0.2, 0.95)

// MARK: ExpeditionButton
function ExpeditionButton(props: { keyId: string; label: string; bg: Color4; onPress: () => void }) {
	return (
		<UiEntity
			key          = {props.keyId}
			uiTransform  = {{
				height        : EXPEDITION_BTN_H,
				padding       : { left: 16, right: 16 },
				margin        : { top: BTN_GAP },
				borderRadius  : borderRadius.sm,
				justifyContent: 'center',
				alignItems    : 'center',
			}}
			uiBackground = {{ color: props.bg }}
			onMouseDown  = {() => { playUiClick(); props.onPress() }}
		>
			<Label
				value       = {props.label}
				fontSize    = {FONT}
				color       = {WHITE}
				font        = "sans-serif"
				textAlign   = "middle-center"
				uiTransform = {{ height: EXPEDITION_BTN_H }}
			/>
		</UiEntity>
	)
}

// MARK: ExpeditionCountdownLayer
class ExpeditionCountdownLayer extends Layer {
	constructor() {
		super({ id: 'expeditionCountdown', zone: ZoneType.TopCenter })
	}

	body() {
		const counting = isNewExpeditionCounting()
		const begin    = canBeginNewExpedition()
		const cancel   = isNewExpeditionMine()
		if (!counting && !begin) return null
		if (isHelpPanelVisible() || isLeaderboardOpen()) return null
		const top = (isMobile() ? BAR_TOP_MB : BAR_TOP_DT) + BAR_H + GAP
		return (
			<UiEntity
				key         = "ui_ExpeditionCountdown_root"
				uiTransform = {{
					margin        : { top },
					flexDirection : 'column',
					alignItems    : 'center',
				}}
			>
				{counting && (
					<UiEntity
						key          = "ui_ExpeditionCountdown_chip"
						uiTransform  = {{
							height        : CHIP_H,
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
				)}
				{begin && (
					<ExpeditionButton keyId = "ui_Expedition_begin" label = "BEGIN NEW EXPEDITION" bg = {BEGIN_BG} onPress = {requestNewExpedition} />
				)}
				{cancel && (
					<ExpeditionButton keyId = "ui_Expedition_cancel" label = "CANCEL NEW EXPEDITION" bg = {CANCEL_BG} onPress = {cancelNewExpedition} />
				)}
			</UiEntity>
		)
	}
}

export const expeditionCountdownLayer = new ExpeditionCountdownLayer()