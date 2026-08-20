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

import {
	getTorchFuelFraction,
	isTorchEquipped,
	isTorchLit,
	isTorchRaised,
} from 'src/client/torchEquip'
import { UI_THEME } from 'src/client/ui/theme/settings'


const { colors, fontSizes, borderRadius } = UI_THEME

// MARK: Layout constants
const SLOT_SIZE      = 64
const SLOT_BG        = Color4.create(0, 0, 0, 0.55)
const SLOT_BORDER    = Color4.create(1, 1, 1, 0.18)
const SLOT_BORDER_ON = Color4.create(1, 0.75, 0.35, 0.95) // warm amber when lit / raised
const KEY_LABEL      = Color4.create(0.75, 0.75, 0.75, 1)
const TORCH_TEXTURE  = 'assets/images/torch.png'
const TORCH_ICON_PX  = 40  // fits inside the 64px slot with breathing room

// Fuel bar sits under the icon at the bottom of the slot. Colours match
// the frost pill's warm-gold => empty-black transition so all warmth
// indicators speak the same visual language.
const FUEL_BAR_H     = 5
const FUEL_BAR_PAD_X = 6
const FUEL_BAR_PAD_B = 4
const FUEL_LIT       = Color4.create(1.00, 0.75, 0.30, 1.00)
const FUEL_TRACK     = Color4.create(0, 0, 0, 0.50)
const ICON_DIM       = Color4.create(0.45, 0.45, 0.45, 1)


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

		const lit       = isTorchLit()
		const raised    = isTorchRaised()
		const highlight = lit || raised
		const border    = highlight ? SLOT_BORDER_ON : SLOT_BORDER
		const iconTint  = lit ? colors.light : ICON_DIM
		const fuelFrac  = Math.max(0, Math.min(1, getTorchFuelFraction()))
		const fuelW     = Math.max(0, SLOT_SIZE - FUEL_BAR_PAD_X * 2)
		const fuelFill  = Math.round(fuelW * fuelFrac)

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
					borderColor    : border,
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
				{/* Torch icon — center. Dimmed when unlit so players see at
				   a glance whether the flame is out. */}
				<UiEntity
					key         = "ui_Hotbar_torchIcon"
					uiTransform = {{
						width       : TORCH_ICON_PX,
						height      : TORCH_ICON_PX,
						positionType: 'absolute',
					}}
					uiBackground = {{
						textureMode: 'stretch',
						texture    : { src: TORCH_TEXTURE },
						color      : iconTint,
					}}
				/>
				{/* Fuel bar — bottom of slot. Empty track always drawn so
				   the fuel gauge geometry stays present even at 0. */}
				<UiEntity
					key         = "ui_Hotbar_fuelTrack"
					uiTransform = {{
						width       : fuelW,
						height      : FUEL_BAR_H,
						positionType: 'absolute',
						position    : { bottom: FUEL_BAR_PAD_B, left: FUEL_BAR_PAD_X },
					}}
					uiBackground = {{ color: FUEL_TRACK }}
				/>
				{fuelFill > 0 ? (
					<UiEntity
						key         = "ui_Hotbar_fuelFill"
						uiTransform = {{
							width       : fuelFill,
							height      : FUEL_BAR_H,
							positionType: 'absolute',
							position    : { bottom: FUEL_BAR_PAD_B, left: FUEL_BAR_PAD_X },
						}}
						uiBackground = {{ color: FUEL_LIT }}
					/>
				) : null}
			</UiEntity>
		)
	}
}


export const hotbarLayer = new HotbarLayer()
