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

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 }                    from '@dcl/sdk/math'
import { isMobile }                  from '@dcl/sdk/platform'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { isTorchEquipped }              from 'src/client/torchEquip'
import { LogsButton, TorchButton }      from 'src/client/ui/layers/layer.brushSize'
import { isGiveUpVisible, isItemInputBlocked, requestGiveUp } from 'src/client/frost/frozenState'
import { playUiClick }                  from 'src/client/audio'


/** Distance from the bottom edge of the safe area. Lifted enough on
 *  desktop to clear the chat bar; mobile leaves room for the touch
 *  joystick + native gamepad slots above the OS home indicator. */
const MARGIN_BOTTOM_DT = 30
// Mobile: pin to the very bottom of the safe area — the kit's
// ScreenInsetArea already handles the OS home-indicator inset, so 0
// here means "lowest visible row". The native touch joystick lives
// bottom-left and the on-screen action buttons bottom-right, leaving
// the bottom-centre strip free for the hotbar.
const MARGIN_BOTTOM_MB = 0

// "Give up and respawn" button: takes the E/F slots' place while frozen.
const GIVE_UP_BG     = Color4.create(0.13, 0.40, 0.85, 1)
const GIVE_UP_BORDER = Color4.create(1, 1, 1, 1)
const GIVE_UP_TEXT   = Color4.create(1, 1, 1, 1)
const GIVE_UP_W_DT   = 300
const GIVE_UP_H_DT   = 72
const GIVE_UP_W_MB   = 340
const GIVE_UP_H_MB   = 104
const GIVE_UP_BORDER_W = 3
const GIVE_UP_RADIUS   = 16


// MARK: GiveUpButton
/**
 * Plain Label text (no <b>): rich-text tags inside clickable elements
 * misalign mobile taps. The whole box takes the tap; F does the same
 * on desktop (handled in frost/death.ts).
 */
function GiveUpButton() {
	const mobile = isMobile()
	return (
		<UiEntity
			key         = "ui_GiveUp_btn"
			uiTransform = {{
				width         : mobile ? GIVE_UP_W_MB : GIVE_UP_W_DT,
				height        : mobile ? GIVE_UP_H_MB : GIVE_UP_H_DT,
				borderWidth   : GIVE_UP_BORDER_W,
				borderColor   : GIVE_UP_BORDER,
				borderRadius  : GIVE_UP_RADIUS,
				justifyContent: 'center',
				alignItems    : 'center',
			}}
			uiBackground = {{ color: GIVE_UP_BG }}
			onMouseDown  = {() => { playUiClick(); requestGiveUp() }}
		>
			<Label
				key       = "ui_GiveUp_label"
				value     = {mobile ? 'Give up and respawn' : 'Give up and respawn  [F]'}
				color     = {GIVE_UP_TEXT}
				fontSize  = {mobile ? 30 : 24}
				textAlign = "middle-center"
				uiTransform = {{ width: '100%', height: '100%' }}
			/>
		</UiEntity>
	)
}


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
		// Frozen: items are useless, so the E/F slots go away. From 5 s
		// in (and while a fire is lit) the give-up button takes their place.
		const frozen = isItemInputBlocked()
		const giveUp = frozen && isGiveUpVisible()

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
				{giveUp && <GiveUpButton />}
				{!frozen && isTorchEquipped() && <TorchButton />}
				{!frozen && <LogsButton />}
			</UiEntity>
		)
	}
}


export const inventoryHotbarLayer = new InventoryHotbarLayer()
