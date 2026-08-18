/**
 * snowfallAudio.ts — looping ambient snowfall sound tied to precipitation.
 *
 * A single AudioSource parented to the camera (so the sound tracks the
 * player anywhere in the scene). One clip, four volume levels, no
 * playback restarts on level changes — only the volume and playing
 * flag are mutated in place so cross-fades between LIGHT/MEDIUM/HEAVY
 * are seamless.
 *
 * Muted when precipitation is CLEAR to avoid dead-air loops.
 */

import { AudioSource, Entity, Transform, engine } from '@dcl/sdk/ecs'

import { PrecipitationLevel, getPrecipitation } from 'src/client/snowfall'


// MARK: Tuning
const SNOWFALL_SRC = 'assets/sounds/snowfall.mp3'

// Per-level playback volume. CLEAR is muted at the source (playing=false)
// so the audio graph does not chew cycles on silence.
const VOLUME_BY_LEVEL: Record<PrecipitationLevel, number> = {
	[PrecipitationLevel.CLEAR ]: 0.0,
	[PrecipitationLevel.LIGHT ]: 0.08,
	[PrecipitationLevel.MEDIUM]: 0.20,
	[PrecipitationLevel.HEAVY ]: 0.40,
}


// MARK: State
let audioEnt: Entity = 0 as Entity


// MARK: applyLevel
/** Push the current precipitation's volume + play state onto the source. */
function applyLevel(): void {
	if (!audioEnt) return

	const level  = getPrecipitation()
	const volume = VOLUME_BY_LEVEL[level]
	const play   = level !== PrecipitationLevel.CLEAR

	AudioSource.createOrReplace(audioEnt, {
		audioClipUrl: SNOWFALL_SRC,
		loop        : true,
		global      : true,
		playing     : play,
		volume      : volume,
	})
}


// MARK: setupSnowfallAudio
/**
 * Spawn the snowfall audio source parented to the camera and apply the
 * initial volume for whatever the current precipitation level is.
 * Idempotent — safe to call once from client bootstrap.
 */
export function setupSnowfallAudio(): void {
	if (audioEnt) {
		console.log('snowfallAudio: setupSnowfallAudio: already spawned, skipping')
		return
	}

	audioEnt = engine.addEntity()
	Transform.create(audioEnt, { parent: engine.CameraEntity })
	applyLevel()
	console.log('snowfallAudio: setupSnowfallAudio: source parented to camera')
}


// MARK: refreshSnowfallAudio
/**
 * Re-apply the audio settings based on the current precipitation level.
 * Called from setPrecipitation so weather changes update the sound in
 * lockstep with the visuals.
 */
export function refreshSnowfallAudio(): void {
	if (!audioEnt) return
	applyLevel()
}
