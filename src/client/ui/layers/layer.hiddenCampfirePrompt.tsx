/**
 * layer.hiddenCampfirePrompt.tsx — proximity tooltip: "Light campfire"
 * over the hidden (buried) pit.
 *
 * Visible when ALL of the following are true:
 *   - torch is equipped and lit
 *   - local player is inside the hidden campfire's ignite radius
 *   - the hidden fire is not yet lit (and no ignite request is
 *     already in flight to the server)
 *
 * Visually a direct twin of layer.relightPrompt — same gold bubble,
 * same flush placement against the LEFT side of the Torch hotbar
 * button. Only the label differs ("LIGHT CAMPFIRE" vs "LIGHT TORCH").
 * When both would show on the same frame, layer.relightPrompt yields
 * to this one via a check on isHiddenCampfirePromptVisible() — the
 * hidden ignite is the higher-value action.
 *
 * The player still has to press E — this layer is only the affordance
 * hint. The actual ignition path is torchInput.ts, whose E-press
 * handler calls requestHiddenIgnite() when isReadyToIgniteHidden() is
 * true.
 */

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { engine } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { isReadyToIgniteHidden, requestHiddenIgnite } from 'src/client/hiddenCampfire'
import { UI_THEME }                                   from 'src/client/ui/theme/settings'


const { fontSizes, borderRadius } = UI_THEME


// Solid warm gold background with black text — shared visual language
// with layer.relightPrompt / layer.feedPrompt so all three hotbar-flush
// tooltips read as the same affordance family.
const BG_GOLD     = Color4.create(1.00, 0.80, 0.30, 1)
const FG_BLACK    = Color4.create(0, 0, 0, 1)
const BORDER_GOLD = Color4.create(1.00, 0.80, 0.30, 0.95)


// Per-platform sizing keyed off the underlying hotbar button. Kept in
// sync with layer.relightPrompt / layer.feedPrompt — if you tweak
// these there, tweak them here too (all three should stay identical
// so the tooltip family reads as one system).
const TOOLTIP_H_MB    = 112
const TOOLTIP_H_DT    = 71
const HOTBAR_HALF_MB  = 128
const HOTBAR_HALF_DT  = 80
const BOTTOM_MB       = 0
const BOTTOM_DT       = 30
const BORDER_W_MB     = 4
const BORDER_W_DT     = 3
const PADDING_X_MB    = 20
const PADDING_X_DT    = 14


// MARK: shouldShowPrompt
function shouldShowPrompt(): boolean {
	return isReadyToIgniteHidden()
}


// MARK: HiddenCampfirePromptLayer
/**
 * Bottom-flush tooltip that appears against the LEFT side of the
 * Torch hotbar button when the player is standing on the hidden pit
 * holding a lit torch. Empty body when hidden — zero UI cost while
 * not shown.
 */
class HiddenCampfirePromptLayer extends Layer {
	constructor() {
		super({
			id  : 'hiddenCampfirePrompt',
			zone: ZoneType.BottomCenter,
		})
	}

	// MARK: body
	body() {
		if (!shouldShowPrompt()) {
			return <UiEntity key="ui_HiddenCampfirePrompt_hidden" uiTransform={{ display: 'none' }} />
		}

		const mobile   = isMobile()
		const height   = mobile ? TOOLTIP_H_MB   : TOOLTIP_H_DT
		const halfRow  = mobile ? HOTBAR_HALF_MB : HOTBAR_HALF_DT
		const bottomPx = mobile ? BOTTOM_MB      : BOTTOM_DT
		const borderW  = mobile ? BORDER_W_MB    : BORDER_W_DT
		const padX     = mobile ? PADDING_X_MB   : PADDING_X_DT
		const fontPx   = mobile ? fontSizes.md * 2 : fontSizes.md * 1.25
		const labelH   = Math.round(fontPx * 1.6)

		return (
			<UiEntity
				key         = "ui_HiddenCampfirePrompt_root"
				uiTransform = {{
					positionType : 'absolute',
					position     : { bottom: bottomPx, right: '50%' },
					margin       : { right: halfRow },
					height       : height,
					flexDirection: 'row',
					alignItems   : 'center',
					padding      : { top: 0, bottom: 0, left: padX, right: padX },
					borderRadius : borderRadius.md,
					borderWidth  : borderW,
					borderColor  : BORDER_GOLD,
				}}
				uiBackground = {{ color: BG_GOLD }}
				// Clicking the tooltip also triggers the ignite on both
				// platforms — the bubble is the primary tap target next
				// to the button.
				onMouseDown = {requestHiddenIgnite}
			>
				{/* Desktop uses <b> markup for a bolder read; mobile stays
				   on the plain string to avoid the rich-text hitbox mismatch
				   (see docs/bug-reports/react-ecs-richtext-hitbox-mismatch.md). */}
				<Label
					key         = "ui_HiddenCampfirePrompt_label"
					value       = {mobile ? 'LIGHT CAMPFIRE' : '<b>LIGHT CAMPFIRE</b>'}
					fontSize    = {fontPx}
					color       = {FG_BLACK}
					font        = "sans-serif"
					textAlign   = "middle-left"
					uiTransform = {{ width: 'auto', height: labelH }}
				/>
			</UiEntity>
		)
	}
}


export const hiddenCampfirePromptLayer = new HiddenCampfirePromptLayer()


// MARK: isHiddenCampfirePromptVisible
/**
 * True while the hidden-campfire tooltip would render this frame.
 * Read by:
 *   - layer.relightPrompt to yield its slot to this one on overlap
 *   - layer.hotbarBridge to draw the LEFT gold connector alongside
 *     the tooltip
 * Cheap — sampled per frame directly from the same predicate the
 * body() uses, no extra state to keep in sync.
 */
export function isHiddenCampfirePromptVisible(): boolean {
	return shouldShowPrompt()
}


// MARK: setupHiddenCampfirePromptVisibility
/**
 * Idempotent no-op today: body() gates on shouldShowPrompt() directly
 * so the tooltip snaps in/out with the ignite-ready state. Kept as a
 * function so the bootstrap call site matches the other prompt layers
 * and future animation work has a hook.
 */
let _hiddenPromptInstalled = false
export function setupHiddenCampfirePromptVisibility(): void {
	if (_hiddenPromptInstalled) return
	_hiddenPromptInstalled = true
	// Reserved for a future visibility watcher (edge-triggered logs,
	// analytics, animation tweens). Keeping the engine.addSystem noop
	// out — no per-frame cost until we actually need it.
	void engine
}
