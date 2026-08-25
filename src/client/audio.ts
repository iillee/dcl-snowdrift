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
import { isMobile } from '@dcl/sdk/platform'

const MUSIC_VOLUME = 0.4
const MUSIC_SRC = 'assets/sounds/HomeAgain_Loop.mp3'
const CLICK_SRC = 'assets/sounds/click.wav'
const CLAIM_SRC = 'assets/sounds/snowstepsingle.mp3'

let musicEnt: Entity = 0 as Entity
let muteClickEnt: Entity = 0 as Entity
let claimSfxEnt: Entity = 0 as Entity
// Music starts muted by default; player unmutes via the mute button.
let musicMuted = true
let playStartMs = 0
let pausedPositionSec = 0

export function initAudio(): void {
  muteClickEnt = engine.addEntity()
  Transform.create(muteClickEnt, { parent: engine.CameraEntity })
  claimSfxEnt = engine.addEntity()
  Transform.create(claimSfxEnt, { parent: engine.CameraEntity })
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
  AudioSource.createOrReplace(muteClickEnt, {
    audioClipUrl: CLICK_SRC,
    playing: true, loop: false, volume: 0.5, global: true,
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
    playing: true, loop: false, volume: 0.25, global: true, pitch,
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
    playing: true, loop: false, volume: 0.6, global: true,
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
    playing: true, loop: false, volume: 0.7, global: true,
  })
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
