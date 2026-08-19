/**
 * layer.hotbar.tsx — bottom-center inventory slot (E: Torch).
 *
 * Single-slot hotbar for now. Shows a torch glyph when the local player
 * has the torch equipped, with the E key label pinned top-left. The
 * slot highlights while the torch is raised (E just pressed).
 *
 * Distilled from the `power` scene's AbilitySlot pattern, adapted to
 * the DUCK Layer + Zone system used elsewhere in the scene. Empty
 * layer body when the torch is not equipped keeps the HUD clean.
 */

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { isTorchEquipped, isTorchRaised } from 'src/client/torchEquip'
import { UI_THEME } from 'src/client/ui/theme/settings'


const { colors, fontSizes, borderRadius } = UI_THEME

// MARK: Layout constants
const SLOT_SIZE      = 64
const SLOT_BG        = Color4.create(0, 0, 0, 0.55)
const SLOT_BORDER    = Color4.create(1, 1, 1, 0.18)
const SLOT_BORDER_ON = Color4.create(1, 0.75, 0.35, 0.95) // warm amber when raised
const KEY_LABEL      = Color4.create(0.75, 0.75, 0.75, 1)
const TORCH_GLYPH    = 'T' // placeholder — swap for an image asset later


// MARK: HotbarLayer
/**
 * Bottom-center hotbar. Currently one slot (E: Torch). Hidden entirely
 * when the local player has no equippable items.
 */
class HotbarLayer extends Layer {
	constructor() {
		super({
			id  : 'hotbar',
			zone: ZoneType.BottomCenter,
		})
	}

	body() {
		if (!isTorchEquipped()) return <UiEntity key="ui_Hotbar_empty" />

		const raised = isTorchRaised()
		const borderColor = raised ? SLOT_BORDER_ON : SLOT_BORDER

		return (
			<UiEntity
				key         = "ui_Hotbar_root"
				uiTransform = {{
					width          : SLOT_SIZE,
					height         : SLOT_SIZE,
					flexDirection  : 'column',
					alignItems     : 'center',
					justifyContent : 'center',
					borderRadius   : borderRadius.md,
					borderWidth    : 2,
					borderColor    : borderColor,
				}}
				uiBackground = {{ color: SLOT_BG }}
			>
				{/* E key label — top-left */}
				<Label
					value       = "E"
					fontSize    = {fontSizes.sm}
					color       = {KEY_LABEL}
					font        = "sans-serif"
					uiTransform = {{
						positionType: 'absolute',
						position    : { top: 2, left: 6 },
					}}
				/>
				{/* Torch icon — center */}
				<Label
					value       = {TORCH_GLYPH}
					fontSize    = {28}
					color       = {raised ? colors.warning : colors.light}
					font        = "sans-serif"
					uiTransform = {{ positionType: 'absolute' }}
				/>
			</UiEntity>
		)
	}
}


export const hotbarLayer = new HotbarLayer()
