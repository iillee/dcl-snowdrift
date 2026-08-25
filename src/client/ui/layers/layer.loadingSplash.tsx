/**
 * layer.loadingSplash.tsx — cold-open + world-rebuild splash.
 *
 * Full-screen thumbnail overlay shown in two situations:
 *   1. Cold-open — from scene start until the first maze rebuild's
 *      spawn queue drains. Hides the initial tile-pop-in seconds.
 *   2. Cycle rollover — a temporary override triggered by
 *      showRebuildSplash(ms). Covers the ~few seconds while the world
 *      regenerates around the player (maze reshuffle, hidden fire
 *      relocation, teleport home).
 *
 * There's no fade — the layer just stops rendering on the frame the
 * relevant signal flips. If we want a fade later, wire an alpha ramp
 * here that ticks down over ~500 ms after the last signal releases.
 */

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { isInitialLoadComplete, isInnerRingLoadComplete, isRebuilding } from 'src/client/maze/rebuild'


const SPLASH_IMAGE = 'assets/images/snowdrift.png'


// MARK: Rebuild override state
// Absolute wall-clock ms until which the splash forces itself visible
// regardless of the cold-open latch. Zero means no override active.
let rebuildOverrideUntilMs = 0


// MARK: showRebuildSplash
/**
 * Force the splash on for `durationMs` from now. Called by the cycle
 * rollover handler in src/client/cycle.ts so players see a clean
 * "world is regenerating" curtain instead of the maze teardown and
 * teleport happening under their feet in-view.
 */
export function showRebuildSplash(durationMs: number): void {
	const until = Date.now() + durationMs
	if (until > rebuildOverrideUntilMs) rebuildOverrideUntilMs = until
	console.log(`layer.loadingSplash: showRebuildSplash: covering next ${durationMs}ms`)
}


// MARK: isSplashActive
/**
 * Splash stays visible while ANY of the following is true:
 *   1. Cold-open: initial load hasn't completed yet.
 *   2. Rebuild override timer is still running (dev-roll or real
 *      cycle rollover triggered showRebuildSplash).
 *   3. Maze cascade is still spawning tiles — covers the case where
 *      the rebuild-override timer elapsed but the tile stream is
 *      still in flight (large mazes take >3 s to fill in).
 */
function isSplashActive(): boolean {
	// Cold-open: drop the splash as soon as the inner ring around the
	// campfire has finished spawning, not the entire 900-tile playfield.
	// Outer rings continue to stream in behind the player.
	if (!isInnerRingLoadComplete()) return true
	if (Date.now() < rebuildOverrideUntilMs) return true
	// Once the override window has opened at least once (i.e. we're
	// past cold-open and a rebuild has been requested), keep the
	// splash up until the tile cascade finishes. Without this the
	// splash uncovers a half-built maze on slower machines.
	//
	// Uses the full-drain latch (isInitialLoadComplete + isRebuilding)
	// rather than the inner-ring latch — mid-session rollovers should
	// stay covered for the entire rebuild, not just the inner ring.
	if (rebuildOverrideUntilMs > 0 && isRebuilding()) return true
	// Silence unused-import lint now that isInitialLoadComplete is
	// only referenced conditionally above.
	void isInitialLoadComplete
	return false
}


// MARK: LoadingSplashLayer
/**
 * Full-screen splash pinned above every other layer. Renders the scene
 * thumbnail centred and scaled to cover; hides itself once initial
 * tile spawn has completed AND no rebuild override is active.
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
		if (!isSplashActive()) return <UiEntity />

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
