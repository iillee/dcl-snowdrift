/**
 * layer.torchWarmthDebug.tsx — dev-only readout of the local torch's
 * cluster warmth state.
 *
 * Gated behind devFlags.SHOW_TORCH_WARMTH_DEBUG. Meant to be used when
 * playtesting warmth-together solo with two accounts — the readout
 * confirms the mechanic fired without needing to watch both avatars'
 * flames simultaneously across two windows.
 *
 * Displays:
 *   TIER    0 / 1 / 2   (solo / paired / cluster)
 *   RADIUS  meters      (current warmth-disc radius)
 *   NEARBY  count       (other lit torches within CLUSTER_PROXIMITY_M)
 *   TOTAL   count       (all lit torches in scene, local + remote)
 *
 * Positioned top-right — top-left was covered by the native mobile
 * comms/minimap chrome, top-center is the action bar, bottom-center
 * is the frost bar, bottom-right is the version chip. Top-right is
 * the only corner left clear on both platforms.
 */

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { getTorchWarmthDebugInfo } from 'src/client/torchWarmth'
import { UI_THEME }                from 'src/client/ui/theme/settings'


const { colors, fontSizes, borderRadius, spacing } = UI_THEME


// MARK: rowStyle
// Shared inline style for each metric row. Kept local; too small to
// warrant a components/ export.
const ROW_HEIGHT    = 18
const LABEL_WIDTH   = 68
const VALUE_WIDTH   = 60
const PANEL_WIDTH   = LABEL_WIDTH + VALUE_WIDTH + 16


// MARK: TorchWarmthDebugLayer
class TorchWarmthDebugLayer extends Layer {
	constructor() {
		super({
			id  : 'torchWarmthDebug',
			zone: ZoneType.TopRight,
		})
	}

	body() {
		const info = getTorchWarmthDebugInfo()

		// Tint the tier value so it reads at a glance across windows:
		// solo = neutral, paired = warm, cluster = bright warm gold.
		// Inline colors — dev-only layer, not worth extending the theme.
		const tierColor =
			info.localTier === 2 ? { r: 1.00, g: 0.75, b: 0.30, a: 1 } :
			info.localTier === 1 ? { r: 1.00, g: 0.90, b: 0.55, a: 1 } :
			                       { r: 0.85, g: 0.85, b: 0.90, a: 1 }

		return (
			<UiEntity
				uiTransform = {{
					width        : PANEL_WIDTH,
					padding      : spacing.sm,
					margin       : { top: 8, right: 8 },
					borderRadius : borderRadius.sm,
					flexDirection: 'column',
					pointerFilter: 'none',
				}}
				uiBackground = {{ color: colors.statsBg }}
			>
				<Row label = "TIER"   value = {`${info.localTier}`}                        valueColor = {tierColor} />
				<Row label = "RADIUS" value = {`${info.localRadius.toFixed(1)}m`}          />
				<Row label = "NEARBY" value = {`${info.nearbyLit}`}                        />
				<Row label = "TOTAL"  value = {`${info.totalLit}${info.localLit ? '' : ' *'}`} />
			</UiEntity>
		)
	}
}


// MARK: Row
// Small label/value pair. Extracted so all four rows share layout and
// the file stays scannable. Local component — not worth a components/
// export for a dev-only layer.
interface RowProps {
	label      : string
	value      : string
	valueColor?: { r: number, g: number, b: number, a: number }
}
function Row({ label, value, valueColor }: RowProps) {
	return (
		<UiEntity
			uiTransform = {{
				width        : '100%',
				height       : ROW_HEIGHT,
				flexDirection: 'row',
				alignItems   : 'center',
			}}
		>
			<UiEntity
				uiTransform = {{ width: LABEL_WIDTH, height: ROW_HEIGHT }}
				uiText      = {{
					value    : label,
					fontSize : fontSizes.sm ?? 12,
					color    : { r: 0.65, g: 0.65, b: 0.70, a: 1 },
					textAlign: 'middle-left',
				}}
			/>
			<UiEntity
				uiTransform = {{ width: VALUE_WIDTH, height: ROW_HEIGHT }}
				uiText      = {{
					value    : value,
					fontSize : fontSizes.sm ?? 12,
					color    : valueColor ?? { r: 0.95, g: 0.95, b: 0.95, a: 1 },
					textAlign: 'middle-right',
				}}
			/>
		</UiEntity>
	)
}


export const torchWarmthDebugLayer = new TorchWarmthDebugLayer()
