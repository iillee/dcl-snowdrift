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

// Solid warm gold background with black text — reads as a bright,
// opaque call-to-action anchored to the hotbar slot. Shared by mobile
// and desktop now that both platforms use the same tooltip design.
const BG_GOLD     = Color4.create(1.00, 0.80, 0.30, 1)
const FG_BLACK    = Color4.create(0, 0, 0, 1)
// Warm gold border shared with the hotbar buttons' active state.
const BORDER_GOLD = Color4.create(1.00, 0.80, 0.30, 0.95)

// Per-platform sizing keyed off the underlying hotbar button. See
// layer.relightPrompt for the derivation of these numbers — kept in
// sync so the two tooltips stay symmetric around screen centre.
// Kept in sync with layer.relightPrompt — see comments there for why
// desktop uses 71 (not 72) and mobile is left alone at 112.
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
			id  : 'feedPrompt',
			zone: ZoneType.BottomCenter,
			// No slide animation — the bridge (layer.hotbarBridge) needs to
			// pop in/out in the same frame as the tooltip so the two read as
			// one crisp shape. Gated by shouldShowPrompt() in body().
		})
	}

	body() {
		// Hard visibility gate so bridge + tooltip snap on/off together.
		if (!shouldShowPrompt()) return <UiEntity key="ui_FeedPrompt_hidden" uiTransform={{ display: 'none' }} />

		const mobile   = isMobile()
		const height   = mobile ? TOOLTIP_H_MB   : TOOLTIP_H_DT
		const halfRow  = mobile ? HOTBAR_HALF_MB : HOTBAR_HALF_DT
		const bottomPx = mobile ? BOTTOM_MB : BOTTOM_DT
		const borderW  = mobile ? BORDER_W_MB    : BORDER_W_DT
		const padX     = mobile ? PADDING_X_MB   : PADDING_X_DT
		const fontPx   = mobile ? fontSizes.md * 2 : fontSizes.md * 1.25
		const labelH   = Math.round(fontPx * 1.6)

		// Mirror of the relight tooltip on the opposite side of centre:
		// anchor LEFT edge to screen centre, push right by halfRow so the
		// tooltip's inner edge kisses the Logs button's outer edge.
		return (
			<UiEntity
				key         = "ui_FeedPrompt_root"
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
				// Clicking the tooltip also feeds on both platforms — the
				// bubble IS the primary tap target next to the button.
				onMouseDown = {feedFire}
			>
				{/* Desktop uses <b> markup for a bolder read; only mobile is
				   sensitive to the rich-text hitbox mismatch (see bug report). */}
				<Label
					key         = "ui_FeedPrompt_label"
					value       = {mobile ? 'FEED FIRE' : '<b>FEED FIRE</b>'}
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


export const feedPromptLayer = new FeedPromptLayer()


// MARK: setupFeedPromptVisibility
/**
 * Drive the layer's slide-in / slide-out from the proximity check.
 * Mirror of setupRelightPromptVisibility. Idempotent.
 */
let _feedPromptInstalled = false
let _feedPromptVisible   = false
// MARK: isFeedPromptVisible
/** True while the feed tooltip is (or is animating into) view. Read by the
 *  hotbar-bridge layer to know when to draw its gold connector. */
export function isFeedPromptVisible(): boolean { return _feedPromptVisible }
export function setupFeedPromptVisibility(): void {
	if (_feedPromptInstalled) return
	_feedPromptInstalled = true
	engine.addSystem((_dt: number) => {
		const want = shouldShowPrompt()
		if (want === _feedPromptVisible) return
		_feedPromptVisible = want
		// No show/hide call — body() gates on shouldShowPrompt() directly
		// so the tooltip snaps in the same frame the bridge does.
	})
}
