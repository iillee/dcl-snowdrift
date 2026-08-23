/**
 * layer.inventoryHotbar.tsx - bottom-center hotbar hosting the two
 * inventory slots (Torch on the left, Wood on the right).
 *
 * Previously both slots were tacked onto the top-center frost bar row
 * (see layer.frostBar.tsx history). Moving them to a dedicated bottom
 * hotbar keeps the top HUD focused on status (frost, clock, mute) and
 * matches the classic "action bar at the bottom" convention players
 * expect from survival/exploration games.
 *
 * The button components themselves (TorchButton, LogsButton) still
 * live in layer.brushSize.tsx - this file only owns placement.
 */

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { isMobile }           from '@dcl/sdk/platform'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { isTorchEquipped }              from 'src/client/torchEquip'
import { LogsButton, TorchButton }      from 'src/client/ui/layers/layer.brushSize'


/** Distance from the bottom edge of the safe area. Lifted enough on
 *  desktop to clear the chat bar; mobile leaves room for the touch
 *  joystick + native gamepad slots above the OS home indicator. */
const MARGIN_BOTTOM_DT = 30
const MARGIN_BOTTOM_MB = 80


// MARK: InventoryHotbarLayer
class InventoryHotbarLayer extends Layer {
	constructor() {
		super({
			id  : 'inventoryHotbar',
			zone: ZoneType.BottomCenter,
		})
	}

	// MARK: body
	body() {
		const bottom = isMobile() ? MARGIN_BOTTOM_MB : MARGIN_BOTTOM_DT

		return (
			<UiEntity
				key         = "ui_InventoryHotbar_root"
				uiTransform = {{
					flexDirection : 'row',
					alignItems    : 'center',
					justifyContent: 'center',
					margin        : { bottom },
				}}
			>
				{/* Torch slot only appears once the player has picked up a
				   torch - matches the previous frost-bar behaviour so an
				   empty slot doesn't loiter before the first pickup. */}
				{isTorchEquipped() && <TorchButton />}
				<LogsButton />
			</UiEntity>
		)
	}
}


export const inventoryHotbarLayer = new InventoryHotbarLayer()
