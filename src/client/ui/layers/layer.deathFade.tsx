/**
 * layer.deathFade.tsx — full-screen black fade overlay for frost death.
 *
 * Opacity is driven by getDeathFadeOpacity() from the death FSM. When
 * the FSM is IDLE the opacity is 0 and this layer renders an invisible
 * pass-through (pointer events fall through to the game). When the
 * FSM is dying, the overlay ramps to fully opaque and locks the screen
 * to black while the teleport + emote workaround runs.
 *
 * Sits above every gameplay layer but BELOW the loading splash so a
 * cold-open load still covers a still-fading corpse if that ever races.
 */

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { getDeathFadeOpacity } from 'src/client/frost/death'


// MARK: DeathFadeLayer
class DeathFadeLayer extends Layer {
	constructor() {
		super({
			id  : 'deathFade',
			zone: ZoneType.FullScreen,
		})
	}


	// MARK: body
	body() {
		const alpha = getDeathFadeOpacity()
		if (alpha <= 0) return <UiEntity key="ui_DeathFade_hidden" uiTransform={{ display: 'none' }} />

		return (
			<UiEntity
				key         = "ui_DeathFade_root"
				uiTransform = {{
					width : '100%',
					height: '100%',
					// Overlay must not eat clicks even when opaque — the
					// death FSM watches inputSystem, and no HUD element
					// is reachable during death anyway.
					pointerFilter: 'none',
				}}
				uiBackground = {{ color: Color4.create(0, 0, 0, alpha) }}
			/>
		)
	}
}


export const deathFadeLayer = new DeathFadeLayer()
