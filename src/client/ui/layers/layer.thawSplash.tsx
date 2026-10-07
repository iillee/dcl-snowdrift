/**
 * layer.thawSplash.tsx — "WORLD THAWED" victory title.
 */

import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { getThawSplashOpacity, getThawSplashText } from 'src/client/thawSplash'
import { UI_THEME } from 'src/client/ui/theme/settings'


const { fontSizes } = UI_THEME
const GOLD = Color4.create(1.00, 0.85, 0.35, 1)


class ThawSplashLayer extends Layer {
	constructor() {
		super({
			id  : 'thawSplash',
			zone: ZoneType.FullScreen,
		})
	}

	body() {
		const textA = getThawSplashOpacity()
		const line  = getThawSplashText()
		if (textA <= 0 || line === '') {
			return <UiEntity key="ui_ThawSplash_hidden" uiTransform={{ display: 'none' }} />
		}

		return (
			<UiEntity
				key         = "ui_ThawSplash_root"
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
					key         = "ui_ThawSplash_lineWrap"
					uiTransform = {{
						width         : '90%',
						height        : 140,
						alignItems    : 'center',
						justifyContent: 'center',
						margin        : { bottom: '14%' },
						opacity       : textA,
					}}
				>
					<Label
						value     = {line}
						fontSize  = {fontSizes.hero}
						color     = {GOLD}
						font      = "sans-serif"
						textAlign = "middle-center"
						uiTransform = {{ width: '100%', height: 140 }}
					/>
				</UiEntity>
			</UiEntity>
		)
	}
}

export const thawSplashLayer = new ThawSplashLayer()
