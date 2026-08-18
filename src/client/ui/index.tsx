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

import { actionBarLayer }    from 'src/client/ui/layers/layer.brushSize'
import { serverStatsLayer }  from 'src/client/ui/layers/layer.serverStats'
import { topDownPanLayer }   from 'src/client/ui/layers/layer.topDownPan'
import { versionLayer }      from 'src/client/ui/layers/layer.version'


// MARK: setupUi
/**
 * Register every HUD layer with the UI Component Kit. Zone order in the
 * array is z-order (later = drawn above), so the pan overlay's drag
 * catcher sits above corner chrome but below the action bar's buttons.
 */
export function setupUi() {
	SetupUiComponentKit({
		layers: [
			serverStatsLayer,
			topDownPanLayer,
			actionBarLayer,
			versionLayer,
		],
	})
}
