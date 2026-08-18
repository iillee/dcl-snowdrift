/**
 * layer.version.tsx \u2014 bottom-right build version chip.
 *
 * DUCK Layer wrapper; the actual chip content is unchanged. Zone handles
 * corner placement + safe-area insets, so no manual absolute positioning.
 */

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { UI_THEME } from 'src/client/ui/theme/settings'
import { VERSION } from 'src/shared/data/version'


const { colors, fontSizes, borderRadius } = UI_THEME


// MARK: VersionLayer
/**
 * Compact version chip pinned to the bottom-right of the screen.
 */
class VersionLayer extends Layer {
	constructor() {
		super({
			id  : 'version',
			zone: ZoneType.BottomRight,
		})
	}

	body() {
		return (
			<UiEntity
				key         = "ui_Version_root"
				uiTransform = {{
					width       : 'auto',
					height      : 24,
					borderRadius: borderRadius.sm,
					padding     : { right: 4, left: 4 },
				}}
				uiText = {{
					value    : VERSION,
					fontSize : fontSizes.md,
					color    : colors.versionFg,
					textAlign: 'middle-center',
				}}
				uiBackground = {{
					color: colors.versionBg,
				}}
			/>
		)
	}
}


export const versionLayer = new VersionLayer()
