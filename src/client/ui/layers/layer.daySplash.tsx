/**
 * layer.daySplash.tsx — sunrise "Day X" title over the world.
 *
 * Opacity comes from daySplash.ts. Uses uiTransform.opacity because
 * Explorer ignores Label color alpha. Hidden when idle so clicks
 * pass through to the world.
 *
 * Weight is two overlapping labels, not `<b>`: Explorer draws digits
 * from a gray fallback font inside bold markup.
 */

import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { getDaySplashOpacity, getDaySplashText } from 'src/client/daySplash'
import { FakeBoldLabel } from 'src/client/ui/components/fakeBoldLabel'
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
						margin        : { bottom: '14%' },
						opacity       : textA,
					}}
				>
					<FakeBoldLabel
						id       = "ui_DaySplash_line"
						value    = {line}
						fontSize = {fontSizes.hero}
						color    = {GOLD}
						height   = {140}
						offsetPx = {2}
					/>
				</UiEntity>
			</UiEntity>
		)
	}
}


export const daySplashLayer = new DaySplashLayer()
