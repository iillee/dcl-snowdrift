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
		const lines  = line === '' ? [] : line.split('\n')
		const lineH  = 56
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
				{textA > 0 && lines.length > 0 && (
					<UiEntity
						key         = "ui_EmberFail_lineWrap"
						uiTransform = {{
							width          : '84%',
							height         : lineH * lines.length,
							alignItems     : 'center',
							justifyContent : 'center',
							flexDirection  : 'column',
							opacity        : textA,
						}}
					>
						{lines.map((text, i) => (
							<Label
								key      = {`ui_EmberFail_line_${i}`}
								value    = {text}
								fontSize = {fontSizes.display}
								color    = {Color4.White()}
								font     = "sans-serif"
								textAlign= "middle-center"
								uiTransform = {{ width: '100%', height: lineH }}
							/>
						))}
					</UiEntity>
				)}
			</UiEntity>
		)
	}
}


export const emberFailLayer = new EmberFailLayer()
