/**
 * layer.daySplash.tsx — sunrise "Day X" title over the world.
 *
 * Opacity comes from daySplash.ts. Uses uiTransform.opacity because
 * Explorer ignores Label color alpha. Hidden when idle so clicks
 * pass through to the world.
 */

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { getDaySplashOpacity, getDaySplashText } from 'src/client/daySplash'
import { UI_THEME } from 'src/client/ui/theme/settings'


const { fontSizes } = UI_THEME
const GOLD = Color4.create(1.00, 0.80, 0.30, 1)


// MARK: DaySplashLayer
class DaySplashLayer extends Layer {
	constructor() {
		super({
			id  : 'daySplash',
			zone: ZoneType.FullScreen,
		})
	}


	// MARK: body
	body() {
		const textA = getDaySplashOpacity()
		const line  = getDaySplashText()
		if (textA <= 0 || line === '') {
			return <UiEntity key="ui_DaySplash_hidden" uiTransform={{ display: 'none' }} />
		}

		return (
			<UiEntity
				key         = "ui_DaySplash_root"
				uiTransform = {{
					width         : '100%',
					height        : '100%',
					alignItems    : 'center',
					justifyContent: 'center',
					flexDirection : 'column',
					pointerFilter : 'none',
				}}
			>
				<UiEntity
					key         = "ui_DaySplash_lineWrap"
					uiTransform = {{
						width         : '90%',
						height        : 140,
						alignItems    : 'center',
						justifyContent: 'center',
						opacity       : textA,
					}}
				>
					<Label
						key      = "ui_DaySplash_line"
						value    = {`<b>${line}</b>`}
						fontSize = {fontSizes.hero}
						color    = {GOLD}
						font     = "sans-serif"
						textAlign= "middle-center"
						uiTransform = {{ width: '100%', height: 140 }}
					/>
				</UiEntity>
			</UiEntity>
		)
	}
}


export const daySplashLayer = new DaySplashLayer()
