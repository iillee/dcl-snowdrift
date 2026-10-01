/**
 * fakeBoldLabel.tsx — two overlapping labels to fake a bold weight.
 *
 * SDK7 Label has no fontWeight, and `<b>` markup draws digits from a
 * gray fallback font. Offset the second copy instead.
 */

import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { Label, UiEntity, UiTransformProps } from '@dcl/sdk/react-ecs'


// MARK: FakeBoldLabel

/**
 * Gold (or any color) text that reads as bold without `<b>` markup.
 * `offsetPx` is 1 for HUD type and 2 for the sunrise hero line.
 */
export function FakeBoldLabel({
	id,
	value,
	fontSize,
	color,
	font     = 'sans-serif',
	height,
	offsetPx = 1,
	uiTransform,
}: {
	id          : string
	value       : string
	fontSize    : number
	color       : Color4
	font?       : 'serif' | 'sans-serif' | 'monospace'
	height      : number
	offsetPx?   : number
	uiTransform?: UiTransformProps
}) {
	return (
		<UiEntity
			key         = {`${id}_wrap`}
			uiTransform = {{
				width       : '100%',
				height,
				positionType: 'relative',
				...uiTransform,
			}}
		>
			<Label
				key      = {`${id}_a`}
				value    = {value}
				fontSize = {fontSize}
				color    = {color}
				font     = {font}
				textAlign= "middle-center"
				uiTransform = {{
					width       : '100%',
					height,
					positionType: 'absolute',
					position    : { top: 0, left: 0 },
				}}
			/>
			<Label
				key      = {`${id}_b`}
				value    = {value}
				fontSize = {fontSize}
				color    = {color}
				font     = {font}
				textAlign= "middle-center"
				uiTransform = {{
					width       : '100%',
					height,
					positionType: 'absolute',
					position    : { top: offsetPx, left: offsetPx },
				}}
			/>
		</UiEntity>
	)
}
