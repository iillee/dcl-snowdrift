/**
 * layer.frostBar.tsx — bottom-center survival gauge (the "warmth pill").
 *
 * Reads the local player's frost value from src/client/frost/accumulation
 * and paints a horizontal pill that fills from the RIGHT as frost rises:
 * a warm gold base with an icy-blue overlay creeping in as danger grows.
 * At 0% the bar is fully gold (safe / warm); at 100% it's fully iced.
 *
 * v1 shows only the warmth axis. The left "hand slot" cap (torch icon +
 * fuel ring) and any secondary tick marks are deferred until the torch
 * fuel system lands in step 4 of the frost survival plan.
 *
 * The Layer.body() closure re-runs every frame, so no explicit
 * subscription / signal wiring is needed — reading getFrostLocal()
 * inside body() naturally repaints as the value drifts.
 */

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { getFrostLocal } from 'src/client/frost/accumulation'
import { FROST_MAX } from 'src/shared/frost/tuning'
import { TEAM_COLORS } from 'src/shared/palette'
import { Team } from 'src/shared/team'
import { UI_THEME } from 'src/client/ui/theme/settings'


const { colors, borderRadius } = UI_THEME

// Bar geometry. Mobile shrinks slightly to leave the joystick area alone.
// BORDER_PX is added on all sides via a wrapping black frame (React-ECS
// has no native border property).
const BAR_HEIGHT      = 24
const BAR_WIDTH_DT    = 320
const BAR_WIDTH_MB    = 260
const BAR_BOTTOM_DT   = 40
const BAR_BOTTOM_MB   = 24
const BORDER_PX       = 2

// Palette. Warm gold reads as "safe / hearth"; ice tint pulled from the
// paint palette so the HUD matches the melted-snow color players already
// see on the ground.
const WARM_GOLD  = Color4.create(1.00, 0.75, 0.30, 1.00)
const PAINT_BLUE = TEAM_COLORS[Team.Blue]
const BORDER     = Color4.Black()
const PANEL_BG   = colors.statsBg
void PANEL_BG // reserved for a future numeric label / hand-slot cap


// MARK: FrostBarLayer
/**
 * Wraps the pill in a full-width row so we can center a fixed-width
 * child. React-ECS doesn't support `left: 50%` self-centering, so this
 * flexbox row is the standard workaround (same pattern as
 * layer.cameraToggle).
 */
class FrostBarLayer extends Layer {
	constructor() {
		super({
			id  : 'frostBar',
			zone: ZoneType.BottomCenter,
		})
	}

	body() {
		const frost   = getFrostLocal()
		const pct     = Math.max(0, Math.min(1, frost / FROST_MAX))
		const barW    = isMobile() ? BAR_WIDTH_MB : BAR_WIDTH_DT
		const iceW    = Math.round(barW * pct)
		const bottom  = isMobile() ? BAR_BOTTOM_MB : BAR_BOTTOM_DT

		return (
			<UiEntity
				key = "ui_FrostBar_wrap"
				uiTransform = {{
					flexDirection : 'row',
					justifyContent: 'center',
					alignItems    : 'flex-end',
					margin        : { bottom },
					pointerFilter : 'none',
				}}
			>
				{/* Border frame: black rounded pill, slightly larger on all
				   sides than the inner pill. React-ECS has no native border,
				   so we fake it with an outer background and a padded inner. */}
				<UiEntity
					key = "ui_FrostBar_border"
					uiTransform = {{
						width        : barW + BORDER_PX * 2,
						height       : BAR_HEIGHT + BORDER_PX * 2,
						borderRadius : borderRadius.pill,
						justifyContent: 'center',
						alignItems   : 'center',
					}}
					uiBackground = {{ color: BORDER }}
				>
					{/* Inner pill: warm gold base + ice overlay stacked absolutely. */}
					<UiEntity
						key = "ui_FrostBar_pill"
						uiTransform = {{
							width        : barW,
							height       : BAR_HEIGHT,
							borderRadius : borderRadius.pill,
							flexDirection: 'row',
							alignItems   : 'center',
							justifyContent: 'flex-end',
						}}
						uiBackground = {{ color: WARM_GOLD }}
					>
						{/* Ice overlay: width scales with frost %, right-anchored. */}
						{iceW > 0 ? (
							<UiEntity
								key = "ui_FrostBar_ice"
								uiTransform = {{
									positionType: 'absolute',
									position    : { top: 0, right: 0 },
									width       : iceW,
									height      : BAR_HEIGHT,
									borderRadius: borderRadius.pill,
								}}
								uiBackground = {{ color: PAINT_BLUE }}
							/>
						) : null}
					</UiEntity>
				</UiEntity>
			</UiEntity>
		)
	}
}


export const frostBarLayer = new FrostBarLayer()
