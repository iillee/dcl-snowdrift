/**
 * layer.hiddenCampfirePrompt.tsx — proximity tooltip: "Press E to
 * light campfire" over the hidden (buried) pit.
 *
 * Visible when ALL of the following are true:
 *   - torch is equipped and lit
 *   - local player is inside the hidden campfire's ignite radius
 *   - the hidden fire is not yet lit (and no ignite request already
 *     in flight to the server)
 *
 * The player still has to press E — this layer is only the affordance
 * hint. The actual ignition path is torchInput.ts, whose E-press
 * handler calls requestHiddenIgnite() when isReadyToIgniteHidden() is
 * true. Visual language is a direct twin of the torch relight prompt
 * (layer.relightPrompt.tsx) so both fire-side affordances read the
 * same at HUD scale.
 */

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { isReadyToIgniteHidden, requestHiddenIgnite } from 'src/client/hiddenCampfire'
import { UI_THEME }                                   from 'src/client/ui/theme/settings'
import { getUVsForAtlasTile }                         from 'src/client/ui/utils/atlas'


// Font-awesome atlas from the UI component kit — same asset the mobile
// pointer-button glyph uses. Kept in sync with layer.relightPrompt so
// both affordances share one texture upload.
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


// MARK: HiddenCampfirePromptLayer
/**
 * Bottom-center tooltip that appears above the hotbar when the player
 * is standing on the hidden pit holding a lit torch. Empty body when
 * hidden — zero UI cost while not shown.
 */
class HiddenCampfirePromptLayer extends Layer {
	constructor() {
		super({
			id  : 'hiddenCampfirePrompt',
			zone: ZoneType.BottomCenter,
		})
	}

	body() {
		if (!isReadyToIgniteHidden()) {
			return <UiEntity key="ui_HiddenCampfirePrompt_hidden" uiTransform={{ display: 'none' }} />
		}

		// Mobile uses a 2x scale on every intrinsic size to match the
		// enlarged torch relight prompt so both fire-side affordances read
		// the same at HUD scale on a phone.
		const S = isMobile() ? 2 : 1

		return (
			<UiEntity
				key         = "ui_HiddenCampfirePrompt_root"
				uiTransform = {{
					// Sits slightly above the torch relight prompt's slot so
					// on the (unlikely) frame both overlap, this one reads
					// first — you're getting a bigger gameplay payoff.
					// On mobile, shift right so the prompt clears the player
					// avatar silhouette (centred on screen) and doesn't overlap it.
					margin      : { bottom: isMobile() ? 260 : 780, left: isMobile() ? 320 : 0 },
					flexDirection: 'row',
					alignItems  : 'center',
					padding     : { top: 8 * S, bottom: 8 * S, left: 12 * S, right: 14 * S },
					borderRadius: borderRadius.sm,
				}}
				uiBackground = {{ color: BG }}
				// Tapping the prompt on mobile is a valid ignition path too;
				// the helper enforces radius + lit torch itself.
				onMouseDown = {requestHiddenIgnite}
			>
				<UiEntity
					key         = "ui_HiddenCampfirePrompt_key"
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
							key = "ui_HiddenCampfirePrompt_handIcon"
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
							value    = "E"
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
					key         = "ui_HiddenCampfirePrompt_label"
					uiTransform = {{ width: 'auto', height: 26 * S }}
					uiText      = {{
						value    : 'Light campfire',
						fontSize : fontSizes.md * S,
						color    : FG,
						textAlign: 'middle-left',
					}}
				/>
			</UiEntity>
		)
	}
}


export const hiddenCampfirePromptLayer = new HiddenCampfirePromptLayer()
