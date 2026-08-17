/**
 * layer.brushSize.tsx — bottom-center +/- buttons that grow or shrink the
 * local player's paint brush footprint.
 *
 * Sits just to the left of the CameraToggle button, using the same
 * visual language (dark square panel, centered glyph, gold on hover).
 * The current brush size is rendered as a small label between the two
 * buttons so the player has feedback while tapping.
 */

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

import {
	BRUSH_MAX_CELLS,
	BRUSH_MIN_CELLS,
	decreaseBrush,
	getBrushCells,
	increaseBrush,
} from 'src/client/brush'
import { isMusicMuted, toggleMusic } from 'src/client/audio'
import { isTopDownActive, toggleTopDownCamera } from 'src/client/topDownCamera'
import { toggleServerStats } from 'src/client/ui/layers/layer.serverStats'
import { UI_THEME } from 'src/client/ui/theme/settings'


const { colors, fontSizes, borderRadius } = UI_THEME

const WHITE     = Color4.White()
const DIM       = Color4.create(1, 1, 1, 0.35)
const GOLD      = Color4.create(1.0, 0.84, 0.0, 1)
const PANEL_BG  = colors.statsBg

// Shared button footprint so every action button in the bar looks identical.
const BTN_SIZE       = 72
const BTN_MARGIN_X   = 8   // horizontal breathing room per-button (left + right)

// Parcel-grid icon inside the spectator button.
const GRID_COLS = 4
const GRID_ROWS = 2
const CELL_SIZE = 9
const CELL_GAP  = 2


// MARK: ParcelGridIcon
function ParcelGridIcon(props: { color: Color4 }) {
	const rows: any[] = []
	for (let r = 0; r < GRID_ROWS; r++) {
		const cells: any[] = []
		for (let c = 0; c < GRID_COLS; c++) {
			cells.push(
				<UiEntity
					key = {`gridCell_${r}_${c}`}
					uiTransform = {{
						width : CELL_SIZE,
						height: CELL_SIZE,
						margin: { left: c === 0 ? 0 : CELL_GAP },
					}}
					uiBackground = {{ color: props.color }}
				/>
			)
		}
		rows.push(
			<UiEntity
				key = {`gridRow_${r}`}
				uiTransform = {{
					flexDirection: 'row',
					margin       : { top: r === 0 ? 0 : CELL_GAP },
				}}
			>
				{cells}
			</UiEntity>
		)
	}
	return (
		<UiEntity
			key = "ui_ParcelGridIcon"
			uiTransform = {{ flexDirection: 'column', alignItems: 'center' }}
		>
			{rows}
		</UiEntity>
	)
}


// MARK: BrushButton
/**
 * A single square icon button. `enabled = false` renders it dimmed and
 * ignores clicks so the player sees min/max clamping.
 */
function BrushButton(props: {
	label     : string
	onClick   : () => void
	enabled   : boolean
	keySuffix : string
	/** Optional glyph size override (default 64) */
	fontSize? : number
	/** Optional optical-nudge overrides (defaults tuned for +/- glyphs) */
	nudgeTop? : number
	nudgeLeft?: number
}) {
	const fontSize  = props.fontSize  ?? 64
	// Mobile needs a stronger optical-nudge — the DCL system chrome and the
	// portrait viewport push the glyph baseline lower than on desktop.
	const defaultNudgeTop = isMobile() ? -22 : -10
	const nudgeTop  = props.nudgeTop  ?? defaultNudgeTop
	const nudgeLeft = props.nudgeLeft ?? 4
	return (
		<UiEntity
			key         = {`ui_BrushBtn_${props.keySuffix}`}
			uiTransform = {{
				width        : BTN_SIZE,
				height       : BTN_SIZE,
				margin       : { left: BTN_MARGIN_X, right: BTN_MARGIN_X },
				justifyContent: 'center',
				alignItems   : 'center',
				borderRadius : borderRadius.md,
			}}
			uiBackground = {{ color: PANEL_BG }}
			onMouseDown  = {props.enabled ? props.onClick : () => {}}
		>
			<Label
				value    = {props.label}
				fontSize = {fontSize}
				color    = {props.enabled ? WHITE : DIM}
				font     = "sans-serif"
				textAlign= "middle-center"
				uiTransform = {{
					width : '100%',
					height: '100%',
					// Optical-nudge for glyph baseline / kerning quirks.
					margin: { top: nudgeTop, left: nudgeLeft },
				}}
			/>
		</UiEntity>
	)
}


// MARK: BrushSizeLayer
/**
 * Right-edge, vertically stacked +/- brush size controls. Anchored to
 * the middle-right of the screen with + on top, - beneath.
 */
export function BrushSizeLayer() {
	const size       = getBrushCells()
	const canDec     = size > BRUSH_MIN_CELLS
	const canInc     = size < BRUSH_MAX_CELLS
	const specActive = isTopDownActive()

	return (
		<UiEntity
			key = "ui_BrushSize_wrap"
			uiTransform = {{
				width        : '100%',
				height       : '100%',
				positionType : 'absolute',
				position     : { top: 0, left: 0 },
				flexDirection: 'column',
				justifyContent: 'flex-start',
				alignItems   : 'center',
				pointerFilter: 'none',
			}}
		>
			<UiEntity
				key = "ui_BrushSize_row"
				uiTransform = {{
					margin       : { top: isMobile() ? -40 : 32 },
					flexDirection: 'row',
					alignItems   : 'center',
					justifyContent: 'center',
				}}
			>
				<BrushButton
					label     = "+"
					onClick   = {increaseBrush}
					enabled   = {canInc}
					keySuffix = "inc"
				/>
				<BrushButton
					label     = "-"
					onClick   = {decreaseBrush}
					enabled   = {canDec}
					keySuffix = "dec"
				/>
				<UiEntity
					key = "ui_SpectatorBtn"
					uiTransform = {{
						width        : BTN_SIZE,
						height       : BTN_SIZE,
						margin       : { left: BTN_MARGIN_X, right: BTN_MARGIN_X },
						justifyContent: 'center',
						alignItems   : 'center',
						borderRadius : borderRadius.md,
					}}
					uiBackground = {{ color: PANEL_BG }}
					onMouseDown  = {toggleTopDownCamera}
				>
					<ParcelGridIcon color={specActive ? GOLD : WHITE} />
				</UiEntity>
				<BrushButton
					label     = "#"
					onClick   = {toggleServerStats}
					enabled   = {true}
					keySuffix = "stats"
					nudgeTop  = {isMobile() ? -14 : -2}
				/>
				<UiEntity
					key = "ui_MuteBtn"
					uiTransform = {{
						width        : BTN_SIZE,
						height       : BTN_SIZE,
						margin       : { left: BTN_MARGIN_X, right: BTN_MARGIN_X },
						justifyContent: 'center',
						alignItems   : 'center',
						borderRadius : borderRadius.md,
					}}
					uiBackground = {{ color: PANEL_BG }}
					onMouseDown  = {toggleMusic}
				>
					<UiEntity
						key = "ui_MuteBtn_icon"
						uiTransform = {{ width: 44, height: 44 }}
						uiBackground = {{
							textureMode: 'stretch',
							texture    : { src: isMusicMuted() ? 'assets/images/muted.png' : 'assets/images/unmute.png' },
						}}
					/>
				</UiEntity>
			</UiEntity>
		</UiEntity>
	)
}


// MARK: PaintSwatchButton (unused)
// Kept for reference — revive if Snow Drift ever needs a visible "current
// hand slot" indicator in the top bar.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _PaintSwatchButton(props: {
	keySuffix: string
	color    : Color4 | null
	onClick  : () => void
}) {
	const SWATCH_PX = 40
	return (
		<UiEntity
			key         = {`ui_SwatchBtn_${props.keySuffix}`}
			uiTransform = {{
				width        : BTN_SIZE,
				height       : BTN_SIZE,
				margin       : { left: BTN_MARGIN_X, right: BTN_MARGIN_X },
				justifyContent: 'center',
				alignItems   : 'center',
				borderRadius : borderRadius.md,
			}}
			uiBackground = {{ color: PANEL_BG }}
			onMouseDown  = {props.onClick}
		>
			{props.color ? (
				<UiEntity
					key = {`ui_SwatchDot_${props.keySuffix}`}
					uiTransform = {{
						width : SWATCH_PX,
						height: SWATCH_PX,
						borderRadius: SWATCH_PX / 2,
					}}
					uiBackground = {{ color: props.color }}
				/>
			) : null}
		</UiEntity>
	)
}
