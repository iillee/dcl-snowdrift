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

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import {
	BRUSH_MAX_CELLS,
	BRUSH_MIN_CELLS,
	decreaseBrush,
	getBrushCells,
	increaseBrush,
} from 'src/client/brush'
import { isMusicMuted, toggleMusic } from 'src/client/audio'
import { PrecipitationLevel, getPrecipitation } from 'src/client/snowfall'
import { isTopDownActive, toggleTopDownCamera } from 'src/client/topDownCamera'
import { toggleServerStats } from 'src/client/ui/layers/layer.serverStats'
import { room } from 'src/shared/messages'
import { UI_THEME } from 'src/client/ui/theme/settings'


const { colors, fontSizes, borderRadius } = UI_THEME

const WHITE     = Color4.White()
const DIM       = Color4.create(1, 1, 1, 0.35)
const GOLD      = Color4.create(1.0, 0.84, 0.0, 1)
const ICE_BLUE  = Color4.create(0.65, 0.85, 1.0, 1)
const DEEP_BLUE = Color4.create(0.40, 0.65, 1.0, 1)
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


// MARK: cyclePrecipitation
/**
 * Ask the server to advance ambient snowfall to the next level
 * (CLEAR → LIGHT → MEDIUM → HEAVY → CLEAR). Server broadcasts the new
 * state back so all connected clients update in lockstep. We do NOT
 * set the level locally here — doing so would create a brief
 * client/server mismatch until the broadcast arrives.
 */
function cyclePrecipitation(): void {
	const next = ((getPrecipitation() + 1) % 4) as PrecipitationLevel
	room.send('weatherRequest', { level: next })
}


// MARK: precipitationIconColor
/** Icon tint used to signal the current precipitation level at a glance. */
function precipitationIconColor(level: PrecipitationLevel): Color4 {
	switch (level) {
		case PrecipitationLevel.CLEAR : return DIM
		case PrecipitationLevel.LIGHT : return WHITE
		case PrecipitationLevel.MEDIUM: return ICE_BLUE
		case PrecipitationLevel.HEAVY : return DEEP_BLUE
	}
}


// MARK: ActionBarLayer
/**
 * Top-center action bar: +/- brush, spectator toggle, stats toggle, mute.
 * Zone handles top placement + safe-area insets; only the mobile-vs-
 * desktop margin nudge is preserved.
 */
class ActionBarLayer extends Layer {
	constructor() {
		super({
			id  : 'actionBar',
			zone: ZoneType.TopCenter,
		})
	}

	body() {
		const size       = getBrushCells()
		const canDec     = size > BRUSH_MIN_CELLS
		const canInc     = size < BRUSH_MAX_CELLS
		const specActive = isTopDownActive()

		return (
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
				<BrushButton
					label     = "#"
					onClick   = {toggleServerStats}
					enabled   = {true}
					keySuffix = "stats"
					fontSize  = {isMobile() ? 64 : 44}
					nudgeTop  = {isMobile() ? -14 : -4}
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
				<UiEntity
					key = "ui_PrecipBtn"
					uiTransform = {{
						width        : BTN_SIZE,
						height       : BTN_SIZE,
						margin       : { left: BTN_MARGIN_X, right: BTN_MARGIN_X },
						justifyContent: 'center',
						alignItems   : 'center',
						borderRadius : borderRadius.md,
					}}
					uiBackground = {{ color: PANEL_BG }}
					onMouseDown  = {cyclePrecipitation}
				>
					<SnowflakeIcon color = {precipitationIconColor(getPrecipitation())} />
				</UiEntity>
			</UiEntity>
		)
	}
}


// MARK: SnowflakeIcon
/**
 * Six-armed snowflake composed from three overlapping bars: horizontal,
 * plus two diagonals approximated by short staircase strips. React-ECS
 * cannot rotate arbitrary elements, so each arm is built by absolutely
 * positioning bar segments through the icon's centre.
 *
 * Simplified glyph: a central plus (+) and an ex (×) overlaid so the
 * combined silhouette reads as an asterisk / snowflake at button scale.
 */
function SnowflakeIcon(props: { color: Color4 }) {
	const ICON = 44
	const BAR  = 4
	const LONG = 40
	const DIAG = 6            // staircase step size for the diagonals
	const DIAG_STEPS = 5
	const diag: any[] = []
	for (let i = 0; i < DIAG_STEPS; i++) {
		const offset = (i - (DIAG_STEPS - 1) / 2) * DIAG
		// NE-SW diagonal: shift x + y together
		diag.push(
			<UiEntity
				key = {`snowflake_diag_a_${i}`}
				uiTransform = {{
					width       : DIAG,
					height      : DIAG,
					positionType: 'absolute',
					position    : { top: ICON / 2 + offset - DIAG / 2, left: ICON / 2 + offset - DIAG / 2 },
				}}
				uiBackground = {{ color: props.color }}
			/>
		)
		// NW-SE diagonal: mirror x
		diag.push(
			<UiEntity
				key = {`snowflake_diag_b_${i}`}
				uiTransform = {{
					width       : DIAG,
					height      : DIAG,
					positionType: 'absolute',
					position    : { top: ICON / 2 + offset - DIAG / 2, left: ICON / 2 - offset - DIAG / 2 },
				}}
				uiBackground = {{ color: props.color }}
			/>
		)
	}
	return (
		<UiEntity
			key = "ui_SnowflakeIcon"
			uiTransform = {{ width: ICON, height: ICON, positionType: 'relative' }}
		>
			{/* Horizontal bar */}
			<UiEntity
				key = "snowflake_h"
				uiTransform = {{
					width       : LONG,
					height      : BAR,
					positionType: 'absolute',
					position    : { top: (ICON - BAR) / 2, left: (ICON - LONG) / 2 },
				}}
				uiBackground = {{ color: props.color }}
			/>
			{/* Vertical bar */}
			<UiEntity
				key = "snowflake_v"
				uiTransform = {{
					width       : BAR,
					height      : LONG,
					positionType: 'absolute',
					position    : { top: (ICON - LONG) / 2, left: (ICON - BAR) / 2 },
				}}
				uiBackground = {{ color: props.color }}
			/>
			{/* Diagonals as short staircase strips */}
			{diag}
		</UiEntity>
	)
}


export const actionBarLayer = new ActionBarLayer()


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
