/**
 * layer.loadingSplash.tsx — cold-open black + mid-game black cover.
 *
 *   1. Cold-open — solid black, with the two-line hearth card, until a
 *      short min hold plus player collapsed / snow / cliffs ready, then
 *      a short fade.
 *   2. Mid-game regen — solid black, never a title card. Ember-fail
 *      owns its own black cards, so this cover stays off during that
 *      cinematic.
 */

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { COLD_OPEN_LINE } from 'src/shared/emberFail'

import { isEmberFailing } from 'src/client/emberFail'
import { isPlayerLaidDownAtHome } from 'src/client/frost/death'
import { hasTerrainSpawned, isTerrainReady } from 'src/client/terrain/terrainRenderer'
import { isSnowRebuilding, isSnowSettled } from 'src/client/snow/snowRenderer'
import { UI_THEME } from 'src/client/ui/theme/settings'


/**
 * Minimum wall-clock cover from script start. Readiness gates can hold
 * longer on slow loads; this floor keeps AvatarAttach / torch GLB from
 * racing the fade on fast/cached boots. ~3s is enough headroom without
 * feeling like a long load screen.
 */
const COLD_OPEN_MIN_HOLD_MS = 3000
/** Fade-out once the player is down and the world is ready to see. */
const COLD_OPEN_FADE_MS = 400
const { fontSizes } = UI_THEME

// Once the first winter has been shown, the cold-open cover must
// never return. Mid-game perimeter teardown used to look like a
// cold-open (cliffs go to zero for a frame).
const coldOpenStartedAt = Date.now()
let   coldOpenReleased  = false
let   fadeStartedAt: number | null = null


// MARK: isColdOpenReleased

/** True once the cold-open cover has faded out for good. */
export function isColdOpenReleased(): boolean {
	return coldOpenReleased
}


// MARK: isColdOpenHolding

/**
 * Solid black until the min hold has elapsed AND the player is
 * collapsed at the fire with snow+terrain ready. Min hold covers
 * attach/asset races; readiness gates cover slow machines.
 */
function isColdOpenHolding(): boolean {
	if (coldOpenReleased) return false
	if (isEmberFailing()) return false
	if (Date.now() - coldOpenStartedAt < COLD_OPEN_MIN_HOLD_MS) return true
	if (!isPlayerLaidDownAtHome()) return true
	if (!isSnowSettled()) return true
	if (!hasTerrainSpawned() || !isTerrainReady()) return true
	return false
}


// MARK: coldOpenAlpha

/**
 * 1 while holding, then a fade to 0. Ember-fail hides this cover so
 * its own cards can show.
 */
function coldOpenAlpha(): number {
	if (coldOpenReleased || isEmberFailing()) return 0
	if (isColdOpenHolding()) {
		fadeStartedAt = null
		return 1
	}
	if (fadeStartedAt === null) {
		fadeStartedAt = Date.now()
		console.log('loadingSplash: coldOpenAlpha: world ready, fading cover')
	}
	const t = (Date.now() - fadeStartedAt) / COLD_OPEN_FADE_MS
	if (t >= 1) {
		coldOpenReleased = true
		console.log('loadingSplash: coldOpenAlpha: cover released')
		return 0
	}
	return 1 - t
}


// MARK: isMidGameCoverActive

/**
 * Black curtain for a mid-game seed roll that is not the ember-fail
 * cinematic. Ember-fail already holds black + title cards.
 */
function isMidGameCoverActive(): boolean {
	if (isEmberFailing()) return false
	if (!coldOpenReleased) return false
	if (isSnowRebuilding()) return true
	if (hasTerrainSpawned() && !isTerrainReady()) return true
	return false
}


// MARK: isWorldCovered

/**
 * True while a full-screen cover hides the world: cold open (including
 * its fade), ember-fail, or a mid-game rebuild. Sunrise titles wait
 * on this so the day line is actually visible.
 */
export function isWorldCovered(): boolean {
	if (isEmberFailing()) return true
	if (!coldOpenReleased) return true
	return isMidGameCoverActive()
}


// MARK: LoadingSplashLayer
/**
 * Full-screen splash pinned above every other layer. Cold-open and
 * mid-game regen are both a black field.
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
		const alpha = coldOpenAlpha()
		const lines = COLD_OPEN_LINE.split('\n')
		const lineH = 56
		if (alpha > 0) {
			return (
				<UiEntity
					key         = "ui_LoadingSplash_cold"
					uiTransform = {{
						width          : '100%',
						height         : '100%',
						positionType   : 'absolute',
						alignItems     : 'center',
						justifyContent : 'center',
						flexDirection  : 'column',
					}}
					uiBackground = {{ color: Color4.create(0, 0, 0, alpha) }}
				>
					<UiEntity
						key         = "ui_LoadingSplash_lineWrap"
						uiTransform = {{
							width          : '84%',
							height         : lineH * lines.length,
							alignItems     : 'center',
							justifyContent : 'center',
							flexDirection  : 'column',
							opacity        : alpha,
						}}
					>
						{lines.map((text, i) => (
							<Label
								key         = {`ui_LoadingSplash_line_${i}`}
								value       = {text}
								fontSize    = {fontSizes.display}
								color       = {Color4.White()}
								font        = "sans-serif"
								textAlign   = "middle-center"
								uiTransform = {{ width: '100%', height: lineH }}
							/>
						))}
					</UiEntity>
				</UiEntity>
			)
		}

		if (isMidGameCoverActive()) {
			return (
				<UiEntity
					key         = "ui_LoadingSplash_mid"
					uiTransform = {{
						width : '100%',
						height: '100%',
						positionType: 'absolute',
					}}
					uiBackground = {{ color: Color4.Black() }}
				/>
			)
		}

		return <UiEntity key="ui_LoadingSplash_hidden" uiTransform={{ display: 'none' }} />
	}
}


export const loadingSplashLayer = new LoadingSplashLayer()
