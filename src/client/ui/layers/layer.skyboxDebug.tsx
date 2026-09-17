/**
 * layer.skyboxDebug.tsx \u2014 dev-only readout of the day/night cycle
 * diagnostic sampler.
 *
 * Gated behind devFlags.SHOW_SKYBOX_DEBUG. Reads the latest sample
 * from src/client/skyboxDebug.ts and displays:
 *
 *   RUNTIME   HH:MM:SS   getWorldTime().seconds  (what engine renders)
 *   WRITTEN   HH:MM:SS   last fixedTime we wrote (or "\u2014" if unlocked)
 *   DELTA     \u00b1seconds   runtime - written        (divergence check)
 *   LOCKED    yes / NO   SkyboxTime present on RootEntity
 *   NOW       ms         Date.now() at sample time
 *
 * Purpose: two dev browsers side-by-side let you eyeball whether all
 * clients see the same sky (goal 1: locked + identical) and whether
 * per-frame writes are actually landing (delta should be tiny;
 * a large drift means the engine\u2019s smooth transition is fighting us).
 *
 * Positioned top-right \u2014 same corner as torch-warmth-debug because
 * only one dev overlay is typically on at a time.
 */

import { TransitionMode }     from '@dcl/sdk/ecs'
import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import {
	CYCLE_REAL_SECONDS,
	DUSK_END,
	DUSK_START,
	FULL_DAY,
}                                               from 'src/client/skybox'
import { formatSeconds, getLatestSkyboxSample } from 'src/client/skyboxDebug'
import { UI_THEME }                             from 'src/client/ui/theme/settings'


const { colors, fontSizes, borderRadius, spacing } = UI_THEME


// MARK: Layout
const ROW_HEIGHT  = 18
const LABEL_WIDTH = 80
const VALUE_WIDTH = 200
const PANEL_WIDTH = LABEL_WIDTH + VALUE_WIDTH + 16


// MARK: SkyboxDebugLayer
class SkyboxDebugLayer extends Layer {
	constructor() {
		super({
			id  : 'skyboxDebug',
			zone: ZoneType.TopLeft,
		})
	}

	body() {
		const s = getLatestSkyboxSample()

		const delta =
			s.runtimeSeconds !== null && s.writtenSeconds !== null
				? s.runtimeSeconds - s.writtenSeconds
				: null

		const deltaStr =
			delta === null
				? '\u2014'
				: (delta >= 0 ? '+' : '') + delta.toFixed(1) + 's'

		// Colour the delta so drift jumps out: green under 2s, amber
		// under 30s, red beyond. Values are seconds of skybox-time
		// mismatch between what we asked for and what the engine
		// reports.
		const deltaAbs = delta === null ? 0 : Math.abs(delta)
		const deltaColor =
			delta === null       ? { r: 0.65, g: 0.65, b: 0.70, a: 1 } :
			deltaAbs < 2         ? { r: 0.55, g: 0.95, b: 0.55, a: 1 } :
			deltaAbs < 30        ? { r: 1.00, g: 0.80, b: 0.35, a: 1 } :
			                       { r: 1.00, g: 0.45, b: 0.45, a: 1 }

		const lockedColor =
			s.locked ? { r: 0.55, g: 0.95, b: 0.55, a: 1 }
			         : { r: 1.00, g: 0.45, b: 0.45, a: 1 }

		// Configured cycle summary. We don’t have separate day/night
		// durations yet — skybox.ts sweeps a single slice with a triangle
		// wave. Show real-time round-trip + which skybox range it covers.
		// When the phase clock lands this row will split into DAY/NIGHT.
		const cycleMin  = (CYCLE_REAL_SECONDS / 60).toFixed(1)
		const rangeStr  = FULL_DAY
			? '00:00→24:00'
			: `${formatHHMM(DUSK_START)}→${formatHHMM(DUSK_END)}`
		const cycleStr  = `${cycleMin}m ${rangeStr}`

		const modeStr =
			s.mode === null                      ? '—'    :
			s.mode === TransitionMode.TM_FORWARD ? 'FWD'  :
			                                       'BWD'
		const modeColor =
			s.mode === null                      ? { r: 0.65, g: 0.65, b: 0.70, a: 1 } :
			s.mode === TransitionMode.TM_FORWARD ? { r: 0.55, g: 0.85, b: 0.95, a: 1 } :
			                                       { r: 0.95, g: 0.65, b: 0.95, a: 1 }

		return (
			<UiEntity
				uiTransform = {{
					width        : PANEL_WIDTH,
					padding      : spacing.sm,
					margin       : { top: 8, left: 8 },
					borderRadius : borderRadius.sm,
					flexDirection: 'column',
					pointerFilter: 'none',
				}}
				uiBackground = {{ color: colors.statsBg }}
			>
				<Row label = "CYCLE"    value = {cycleStr}                        />
				<Row label = "RUNTIME"  value = {formatSeconds(s.runtimeSeconds)} />
				<Row label = "WRITTEN"  value = {formatSeconds(s.writtenSeconds)} />
				<Row label = "DELTA"    value = {deltaStr}                        valueColor = {deltaColor} />
				<Row label = "TRANS"    value = {modeStr}                         valueColor = {modeColor} />
				<Row label = "WRITES/s" value = {s.writesPerSec.toFixed(2)}       />
				<Row label = "LOCKED"   value = {s.locked ? 'yes' : 'NO'}         valueColor = {lockedColor} />
				<Row label = "TICK"     value = {`${s.tick}`}                     />
			</UiEntity>
		)
	}
}


// MARK: Row
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


// MARK: formatHHMM
// Skybox-seconds → "HH:MM" (no seconds). Used for the CYCLE range
// summary where we don’t need per-second precision.
function formatHHMM(sec: number): string {
	const s = ((sec % 86400) + 86400) % 86400
	const h = Math.floor(s / 3600)
	const m = Math.floor((s % 3600) / 60)
	const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
	return `${pad(h)}:${pad(m)}`
}


export const skyboxDebugLayer = new SkyboxDebugLayer()
