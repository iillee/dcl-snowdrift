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
// CyclePanel is rendered inline by ClockButton (see layer.brushSize.tsx)
// so it's anchored to the clock icon — not a top-level kit layer.
import { deathFadeLayer }     from 'src/client/ui/layers/layer.deathFade'
import { frostFlashLayer }    from 'src/client/ui/layers/layer.frostFlash'
import { frostBarLayer }              from 'src/client/ui/layers/layer.frostBar'
import { hotbarBridgeLayer }          from 'src/client/ui/layers/layer.hotbarBridge'
import { inventoryHotbarLayer }       from 'src/client/ui/layers/layer.inventoryHotbar'
import { helpPanelLayer }             from 'src/client/ui/layers/layer.helpPanel'
import { hiddenCampfirePromptLayer }  from 'src/client/ui/layers/layer.hiddenCampfirePrompt'
// hotbarLayer retired — the torch button now lives inside the top
// action bar (see layer.brushSize.tsx > TorchButton). The layer file
// is kept in-tree for a future hand-slot revival but no longer
// registered here.
import { loadingSplashLayer } from 'src/client/ui/layers/layer.loadingSplash'
import { preloadLayer }       from 'src/client/ui/layers/layer.preload'
import { feedPromptLayer }    from 'src/client/ui/layers/layer.feedPrompt'
import { relightPromptLayer } from 'src/client/ui/layers/layer.relightPrompt'
import { serverStatsLayer }   from 'src/client/ui/layers/layer.serverStats'
import { topDownPanLayer }    from 'src/client/ui/layers/layer.topDownPan'
// versionLayer is retired — the version chip now lives inside the
// help panel footer (see layer.helpPanel > ui_HelpPanel_version).


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
			// Preload sits first so texture fetches for HUD PNGs kick off
			// at scene boot rather than the first frame each icon renders.
			// Invisible, off-screen; no z-order or interaction impact.
			preloadLayer,
			topDownPanLayer,
			// Frost segment-gain flash renders BELOW HUD chrome so the bar,
			// buttons, and prompts stay legible while the blue tint bleeds
			// across the world. ZoneType.FullScreen but sits early in the
			// z-stack; deathFade / splash still cover it.
			frostFlashLayer,
			actionBarLayer,
			frostBarLayer,
			// Bottom-center hotbar hosting the Torch (E) + Wood (F) slots.
			// Previously inlined into frostBarLayer; pulled out so the top
			// row stays status-only and the inventory reads as a classic
			// action bar at the bottom of the screen.
			// Bridge sits BEFORE the hotbar + prompts so its gold strip
			// renders BEHIND both, hiding the seam between button and
			// tooltip. Pointer-inert; taps still hit button / tooltip.
			hotbarBridgeLayer,
			inventoryHotbarLayer,
			relightPromptLayer,
			feedPromptLayer,
			hiddenCampfirePromptLayer,
			// Help panel — slides down from the top when the HelpButton (?)
			// is clicked. Registered above HUD chrome so its border isn't
			// clipped by lower layers, but below deathFade / splash.
			helpPanelLayer,
			// Death fade must sit above gameplay HUD but below the cold-open
			// splash so a splash-during-death still covers the screen.
			deathFadeLayer,
			// Splash must be last so it renders on top of every other layer.
			loadingSplashLayer,
		],
	})
}
