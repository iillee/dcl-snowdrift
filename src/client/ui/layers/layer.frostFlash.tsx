/**
 * layer.frostFlash.tsx — full-screen blue tint that pulses each time
 * the frost bar gains a new blue segment.
 *
 * Alpha is driven by getFrostFlashAlpha() from src/client/frost/frostFlash.
 * When alpha is zero this layer renders an invisible pass-through, so
 * pointer events fall through to the game unobstructed.
 *
 * Sits above HUD chrome but BELOW the death fade and loading splash
 * (both of which fully cover the screen anyway) — see
 * src/client/ui/index.tsx for the layer stacking order.
 *
 * Oversized + negative offset so the tint bleeds past the platform's
 * safe-area border and covers the whole physical screen — same trick
 * flagtag's hit flash uses.
 */

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { getFrostFlashAlpha } from 'src/client/frost/frostFlash'


// MARK: Palette
// Cold blue chosen to match the frost bar's COL_COLD (0.42, 0.60, 0.98)
// so the on-screen pulse and the bar's ice fill speak the same visual
// language. Slightly desaturated in the R channel for a colder, less
// cheerful tint at full alpha.
const FLASH_COLOR = { r: 0.35, g: 0.55, b: 0.95 }


// MARK: FrostFlashLayer
class FrostFlashLayer extends Layer {
	constructor() {
		super({
			id  : 'frostFlash',
			zone: ZoneType.FullScreen,
		})
	}


	// MARK: body
	body() {
		const alpha = getFrostFlashAlpha()
		if (alpha <= 0) return <UiEntity key="ui_FrostFlash_hidden" uiTransform={{ display: 'none' }} />

		return (
			<UiEntity
				key         = "ui_FrostFlash_root"
				uiTransform = {{
					positionType: 'absolute',
					position    : { top: '-10%', left: '-10%' },
					width       : '120%',
					height      : '120%',
					// Never eat clicks — this is atmospheric, not modal.
					pointerFilter: 'none',
				}}
				uiBackground = {{ color: Color4.create(FLASH_COLOR.r, FLASH_COLOR.g, FLASH_COLOR.b, alpha) }}
			/>
		)
	}
}


export const frostFlashLayer = new FrostFlashLayer()
