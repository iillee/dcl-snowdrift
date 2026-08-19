/**
 * layer.loadingSplash.tsx — cold-open loading splash.
 *
 * Full-screen thumbnail overlay shown from scene start until the first
 * maze rebuild's spawn queue drains. Hides the ~few seconds of tiles
 * popping in during initial load; once the world is standing the layer
 * unmounts and the player sees the assembled scene.
 *
 * Visibility signal: isInitialLoadComplete() latches true after the
 * first rebuild's tile stream finishes (src/client/maze/rebuild.ts).
 * There's no fade — the layer just stops rendering on the frame the
 * latch flips. If we want a fade later, wire an alpha ramp here that
 * ticks down over ~500 ms after the latch.
 */

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { isInitialLoadComplete } from 'src/client/maze/rebuild'


const SPLASH_IMAGE = 'assets/images/snowdrift.png'


// MARK: LoadingSplashLayer
/**
 * Full-screen splash pinned above every other layer. Renders the scene
 * thumbnail centred and scaled to cover; hides itself once initial
 * tile spawn has completed.
 */
class LoadingSplashLayer extends Layer {
	constructor() {
		super({
			id  : 'loadingSplash',
			zone: ZoneType.FullScreen,
		})
	}


	// MARK: body
	body() {
		if (isInitialLoadComplete()) return <UiEntity />

		return (
			<UiEntity
				key         = "ui_LoadingSplash_root"
				uiTransform = {{
					width         : '100%',
					height        : '100%',
					positionType  : 'absolute',
					justifyContent: 'center',
					alignItems    : 'center',
				}}
				uiBackground = {{
					textureMode: 'stretch',
					texture    : { src: SPLASH_IMAGE },
				}}
			/>
		)
	}
}


export const loadingSplashLayer = new LoadingSplashLayer()
