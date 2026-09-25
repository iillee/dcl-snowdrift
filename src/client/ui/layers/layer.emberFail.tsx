/**
 * layer.emberFail.tsx — full-screen game-over cards when the last fire dies.
 *
 * World opacity and title-card opacity come from the emberFail FSM.
 * Title alpha is applied via uiTransform.opacity — Label color alpha
 * is ignored by Explorer, which is why a previous fade looked stuck.
 * Idle is a hidden pass-through so pointer events keep hitting the world.
 */

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import {
	getEmberFailText,
	getEmberFailTextOpacity,
	getEmberFailWorldOpacity,
} from 'src/client/emberFail'
import { UI_THEME } from 'src/client/ui/theme/settings'


const { fontSizes } = UI_THEME


// MARK: EmberFailLayer
class EmberFailLayer extends Layer {
	constructor() {
		super({
			id  : 'emberFail',
			zone: ZoneType.FullScreen,
		})
	}


	// MARK: body
	body() {
		const worldA = getEmberFailWorldOpacity()
		const textA  = getEmberFailTextOpacity()
		const line   = getEmberFailText()
		if (worldA <= 0 && textA <= 0) {
			return <UiEntity key="ui_EmberFail_hidden" uiTransform={{ display: 'none' }} />
		}

		return (
			<UiEntity
				key         = "ui_EmberFail_root"
				uiTransform = {{
					width         : '100%',
					height        : '100%',
					alignItems    : 'center',
					justifyContent: 'center',
					flexDirection : 'column',
					pointerFilter : 'none',
				}}
				uiBackground = {{ color: Color4.create(0, 0, 0, worldA) }}
			>
				{textA > 0 && line !== '' && (
					<UiEntity
						key         = "ui_EmberFail_lineWrap"
						uiTransform = {{
							width         : '84%',
							height        : 80,
							alignItems    : 'center',
							justifyContent: 'center',
							opacity       : textA,
						}}
					>
						<Label
							key      = "ui_EmberFail_line"
							value    = {line}
							fontSize = {fontSizes.display}
							color    = {Color4.White()}
							font     = "sans-serif"
							textAlign= "middle-center"
							uiTransform = {{ width: '100%', height: 80 }}
						/>
					</UiEntity>
				)}
			</UiEntity>
		)
	}
}


export const emberFailLayer = new EmberFailLayer()
