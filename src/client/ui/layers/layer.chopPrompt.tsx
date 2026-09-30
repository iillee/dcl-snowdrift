/**
 * layer.chopPrompt.tsx — proximity tooltip: "Chop wood".
 *
 * Visible when the F slot is empty and a tree that still has wood is
 * in reach. F gathers one log and shrinks that tree. This layer is
 * only the hint; the key handler lives in logsInput.ts.
 *
 * Sits on the Logs slot, same gold chip as Feed. The two never show
 * together: Feed needs a full slot, Chop needs an empty one.
 */

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { engine } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { canChopWood, tryChopWood } from 'src/client/wood'
import { UI_THEME } from 'src/client/ui/theme/settings'


const { fontSizes, borderRadius } = UI_THEME

const BG_GOLD     = Color4.create(1.00, 0.80, 0.30, 1)
const FG_BLACK    = Color4.create(0, 0, 0, 1)
const BORDER_GOLD = Color4.create(1.00, 0.80, 0.30, 0.95)

const TOOLTIP_H_MB    = 112
const TOOLTIP_H_DT    = 71
const HOTBAR_HALF_MB  = 128
const HOTBAR_HALF_DT  = 80
const BOTTOM_MB       = 0
const BOTTOM_DT       = 30
const BORDER_W_MB     = 4
const BORDER_W_DT     = 3
const PADDING_X_MB    = 20
const PADDING_X_DT    = 14


// MARK: shouldShowPrompt
function shouldShowPrompt(): boolean {
	return canChopWood()
}


// MARK: ChopPromptLayer
/**
 * Bottom-center tooltip on the Logs slot while a trunk can be chopped.
 * Empty body when hidden.
 */
class ChopPromptLayer extends Layer {
	constructor() {
		super({
			id  : 'chopPrompt',
			zone: ZoneType.BottomCenter,
		})
	}


	// MARK: body
	body() {
		if (!shouldShowPrompt()) return <UiEntity key="ui_ChopPrompt_hidden" uiTransform={{ display: 'none' }} />

		const mobile   = isMobile()
		const height   = mobile ? TOOLTIP_H_MB   : TOOLTIP_H_DT
		const halfRow  = mobile ? HOTBAR_HALF_MB : HOTBAR_HALF_DT
		const bottomPx = mobile ? BOTTOM_MB : BOTTOM_DT
		const borderW  = mobile ? BORDER_W_MB    : BORDER_W_DT
		const padX     = mobile ? PADDING_X_MB   : PADDING_X_DT
		const fontPx   = mobile ? fontSizes.md * 2 : fontSizes.md * 1.25
		const labelH   = Math.round(fontPx * 1.6)

		return (
			<UiEntity
				key         = "ui_ChopPrompt_root"
				uiTransform = {{
					positionType : 'absolute',
					position     : { bottom: bottomPx, left: '50%' },
					margin       : { left: halfRow },
					height       : height,
					flexDirection: 'row',
					alignItems   : 'center',
					padding      : { top: 0, bottom: 0, left: padX, right: padX },
					borderRadius : borderRadius.md,
					borderWidth  : borderW,
					borderColor  : BORDER_GOLD,
				}}
				uiBackground = {{ color: BG_GOLD }}
				onMouseDown  = {tryChopWood}
			>
				<Label
					key         = "ui_ChopPrompt_label"
					value       = {mobile ? 'CHOP WOOD' : '<b>CHOP WOOD</b>'}
					fontSize    = {fontPx}
					color       = {FG_BLACK}
					font        = "sans-serif"
					textAlign   = "middle-left"
					uiTransform = {{ width: 'auto', height: labelH }}
				/>
			</UiEntity>
		)
	}
}


export const chopPromptLayer = new ChopPromptLayer()


let _chopPromptInstalled = false
let _chopPromptVisible   = false


// MARK: isChopPromptVisible

/** True while the chop tooltip is showing. */
export function isChopPromptVisible(): boolean {
	return _chopPromptVisible
}


// MARK: setupChopPromptVisibility

/** Register the visibility watcher. Call once from client bootstrap. */
export function setupChopPromptVisibility(): void {
	if (_chopPromptInstalled) return
	_chopPromptInstalled = true
	engine.addSystem((_dt: number) => {
		const want = shouldShowPrompt()
		if (want === _chopPromptVisible) return
		_chopPromptVisible = want
	})
}
