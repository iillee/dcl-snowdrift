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

import { SHOW_PRECIPITATION_BUTTON, SHOW_REROLL_BUTTON } from 'src/client/devFlags'
import { CyclePanelPopover, PANEL_GAP_PX, PANEL_WIDTH, toggleCyclePanel } from 'src/client/ui/layers/layer.cyclePanel'
import { toggleHelpPanel } from 'src/client/ui/layers/layer.helpPanel'
import { isMusicMuted, playUiClick, toggleMusic } from 'src/client/audio'
import { getTorchFuelFraction, isTorchEquipped, isTorchLit, isTorchRaised } from 'src/client/torchEquip'
import { clearProps } from 'src/client/props/spawn'
import { PrecipitationLevel, getPrecipitation } from 'src/client/snowfall'
import { isTopDownActive, toggleTopDownCamera } from 'src/client/topDownCamera'
import { SeedHolder, seedHolder } from 'src/shared/components'
import { room } from 'src/shared/messages'
import { UI_THEME } from 'src/client/ui/theme/settings'


const { colors, fontSizes, borderRadius } = UI_THEME

const WHITE     = Color4.White()
const DIM       = Color4.create(1, 1, 1, 0.35)
// Matches COL_WARM in layer.frostBar.tsx so every warm accent
// (button borders, active icons, torch fuel meter) reads as the
// same colour language as the heat bar.
const GOLD      = Color4.create(1.00, 0.80, 0.30, 1)
const ICE_BLUE  = Color4.create(0.65, 0.85, 1.0, 1)
const DEEP_BLUE = Color4.create(0.40, 0.65, 1.0, 1)
const PANEL_BG  = colors.statsBg

// Shared button footprint so every action button in the bar looks identical.
const BTN_SIZE       = 72
const BTN_MARGIN_X   = 8   // horizontal breathing room per-button (left + right)

// Eye icon texture. White silhouette on transparent so the SDK tint
// (implicit via textureMode: 'stretch') stays untouched — we express
// the active/inactive state by swapping the icon size + a colour cast
// via a coloured backdrop is not needed at this scale.
const EYE_ICON_SRC = 'assets/images/eye.png'
// Eye PNGs are wider than tall. DCL's textureMode has no 'contain'
// (aspect-preserving fit), so we hardcode a box that roughly matches
// the icon's aspect. Bump _W / _H together to resize.
const EYE_ICON_W   = 48
const EYE_ICON_H   = 32


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


// MARK: rerollLevel
/**
 * Roll a fresh maze seed and publish it via SeedHolder. The synced
 * seed change trips the watcher in src/client/index.ts, which calls
 * rebuildMaze() and setupProps(). clearProps() flips setupProps'
 * idempotency latch so scattered decorations (trees, huts...) also
 * reroll with the new seed instead of persisting from the old layout.
 *
 * Determinism: the new seed goes through SeedHolder (CRDT-synced), so
 * every other client in the scene sees the same reroll and produces
 * identical output.
 */
function rerollLevel(): void {
	const next = (Math.floor(Math.random() * 0x7fffffff) | 0) || 1
	console.log(`layer.brushSize: rerollLevel: publishing new seed ${next}`)
	clearProps()
	SeedHolder.createOrReplace(seedHolder, { seed: next })
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
		const specActive = isTopDownActive()
		// Mobile pulls the spectator + mute buttons OUT of the top-center
		// bar entirely — the mobile-actions layer renders them as round
		// white-bordered buttons anchored bottom-right, replacing the
		// native DCL `E` / `F` gamepad buttons we hide via TouchScreenControls.
		const mobile = isMobile()

		return (
			<UiEntity
				key = "ui_BrushSize_row"
				uiTransform = {{
					margin       : { top: mobile ? 4 : 32 },
					flexDirection: 'row',
					alignItems   : 'center',
					justifyContent: 'center',
				}}
			>
				{SHOW_REROLL_BUTTON && (
					<BrushButton
						label     = "↻"
						onClick   = {rerollLevel}
						enabled   = {true}
						keySuffix = "reroll"
						fontSize  = {mobile ? 56 : 40}
						nudgeTop  = {mobile ? -12 : -2}
					/>
				)}
				{/* SpectatorButton + MuteButton are rendered inline by
				   layer.frostBar on desktop so the whole top-centre HUD reads
				   as one cluster (eye + mute + frost bar + torch). On mobile
				   they live in the native gamepad slots (see touchControls.ts). */}
				{/* TorchButton was moved out of the top-center action bar to
				   ZoneType.TopLeft (layer.torchButton) so it doesn't collide
				   with the frost bar which now anchors top-center. */}
				{SHOW_PRECIPITATION_BUTTON && (
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
				)}
			</UiEntity>
		)
	}
}


// MARK: HelpButton
/**
 * Bold-white "?" button. Same footprint + border language as the other
 * top-centre HUD buttons (Clock / Spectator / Mute) so the row reads
 * as one cluster. Click behaviour is unwired for now — placeholder for
 * a future help / how-to-play popover.
 */
export function HelpButton() {
	return (
		<UiEntity
			key = "ui_HelpBtn"
			uiTransform = {{
				width         : BTN_SIZE,
				height        : BTN_SIZE,
				margin        : { left: BTN_MARGIN_X, right: BTN_MARGIN_X },
				justifyContent: 'center',
				alignItems    : 'center',
				borderRadius  : borderRadius.md,
				borderWidth   : TORCH_BORDER_W,
				borderColor   : TORCH_BORDER_OFF,
			}}
			uiBackground = {{ color: PANEL_BG }}
			onMouseDown  = {() => { playUiClick(); toggleHelpPanel() }}
		>
			{/* Bold "?" faked by stacking two labels with a 1 px offset —
			   same trick used on the countdown text (SDK7 Label has no
			   fontWeight prop). */}
			<UiEntity
				key         = "ui_HelpBtn_glyph_wrap"
				uiTransform = {{
					width       : BTN_SIZE,
					height      : BTN_SIZE,
					positionType: 'relative',
				}}
			>
				<Label
					value    = "?"
					fontSize = {48}
					color    = {WHITE}
					font     = "sans-serif"
					textAlign= "middle-center"
					uiTransform = {{
						width       : '100%',
						height      : '100%',
						positionType: 'absolute',
						position    : { top: isMobile() ? -8 : 0, left: 0 },
					}}
				/>
				<Label
					value    = "?"
					fontSize = {48}
					color    = {WHITE}
					font     = "sans-serif"
					textAlign= "middle-center"
					uiTransform = {{
						width       : '100%',
						height      : '100%',
						positionType: 'absolute',
						position    : { top: isMobile() ? -7 : 1, left: 1 },
					}}
				/>
			</UiEntity>
		</UiEntity>
	)
}


// MARK: ClockIcon
/**
 * Minimalist analogue-clock glyph built from UiEntity primitives so we
 * don't need a PNG asset. A rounded-square backdrop approximates the
 * bezel; two absolutely-positioned bars form the hour + minute hands
 * meeting at the centre. Colour is driven by the caller so the same
 * component can render active/inactive states later.
 */
export function ClockIcon(props: { color: Color4; size?: number }) {
	const ICON       = props.size ?? 36
	const RING_W     = Math.max(2, Math.round(ICON * (3 / 36)))
	const HAND_W     = Math.max(2, Math.round(ICON * (3 / 36)))
	const HOUR_LEN   = Math.round(ICON * (10 / 36))
	const MINUTE_LEN = Math.round(ICON * (14 / 36))
	const centre     = ICON / 2
	return (
		<UiEntity
			key         = "ui_ClockIcon"
			uiTransform = {{ width: ICON, height: ICON, positionType: 'relative' }}
		>
			{/* Bezel — rounded square standing in for a circle. */}
			<UiEntity
				key         = "clock_bezel"
				uiTransform = {{
					width       : ICON,
					height      : ICON,
					positionType: 'absolute',
					position    : { top: 0, left: 0 },
					borderRadius: ICON / 2,
					borderWidth : RING_W,
					borderColor : props.color,
				}}
			/>
			{/* Minute hand — vertical, points to 12. */}
			<UiEntity
				key         = "clock_minute"
				uiTransform = {{
					width       : HAND_W,
					height      : MINUTE_LEN,
					positionType: 'absolute',
					position    : { top: centre - MINUTE_LEN, left: centre - HAND_W / 2 },
				}}
				uiBackground = {{ color: props.color }}
			/>
			{/* Hour hand — horizontal, points to 3. */}
			<UiEntity
				key         = "clock_hour"
				uiTransform = {{
					width       : HOUR_LEN,
					height      : HAND_W,
					positionType: 'absolute',
					position    : { top: centre - HAND_W / 2, left: centre },
				}}
				uiBackground = {{ color: props.color }}
			/>
		</UiEntity>
	)
}


// MARK: ClockButton
/**
 * Cycle-clock button. Sits to the LEFT of the SpectatorButton (eye) in
 * the top-centre HUD cluster. Click behaviour is unwired for now — the
 * button is a placeholder for the 24 h cycle UI (countdown to next
 * world reset). Same footprint + border language as SpectatorButton
 * and MuteButton so the row reads as one system.
 */
export function ClockButton() {
	return (
		<UiEntity
			key = "ui_ClockBtn"
			uiTransform = {{
				width         : BTN_SIZE,
				height        : BTN_SIZE,
				margin        : { left: BTN_MARGIN_X, right: BTN_MARGIN_X },
				justifyContent: 'center',
				alignItems    : 'center',
				borderRadius  : borderRadius.md,
				borderWidth   : TORCH_BORDER_W,
				borderColor   : TORCH_BORDER_OFF,
			}}
			uiBackground = {{ color: PANEL_BG }}
			onMouseDown  = {() => { playUiClick(); toggleCyclePanel() }}
		>
			<ClockIcon color = {WHITE} size = {36} />
			{/* Countdown popover — absolute-positioned sibling anchored to the
			   LEFT of the clock button so it appears immediately left of the
			   icon. Rendered here (instead of as a standalone kit layer) so its
			   x-position always tracks the icon regardless of HUD layout. */}
			<UiEntity
				key         = "ui_ClockBtn_popoverAnchor"
				uiTransform = {{
					positionType: 'absolute',
					// Right edge of the popover sits PANEL_GAP_PX left of the
					// button's left border. `right: BTN_SIZE + PANEL_GAP_PX`
					// places it that far from the button's own right edge, which
					// (thanks to absolute containment inside the button) lands it
					// just past the left edge.
					// Nudge up by the button's border thickness so the popover's
					// outer top edge lines up with the button's outer top edge —
					// absolute children are positioned inside the border box, so
					// top: 0 would otherwise sit TORCH_BORDER_W px below the row
					// baseline shared with the neighbouring buttons.
					position    : { top: -TORCH_BORDER_W, right: BTN_SIZE + PANEL_GAP_PX },
					width       : PANEL_WIDTH,
					height      : BTN_SIZE,
					justifyContent: 'center',
					alignItems  : 'center',
				}}
			>
				<CyclePanelPopover />
			</UiEntity>
		</UiEntity>
	)
}


// MARK: SpectatorButton
/**
 * Top-down camera toggle. Same footprint as the torch button; border
 * turns warm gold while top-down is active. Exported so the frost-bar
 * layer can host it inline on desktop.
 */
export function SpectatorButton() {
	const specActive = isTopDownActive()
	return (
		<UiEntity
			key = "ui_SpectatorBtn"
			uiTransform = {{
				width         : BTN_SIZE,
				height        : BTN_SIZE,
				margin        : { left: BTN_MARGIN_X, right: BTN_MARGIN_X },
				justifyContent: 'center',
				alignItems    : 'center',
				borderRadius  : borderRadius.md,
				borderWidth   : TORCH_BORDER_W,
				borderColor   : specActive ? TORCH_BORDER_ON : TORCH_BORDER_OFF,
			}}
			uiBackground = {{ color: PANEL_BG }}
			onMouseDown  = {() => { playUiClick(); toggleTopDownCamera() }}
		>
			<UiEntity
				key = "ui_ViewToggle_icon_desktop"
				uiTransform = {{ width: EYE_ICON_W, height: EYE_ICON_H }}
				uiBackground = {{
					textureMode: 'stretch',
					texture    : { src: EYE_ICON_SRC },
					color      : specActive ? GOLD : WHITE,
				}}
			/>
		</UiEntity>
	)
}


// MARK: MuteButton
/**
 * Audio mute toggle. Same footprint as the torch button. Exported so
 * the frost-bar layer can host it inline on desktop.
 */
export function MuteButton() {
	return (
		<UiEntity
			key = "ui_MuteBtn"
			uiTransform = {{
				width         : BTN_SIZE,
				height        : BTN_SIZE,
				margin        : { left: BTN_MARGIN_X, right: BTN_MARGIN_X },
				justifyContent: 'center',
				alignItems    : 'center',
				borderRadius  : borderRadius.md,
				borderWidth   : TORCH_BORDER_W,
				borderColor   : TORCH_BORDER_OFF,
			}}
			uiBackground = {{ color: PANEL_BG }}
			onMouseDown  = {toggleMusic}
		>
			{/* Key varies with mute state: react-ecs otherwise diffs the
			   same node in place and can keep the cached texture handle,
			   leaving the icon stale after toggling on desktop. Distinct
			   key forces a fresh element so the new src is picked up. */}
			<UiEntity
				key = {isMusicMuted() ? 'ui_MuteBtn_icon_muted' : 'ui_MuteBtn_icon_unmuted'}
				uiTransform = {{ width: 34, height: 34 }}
				uiBackground = {{
					textureMode: 'stretch',
					texture    : { src: isMusicMuted() ? 'assets/images/muted.png' : 'assets/images/unmute.png' },
				}}
			/>
		</UiEntity>
	)
}


// MARK: TorchButton
/**
 * Torch inventory slot. Same footprint (BTN_SIZE), same PANEL_BG, same
 * border radius as the action-bar buttons. When the torch is lit, a
 * warm-gold fill drains from the top inside the button as fuel is
 * consumed (inverse of the flagtag boomerang charge). Clicking the
 * button does nothing yet — relight lives on the E key
 * (torchInput.ts) and stays there so the input story is consistent
 * across mouse and touch.
 *
 * Exported so layer.torchButton can host it in its own top-left zone
 * (the torch was pulled out of the top-center action bar when the
 * frost bar was moved there).
 */
export function TorchButton() {
	const lit         = isTorchLit()
	const raised      = isTorchRaised()
	const highlight   = lit || raised
	// Both lit and unlit icons render at full white — the images
	// themselves communicate state (torch.png vs torch_unlit.png), and
	// dimming the unlit one made it near-invisible on the dark panel
	// especially on mobile.
	const iconTint    = WHITE
	const fuelFrac    = Math.max(0, Math.min(1, getTorchFuelFraction()))
	const borderColor = highlight ? TORCH_BORDER_ON : TORCH_BORDER_OFF

	const fuelHeightMax = BTN_SIZE - TORCH_BORDER_W * 2 - TORCH_FUEL_INSET * 2
	const fuelHeightPx  = Math.round(fuelHeightMax * fuelFrac)
	// Constant warm gold across the whole drain — the fill height alone
	// communicates remaining fuel. A low-fuel warning colour was tried
	// and rejected; if we bring it back, prefer a pulse over a hard swap.
	const fuelColor     = TORCH_FUEL_COLOR_FULL

	return (
		<UiEntity
			key = "ui_TorchBtn"
			uiTransform = {{
				width        : BTN_SIZE,
				height       : BTN_SIZE,
				margin       : { left: BTN_MARGIN_X, right: BTN_MARGIN_X },
				justifyContent: 'center',
				alignItems   : 'center',
				borderRadius : borderRadius.md,
				borderWidth  : TORCH_BORDER_W,
				borderColor  : borderColor,
			}}
			uiBackground = {{ color: PANEL_BG }}
		>
			{/* Fuel fill — anchored bottom, drains from top as fuel depletes.
			   Rendered as an outer frame + inner bar so the horizontal gap
			   stays symmetric. Putting the insets on the outer frame (which
			   has no sibling flex children) sidesteps a DCL quirk where an
			   absolute child with `left` + `right` insets rendered
			   asymmetrically when the parent had a borderWidth + a
			   flex-centred sibling (the torch icon), pushing the fill a few
			   px to the right of centre. The inner bar handles the drain. */}
			{lit && fuelFrac > 0 ? (
				<UiEntity
					key         = "ui_TorchBtn_fuelFrame"
					uiTransform = {{
						positionType   : 'absolute',
						// Explicit width + height + top/left inset. DCL absolute
						// elements do NOT stretch to fill via top+bottom+left+right
						// the way CSS does — without an explicit size they collapse
						// to their content's intrinsic dimensions and anchor to the
						// specified corner (bottom-right in our case). Sizing the
						// frame in px matches the visible inner content area of the
						// button (BTN_SIZE - 2 * border - 2 * inset) and pins it to
						// the top-left of that region, yielding a uniform gap on all
						// four sides.
						position       : { top: TORCH_FUEL_INSET, left: TORCH_FUEL_INSET },
						width          : BTN_SIZE - TORCH_BORDER_W * 2 - TORCH_FUEL_INSET * 2,
						height         : BTN_SIZE - TORCH_BORDER_W * 2 - TORCH_FUEL_INSET * 2,
						flexDirection  : 'column',
						justifyContent : 'flex-end',
					}}
				>
					<UiEntity
						key         = "ui_TorchBtn_fuelBar"
						uiTransform = {{
							width       : '100%',
							height      : fuelHeightPx,
							borderRadius: borderRadius.sm,
						}}
						uiBackground = {{ color: fuelColor }}
					/>
				</UiEntity>
			) : null}
			{/* Torch glyph — centred on top of the fuel fill. */}
			<UiEntity
				key         = "ui_TorchBtn_icon"
				uiTransform = {{ width: TORCH_ICON_PX, height: TORCH_ICON_PX }}
				uiBackground = {{
					textureMode: 'stretch',
					texture    : { src: lit ? 'assets/images/torch.png' : 'assets/images/torch_unlit.png' },
					color      : iconTint,
				}}
			/>
		</UiEntity>
	)
}

// Torch-button visual constants — kept beside the component so the
// action bar owns its own tuning without importing from the retired
// hotbar layer.
const TORCH_ICON_PX          = 40
// Constant width to avoid the 2 px child-shift bug when toggling
// borderWidth (see handoff #2). Border is transparent when the torch
// is unlit; when lit it becomes TORCH_BORDER_ON at full 4 px thickness.
const TORCH_BORDER_W         = 4
const TORCH_BORDER_ON        = Color4.create(1.00, 0.80, 0.30, 0.95)
// Cool white outline shown when the torch is unlit — keeps the slot
// visually anchored in the action bar even without the warm glow.
const TORCH_BORDER_OFF       = Color4.create(1, 1, 1, 0.75)
// Distance from the outer edge of the button to the fuel-fill rect.
// Must exceed TORCH_BORDER_W so the fill sits INSIDE the border on
// every platform — DCL's mobile layout counts absolute-positioned
// insets from the border box, so a value at or below TORCH_BORDER_W
// (4 px) leaves the fill flush with / bleeding over the border edge.
// Must remain > TORCH_BORDER_W so the fill sits inside the border on
// every platform (see handoff #2 note re: mobile bleed at inset<=border).
const TORCH_FUEL_INSET       = TORCH_BORDER_W + 2
// Matches GOLD / COL_WARM RGB. Alpha kept just under 1 so the icon
// on top still reads cleanly, but high enough that the dark panel
// doesn't desaturate the fill (previous 0.55 looked muddy/olive
// against black).
const TORCH_FUEL_COLOR_FULL  = Color4.create(1.00, 0.80, 0.30, 0.90)


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
export function SnowflakeIcon(props: { color: Color4; size?: number }) {
	// All internal dimensions derive from ICON so the glyph scales cleanly
	// when embedded in smaller HUD elements (e.g. the frost bar's cold
	// panel). Defaults preserve the original 44 px button footprint.
	const ICON = props.size ?? 44
	const BAR  = Math.max(2, Math.round(ICON * (4 / 44)))
	const LONG = Math.round(ICON * (40 / 44))
	const DIAG = Math.max(3, Math.round(ICON * (6 / 44)))
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
