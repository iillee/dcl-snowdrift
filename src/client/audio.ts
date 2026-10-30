/**
 * audio.ts — background music + UI / gameplay SFX.
 *
 * Music is parented to the camera so it stays at ear-level anywhere in
 * the scene. Starts muted so the scene loads quietly; the HUD mute
 * pill toggles it via toggleMusic().
 *
 * Playback position is tracked across pause/resume so the loop continues
 * where it left off instead of restarting each unmute. Pattern borrowed
 * from flagtag's boomboxState: the SDK reads currentTime on the
 * playing:false → true transition, so we must seek BEFORE flipping playing.
 *
 * One-shots use createOrReplace + currentTime: 0 on dedicated entities
 * so CRDT diff-checks cannot drop a retrigger, and so pickup / drop /
 * click cannot clobber each other on a shared source (a mobile failure
 * mode). Mobile also needs an unlock gesture before WebView audio will
 * play — unlockAudio() primes sources on the first real UI/SFX call.
 */

import { AudioSource, Entity, Transform, engine } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

const MUSIC_VOLUME = 0.4
const MUSIC_SRC = 'assets/sounds/HomeAgain_Loop.mp3'
const CLICK_SRC = 'assets/sounds/click.wav'
const SURGE_SRC = 'assets/sounds/surge.mp3'
const TORCH_SRC = 'assets/sounds/torch.mp3'
const FROST_SRC = 'assets/sounds/frost.mp3'
const HEAL_SRC    = 'assets/sounds/heal2.wav'
const ICECUBE_SRC = 'assets/sounds/icecube.mp3'
const ICEMELT_SRC = 'assets/sounds/icemelt.mp3'
const SUNRISE_SRC = 'assets/sounds/sunrise.wav'
const PICKUP_SRC  = 'assets/sounds/pop.mp3'
const DROP_SRC    = 'assets/sounds/droplogs.mp3'
const OBELISK_SRC = 'assets/sounds/obelisk.mp3'
const BEAM_SRC     = 'assets/sounds/beam.wav'
// Trimmed copy of the first 1.0 s of the original release recording, with a 70 ms fade-out.
const RELEASE_BURST_SRC = 'assets/sounds/release_burst.wav'
// The charge-start cue was dropped: the beam-hit moment starts the looping crystal.mp3 (stationMarkers startHum).

// Frost clip is ~8s but the last ~5s are dead air / trailing hiss we
// don't want. After a cue starts, cut it once this window elapses.
// This does NOT gate the next cue — a bar step can land well inside
// the window, and that step still has to be heard.
const FROST_SFX_WINDOW_S = 3.0
const FROST_SFX_VOLUME   = 0.28
// Fade applied when frost stops rising (warmed up, or back on safe
// ground) so the cue tails off instead of cutting mid-hiss.
const FROST_SFX_FADE_S   = 0.4

let musicEnt: Entity = 0 as Entity
let muteClickEnt: Entity = 0 as Entity
let pickupSfxEnt: Entity = 0 as Entity
let dropSfxEnt: Entity = 0 as Entity
let surgeSfxEnt: Entity = 0 as Entity
let obeliskSfxEnt: Entity = 0 as Entity
let releaseBurstSfxEnt: Entity = 0 as Entity
let beamSfxEnt:     Entity = 0 as Entity
let torchSfxEnt: Entity = 0 as Entity
let frostSfxEnt: Entity = 0 as Entity
let healSfxEnt:  Entity = 0 as Entity
let iceSfxEnt:     Entity = 0 as Entity
let iceMeltSfxEnt: Entity = 0 as Entity
let sunriseSfxEnt: Entity = 0 as Entity
let unlockSfxEnt: Entity = 0 as Entity

// Frost SFX driver state. playFrostChunkSfx() only stops the voice and
// raises frostSfxPending. The system below starts it on the next frame
// so the renderer sees playing false, then true. A same-frame rewrite
// that leaves playing:true and currentTime:0 is ignored, which used to
// drop every cue that landed while the previous one was still inside
// the 3 s tail window (about every third bar step in snow).
let frostSfxPlaying  = false
let frostSfxElapsedS = 0
let frostSfxPending  = false
/** Seconds into a fade-out, or -1 when not fading. */
let frostSfxFadeS    = -1
let frostSfxLastVol  = FROST_SFX_VOLUME
// Music starts muted by default; player unmutes via the mute button.
let musicMuted = true
let playStartMs = 0
let pausedPositionSec = 0
let audioUnlocked = false


// MARK: makeCameraSfx
function makeCameraSfx(clip: string, volume: number): Entity {
	const ent = engine.addEntity()
	Transform.create(ent, { parent: engine.CameraEntity })
	AudioSource.create(ent, {
		audioClipUrl: clip,
		playing     : false,
		loop        : false,
		volume,
		global      : true,
		currentTime : 0,
	})
	return ent
}


// MARK: playOneShot
/**
 * Retriggerable one-shot on a dedicated camera-parented entity.
 * currentTime: 0 forces a CRDT diff every call.
 */
function playOneShot(
	ent   : Entity,
	clip  : string,
	volume: number,
	pitch?: number,
): void {
	if (!ent) return
	unlockAudio()
	AudioSource.createOrReplace(ent, {
		audioClipUrl: clip,
		playing     : true,
		loop        : false,
		volume,
		global      : true,
		currentTime : 0,
		...(pitch !== undefined ? { pitch } : {}),
	})
}


// MARK: unlockAudio
/**
 * Prime WebView / mobile audio after a user gesture. Idempotent.
 * Called from every local SFX entry point so the first real tap that
 * already routes through audio (mute, click, melt, pickup, …) unlocks
 * the rest of the session.
 */
export function unlockAudio(): void {
	if (audioUnlocked) return
	audioUnlocked = true
	if (unlockSfxEnt) {
		AudioSource.createOrReplace(unlockSfxEnt, {
			audioClipUrl: CLICK_SRC,
			playing     : true,
			loop        : false,
			volume      : 0.001,
			global      : true,
			currentTime : 0,
		})
	}
	console.log('audio: unlockAudio: SFX primed')
}


export function initAudio(): void {
	muteClickEnt  = makeCameraSfx(CLICK_SRC, 0.5)
	pickupSfxEnt  = makeCameraSfx(PICKUP_SRC, 0.6)
	dropSfxEnt    = makeCameraSfx(DROP_SRC, 0.7)
	surgeSfxEnt   = makeCameraSfx(SURGE_SRC, 0.7)
	obeliskSfxEnt = makeCameraSfx(OBELISK_SRC, 0.8)
	beamSfxEnt     = makeCameraSfx(BEAM_SRC, 0.8)
	releaseBurstSfxEnt = makeCameraSfx(RELEASE_BURST_SRC, 0.9)
	torchSfxEnt   = makeCameraSfx(TORCH_SRC, 0.18)
	frostSfxEnt   = makeCameraSfx(FROST_SRC, FROST_SFX_VOLUME)
	healSfxEnt    = makeCameraSfx(HEAL_SRC, 0.2)
	iceSfxEnt     = makeCameraSfx(ICECUBE_SRC, 0.7)
	iceMeltSfxEnt = makeCameraSfx(ICEMELT_SRC, 0.65)
	sunriseSfxEnt = makeCameraSfx(SUNRISE_SRC, 0.55)
	unlockSfxEnt  = makeCameraSfx(CLICK_SRC, 0.001)

	// Starts a pending frost cue, then cuts the clip after the useful
	// head (~3 s) so the trailing hiss of the 8 s source never plays.
	engine.addSystem((dt: number) => {
		if (frostSfxPending) {
			frostSfxPending  = false
			frostSfxPlaying  = true
			frostSfxElapsedS = 0
			frostSfxFadeS    = -1
			frostSfxLastVol  = FROST_SFX_VOLUME
			playOneShot(frostSfxEnt, FROST_SRC, FROST_SFX_VOLUME)
			return
		}
		if (!frostSfxPlaying) return
		frostSfxElapsedS += dt
		if (frostSfxFadeS >= 0) {
			frostSfxFadeS += dt
			const k   = Math.max(0, 1 - frostSfxFadeS / FROST_SFX_FADE_S)
			const vol = Math.round(FROST_SFX_VOLUME * k * 100) / 100
			// Volume writes only on change (same rule as the campfire loop).
			if (vol !== frostSfxLastVol) {
				const a = AudioSource.getMutableOrNull(frostSfxEnt)
				if (a) a.volume = vol
				frostSfxLastVol = vol
			}
			if (k > 0 && frostSfxElapsedS < FROST_SFX_WINDOW_S) return
		} else if (frostSfxElapsedS < FROST_SFX_WINDOW_S) return
		frostSfxPlaying  = false
		frostSfxElapsedS = 0
		frostSfxFadeS    = -1
		AudioSource.stopSound(frostSfxEnt, true)
	})

	musicEnt = engine.addEntity()
	Transform.create(musicEnt, { parent: engine.CameraEntity })
	AudioSource.create(musicEnt, {
		audioClipUrl: MUSIC_SRC,
		playing: !musicMuted,
		loop: true,
		volume: MUSIC_VOLUME,
		global: true,
	})
	playStartMs = Date.now()
}

export function isMusicMuted(): boolean {
	return musicMuted
}

/**
 * Play the shared UI click SFX. Fire from any button that wants the same
 * feedback as the mute toggle — star, popup close, etc.
 */
export function playUiClick(): void {
	playOneShot(muteClickEnt, CLICK_SRC, 0.5)
}

// MARK: playPickupSfx
/**
 * Play the wood-pickup pop. Camera-parented + global so no 3D falloff
 * on the local player.
 */
export function playPickupSfx(): void {
	playOneShot(pickupSfxEnt, PICKUP_SRC, 0.6)
}

// MARK: playDropSfx
/**
 * Play the wood-drop thud. Dedicated entity so it cannot clobber the
 * UI click or pickup cue on the same frame.
 */
export function playDropSfx(): void {
	playOneShot(dropSfxEnt, DROP_SRC, 0.7)
}

// MARK: playFrostChunkSfx
/**
 * Fire the frost SFX once as a discrete cue. Called the moment frost
 * starts rising (first sliver of blue after the warmth reserve runs
 * out) and again on each new blue chunk while it keeps rising.
 * fadeOutFrostSfx() tails it off once frost stops rising. Stops the voice now and plays it next frame, so a step that
 * lands while the previous cue is still ringing still restarts from
 * the top. The auto-silencer cuts the clip at FROST_SFX_WINDOW_S so
 * the trailing dead air never plays.
 */
export function playFrostChunkSfx(): void {
	if (!frostSfxEnt) return
	unlockAudio()
	AudioSource.stopSound(frostSfxEnt, true)
	frostSfxPlaying  = false
	frostSfxElapsedS = 0
	frostSfxFadeS    = -1
	frostSfxPending  = true
}


// MARK: fadeOutFrostSfx
/**
 * Frost stopped rising: tail the current freeze cue off over
 * FROST_SFX_FADE_S. No-op when nothing is playing or already fading.
 * A pending (not yet started) cue is dropped.
 */
export function fadeOutFrostSfx(): void {
	frostSfxPending = false
	if (!frostSfxPlaying || frostSfxFadeS >= 0) return
	frostSfxFadeS = 0
}


// MARK: playHealChunkSfx
/**
 * Fire heal2.wav once when a fire puts a gold segment back on the
 * heat bar. Restarts from the top if the last cue is still playing,
 * so each regained chunk is its own hit.
 */
export function playHealChunkSfx(): void {
	playOneShot(healSfxEnt, HEAL_SRC, 0.2)
}


// MARK: playIceCubeSfx
/**
 * Play the freeze crack for the local player. Camera-parented and
 * global so they hear it from inside their own cube.
 */
export function playIceCubeSfx(): void {
	playOneShot(iceSfxEnt, ICECUBE_SRC, 0.7)
}


// MARK: playIceMeltSfx
/**
 * Play icemelt for a local thaw phase (torch eating a third of the
 * cube, or the last third vanishing). Camera-parented so the frozen
 * player and rescuer both hear it clearly.
 */
export function playIceMeltSfx(): void {
	playOneShot(iceMeltSfxEnt, ICEMELT_SRC, 0.65)
}


// MARK: playSunriseSfx
/**
 * Play sunrise.wav with the "Day X" title card — including Day 1 on
 * cold-open. Camera-parented and global so every player hears dawn,
 * even away from the hearth.
 */
export function playSunriseSfx(): void {
	playOneShot(sunriseSfxEnt, SUNRISE_SRC, 0.55)
}


// MARK: playIceCubeSfxAt
/**
 * Play the freeze crack at a world position so nearby players hear
 * someone else lock into a cube. On mobile, fall back to a global
 * local cue — spatial throwaways are unreliable there. Remote peers
 * on desktop still get the 3D whoosh.
 */
export function playIceCubeSfxAt(position: Vector3): void {
	if (isMobile()) {
		playIceCubeSfx()
		return
	}
	const ent = engine.addEntity()
	Transform.create(ent, { position })
	AudioSource.create(ent, {
		audioClipUrl: ICECUBE_SRC,
		playing: true, loop: false, volume: 0.9, global: false,
	})
	const ICE_CLEANUP_MS = 2500
	const spawnedAt = Date.now()
	const cleanup = (): void => {
		if (Date.now() - spawnedAt < ICE_CLEANUP_MS) return
		engine.removeEntity(ent)
		engine.removeSystem(cleanup)
	}
	engine.addSystem(cleanup)
}


// MARK: playIceMeltSfxAt
/**
 * Play icemelt at a world position so nearby players hear each thaw
 * phase on someone else's cube. Mobile falls back to the global cue.
 */
export function playIceMeltSfxAt(position: Vector3, volume = 0.8): void {
	if (isMobile()) {
		playIceMeltSfx()
		return
	}
	const ent = engine.addEntity()
	Transform.create(ent, { position })
	AudioSource.create(ent, {
		audioClipUrl: ICEMELT_SRC,
		playing: true, loop: false, volume, global: false,
	})
	const MELT_CLEANUP_MS = 2500
	const spawnedAt = Date.now()
	const cleanup = (): void => {
		if (Date.now() - spawnedAt < MELT_CLEANUP_MS) return
		engine.removeEntity(ent)
		engine.removeSystem(cleanup)
	}
	engine.addSystem(cleanup)
}


// MARK: playTorchSfxLocal
/**
 * Play the torch-ignition SFX for the local player on the unlit -> lit
 * edge of their own torch. Dedicated entity so it never races surge.
 */
export function playTorchSfxLocal(): void {
	playOneShot(torchSfxEnt, TORCH_SRC, 0.18)
}


// MARK: playSurgeSfxLocal
/**
 * Play the ignition surge for the LOCAL player (camera-parented, global=true).
 */
export function playSurgeSfxLocal(): void {
	playOneShot(surgeSfxEnt, SURGE_SRC, 0.7)
}


// MARK: playBeamSfx
/**
 * Volcano-beam whoosh (beam.wav) for the player who ignited an obelisk:
 * camera-parented, non-positional one-shot so it is clearly audible
 * however far the camera is from the obelisk.
 */
export function playBeamSfx(volume: number, fadeInS: number): void {
	beamFadeTarget = volume
	beamFadeS      = Math.max(0.01, fadeInS)
	beamFadeT      = 0
	playOneShot(beamSfxEnt, BEAM_SRC, 0)
	if (!beamFadeInstalled) {
		beamFadeInstalled = true
		engine.addSystem(beamFadeSystem)
	}
}

let beamFadeTarget    = 0
let beamFadeS         = 0.8
let beamFadeT         = -1
let beamFadeInstalled = false


// MARK: beamFadeSystem
/** Ramp the beam whoosh volume 0 -> target over its fade-in (linear in amplitude, eased). */
function beamFadeSystem(dt: number): void {
	if (beamFadeT < 0 || !beamSfxEnt) return
	beamFadeT += dt
	const u = Math.min(1, beamFadeT / beamFadeS)
	const src = AudioSource.getMutableOrNull(beamSfxEnt)
	if (src) src.volume = beamFadeTarget * u * u * (3 - 2 * u)
	if (u >= 1) beamFadeT = -1
}


// MARK: playObeliskSfxAt
/**
 * Obelisk ignition cue at the obelisk (3D-positional, same pattern as
 * playSurgeSfxAt). Mobile falls back to the global camera cue.
 */
export function playObeliskSfxAt(position: Vector3): void {
	if (isMobile()) {
		playOneShot(obeliskSfxEnt, OBELISK_SRC, 0.8)
		return
	}
	unlockAudio()
	const ent = engine.addEntity()
	Transform.create(ent, { position })
	AudioSource.create(ent, {
		audioClipUrl: OBELISK_SRC,
		playing: true, loop: false, volume: 1.0, global: false,
	})
	const CLEANUP_MS = 12000
	const spawnedAt = Date.now()
	const cleanup = (): void => {
		if (Date.now() - spawnedAt < CLEANUP_MS) return
		engine.removeEntity(ent)
		engine.removeSystem(cleanup)
	}
	engine.addSystem(cleanup)
}


// MARK: playReleaseBurstSfxAt
/**
 * Charge-sphere burst cue (release_burst.wav) at the obelisk,
 * GLOBAL (camera-attached, non-positional) on every client, so it is not attenuated by the far cinematic camera. Like the other
 * SFX helpers it is not silenced by the mute toggle (mute only pauses the music loop).
 */
export function playReleaseBurstSfxAt(_position: Vector3): void {
	playOneShot(releaseBurstSfxEnt, RELEASE_BURST_SRC, 1.0)
}

// MARK: playSurgeSfxAt
/**
 * Play the ignition surge at a world position (3D-positional) so remote
 * players hear the fire whoosh spatially. Mobile uses the global local
 * cue instead — spatial one-shots often stay silent there.
 */
export function playSurgeSfxAt(position: Vector3): void {
	if (isMobile()) {
		playSurgeSfxLocal()
		return
	}
	unlockAudio()
	const ent = engine.addEntity()
	Transform.create(ent, { position })
	AudioSource.create(ent, {
		audioClipUrl: SURGE_SRC,
		playing: true, loop: false, volume: 1.0, global: false,
	})
	const SURGE_CLEANUP_MS = 5000
	const spawnedAt = Date.now()
	const cleanup = (): void => {
		if (Date.now() - spawnedAt < SURGE_CLEANUP_MS) return
		engine.removeEntity(ent)
		engine.removeSystem(cleanup)
	}
	engine.addSystem(cleanup)
}


export function toggleMusic(): void {
	unlockAudio()
	playUiClick()
	const a = AudioSource.getMutableOrNull(musicEnt) as
		{ volume: number; playing: boolean; currentTime?: number } | null
	if (!a) return
	if (!musicMuted) {
		// Pause: bank the elapsed play time and stop.
		pausedPositionSec += (Date.now() - playStartMs) / 1000
		a.playing = false
		musicMuted = true
	} else {
		// Resume: seek first, THEN flip playing on.
		a.currentTime = pausedPositionSec
		a.playing = true
		playStartMs = Date.now()
		musicMuted = false
	}
}
