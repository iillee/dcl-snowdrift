/**
 * layer.leaderboard.tsx - per-player leaderboard panel.
 *
 * Opened by the star button in the top HUD row (and the star slot of the
 * native mobile button cluster). Same look as the help panel: dark
 * rounded card with a white border, slid in just below the button row.
 *
 * Four small tabs, one table each (top LEADERBOARD_SHOW players, local
 * player's name in gold):
 *   Fastest Run - Player, Days, Time (best completion of all monuments)   [default]
 *   Longest Run - Player, Days (most days survived in one run)
 *   Monuments   - Player, Monuments (lifetime released)
 *   Biggest Firenet - Player, Fires (most campfires in one linked network)
 *
 * The board shown is the ACTIVE world profile's (the server only ever sends its own): the standard game shows no heading,
 * the 3-monument playtest shows LEADERBOARD_HEADING above the tabs. Read-only: records are written by the server only.
 */

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { InputAction, PointerEventType, engine, inputSystem } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { playUiClick } from 'src/client/audio'
import {
	closeLeaderboard,
	getLeaderboardRows,
	getLeaderboardTab,
	getLocalAddress,
	isLeaderboardOpen,
	setLeaderboardTab,
	toggleLeaderboard,
} from 'src/client/leaderboard'
import { helpPanelLayer, isHelpPanelVisible } from 'src/client/ui/layers/layer.helpPanel'
import { UI_THEME } from 'src/client/ui/theme/settings'
import { BoardKind, clipName, formatElapsed, LEADERBOARD_HEADING, LEADERBOARD_SHOW } from 'src/shared/leaderboard'
import { isFloatingCrystals } from 'src/shared/ruleset'


const { colors, borderRadius, spacing } = UI_THEME

const WHITE = Color4.White()
const DIM   = Color4.create(1, 1, 1, 0.55)
const GOLD  = Color4.create(1, 0.8, 0.3, 1)

// Land just below the HUD button row (same math as layer.helpPanel).
const BAR_TOP_DT = 32
const BAR_TOP_MB = 4
const BTN_SIZE   = 72
const GAP_BELOW_BAR_PX = 16

const PANEL_PAD    = spacing.md
const PANEL_BORDER = 4
const ROW_FONT     = 17
const HEAD_FONT    = 14
const TAB_FONT     = 16
const TAB_H        = 32
const TITLE_H      = 22
const HEAD_H       = HEAD_FONT + 10
const ROW_H        = 30
const GAP          = 8
const CLOSE_PX     = 30
// Close button sits inside the border, clear of the rounded corner.
const CLOSE_INSET  = PANEL_BORDER + 8

const COL_RANK = 40

const TABS: Array<{ kind: BoardKind; label: string }> = [
	{ kind: 'fastest',   label: 'Fastest Run' },
	{ kind: 'longest',   label: 'Longest Run' },
	{ kind: 'monuments', label: 'Monuments' },
	{ kind: 'firenet',   label: 'Biggest Firenet' },
]

/** Tab widths (px); the longer 'Biggest Firenet' label gets more room. */
function tabWidth(kind: BoardKind, mobile: boolean): number {
	if (kind === 'firenet') return mobile ? 112 : 150
	return mobile ? 86 : 112
}

/** Value-column widths (px) per board; PLAYER takes the rest. */
function valueCols(kind: BoardKind, mobile: boolean): number[] {
	if (kind === 'fastest')   return mobile ? [70, 96] : [84, 110]
	if (kind === 'longest')   return mobile ? [90] : [110]
	if (kind === 'firenet')   return mobile ? [90] : [110]
	return mobile ? [130] : [160]
}
function valueHeads(kind: BoardKind): string[] {
	if (kind === 'fastest') return ['Days', 'Time']
	if (kind === 'longest') return ['Days']
	if (kind === 'firenet') return ['Fires']
	return ['Monuments']
}


// MARK: toggleLeaderboardPanel
/** Open / close the panel (star button, mobile slot). Closes the help panel so they never overlap. */
export function toggleLeaderboardPanel(): void {
	if (!isLeaderboardOpen() && isHelpPanelVisible()) helpPanelLayer.hide()
	toggleLeaderboard()
}


// MARK: initLeaderboardHotkey
/**
 * Desktop hotkey: `3` (IA_ACTION_5) toggles the leaderboard (1 view, 2 mute,
 * 3 leaderboard, 4 help). Floating-crystals ruleset only; a no-op otherwise.
 * Skipped on mobile: the native star slot fires the same action and
 * touchControls.ts handles it there (a second handler would double-toggle).
 */
export function initLeaderboardHotkey(): void {
	if (isMobile() || !isFloatingCrystals()) return
	engine.addSystem(() => {
		if (inputSystem.isTriggered(InputAction.IA_ACTION_5, PointerEventType.PET_DOWN)) { // 3: leaderboard
			playUiClick()
			toggleLeaderboardPanel()
		}
	})
}


// MARK: Cell
function Cell(props: { k: string; w: number; value: string; color?: Color4; font?: number; h: number }) {
	return (
		<Label
			key         = {props.k}
			value       = {props.value}
			fontSize    = {props.font ?? ROW_FONT}
			color       = {props.color ?? WHITE}
			font        = "sans-serif"
			textAlign   = "middle-left"
			uiTransform = {{ width: props.w, minWidth: props.w, height: props.h, flexShrink: 0 }}
		/>
	)
}


// MARK: LeaderboardLayer
class LeaderboardLayer extends Layer {
	constructor() {
		super({
			id  : 'leaderboard',
			zone: ZoneType.TopCenter,
		})
	}

	body() {
		if (!isLeaderboardOpen()) {
			return <UiEntity key="ui_Leaderboard_hidden" uiTransform={{ display: 'none' }} />
		}

		const mobile  = isMobile()
		const barTop  = mobile ? BAR_TOP_MB : BAR_TOP_DT
		const top     = barTop + BTN_SIZE + GAP_BELOW_BAR_PX
		const panelW  = mobile ? 460 : 560
		const inner   = panelW - PANEL_PAD * 2 - PANEL_BORDER * 2
		const kind    = getLeaderboardTab()
		const cols    = valueCols(kind, mobile)
		const heads   = valueHeads(kind)
		const colName = inner - COL_RANK - cols.reduce((s, w) => s + w, 0)
		const nameLen = mobile ? 14 : 18
		const me      = getLocalAddress()

		const rows   = getLeaderboardRows(kind).slice(0, LEADERBOARD_SHOW)
		const titleH = LEADERBOARD_HEADING ? TITLE_H + GAP : 0
		const panelH =
			PANEL_PAD * 2 + PANEL_BORDER * 2 + titleH +
			TAB_H + GAP + HEAD_H + rows.length * ROW_H

		const values = (r: { v: number; ts: number }): string[] => {
			if (kind === 'fastest') return [`${r.v}`, formatElapsed(r.ts)]
			return [`${r.v}`]
		}

		return (
			<UiEntity
				key         = "ui_Leaderboard_root"
				uiTransform = {{
					width         : panelW,
					height        : panelH,
					margin        : { top },
					padding       : PANEL_PAD,
					borderRadius  : borderRadius.md,
					borderWidth   : PANEL_BORDER,
					borderColor   : Color4.create(1, 1, 1, 0.75),
					flexDirection : 'column',
					alignItems    : 'stretch',
					justifyContent: 'flex-start',
					positionType  : 'relative',
				}}
				uiBackground = {{ color: colors.statsBg }}
			>
				{LEADERBOARD_HEADING !== '' && (
					<Label
						key         = "ui_Leaderboard_heading"
						value       = {LEADERBOARD_HEADING}
						fontSize    = {mobile ? 14 : 15}
						color       = {GOLD}
						textAlign   = "middle-center"
						uiTransform = {{ width: '100%', height: TITLE_H, margin: { bottom: GAP } }}
					/>
				)}

				{/* Tabs */}
				<UiEntity
					key         = "ui_Leaderboard_tabs"
					uiTransform = {{
						width         : '100%',
						height        : TAB_H,
						margin        : { bottom: GAP },
						flexDirection : 'row',
						alignItems    : 'center',
						justifyContent: 'center',
					}}
				>
					{TABS.map((t) => (
						<UiEntity
							key          = {`ui_Leaderboard_tab_${t.kind}`}
							uiTransform  = {{
								width         : tabWidth(t.kind, mobile),
								height        : TAB_H,
								margin        : { left: 3, right: 3 },
								alignItems    : 'center',
								justifyContent: 'center',
								borderRadius  : borderRadius.xs + 4,
							}}
							uiBackground = {{ color: t.kind === kind ? Color4.create(1, 1, 1, 0.14) : Color4.create(1, 1, 1, 0) }}
							onMouseDown  = {() => { if (t.kind !== getLeaderboardTab()) { playUiClick(); setLeaderboardTab(t.kind) } }}
						>
							<Label
								value       = {t.label}
								fontSize    = {mobile ? TAB_FONT - 2 : TAB_FONT}
								color       = {t.kind === kind ? GOLD : DIM}
								font        = "sans-serif"
								textAlign   = "middle-center"
								uiTransform = {{ width: '100%', height: TAB_H }}
							/>
						</UiEntity>
					))}
				</UiEntity>

				{/* Column headers */}
				<UiEntity
					key         = "ui_Leaderboard_head"
					uiTransform = {{ width: '100%', height: HEAD_H, flexDirection: 'row', alignItems: 'center' }}
				>
					<Cell k="ui_Leaderboard_h_rank" w={COL_RANK} h={HEAD_H} value="#"      color={WHITE} font={HEAD_FONT} />
					<Cell k="ui_Leaderboard_h_name" w={colName}  h={HEAD_H} value="Player" color={DIM} font={HEAD_FONT} />
					{heads.map((h, c) => (
						<Cell k={`ui_Leaderboard_h_v${c}`} w={cols[c]} h={HEAD_H} value={h} color={DIM} font={HEAD_FONT} />
					))}
				</UiEntity>

				{rows.map((r, i) => {
					const mine  = me !== '' && r.a === me
					const nameColor = mine ? GOLD : WHITE // only the local player's name is gold
					const vals  = values(r)
					return (
						<UiEntity
							key          = {`ui_Leaderboard_row_${i}`}
							uiTransform  = {{ width: '100%', height: ROW_H, flexDirection: 'row', alignItems: 'center', borderRadius: 6 }}
							uiBackground = {{ color: i % 2 === 0 ? Color4.create(1, 1, 1, 0.05) : Color4.create(1, 1, 1, 0) }}
						>
							<Cell k={`ui_Leaderboard_r${i}_rank`} w={COL_RANK} h={ROW_H} value={`${i + 1}`} color={WHITE} />
							<Cell k={`ui_Leaderboard_r${i}_name`} w={colName} h={ROW_H} value={clipName(r.name, nameLen)} color={nameColor} />
							{vals.map((v, c) => (
								<Cell k={`ui_Leaderboard_r${i}_v${c}`} w={cols[c]} h={ROW_H} value={v} color={WHITE} />
							))}
						</UiEntity>
					)
				})}

				{/* Close: small X inset inside the panel corner (no box poking past the rounded border). */}
				<UiEntity
					key          = "ui_Leaderboard_close"
					uiTransform  = {{
						positionType  : 'absolute',
						position      : { top: CLOSE_INSET - PANEL_BORDER, right: CLOSE_INSET - PANEL_BORDER },
						borderRadius  : borderRadius.xs + 4,
						width         : CLOSE_PX,
						height        : CLOSE_PX,
						alignItems    : 'center',
						justifyContent: 'center',
					}}
					uiBackground = {{ color: Color4.create(0, 0, 0, 0) }}
					onMouseDown  = {() => closeLeaderboard()}
				>
					<Label
						value       = {'\u2715'}
						fontSize    = {CLOSE_PX * 0.6}
						color       = {WHITE}
						textAlign   = "middle-center"
						uiTransform = {{ width: CLOSE_PX, height: CLOSE_PX }}
					/>
				</UiEntity>
			</UiEntity>
		)
	}
}


export const leaderboardLayer = new LeaderboardLayer()