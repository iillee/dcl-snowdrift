/**
 * layer.torchButton.tsx — top-right home for the torch inventory slot.
 *
 * The frost bar now anchors top-center (see layer.frostBar). To keep
 * the torch out of that stack — and free the whole centre band for
 * the frost gauge on mobile, where torch was the sole action-bar
 * item — the torch button lives in its own TopRight layer.
 *
 * The button visuals are unchanged; this layer only owns placement.
 * Hidden entirely when the player doesn't have a torch equipped, so
 * the top-right corner stays clean during normal exploration.
 */

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { isMobile } from '@dcl/sdk/platform'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { isTorchEquipped } from 'src/client/torchEquip'
import { TorchButton }     from 'src/client/ui/layers/layer.brushSize'


// Placement offsets. Top margin is shared with layer.frostBar
// (BAR_TOP_*) so the torch slot and frost bar sit on the same
// y-baseline. Right margin is a small nudge off the safe-area edge.
// Top offset matches BAR_TOP_* in layer.frostBar and the ActionBarLayer
// margin in layer.brushSize so the torch slot, frost bar, and eye/mute
// buttons all sit on the same y-baseline as one HUD row.
const MARGIN_TOP_DT   = 32
const MARGIN_RIGHT_DT = 32
const MARGIN_TOP_MB   = 4
const MARGIN_RIGHT_MB = 8


// MARK: TorchButtonLayer
class TorchButtonLayer extends Layer {
	constructor() {
		super({
			id  : 'torchButton',
			zone: ZoneType.TopRight,
		})
	}

	body() {
		if (!isTorchEquipped()) return <UiEntity key="ui_TorchButtonLayer_hidden" />

		const top   = isMobile() ? MARGIN_TOP_MB   : MARGIN_TOP_DT
		const right = isMobile() ? MARGIN_RIGHT_MB : MARGIN_RIGHT_DT

		return (
			<UiEntity
				key = "ui_TorchButtonLayer_root"
				uiTransform = {{
					margin: { top, right },
				}}
			>
				<TorchButton />
			</UiEntity>
		)
	}
}


export const torchButtonLayer = new TorchButtonLayer()
