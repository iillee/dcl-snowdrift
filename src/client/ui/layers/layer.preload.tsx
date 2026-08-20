/**
 * layer.preload.tsx — invisible HUD layer that forces critical UI
 * textures to load at scene boot instead of the first time they render.
 *
 * On a deployed World with a cold CDN, DCL's UI renderer requests a
 * texture the first frame a UiEntity references it, which produces a
 * visible "pop in" on the frost bar's flame icon and the torch slot's
 * torch.png / torch_unlit.png the first time each is shown. By
 * mounting 1×1 alpha-zero UiEntities pointing at every critical
 * texture inside a permanently-present layer, we push those network
 * fetches into scene load so the textures are already in the
 * renderer's cache when the real HUD elements appear.
 *
 * Cost: N tiny UiEntities at 1×1 with an invisible background. No
 * layout impact (positionType absolute, top/left off-screen), no
 * pointer surface, no per-frame work.
 */

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'


// Every UI PNG referenced by a HUD layer that has ever been reported
// as popping in. Add new entries here as they're introduced — the
// cost per texture is negligible and the win is a clean first paint.
const PRELOAD_SRCS = [
	'assets/images/flame.png',
	'assets/images/torch.png',
	'assets/images/torch_unlit.png',
	'assets/images/eye.png',
	'assets/images/muted.png',
	'assets/images/unmute.png',
	'assets/images/muted_padded.png',
	'assets/images/unmute_padded.png',
]

// Fully transparent so the tiles are invisible but the SDK still
// treats the texture as referenced and issues the fetch.
const TRANSPARENT = Color4.create(1, 1, 1, 0)


// MARK: PreloadLayer
class PreloadLayer extends Layer {
	constructor() {
		super({
			id  : 'preload',
			// FullScreen so absolute positioning has a viewport-sized
			// parent; the actual tiles sit off-screen and never occlude.
			zone: ZoneType.FullScreen,
		})
	}

	body() {
		return (
			<UiEntity
				key         = "ui_Preload_root"
				uiTransform = {{
					width        : '100%',
					height       : '100%',
					pointerFilter: 'none',
				}}
			>
				{PRELOAD_SRCS.map((src, i) => (
					<UiEntity
						key         = {`ui_Preload_${i}`}
						uiTransform = {{
							width       : 1,
							height      : 1,
							positionType: 'absolute',
							// Off-screen. Negative offsets keep the tile from
							// ever contributing a pixel to the final composite.
							position    : { top: -10, left: -10 },
						}}
						uiBackground = {{
							textureMode: 'stretch',
							texture    : { src },
							color      : TRANSPARENT,
						}}
					/>
				))}
			</UiEntity>
		)
	}
}


export const preloadLayer = new PreloadLayer()
