/**
 * layer.feedPrompt.tsx - proximity tooltip: "Press F to feed fire".
 *
 * Visible when ALL of the following are true:
 *   - local player is carrying a log (F slot filled)
 *   - local player is inside the campfire feed radius
 *
 * The player still has to press F - this layer is only the affordance
 * hint. The actual feed happens in src/client/logsInput.ts.
 *
 * Structurally a near-clone of layer.relightPrompt.tsx; if we grow a
 * third proximity prompt we should extract a shared PromptChip
 * component. Two is under the "rule of three" threshold, so we keep
 * the copy for now to avoid premature abstraction.
 */

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { engine } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { feedFire, hasLogs, isInFeedRange } from 'src/client/logsInventory'
import { UI_THEME }                         from 'src/client/ui/theme/settings'
import { getUVsForAtlasTile }               from 'src/client/ui/utils/atlas'


// Same atlas the relight prompt uses so the mobile hand glyph stays
// consistent across proximity affordances.
const ATLAS_SRC     = 'assets/images/ui-component-kit/atlas-icons-font-awesome.png'
const ATLAS_COLS    = 16
const ATLAS_ROWS    = 16
const HAND_TILE_COL = 2
const HAND_TILE_ROW = 11


const { fontSizes, borderRadius } = UI_THEME

const BG        = Color4.create(0, 0, 0, 0.65)
const FG        = Color4.create(1, 0.95, 0.85, 1)
const KEY_BG    = Color4.create(1, 0.75, 0.35, 0.95)
const KEY_FG    = Color4.create(0.1, 0.05, 0, 1)
// Warm gold border shared with the hotbar buttons' active state.
const BORDER_GOLD      = Color4.create(1.00, 0.80, 0.30, 0.95)
const MOBILE_TOOLTIP_H = 112


// MARK: shouldShowPrompt
function shouldShowPrompt(): boolean {
	if (!hasLogs()) return false
	return isInFeedRange()
}


// MARK: FeedPromptLayer
/**
 * Bottom-center tooltip visible when the player is inside the fire's
 * feed ring holding a log. Empty body when hidden - zero UI cost while
 * not shown.
 */
class FeedPromptLayer extends Layer {
	constructor() {
		super({
			id         : 'feedPrompt',
			zone       : ZoneType.BottomCenter,
			// Rest position: RIGHT of the Logs (F) hotbar button. Slide in
			// from the RIGHT edge so travel distance stays short and the
			// tooltip approaches from the same side it settles on — no
			// cross-screen sweep.
			canBeHidden: true,
			startHidden: true,
			showFrom   : 'right',
		})
	}

	body() {
		// Visibility driven externally by setupFeedPromptVisibility() so the
		// kit can tween the slide in / out instead of a hard swap.

		const mobile = isMobile()
		const S = mobile ? 2 : 1

		// Mobile: escape the BottomCenter flex row (positionType absolute)
		// and anchor the tooltip's LEFT edge to the zone midpoint, then
		// push right of the Logs (F) hotbar button.
		const MOBILE_HOTBAR_HALF_PX = 128
		const mobileHeight = MOBILE_TOOLTIP_H
		const borderW      = mobile ? 4 : 0
		const borderCol    = mobile ? BORDER_GOLD : Color4.create(0, 0, 0, 0)

		return (
			<UiEntity
				key         = "ui_FeedPrompt_root"
				uiTransform = {mobile ? {
					positionType : 'absolute',
					// bottom: 0 aligns with the hotbar row at the bottom edge of
					// the safe area (matches MARGIN_BOTTOM_MB in inventoryHotbar).
					position     : { bottom: 0, left: '50%' },
					margin       : { left: MOBILE_HOTBAR_HALF_PX },
					height       : mobileHeight,
					flexDirection: 'row',
					alignItems   : 'center',
					padding      : { top: 0, bottom: 0, left: 20, right: 20 },
					borderRadius : borderRadius.md,
					borderWidth  : borderW,
					borderColor  : borderCol,
				} : {
					margin      : { bottom: 790, left: 0 },
					flexDirection: 'row',
					alignItems  : 'center',
					padding     : { top: 8, bottom: 8, left: 12, right: 14 },
					borderRadius: borderRadius.sm,
				}}
				uiBackground = {{ color: BG }}
				// Tapping the prompt itself also feeds the fire — harmless
				// fallback alongside the dedicated Logs hotbar button.
				onMouseDown = {feedFire}
			>
				{/* Desktop-only key chip. Mobile relies on the Logs hotbar
				   button being the affordance and drops the chip. */}
				{mobile ? null : (
					<UiEntity
						key         = "ui_FeedPrompt_key"
						uiTransform = {{
							width        : 26,
							height       : 26,
							margin       : { right: 10 },
							borderRadius : borderRadius.sm,
							justifyContent: 'center',
							alignItems   : 'center',
						}}
						uiBackground = {{ color: KEY_BG }}
					>
						<Label
							value    = "F"
							fontSize = {fontSizes.md}
							color    = {Color4.White()}
							font     = "sans-serif"
							textAlign= "middle-center"
							uiTransform = {{
								width : '100%',
								height: '100%',
								margin: { top: -2, left: 2 },
							}}
						/>
					</UiEntity>
				)}
				<UiEntity
					key         = "ui_FeedPrompt_label"
					uiTransform = {{ width: 'auto', height: 26 * S }}
					uiText      = {{
						value    : 'Feed fire',
						fontSize : fontSizes.md * S,
						color    : FG,
						textAlign: 'middle-left',
					}}
				/>
			</UiEntity>
		)
	}
}


export const feedPromptLayer = new FeedPromptLayer()


// MARK: setupFeedPromptVisibility
/**
 * Drive the layer's slide-in / slide-out from the proximity check.
 * Mirror of setupRelightPromptVisibility. Idempotent.
 */
let _feedPromptInstalled = false
let _feedPromptVisible   = false
export function setupFeedPromptVisibility(): void {
	if (_feedPromptInstalled) return
	_feedPromptInstalled = true
	engine.addSystem((_dt: number) => {
		const want = shouldShowPrompt()
		if (want === _feedPromptVisible) return
		_feedPromptVisible = want
		if (want) feedPromptLayer.show()
		else      feedPromptLayer.hide()
	})
}
