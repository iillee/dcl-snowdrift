/**
 * index.tsx \u2014 UI entry point.
 *
 * Registers every HUD layer through @stom66/dcl-ui-component-kit. Each
 * layer owns its own Zone (bottom-right chip, top-center action bar,
 * bottom-left debug panel, mobile top-down zoom / rotate cluster). The kit
 * handles safe-area insets, layer visibility plumbing, and the render
 * loop \u2014 our layers only need to implement `body()`.
 *
 * Import setupUi from 'src/client/ui'.
 */

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { Layer, SetupUiComponentKit } from '@stom66/dcl-ui-component-kit'

import { isMonumentCinematicActive } from 'src/client/monumentCinematic'
import { cinematicLayer }     from 'src/client/ui/layers/layer.cinematic'

import { SHOW_SERVER_STATS } from 'src/client/devFlags'
import { actionBarLayer }     from 'src/client/ui/layers/layer.brushSize'
// CyclePanel is rendered inline by ClockButton (see layer.brushSize.tsx)
// so it's anchored to the clock icon — not a top-level kit layer.
import { daySplashLayer }     from 'src/client/ui/layers/layer.daySplash'
import { thawSplashLayer }    from 'src/client/ui/layers/layer.thawSplash'
import { summitMapLayer }    from 'src/client/ui/layers/layer.summitMap'
import { deathFadeLayer }     from 'src/client/ui/layers/layer.deathFade'
import { emberFailLayer }     from 'src/client/ui/layers/layer.emberFail'
import { frostFlashLayer }    from 'src/client/ui/layers/layer.frostFlash'
import { frostBarLayer }              from 'src/client/ui/layers/layer.frostBar'
import { hotbarBridgeLayer }          from 'src/client/ui/layers/layer.hotbarBridge'
import { inventoryHotbarLayer }       from 'src/client/ui/layers/layer.inventoryHotbar'
import { helpPanelLayer }             from 'src/client/ui/layers/layer.helpPanel'
import { leaderboardLayer }           from 'src/client/ui/layers/layer.leaderboard'
import { expeditionCountdownLayer }   from 'src/client/ui/layers/layer.expeditionCountdown'
import { hiddenCampfirePromptLayer }  from 'src/client/ui/layers/layer.hiddenCampfirePrompt'
// hotbarLayer retired — the torch button now lives inside the top
// action bar (see layer.brushSize.tsx > TorchButton). The layer file
// is kept in-tree for a future hand-slot revival but no longer
// registered here.
import { loadingSplashLayer } from 'src/client/ui/layers/layer.loadingSplash'
import { preloadLayer }       from 'src/client/ui/layers/layer.preload'
import { chopPromptLayer }    from 'src/client/ui/layers/layer.chopPrompt'
import { feedPromptLayer }    from 'src/client/ui/layers/layer.feedPrompt'
import { relightPromptLayer } from 'src/client/ui/layers/layer.relightPrompt'
import { serverStatsLayer }   from 'src/client/ui/layers/layer.serverStats'
import { topDownZoomLayer }   from 'src/client/ui/layers/layer.topDownZoom'
// versionLayer is retired — the version chip now lives inside the
// help panel footer (see layer.helpPanel > ui_HelpPanel_version).


// MARK: hideDuringCinematic
/**
 * Wrap gameplay HUD layers so they collapse (display: 'none') while the
 * monument cinematic runs. The wrapper is always rendered and the layer's
 * own tree stays mounted (unmounting lets ReactEcs recycle UiEntities into
 * other layers, see the kit's Layer.keepContentMounted note).
 */
function hideDuringCinematic(layers: Layer[]): Layer[] {
	for (const layer of layers) {
		const orig = layer.render.bind(layer)
		layer.render = () => (
			<UiEntity
				key         = {`ui_cineHide_${layer.id}`}
				uiTransform = {{
					width         : '100%',
					height        : '100%',
					display       : isMonumentCinematicActive() ? 'none' : 'flex',
					flexDirection : 'column',
					alignItems    : 'center',
					justifyContent: 'center',
					flexShrink    : 0,
					pointerFilter : 'none',
				}}
			>
				{orig()}
			</UiEntity>
		)
	}
	return layers
}


// MARK: setupUi
/**
 * Register every HUD layer with the UI Component Kit. Zone order in the
 * array is z-order (later = drawn above), so the zoom overlay
 * sits above corner chrome but below the action bar's buttons.
 */
export function setupUi() {
	// Dev-only layers are prepended when their flag is on. Order matters:
	// the kit uses array position as z-order (later = above), so serverStats
	// stays at the bottom of the stack like it always was.
	const devLayers = SHOW_SERVER_STATS ? [serverStatsLayer] : []

	SetupUiComponentKit({
		layers: [
			...devLayers,
			// Preload sits first so texture fetches for HUD PNGs kick off
			// at scene boot rather than the first frame each icon renders.
			// Invisible, off-screen; no z-order or interaction impact.
			preloadLayer,
			...hideDuringCinematic([topDownZoomLayer]),
			// Frost segment-gain flash renders BELOW HUD chrome so the bar,
			// buttons, and prompts stay legible while the blue tint bleeds
			// across the world. ZoneType.FullScreen but sits early in the
			// z-stack; deathFade / splash still cover it.
			frostFlashLayer,
			...hideDuringCinematic([actionBarLayer, frostBarLayer]),
			// Bottom-center hotbar hosting the Torch (E) + Wood (F) slots.
			// Previously inlined into frostBarLayer; pulled out so the top
			// row stays status-only and the inventory reads as a classic
			// action bar at the bottom of the screen.
			// Bridge sits BEFORE the hotbar + prompts so its gold strip
			// renders BEHIND both, hiding the seam between button and
			// tooltip. Pointer-inert; taps still hit button / tooltip.
			...hideDuringCinematic([
				hotbarBridgeLayer,
				inventoryHotbarLayer,
				relightPromptLayer,
				feedPromptLayer,
				chopPromptLayer,
				hiddenCampfirePromptLayer,
			]),
			// Help panel — slides down from the top when the HelpButton (?)
			// is clicked. Registered above HUD chrome so its border isn't
			// clipped by lower layers, but below deathFade / splash.
			...hideDuringCinematic([helpPanelLayer]),
			// Fastest-completion leaderboard (star button): same slot + look as the help panel.
			...hideDuringCinematic([leaderboardLayer]),
			// "NEW EXPEDITION IN m:ss" chip under the top row while the shared reset countdown runs.
			...hideDuringCinematic([expeditionCountdownLayer]),
			// Monument cinematic letterbox: above HUD chrome, below splashes.
			cinematicLayer,
			// Sunrise "Day X" sits above HUD chrome, below death / ember /
			// loading so those still cover it.
			daySplashLayer,
			// Summit world-map popup (knowledge only).
			summitMapLayer,
			// World-thaw victory card (3/3 stations) � above day splash, below death.
			thawSplashLayer,
			// Death fade must sit above gameplay HUD but below the cold-open
			// splash so a splash-during-death still covers the screen.
			deathFadeLayer,
			// Ember-fail game over sits above death fade. Splash is skipped
			// during fail so this title stays readable on black.
			emberFailLayer,
			// Splash must be last so it renders on top of every other layer.
			loadingSplashLayer,
		],
	})
}
