/**
 * audio.ts — background music + UI click sound.
 *
 * Music is parented to the camera so it stays at ear-level anywhere in
 * the 160m scene. Starts muted so the scene loads quietly; the HUD mute
 * pill toggles it via toggleMusic().
 *
 * Playback position is tracked across pause/resume so the loop continues
 * where it left off instead of restarting each unmute. Pattern borrowed
 * from flagtag's boomboxState: the SDK reads currentTime on the
 * playing:false → true transition, so we must seek BEFORE flipping playing.
 *
 * Future SFX (paint hits, round-end fanfare) will register subscribers on
 * `eventBus` / `ClientEvents` from this module — keeping all audio config in one place.
 */

import { AudioSource, Entity, InputAction, PointerEventType, Transform, engine, inputSystem } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

const MUSIC_VOLUME = 0.4
const MUSIC_SRC = 'assets/sounds/HomeAgain_Loop.mp3'
const CLICK_SRC = 'assets/sounds/click.wav'
const CLAIM_SRC = 'assets/sounds/snowstepsingle.mp3'
const SURGE_SRC = 'assets/sounds/surge.mp3'
const TORCH_SRC = 'assets/sounds/torch.mp3'
const FROST_SRC = 'assets/sounds/frost.mp3'

// Frost clip is ~8s but the last ~5s are dead air / trailing hiss we
// don't want. Retrigger the sample every FROST_SFX_WINDOW_S while the
// player is actively taking damage so only the useful head of the
// clip is ever heard.
const FROST_SFX_WINDOW_S = 3.0

let musicEnt: Entity = 0 as Entity
let muteClickEnt: Entity = 0 as Entity
let claimSfxEnt: Entity = 0 as Entity
let surgeSfxEnt: Entity = 0 as Entity
let frostSfxEnt: Entity = 0 as Entity

// Frost SFX driver state. The clip is one-shot per invocation of
// playFrostChunkSfx(); the system below just auto-silences it after
// FROST_SFX_WINDOW_S so the trailing dead air of the 8 s source clip
// never plays.
let frostSfxPlaying  = false
let frostSfxElapsedS = 0
// Music starts muted by default; player unmutes via the mute button.
let musicMuted = true
let playStartMs = 0
let pausedPositionSec = 0

export function initAudio(): void {
  muteClickEnt = engine.addEntity()
  Transform.create(muteClickEnt, { parent: engine.CameraEntity })
  claimSfxEnt = engine.addEntity()
  Transform.create(claimSfxEnt, { parent: engine.CameraEntity })
  // Dedicated entity for the ignition surge so it never collides with
  // click / drop / pickup writes on muteClickEnt. Two createOrReplace
  // calls on the same AudioSource in the same frame produced audible
  // glitches on nearby fire loops in testing.
  surgeSfxEnt = engine.addEntity()
  Transform.create(surgeSfxEnt, { parent: engine.CameraEntity })
  frostSfxEnt = engine.addEntity()
  Transform.create(frostSfxEnt, { parent: engine.CameraEntity })
  // Frost SFX auto-silencer. playFrostChunkSfx() fires the clip and
  // sets frostSfxPlaying=true; this system stops it after the useful
  // head window (~3 s) so we never hear the trailing hiss.
  engine.addSystem((dt: number) => {
	  if (!frostSfxPlaying) return
	  frostSfxElapsedS += dt
	  if (frostSfxElapsedS < FROST_SFX_WINDOW_S) return
	  frostSfxPlaying  = false
	  frostSfxElapsedS = 0
	  AudioSource.createOrReplace(frostSfxEnt, {
		  audioClipUrl: FROST_SRC,
		  playing: false, loop: false, volume: 0.28, global: true,
	  })
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

  // Desktop hotkey: `2` (IA_ACTION_4) toggles mute/unmute so keyboard
  // players get the same one-press affordance the mobile touch layout
  // already gets via its ACTION_4 slot. Skip on mobile — the on-screen
  // mute button in touchControls already dispatches toggleMusic() and
  // the native gamepad triggers the same InputAction, which would
  // cause a double-toggle here.
  if (!isMobile()) {
    engine.addSystem(() => {
      if (inputSystem.isTriggered(InputAction.IA_ACTION_4, PointerEventType.PET_DOWN)) {
        toggleMusic()
      }
    })
  }
}

export function isMusicMuted(): boolean {
  return musicMuted
}

/**
 * Play the shared UI click SFX. Fire from any button that wants the same
 * feedback as the mute toggle — star, popup close, etc. Reuses the same
 * entity as the mute click so we don't leak audio sources per-button.
 */
export function playUiClick(): void {
  if (!muteClickEnt) return
  // currentTime: 0 forces a CRDT diff every call so a repeated SFX with
  // identical URL + volume actually re-triggers. Without it the SDK's
  // component-diff check sees "no change" and the second play is a
  // no-op (see AudioSource.playSound helper in @dcl/ecs).
  AudioSource.createOrReplace(muteClickEnt, {
    audioClipUrl: CLICK_SRC,
    playing: true, loop: false, volume: 0.5, global: true, currentTime: 0,
  })
}

/**
 * Play the tile-claim SFX for the local player only (camera-parented,
 * global=true so no 3D falloff). Fires once per new claim — caller
 * (paint CRDT apply) already guards against re-walking own tiles,
 * so no additional throttle needed. Low volume so continuous painting
 * reads as a soft rhythmic sparkle, not a machine gun.
 */
// Minimum time between successive crunch triggers. Melts fire per-cell
// as the brush stamps, which is many times per second while walking —
// without a cooldown the sample retriggers before it can breathe and
// reads as a rapid stuttering restart rather than distinct footsteps.
// ~180 ms sits close to a natural footfall cadence.
const CLAIM_MIN_INTERVAL_MS = 300
let   lastClaimSfxMs        = 0

export function playClaimSfx(): void {
  if (!claimSfxEnt) return
  const now = Date.now()
  if (now - lastClaimSfxMs < CLAIM_MIN_INTERVAL_MS) return
  lastClaimSfxMs = now
  // Tiny pitch jitter so successive melts do not sound like identical
  // stamps of the same clip.
  const pitch = 1 + (Math.random() * 2 - 1) * 0.10
  AudioSource.createOrReplace(claimSfxEnt, {
    audioClipUrl: CLAIM_SRC,
    playing: true, loop: false, volume: 0.25, global: true, pitch, currentTime: 0,
  })
}

// MARK: playPickupSfx
/**
 * Play the wood-pickup pop. Camera-parented + global so no 3D falloff
 * on the local player. Reuses the shared click entity to avoid leaking
 * an AudioSource per SFX.
 */
export function playPickupSfx(): void {
  if (!muteClickEnt) return
  AudioSource.createOrReplace(muteClickEnt, {
    audioClipUrl: 'assets/sounds/pop.mp3',
    playing: true, loop: false, volume: 0.6, global: true, currentTime: 0,
  })
}

// MARK: playDropSfx
/**
 * Play the wood-drop thud. Same entity reuse pattern as playPickupSfx.
 * Uses the project's dedicated droplogs.mp3 clip.
 */
export function playDropSfx(): void {
  if (!muteClickEnt) return
  AudioSource.createOrReplace(muteClickEnt, {
    audioClipUrl: 'assets/sounds/droplogs.mp3',
    playing: true, loop: false, volume: 0.7, global: true, currentTime: 0,
  })
}

// MARK: playFrostChunkSfx
/**
 * Fire the frost SFX once as a discrete cue. Call on the rising edge
 * of a new blue chunk on the frost bar (i.e. when the visible cold
 * segment count increments). Not tied to continuous damage state —
 * walking through shallow snow that never fills a full segment stays
 * silent. The auto-silencer above cuts the clip at FROST_SFX_WINDOW_S
 * so the trailing dead air never plays.
 */
export function playFrostChunkSfx(): void {
	if (!frostSfxEnt) return
	frostSfxPlaying  = true
	frostSfxElapsedS = 0
	AudioSource.createOrReplace(frostSfxEnt, {
		audioClipUrl: FROST_SRC,
		playing: true, loop: false, volume: 0.28, global: true, currentTime: 0,
	})
}


// MARK: playTorchSfxLocal
/**
 * Play the torch-ignition SFX for the local player (camera-parented,
 * global=true) on the unlit -> lit edge of their own torch. Reuses the
 * dedicated surge entity because torch ignition and fire ignition are
 * never triggered on the same frame — safe to share without the
 * same-frame createOrReplace race that bit feedFire.
 */
export function playTorchSfxLocal(): void {
	if (!surgeSfxEnt) return
	// currentTime: 0 is critical here — without it, a repeated call with
	// the same audioClipUrl produces an identical component payload, the
	// CRDT diff-check drops it, and the second (and every subsequent)
	// torch relight never plays. Same reason applies to every other
	// one-shot SFX on a reused entity in this module.
	AudioSource.createOrReplace(surgeSfxEnt, {
		audioClipUrl: TORCH_SRC,
		playing: true, loop: false, volume: 0.18, global: true, currentTime: 0,
	})
}


// MARK: playSurgeSfxLocal
/**
 * Play the ignition surge for the LOCAL player (camera-parented, global=true).
 * Use when the player lights their own torch — they always hear it, regardless
 * of where they are in the scene. Reuses the shared click entity to avoid
 * leaking an AudioSource per trigger.
 */
export function playSurgeSfxLocal(): void {
	if (!surgeSfxEnt) return
	AudioSource.createOrReplace(surgeSfxEnt, {
		audioClipUrl: SURGE_SRC,
		playing: true, loop: false, volume: 0.7, global: true, currentTime: 0,
	})
}


// MARK: playSurgeSfxAt
/**
 * Play the ignition surge at a world position (3D-positional, non-global) so
 * remote players hear the fire whoosh spatially when it lights. Spawns a
 * throwaway entity with a one-shot AudioSource and removes it after the clip
 * finishes so we don't accumulate silent sources across a session.
 */
export function playSurgeSfxAt(position: Vector3): void {
	const ent = engine.addEntity()
	Transform.create(ent, { position })
	AudioSource.create(ent, {
		audioClipUrl: SURGE_SRC,
		playing: true, loop: false, volume: 1.0, global: false,
	})
	// Clip is ~short; give it a generous cleanup window then despawn.
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
