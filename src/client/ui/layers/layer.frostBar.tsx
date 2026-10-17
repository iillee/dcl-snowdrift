/**
 * layer.frostBar.tsx - top-centre survival gauge, one continuous bar.
 *
 * Fixed width, three colours left to right: White | Yellow | Blue.
 *   Blue   = frost fraction, anchored RIGHT, grows right -> left.
 *   Yellow = torch fuel fraction * (1 - frost), sitting just left of
 *            the blue; it shrinks from its left edge as fuel burns.
 *            0 while the torch is out.
 *   White  = whatever is left, on the LEFT.
 * Displayed values ease toward the real ones (wall-clock time constant,
 * so frame-rate independent); gameplay never reads the eased values.
 *
 * Reads the local player's frost value from src/client/frost/accumulation.
 * The Layer.body() closure re-runs every frame so no explicit signal
 * wiring is needed.
 */

import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { DEBUG_THAW_BUTTON, SHOW_DEV_ADVANCE_PHASE, SHOW_DEV_ROLL_BUTTON, SHOW_DEV_SNUFF_BUTTON } from 'src/client/devFlags'
import { getCurrentCycleSeed } from 'src/client/cycle'
import { isWorldThawed } from 'src/client/worldThaw'
import { room } from 'src/shared/messages'
import { getFrostLocal } from 'src/client/frost/accumulation'
import { getTorchFuelFraction, isTorchLit } from 'src/client/torchEquip'
import { FROST_MAX, FROST_REDUCES_TORCH_CAPACITY } from 'src/shared/frost/tuning'
import { ClockButton, DevAdvancePhaseButton, DevRollButton, DevSnuffButton, HelpButton, MuteButton, SnowflakeIcon, SpectatorButton } from 'src/client/ui/layers/layer.brushSize'
import { UI_THEME } from 'src/client/ui/theme/settings'
import { getUVsForAtlasTile } from 'src/client/ui/utils/atlas'

// Feature flag — ClockButton (24 h rebuild countdown popover) is hidden
// while the timer lives in the HelpPanel. Flip to `true` to restore the
// standalone HUD button + popover.
const SHOW_CLOCK_BUTTON = false



// Font-awesome atlas from the UI component kit — same asset the
// relight prompt uses. The kit indexes tiles as 1-based (xStart, yStart)
// with yStart counting from the BOTTOM, so `fire: {xStart:2, yStart:15}`
// in atlases.ts converts to 0-indexed from top-left as (col 1, row 1).
// Preferred over a standalone flame.png because the atlas is already
// fetched by the kit at boot, so the icon renders on the first frame
// with no cold-CDN pop-in.
const ATLAS_SRC     = 'assets/images/ui-component-kit/atlas-icons-font-awesome.png'
const ATLAS_COLS    = 16
const ATLAS_ROWS    = 16
const FIRE_TILE_COL = 1
const FIRE_TILE_ROW = 1
// Outline heart for the white pill. The font-awesome atlas only has a
// solid heart, so this 128 px PNG is that atlas heart turned into an
// even ~10 px stroke (white glyph, transparent middle, tinted black).
const HEART_OUTLINE_SRC = 'assets/images/heart_outline.png'
const COL_HEART         = Color4.create(0, 0, 0, 1)


// MARK: Layout
// Old 10-block grid, kept only to size the continuous bar the same.
const SEGMENT_COUNT = 10
// True squares. Desktop segment size is picked so the frost bar's
// outer frame (the white-bordered rectangle behind the segments)
// matches the neighbouring buttons' BTN_SIZE = 72 in height, keeping
// the top-centre HUD cluster on one clean y-baseline. DCL's
// borderWidth is drawn inside the element's `width` / `height`, so
// the outer footprint equals `innerH + borderPx * 2` (the border
// itself doesn't add to the outer size):
//
//   outer H = SEG_SIZE_DT + FRAME_PAD_DT*2 + BORDER_PX_DT*2
//           = 44 + 16 + 12 = 72  ✓
//
// Mobile keeps the tighter footprint tuned for the smaller portrait
// viewport. Frame gap / padding / border scale with segment size so
// proportions stay consistent at each platform.
const SEG_SIZE_DT   = 44
const SEG_SIZE_MB   = 44
const SEG_GAP_DT    = 6
const SEG_GAP_MB    = 6
const FRAME_PAD_DT  = 8
const FRAME_PAD_MB  = 8
const BORDER_PX_DT  = 6
const BORDER_PX_MB  = 6

// Top offset. Matches the ActionBarLayer margin (see layer.brushSize.tsx)
// so the frost bar sits on the same y-baseline as the eye/mute buttons
// and the torch slot — the whole HUD reads as one top row.
const BAR_TOP_DT = 32
const BAR_TOP_MB = 4


// MARK: Palette
// Warm blocks stay a constant gold at every level — urgency reads from
// the growing ice bar on the right, not from a colour shift. Keeps the
// palette calm and coherent with the campfire glow.
const COL_WARM   = Color4.create(1.00, 0.80, 0.30, 1.00)
// Left remainder: neither torch fuel nor frost.
const COL_WHITE  = Color4.create(0.96, 0.96, 0.96, 1.00)

// Display easing: time constant (s) for the drawn widths to follow the
// real values. Small so the bar stays accurate; snaps when close.
const DISPLAY_TAU_S = 0.12
let dispFrost = -1
let dispFuel  = -1
let dispLastMs = 0

function easeDisplay(frostFrac: number, fuelFrac: number): void {
	const now = Date.now()
	if (dispFrost < 0) {
		dispFrost  = frostFrac
		dispFuel   = fuelFrac
		dispLastMs = now
		return
	}
	const dt = Math.min(0.25, Math.max(0, (now - dispLastMs) / 1000))
	dispLastMs = now
	const k = 1 - Math.exp(-dt / DISPLAY_TAU_S)
	dispFrost += (frostFrac - dispFrost) * k
	dispFuel  += (fuelFrac  - dispFuel)  * k
	if (Math.abs(frostFrac - dispFrost) < 0.001) dispFrost = frostFrac
	if (Math.abs(fuelFrac  - dispFuel)  < 0.001) dispFuel  = fuelFrac
}

// Cold fill — ice-blue block that takes over from the right as frost
// rises. Deliberately a hard fill (not a ghost slot) so the bar never
// reads as "empty", only as "warm vs cold".
const COL_COLD    = Color4.create(0.42, 0.60, 0.98, 1.00) // paint-blue ice
// Background fills. Desktop uses a single-layer look: outer frame
// carries the whole tint (0.80) and the inner frame is transparent,
// so there is no lighter grey band between the white outline and the
// segments. Mobile keeps the original two-layer look (both fills at
// 0.55, stacking to ~0.80 inside the segment strip) so the small
// mobile bar matches its pre-desktop-refresh appearance.
// Mobile now matches desktop: single-layer look, outer frame carries
// the full tint and the inner frame is transparent. Previously mobile
// stacked two 0.55-alpha fills, which produced a visible lighter grey
// band in the padding gutter around the warm/cold panels.
const COL_FRAME_DT  = Color4.create(0, 0, 0, 0)
const COL_FRAME_MB  = Color4.create(0, 0, 0, 0)
const COL_BORDER_DT = Color4.create(0, 0, 0, 0.80)
const COL_BORDER_MB = Color4.create(0, 0, 0, 0.80)
// White outline that matches the action-bar buttons (see
// TORCH_BORDER_OFF in layer.brushSize.tsx) so the frost bar reads
// as part of the same HUD system.
const COL_BORDER_WHITE = Color4.create(1, 1, 1, 0.75)
const BORDER_WHITE_W   = 4

// Corner radii — outer frame a hair larger than the inner, and segments
// get a tiny radius so the outermost ones don't fight the frame's
// rounded corners. Per-platform so radii scale with segment size.
// Outer frame matches borderRadius.md (18) used by the buttons so the
// bar and buttons read as one HUD system. Inner frame + segments step
// down proportionally.
const RADIUS_OUTER_DT = 18
const RADIUS_OUTER_MB = 18
const RADIUS_INNER_DT = 14
const RADIUS_INNER_MB = 14
// Panel radius steps down cleanly from the outer frame (18) and inner
// frame (14) so the warm/cold pills feel like they belong to the same
// system as the action-bar buttons (borderRadius.md = 18) rather than
// tiny 4 px chips floating inside a rounded window.
const RADIUS_SEG_DT   = 10
const RADIUS_SEG_MB   = 10


// MARK: DebugThawButton
/** TEMPORARY: forces the 3/3 world thaw. Gated by DEBUG_THAW_BUTTON. */
function DebugThawButton() {
	const done = isWorldThawed()
	return (
		<UiEntity
			key          = "ui_FrostBar_debugThaw"
			uiTransform  = {{
				width: 72, height: 44, flexShrink: 0,
				margin: { left: 8 },
				justifyContent: 'center', alignItems: 'center',
				borderRadius: 12, borderWidth: 3,
				borderColor: Color4.create(1, 1, 1, 0.75),
				pointerFilter: 'block',
			}}
			uiBackground = {{ color: done ? Color4.create(0.2, 0.2, 0.2, 0.6) : Color4.create(0.85, 0.25, 0.05, 0.9) }}
			onMouseDown  = {() => {
				if (isWorldThawed()) return
				console.log('frostBar: DEBUG thaw button pressed')
				room.send('debugThaw', { seed: getCurrentCycleSeed() })
			}}
		>
			<Label value={done ? 'THAWED' : 'THAW'} fontSize={14} color={Color4.White()} textAlign="middle-center" />
		</UiEntity>
	)
}


// MARK: FrostBarLayer
class FrostBarLayer extends Layer {
	constructor() {
		super({
			id  : 'frostBar',
			zone: ZoneType.TopCenter,
			// Kit TopCenter is width 50% / left 25%. On a half-width
			// ultrawide that box is narrower than the HUD row, and Yoga
			// shrinks the square buttons on X. Give the cluster the
			// full top band so the squares keep their size.
			uiTransform: {
				width   : '90%',
				position: { top: 8, left: '5%' },
			},
		})
	}

	body() {
		const frostFrac  = Math.max(0, Math.min(1, getFrostLocal() / FROST_MAX))
		// Torch out (or not carried) = no yellow, even if fuel is kept.
		// dispFuel is yellow's share of the NON-blue region:
		//  cap on:  yellow = fuel / max of the total (fuel <= max * (1 - frost)),
		//           so the share is fuel / max / (1 - frost) and a full
		//           torch exactly fills the non-blue region.
		//  cap off: yellow = fuel / max * (1 - frost) of the total.
		const tankFrac   = isTorchLit() ? Math.max(0, Math.min(1, getTorchFuelFraction())) : 0
		const nonBlue    = 1 - frostFrac
		const fuelFrac   = FROST_REDUCES_TORCH_CAPACITY
			? (nonBlue > 0.0001 ? Math.min(1, tankFrac / nonBlue) : 0)
			: tankFrac
		easeDisplay(frostFrac, fuelFrac)
		const mobile     = isMobile()
		const segSize    = mobile ? SEG_SIZE_MB     : SEG_SIZE_DT
		const segGap     = mobile ? SEG_GAP_MB      : SEG_GAP_DT
		const framePad   = mobile ? FRAME_PAD_MB    : FRAME_PAD_DT
		const borderPx   = mobile ? BORDER_PX_MB    : BORDER_PX_DT
		const radOuter   = mobile ? RADIUS_OUTER_MB : RADIUS_OUTER_DT
		const radInner   = mobile ? RADIUS_INNER_MB : RADIUS_INNER_DT
		const radSeg     = mobile ? RADIUS_SEG_MB   : RADIUS_SEG_DT
		const top        = mobile ? BAR_TOP_MB      : BAR_TOP_DT
		const colFrame   = mobile ? COL_FRAME_MB    : COL_FRAME_DT
		const colBorder  = mobile ? COL_BORDER_MB   : COL_BORDER_DT
		// Desktop bar sits inline with neighbouring buttons on either
		// side, so it needs matching left+right margin. Mobile has no
		// inline neighbours — zero side margin so it centres cleanly.
		const sideMargin = mobile ? 0                : 8

		const innerW = SEGMENT_COUNT * segSize + (SEGMENT_COUNT - 1) * segGap + framePad * 2
		const innerH = segSize + framePad * 2

		// Two pills: [White with Yellow on top] | gap | Blue.
		// The white pill spans the white+yellow region. Yellow is its own
		// pill (same radius on every corner) drawn over the white pill's
		// right end, so its rounded left edge overlaps white with no
		// straight divider. Blue keeps segGap to its left, only while
		// blue is visible. Total width stays stripW.
		const stripW   = SEGMENT_COUNT * segSize + (SEGMENT_COUNT - 1) * segGap
		const rawCold  = stripW * dispFrost
		const rawWarm  = Math.min(stripW - rawCold, stripW * dispFuel * (1 - dispFrost))
		const rawLeft  = Math.max(0, stripW - rawCold)            // white + yellow
		// Visibility 0..1, eased over 2x the corner radius.
		const fadeW = radSeg * 2
		const ease  = (w: number) => {
			const t = Math.max(0, Math.min(1, w / fadeW))
			return t * t * (3 - 2 * t)
		}
		const visLeft = ease(rawLeft)
		const visCold = ease(rawCold)
		const visWarm = ease(rawWarm)
		// Gap only between two visible pills; collapses smoothly.
		const gap   = segGap * Math.min(visLeft, visCold)
		// Gap comes out of the fill; proportions stay true.
		const scale = (stripW - gap) / stripW
		const regionF = rawLeft * scale
		const regionW = Math.round(regionF)
		const coldX   = Math.round(regionF + gap)
		const coldW   = stripW - coldX
		const coldGap = coldX - regionW
		// Yellow: fuel * (1 - frost) of the total, mapped into the region.
		// Never narrower than one corner diameter (it fades instead), and
		// never wider than the region (full = exactly covers the white).
		const warmTrue = Math.min(regionW, Math.round(rawWarm * scale))
		const warmW    = visWarm > 0.001 ? Math.min(regionW, Math.max(warmTrue, fadeW)) : 0
		// Heart sits in the white still showing left of yellow.
		const whiteVisW = Math.max(0, regionW - warmTrue)

		const flameSize     = Math.round(segSize * 1.0)
		const snowSize      = Math.round(flameSize * 0.85)
		const showHeartIcon = whiteVisW >= flameSize + 4 && visLeft > 0.5
		const showFlameIcon = warmW >= flameSize + 4 && visWarm > 0.5
		const showSnowIcon  = coldW >= snowSize + 4 && visCold > 0.5

		const alpha = (c: Color4, v: number) => Color4.create(c.r, c.g, c.b, c.a * v)

		const segments = [
			<UiEntity
				key          = "ui_FrostBar_left"
				uiTransform  = {{
					width       : regionW,
					height      : segSize,
					flexShrink  : 0,
					borderRadius: Math.min(radSeg, regionW / 2),
				}}
				uiBackground = {{ color: alpha(COL_WHITE, visLeft) }}
			>
				{/* Heart: centred in the white left of the yellow. */}
				<UiEntity
					key         = "ui_FrostBar_heartBox"
					uiTransform = {{
						positionType  : 'absolute',
						position      : { left: 0, top: 0 },
						width         : whiteVisW,
						height        : segSize,
						justifyContent: 'center',
						alignItems    : 'center',
					}}
				>
					{showHeartIcon && (
						<UiEntity
							key          = "ui_FrostBar_heart"
							uiTransform  = {{ width: flameSize, height: flameSize }}
							uiBackground = {{
								textureMode: 'stretch',
								texture    : { src: HEART_OUTLINE_SRC },
								color      : COL_HEART,
							}}
						/>
					)}
				</UiEntity>
				{/* Yellow pill on top, anchored to the region's right end. */}
				<UiEntity
					key          = "ui_FrostBar_warm"
					uiTransform  = {{
						positionType  : 'absolute',
						position      : { right: 0, top: 0 },
						width         : warmW,
						height        : segSize,
						borderRadius  : Math.min(radSeg, warmW / 2),
						justifyContent: 'center',
						alignItems    : 'center',
						display       : warmW > 0 ? 'flex' : 'none',
					}}
					uiBackground = {{ color: alpha(COL_WARM, visWarm) }}
				>
					{showFlameIcon && (
						<UiEntity
							key          = "ui_FrostBar_flame"
							uiTransform  = {{ width: flameSize, height: flameSize }}
							uiBackground = {{
								textureMode: 'stretch',
								texture    : { src: ATLAS_SRC },
								uvs        : getUVsForAtlasTile(FIRE_TILE_COL, FIRE_TILE_ROW, ATLAS_COLS, ATLAS_ROWS),
								color      : Color4.White(),
							}}
						/>
					)}
				</UiEntity>
			</UiEntity>,
			<UiEntity
				key          = "ui_FrostBar_cold"
				uiTransform  = {{
					width         : coldW,
					height        : segSize,
					flexShrink    : 0,
					margin        : { left: coldGap },
					borderRadius  : Math.min(radSeg, coldW / 2),
					justifyContent: 'center',
					alignItems    : 'center',
				}}
				uiBackground = {{ color: alpha(COL_COLD, visCold) }}
			>
				{showSnowIcon && (
					<SnowflakeIcon color = {Color4.White()} size = {snowSize} />
				)}
			</UiEntity>,
		]

		return (
			<UiEntity
				key         = "ui_FrostBar_wrap"
				uiTransform = {{
					flexDirection : 'row',
					justifyContent: 'center',
					alignItems    : 'center',
					flexShrink    : 0,
					// Desktop: nudge the whole top-centre HUD cluster (clock, eye,
					// mute, frost bar, torch) to the right so it clears the
					// countdown popover that pops out to the LEFT of the clock.
					// Mobile keeps the row centred — the desktop-only buttons
					// (and their popovers) don't render there.
					margin        : { top, left: mobile ? 0 : 160 },
					pointerFilter : 'none',
				}}
			>
				{/* Eye + mute to the LEFT of the frost bar (desktop only —
				   mobile hosts these in the native gamepad slots via
				   touchControls.ts). Each carries BTN_MARGIN_X = 8 on both
				   sides, giving a 16 px gap between adjacent buttons and a
				   matching 16 px gap to the frost bar (8 button margin + 8
				   frost-bar left margin). */}
				{/* ClockButton (24 h rebuild countdown) is hidden — the timer
				   is currently surfaced in the HelpPanel instead. Re-enable by
				   flipping SHOW_CLOCK_BUTTON to true. */}
				{!mobile && SHOW_CLOCK_BUTTON && <ClockButton />}
				{!mobile && <SpectatorButton />}
				{!mobile && <MuteButton />}
				{!mobile && <HelpButton />}
				{!mobile && SHOW_DEV_ROLL_BUTTON && <DevRollButton />}
				{!mobile && SHOW_DEV_ADVANCE_PHASE && <DevAdvancePhaseButton />}
				{!mobile && SHOW_DEV_SNUFF_BUTTON && <DevSnuffButton />}
				{/* Outer frame — same tinted-black bg + rounded corners as the
				   action-bar buttons, so the HUD reads as one system. */}
				<UiEntity
					key         = "ui_FrostBar_border"
					uiTransform = {{
						width          : innerW + borderPx * 2,
						height         : innerH + borderPx * 2,
						minWidth       : innerW + borderPx * 2,
						minHeight      : innerH + borderPx * 2,
						flexShrink     : 0,
						justifyContent : 'center',
						alignItems     : 'center',
						// L+R margin matches BTN_MARGIN_X on desktop so the gap
						// to the neighbouring inline buttons on either side
						// equals the 16 px gap between adjacent buttons. Mobile
						// has no inline neighbours — side margin is 0.
						margin         : { left: sideMargin, right: sideMargin },
						borderRadius   : radOuter,
						borderWidth    : BORDER_WHITE_W,
						borderColor    : COL_BORDER_WHITE,
					}}
					uiBackground = {{ color: colBorder }}
				>
					{/* Dark inner frame. Segments sit inside with FRAME_PAD gutter. */}
					<UiEntity
						key         = "ui_FrostBar_inner"
						uiTransform = {{
							width         : innerW,
							height        : innerH,
							flexDirection : 'row',
							alignItems    : 'center',
							justifyContent: 'flex-start',
							padding       : { top: framePad, bottom: framePad, left: framePad, right: framePad },
							borderRadius  : radInner,
						}}
						uiBackground = {{ color: colFrame }}
					>
						{segments}
					</UiEntity>
				</UiEntity>
				{DEBUG_THAW_BUTTON && <DebugThawButton />}
				{/* Torch + Logs slots live in layer.inventoryHotbar
				   (bottom-center); this layer owns the heat bar. */}
			</UiEntity>
		)
	}
}



export const frostBarLayer = new FrostBarLayer()
