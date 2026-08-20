/**
 * index.tsx \u2014 UI entry point.
 *
 * Registers every HUD layer through @stom66/dcl-ui-component-kit. Each
 * layer owns its own Zone (bottom-right chip, top-center action bar,
 * bottom-left debug panel, full-screen top-down pan controls). The kit
 * handles safe-area insets, layer visibility plumbing, and the render
 * loop \u2014 our layers only need to implement `body()`.
 *
 * Import setupUi from 'src/client/ui'.
 */

import { SetupUiComponentKit } from '@stom66/dcl-ui-component-kit'

import { SHOW_SERVER_STATS }  from 'src/client/devFlags'
import { actionBarLayer }     from 'src/client/ui/layers/layer.brushSize'
import { deathFadeLayer }     from 'src/client/ui/layers/layer.deathFade'
import { frostBarLayer }      from 'src/client/ui/layers/layer.frostBar'
// hotbarLayer retired — the torch button now lives inside the top
// action bar (see layer.brushSize.tsx > TorchButton). The layer file
// is kept in-tree for a future hand-slot revival but no longer
// registered here.
import { loadingSplashLayer } from 'src/client/ui/layers/layer.loadingSplash'
import { relightPromptLayer } from 'src/client/ui/layers/layer.relightPrompt'
import { serverStatsLayer }   from 'src/client/ui/layers/layer.serverStats'
import { topDownPanLayer }    from 'src/client/ui/layers/layer.topDownPan'
import { versionLayer }       from 'src/client/ui/layers/layer.version'


// MARK: setupUi
/**
 * Register every HUD layer with the UI Component Kit. Zone order in the
 * array is z-order (later = drawn above), so the pan overlay's drag
 * catcher sits above corner chrome but below the action bar's buttons.
 */
export function setupUi() {
	// Dev-only layers are prepended when their flag is on. Order matters:
	// the kit uses array position as z-order (later = above), so serverStats
	// stays at the bottom of the stack like it always was.
	const devLayers = SHOW_SERVER_STATS ? [serverStatsLayer] : []

	SetupUiComponentKit({
		layers: [
			...devLayers,
			topDownPanLayer,
			actionBarLayer,
			frostBarLayer,
			relightPromptLayer,
			versionLayer,
			// Death fade must sit above gameplay HUD but below the cold-open
			// splash so a splash-during-death still covers the screen.
			deathFadeLayer,
			// Splash must be last so it renders on top of every other layer.
			loadingSplashLayer,
		],
	})
}
