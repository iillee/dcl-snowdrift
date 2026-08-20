/**
 * layer.frostBar.tsx — bottom-center survival gauge, retro segmented style.
 *
 * Ten discrete blocks in a chunky black-outlined rectangle, no rounded
 * corners. Full = warm/safe, empty = frozen. As frost rises, segments
 * drop off from the right one at a time — the classic Game Boy /
 * Zelda hearts feel. Threshold colours shift the remaining blocks from
 * warm gold -> amber -> danger red so the player reads urgency at a
 * glance without needing a number.
 *
 * Reads the local player's frost value from src/client/frost/accumulation.
 * The Layer.body() closure re-runs every frame so no explicit signal
 * wiring is needed.
 */

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { getFrostLocal }                           from 'src/client/frost/accumulation'
import { isTorchEquipped }                         from 'src/client/torchEquip'
import { MuteButton, SpectatorButton, TorchButton } from 'src/client/ui/layers/layer.brushSize'
import { FROST_MAX }                               from 'src/shared/frost/tuning'


// MARK: Layout
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
const COL_FRAME_DT  = Color4.create(0, 0, 0, 0)
const COL_FRAME_MB  = Color4.create(0, 0, 0, 0.55)
const COL_BORDER_DT = Color4.create(0, 0, 0, 0.80)
const COL_BORDER_MB = Color4.create(0, 0, 0, 0.55)
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
const RADIUS_SEG_DT   = 4
const RADIUS_SEG_MB   = 4


// MARK: FrostBarLayer
class FrostBarLayer extends Layer {
	constructor() {
		super({
			id  : 'frostBar',
			zone: ZoneType.TopCenter,
		})
	}

	body() {
		const frost      = getFrostLocal()
		const warmthPct  = Math.max(0, Math.min(1, 1 - frost / FROST_MAX))
		// Round up so the last sliver of warmth still shows a full block;
		// only a truly full frost bar (>= FROST_MAX) shows zero warm blocks.
		const warmBlocks = frost >= FROST_MAX ? 0 : Math.max(1, Math.ceil(warmthPct * SEGMENT_COUNT))
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

		// Build segment array. Left → right: warm blocks first, then cold
		// blocks fill in from the right as warmth is lost.
		const segments = []
		for (let i = 0; i < SEGMENT_COUNT; i++) {
			const isWarm = i < warmBlocks
			segments.push(
				<UiEntity
					key         = {`ui_FrostBar_seg_${i}`}
					uiTransform = {{
						width       : segSize,
						height      : segSize,
						margin      : { right: i < SEGMENT_COUNT - 1 ? segGap : 0 },
						borderRadius: radSeg,
					}}
					uiBackground = {{ color: isWarm ? COL_WARM : COL_COLD }}
				/>,
			)
		}

		return (
			<UiEntity
				key         = "ui_FrostBar_wrap"
				uiTransform = {{
					flexDirection : 'row',
					justifyContent: 'center',
					alignItems    : 'center',
					margin        : { top },
					pointerFilter : 'none',
				}}
			>
				{/* Eye + mute to the LEFT of the frost bar (desktop only —
				   mobile hosts these in the native gamepad slots via
				   touchControls.ts). Each carries BTN_MARGIN_X = 8 on both
				   sides, giving a 16 px gap between adjacent buttons and a
				   matching 16 px gap to the frost bar (8 button margin + 8
				   frost-bar left margin). */}
				{!mobile && <SpectatorButton />}
				{!mobile && <MuteButton />}
				{/* Outer frame — same tinted-black bg + rounded corners as the
				   action-bar buttons, so the HUD reads as one system. */}
				<UiEntity
					key         = "ui_FrostBar_border"
					uiTransform = {{
						width          : innerW + borderPx * 2,
						height         : innerH + borderPx * 2,
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
				{/* Torch slot to the RIGHT of the frost bar. Only shown when
				   the player is holding a torch; mobile touch paths do not
				   use this button. */}
				{isTorchEquipped() && (
					<TorchButton />
				)}
			</UiEntity>
		)
	}
}


export const frostBarLayer = new FrostBarLayer()
