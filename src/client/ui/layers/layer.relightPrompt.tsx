/**
 * layer.relightPrompt.tsx — proximity tooltip: "Press E to light" /
 * "Press E to top off".
 *
 * Visible when ALL of the following are true:
 *   - torch is equipped
 *   - local player is inside the campfire heat ring
 *   - torch is either NOT lit, OR is lit but not at full fuel
 *     (so the player can walk back to the fire and re-press E to
 *     top off before heading out again).
 *
 * The player still has to press E — this layer is only the affordance
 * hint. The actual light/refill happens in src/client/torchInput.ts,
 * whose E-press handler already calls relightTorch() unconditionally
 * inside the radius, and relightTorch() refills fuel to max.
 *
 * Body is re-evaluated per frame by the UI kit, so we sample the
 * player Transform + torch state inline. Cheap: 3 subs, 2 mults, one
 * compare.
 */

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { Transform, engine } from '@dcl/sdk/ecs'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { CAMPFIRE_RELIGHT_RADIUS_SQ_M, CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { getTorchFuelFraction, isTorchEquipped, isTorchLit }             from 'src/client/torchEquip'
import { UI_THEME }                                                      from 'src/client/ui/theme/settings'


const { fontSizes, borderRadius } = UI_THEME

const BG        = Color4.create(0, 0, 0, 0.65)
const FG        = Color4.create(1, 0.95, 0.85, 1)
const KEY_BG    = Color4.create(1, 0.75, 0.35, 0.95)
const KEY_FG    = Color4.create(0.1, 0.05, 0, 1)


// Fuel fraction above which a lit torch is considered "full enough"
// that the top-off prompt hides. Just below 1.0 so the prompt vanishes
// the instant after a successful top-off press.
const TOP_OFF_HIDE_THRESHOLD = 0.98


// MARK: shouldShowPrompt
/**
 * Visibility gates in one place. Returns false early on any failed
 * condition to keep the per-frame cost minimal when hidden (the
 * common case).
 */
function shouldShowPrompt(): boolean {
	if (!isTorchEquipped()) return false
	// Lit AND essentially full — nothing to gain from another E-press.
	if (isTorchLit() && getTorchFuelFraction() >= TOP_OFF_HIDE_THRESHOLD) return false

	const t = Transform.getOrNull(engine.PlayerEntity)
	if (t === null) return false

	const dx = t.position.x - CAMPFIRE_WORLD_X
	const dz = t.position.z - CAMPFIRE_WORLD_Z
	return dx * dx + dz * dz <= CAMPFIRE_RELIGHT_RADIUS_SQ_M
}


// MARK: RelightPromptLayer
/**
 * Bottom-center tooltip that appears above the hotbar when the player
 * is standing in the fire's heat ring holding an unlit torch. Empty
 * body when hidden — zero UI cost while not shown.
 */
class RelightPromptLayer extends Layer {
	constructor() {
		super({
			id  : 'relightPrompt',
			zone: ZoneType.BottomCenter,
		})
	}

	body() {
		if (!shouldShowPrompt()) return <UiEntity key="ui_RelightPrompt_hidden" uiTransform={{ display: 'none' }} />

		return (
			<UiEntity
				key         = "ui_RelightPrompt_root"
				uiTransform = {{
					// Sits above the hotbar (hotbar is ~64px tall at bottom).
					// Extra margin.bottom lifts it clear of the slot.
					margin      : { bottom: 200 },
					flexDirection: 'row',
					alignItems  : 'center',
					padding     : { top: 8, bottom: 8, left: 12, right: 14 },
					borderRadius: borderRadius.sm,
				}}
				uiBackground = {{ color: BG }}
			>
				{/* Faux amber border via a 2px wrapper would double the
				    element count; a single background + key chip reads
				    fine at HUD scale, so we skip the border for now. */}
				<UiEntity
					key         = "ui_RelightPrompt_key"
					uiTransform = {{
						width        : 26,
						height       : 26,
						margin       : { right: 10 },
						borderRadius : borderRadius.sm,
						justifyContent: 'center',
						alignItems   : 'center',
					}}
					uiBackground = {{ color: KEY_BG }}
				>
					{/* Label child with an optical top-nudge — DCL's text
					    baseline sits low inside a uiText-only entity, so
					    switching to a flex-centred Label + a small negative
					    top margin visually centres the glyph on the chip. */}
					<Label
						value    = "E"
						fontSize = {fontSizes.md}
						color    = {KEY_FG}
						font     = "sans-serif"
						textAlign= "middle-center"
						uiTransform = {{
							width : '100%',
							height: '100%',
							margin: { top: -2, left: 2 },
						}}
					/>
				</UiEntity>
				<UiEntity
					key         = "ui_RelightPrompt_label"
					uiTransform = {{ width: 'auto', height: 26 }}
					uiText      = {{
						value    : 'Light torch',
						fontSize : fontSizes.md,
						color    : FG,
						textAlign: 'middle-left',
					}}
				/>
			</UiEntity>
		)
	}
}


export const relightPromptLayer = new RelightPromptLayer()
