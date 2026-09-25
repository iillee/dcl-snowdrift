/**
 * layer.loadingSplash.tsx — cold-open thumbnail + mid-game black cover.
 *
 *   1. Cold-open — snowdrift.png until snow settles and cliff GLBs load.
 *   2. Mid-game regen — solid black, never the thumbnail. Ember-fail
 *      owns its own black cards, so this cover stays off during that
 *      cinematic.
 */

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { isEmberFailing } from 'src/client/emberFail'
import { arePerimeterModelsReady, hasPerimeterSpawned } from 'src/client/perimeter'
import { isSnowRebuilding, isSnowSettled } from 'src/client/snow/snowRenderer'


const SPLASH_IMAGE = 'assets/images/snowdrift.png'

// Minimum time (ms) the cold-open splash stays visible from module
// load, even if the first maze rebuild's spawn queue drains sooner.
const COLD_OPEN_MIN_MS = 2000

const coldOpenStartedAtMs = Date.now()

// Once the first winter has been shown, the thumbnail must never
// return. Mid-game perimeter teardown used to look like a cold-open
// (cliffs go to zero for a frame) and flashed snowdrift.png on OUT.
let coldOpenReleased = false


// MARK: isColdOpenActive

/** True only for the first load-in. Never again after that. */
function isColdOpenActive(): boolean {
	if (coldOpenReleased) return false
	if (isEmberFailing()) return false
	if (!isSnowSettled()) return true
	if (!hasPerimeterSpawned() || !arePerimeterModelsReady()) return true
	if (Date.now() - coldOpenStartedAtMs < COLD_OPEN_MIN_MS) return true
	coldOpenReleased = true
	return false
}


// MARK: isMidGameCoverActive

/**
 * Black curtain for a mid-game seed roll that is not the ember-fail
 * cinematic. Ember-fail already holds black + title cards.
 */
function isMidGameCoverActive(): boolean {
	if (isEmberFailing()) return false
	if (isColdOpenActive()) return false
	if (isSnowRebuilding()) return true
	if (hasPerimeterSpawned() && !arePerimeterModelsReady()) return true
	return false
}


// MARK: LoadingSplashLayer
/**
 * Full-screen splash pinned above every other layer. Thumbnail on
 * cold-open only; mid-game regen is a black field.
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
		if (isColdOpenActive()) {
			return (
				<UiEntity
					key         = "ui_LoadingSplash_cold"
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
