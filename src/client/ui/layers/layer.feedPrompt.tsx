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
		})
	}

	body() {
		if (!shouldShowPrompt()) return <UiEntity key="ui_FeedPrompt_hidden" uiTransform={{ display: 'none' }} />

		const S = isMobile() ? 2 : 1

		return (
			<UiEntity
				key         = "ui_FeedPrompt_root"
				uiTransform = {{
					// Placement: stacked ABOVE the relight prompt so both can
					// coexist inside a fire's ring without overlapping. Relight
					// prompt sits at bottom:720 (desktop) / 200 (mobile); feed
					// prompt lifts an extra ~70 px above it.
					margin      : { bottom: isMobile() ? 270 : 790, left: isMobile() ? 320 : 0 },
					flexDirection: 'row',
					alignItems  : 'center',
					padding     : { top: 8 * S, bottom: 8 * S, left: 12 * S, right: 14 * S },
					borderRadius: borderRadius.sm,
				}}
				uiBackground = {{ color: BG }}
				// Tapping the prompt itself also feeds the fire on mobile,
				// where there's no dedicated F key. Safe outside the ring
				// because the prompt is only rendered while in range.
				onMouseDown = {feedFire}
			>
				<UiEntity
					key         = "ui_FeedPrompt_key"
					uiTransform = {{
						width        : 26 * S,
						height       : 26 * S,
						margin       : { right: 10 * S },
						borderRadius : borderRadius.sm,
						justifyContent: 'center',
						alignItems   : 'center',
					}}
					uiBackground = {{ color: KEY_BG }}
				>
					{isMobile() ? (
						<UiEntity
							key = "ui_FeedPrompt_handIcon"
							uiTransform = {{ width: 20 * S, height: 20 * S }}
							uiBackground = {{
								textureMode: 'stretch',
								texture    : { src: ATLAS_SRC },
								uvs        : getUVsForAtlasTile(HAND_TILE_COL, HAND_TILE_ROW, ATLAS_COLS, ATLAS_ROWS),
								color      : KEY_FG,
							}}
						/>
					) : (
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
					)}
				</UiEntity>
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
