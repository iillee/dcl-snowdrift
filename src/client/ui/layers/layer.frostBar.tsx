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

import { getFrostLocal } from 'src/client/frost/accumulation'
import { FROST_MAX } from 'src/shared/frost/tuning'


// MARK: Layout
const SEGMENT_COUNT = 10
// True squares. One dimension per platform — width == height.
const SEG_SIZE_DT   = 24
const SEG_SIZE_MB   = 20
const SEG_GAP       = 3   // gap between segments
const FRAME_PAD     = 4   // dark bg padding around the segments
const BORDER_PX     = 3   // outer black border thickness

// Bottom offset. Hotbar has moved to the top row so the frost bar sits
// flush with the bottom safe-area inset now — a small nudge keeps it
// off the very edge on both desktop and mobile.
const BAR_BOTTOM_DT = 24
const BAR_BOTTOM_MB = 16


// MARK: Palette
// Warm blocks stay a constant gold at every level — urgency reads from
// the growing ice bar on the right, not from a colour shift. Keeps the
// palette calm and coherent with the campfire glow.
const COL_WARM   = Color4.create(1.00, 0.80, 0.30, 1.00)

// Cold fill — ice-blue block that takes over from the right as frost
// rises. Deliberately a hard fill (not a ghost slot) so the bar never
// reads as "empty", only as "warm vs cold".
const COL_COLD    = Color4.create(0.42, 0.60, 0.98, 1.00) // paint-blue ice
// Inner frame + outer frame both use the same tinted-black background
// as the action-bar buttons (PANEL_BG / statsBg, ~0.55 alpha) so the
// whole HUD reads as one visual system.
const COL_FRAME   = Color4.create(0, 0, 0, 0.55)
const COL_BORDER  = Color4.create(0, 0, 0, 0.55)
// White outline that matches the action-bar buttons (see
// TORCH_BORDER_OFF in layer.brushSize.tsx) so the frost bar reads
// as part of the same HUD system.
const COL_BORDER_WHITE = Color4.create(1, 1, 1, 0.75)
const BORDER_WHITE_W   = 4

// Corner radii — outer frame a hair larger than the inner, and segments
// get a tiny radius so the outermost ones don't fight the frame's
// rounded corners.
const RADIUS_OUTER = 6
const RADIUS_INNER = 4
const RADIUS_SEG   = 2


// MARK: FrostBarLayer
class FrostBarLayer extends Layer {
	constructor() {
		super({
			id  : 'frostBar',
			zone: ZoneType.BottomCenter,
		})
	}

	body() {
		const frost      = getFrostLocal()
		const warmthPct  = Math.max(0, Math.min(1, 1 - frost / FROST_MAX))
		// Round up so the last sliver of warmth still shows a full block;
		// only a truly full frost bar (>= FROST_MAX) shows zero warm blocks.
		const warmBlocks = frost >= FROST_MAX ? 0 : Math.max(1, Math.ceil(warmthPct * SEGMENT_COUNT))
		const segSize    = isMobile() ? SEG_SIZE_MB : SEG_SIZE_DT
		const bottom     = isMobile() ? BAR_BOTTOM_MB : BAR_BOTTOM_DT

		const innerW = SEGMENT_COUNT * segSize + (SEGMENT_COUNT - 1) * SEG_GAP + FRAME_PAD * 2
		const innerH = segSize + FRAME_PAD * 2

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
						margin      : { right: i < SEGMENT_COUNT - 1 ? SEG_GAP : 0 },
						borderRadius: RADIUS_SEG,
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
					alignItems    : 'flex-end',
					margin        : { bottom },
					pointerFilter : 'none',
				}}
			>
				{/* Outer frame — same tinted-black bg + rounded corners as the
				   action-bar buttons, so the HUD reads as one system. */}
				<UiEntity
					key         = "ui_FrostBar_border"
					uiTransform = {{
						width          : innerW + BORDER_PX * 2,
						height         : innerH + BORDER_PX * 2,
						justifyContent : 'center',
						alignItems     : 'center',
						borderRadius   : RADIUS_OUTER,
						borderWidth    : BORDER_WHITE_W,
						borderColor    : COL_BORDER_WHITE,
					}}
					uiBackground = {{ color: COL_BORDER }}
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
							padding       : { top: FRAME_PAD, bottom: FRAME_PAD, left: FRAME_PAD, right: FRAME_PAD },
							borderRadius  : RADIUS_INNER,
						}}
						uiBackground = {{ color: COL_FRAME }}
					>
						{segments}
					</UiEntity>
				</UiEntity>
			</UiEntity>
		)
	}
}


export const frostBarLayer = new FrostBarLayer()
