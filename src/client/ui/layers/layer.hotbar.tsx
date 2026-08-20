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

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import {
	getTorchFuelFraction,
	isTorchEquipped,
	isTorchLit,
	isTorchRaised,
} from 'src/client/torchEquip'
import { UI_THEME } from 'src/client/ui/theme/settings'


const { colors, borderRadius } = UI_THEME

// MARK: Layout constants
const SLOT_SIZE       = 64
const SLOT_BG         = Color4.create(0, 0, 0, 0.55)              // matches flagtag PANEL_BG_SEMI
const SLOT_BORDER     = Color4.create(1, 1, 1, 0.18)
const SLOT_BORDER_ON  = Color4.create(1, 0.75, 0.35, 0.95)         // warm amber when lit / raised
const TORCH_TEXTURE   = 'assets/images/torch.png'
const TORCH_ICON_PX   = 40
const ICON_DIM        = Color4.create(0.45, 0.45, 0.45, 1)

// Fuel indicator: same shape + inset trick as flagtag's DESKTOP ability
// button charge fill — a rounded rectangle anchored to the bottom of
// the slot whose HEIGHT scales with the value. Flagtag's charge grows
// from empty → full; ours does the inverse (starts full, drains as the
// torch burns) so the fill visibly shrinks toward the bottom of the slot.
const FUEL_INSET      = 6                                          // matches flagtag S(6)
const FUEL_COLOR_FULL = Color4.create(1.00, 0.75, 0.30, 0.55)      // warm gold at high fuel
const FUEL_COLOR_LOW  = Color4.create(1.00, 0.40, 0.15, 0.75)      // ember orange as fuel runs out


// MARK: HotbarLayer
/**
 * Bottom-center hotbar. Currently one slot (E: Torch). Hidden entirely
 * when the local player has no equippable items.
 */
class HotbarLayer extends Layer {
	constructor() {
		super({
			id  : 'hotbar',
			zone: ZoneType.TopCenter,
		})
	}

	body() {
		if (!isTorchEquipped()) return <UiEntity key="ui_Hotbar_empty" />

		const lit         = isTorchLit()
		const raised      = isTorchRaised()
		const highlight   = lit || raised
		// Border stays a constant WIDTH so the inner content area doesn't
		// shift when it appears (a lit-vs-unlit toggle would otherwise
		// re-centre the fuel fill by 2px each way). Only the COLOUR changes:
		// transparent when idle, warm amber when lit / raised.
		const border      = highlight ? SLOT_BORDER_ON : Color4.create(0, 0, 0, 0)
		const iconTint    = lit ? colors.light : ICON_DIM
		const fuelFrac    = Math.max(0, Math.min(1, getTorchFuelFraction()))
		// Pixel height of the fuel fill. The slot has a 2px border, so the
		// inner content box is (SLOT_SIZE - 4) tall. Subtract FUEL_INSET on
		// both top and bottom to keep the fill visually centred at full.
		const SLOT_BORDER_W = 2
		const fuelHeightMax = SLOT_SIZE - SLOT_BORDER_W * 2 - FUEL_INSET * 2
		const fuelHeightPx  = Math.round(fuelHeightMax * fuelFrac)
		// Shift toward ember-orange when fuel drops below ~25 % — gives
		// the same "warning" feedback as flagtag's peak-charge gold flash,
		// but on the way DOWN instead of UP.
		const fuelColor   = fuelFrac < 0.25 ? FUEL_COLOR_LOW : FUEL_COLOR_FULL

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
					// Align vertically with the action bar (spectator / mute).
					// Action bar uses margin.top of 32 (desktop) / 4 (mobile);
					// hotbar sits one row down when the zone stacks vertically,
					// so keep a matching top margin here.
					margin         : { top: isMobile() ? 4 : 32 },
				}}
				uiBackground = {{ color: SLOT_BG }}
			>
				{/* Fuel fill — inset rounded rectangle anchored to the bottom.
				   Height percent shrinks as fuel drains, so the fill visibly
				   sinks. Same anchoring trick flagtag uses for its charge
				   fill; inverse direction (drain instead of build). Only
				   shown while the torch is lit. */}
				{lit && fuelFrac > 0 ? (
					<UiEntity
						key         = "ui_Hotbar_fuelFill"
						uiTransform = {{
							positionType: 'absolute',
							position    : { bottom: FUEL_INSET, left: FUEL_INSET, right: FUEL_INSET },
							height      : fuelHeightPx,
							borderRadius: borderRadius.sm,
						}}
						uiBackground = {{ color: fuelColor }}
					/>
				) : null}


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

			</UiEntity>
		)
	}
}


export const hotbarLayer = new HotbarLayer()
