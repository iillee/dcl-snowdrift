/**
 * layer.frostFlash.tsx — full-screen tint that pulses with the heat bar.
 *
 * Blue when a cold segment fills. Gold, the same yellow as the warm
 * blocks, when a segment thaws back beside a fire.
 *
 * Alpha comes from getFrostFlashAlpha() and getWarmFlashAlpha() in
 * src/client/frost/frostFlash.
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

import { getFrostFlashAlpha, getWarmFlashAlpha } from 'src/client/frost/frostFlash'


// MARK: Palette
// Cold blue chosen to match the frost bar's COL_COLD (0.42, 0.60, 0.98)
// so the on-screen pulse and the bar's ice fill speak the same visual
// language. Slightly desaturated in the R channel for a colder, less
// cheerful tint at full alpha.
const FLASH_COLOR = { r: 0.35, g: 0.55, b: 0.95 }
// Same gold as COL_WARM on the heat bar (1.00, 0.80, 0.30).
const WARM_COLOR  = { r: 1.00, g: 0.80, b: 0.30 }


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
		const cold = getFrostFlashAlpha()
		const warm = getWarmFlashAlpha()
		if (cold <= 0 && warm <= 0) {
			return <UiEntity key="ui_FrostFlash_hidden" uiTransform={{ display: 'none' }} />
		}

		return (
			<UiEntity
				key         = "ui_FrostFlash_root"
				uiTransform = {{
					width        : '100%',
					height       : '100%',
					pointerFilter: 'none',
				}}
			>
				<UiEntity
					key         = "ui_FrostFlash_warm"
					uiTransform = {{
						display      : warm > 0 ? 'flex' : 'none',
						positionType : 'absolute',
						position     : { top: '-10%', left: '-10%' },
						width        : '120%',
						height       : '120%',
						pointerFilter: 'none',
					}}
					uiBackground = {{ color: Color4.create(WARM_COLOR.r, WARM_COLOR.g, WARM_COLOR.b, warm) }}
				/>
				<UiEntity
					key         = "ui_FrostFlash_cold"
					uiTransform = {{
						display      : cold > 0 ? 'flex' : 'none',
						positionType : 'absolute',
						position     : { top: '-10%', left: '-10%' },
						width        : '120%',
						height       : '120%',
						pointerFilter: 'none',
					}}
					uiBackground = {{ color: Color4.create(FLASH_COLOR.r, FLASH_COLOR.g, FLASH_COLOR.b, cold) }}
				/>
			</UiEntity>
		)
	}
}


export const frostFlashLayer = new FrostFlashLayer()
