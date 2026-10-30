/**
 * obeliskChargeHum.ts - looping hum while a buried obelisk charges.
 *
 * Positional audio is too steep and is heard from the avatar, so the
 * overview (key 1) and cinematic cameras lost it. Instead ONE shared
 * camera-attached, non-positional (global) looping voice whose volume we
 * drive ourselves, so it works the same on desktop and mobile:
 *
 *   level_i = fade(charging_i, hold) * distanceGain(d_i)
 *   volume  = CHARGE_HUM_VOLUME * max_i(level_i)
 *
 * d_i is the horizontal distance from obelisk i (and only the obelisk: fire
 * positions never enter) to the NEARER of the
 * player avatar and the overview camera's focus point (the ground point
 * it centres on). Taking the max over obelisks (not the sum) keeps
 * several charging obelisks from stacking loudness. Like all SFX it
 * ignores the mute toggle (mute is music only).
 *
 * stationMarkers' crystalSystem calls updateObeliskChargeHum every frame
 * per obelisk; the shared voice is applied by a system installed on first
 * use (so it runs after crystalSystem). Volume is written only when its
 * 0.01-rounded value changes (rewriting an AudioSource restarts the loop).
 */

import { AudioSource, Entity, Transform, engine } from '@dcl/sdk/ecs'

import { unlockAudio } from 'src/client/audio'
import { getTopDownFocus } from 'src/client/topDownCamera'

// MARK: Tuning
const HUM_SRC = 'assets/sounds/hum.mp3'
/** Voice volume at full level. */
export const CHARGE_HUM_VOLUME = 0.25
/** Full volume within this distance (m) of the obelisk (listener = nearer of avatar / overview focus)... */
export const CHARGE_HUM_FULL_M = 6
/** ...falling off (squared) to silence by this distance (m). ~0.6 at 40 m (where the linked fires stand), ~0.27 at 80 m. */
export const CHARGE_HUM_SILENT_M = 160
/** Fade times (s) for an obelisk's level to rise / fall. */
export const CHARGE_HUM_FADE_IN_S  = 1.0
export const CHARGE_HUM_FADE_OUT_S = 0.6
/** Keep humming this long (s) after the charge signal drops (link rebuild flicker). */
const CHARGE_HUM_HOLD_S = 1.5

// MARK: State
type Mon = { level: number; offT: number }
const mons: Mon[] = []
let voiceEnt: Entity | null = null
let writtenVol = -1
let applyInstalled = false

function mon(i: number): Mon {
	let m = mons[i]
	if (!m) { m = { level: 0, offT: CHARGE_HUM_HOLD_S }; mons[i] = m }
	return m
}

/** 1 within FULL_M, then (1 - u)^2 down to 0 at SILENT_M: the hum is clearly loudest at the obelisk, not at the fires around it. */
export function distanceGain(d: number): number {
	if (d <= CHARGE_HUM_FULL_M) return 1
	if (d >= CHARGE_HUM_SILENT_M) return 0
	const u = (d - CHARGE_HUM_FULL_M) / (CHARGE_HUM_SILENT_M - CHARGE_HUM_FULL_M)
	return (1 - u) * (1 - u)
}

/** Horizontal distance from (x, z) to the nearer of the avatar and the overview focus. */
function listenerDistance(x: number, z: number): number {
	let d = Infinity
	const p = Transform.getOrNull(engine.PlayerEntity)
	if (p) d = Math.hypot(p.position.x - x, p.position.z - z)
	const f = getTopDownFocus()
	if (f) d = Math.min(d, Math.hypot(f.x - x, f.z - z))
	return d === Infinity ? 0 : d
}

// MARK: updateObeliskChargeHum
/**
 * Per-frame driver for obelisk `index`. `charging` = it is buried and
 * currently receiving heat from the fire network (not full, not released).
 * Safe to call every frame.
 */
export function updateObeliskChargeHum(index: number, x: number, _y: number, z: number, charging: boolean, dt: number): void {
	const m = mon(index)
	if (charging) m.offT = 0
	else m.offT = Math.min(CHARGE_HUM_HOLD_S + 1, m.offT + dt)
	if (m.offT >= CHARGE_HUM_HOLD_S && m.level <= 0) return
	const target = m.offT < CHARGE_HUM_HOLD_S ? distanceGain(listenerDistance(x, z)) : 0
	if (target > m.level) m.level = Math.min(target, m.level + dt / CHARGE_HUM_FADE_IN_S)
	else                  m.level = Math.max(target, m.level - dt / CHARGE_HUM_FADE_OUT_S)
	if (!applyInstalled) { applyInstalled = true; engine.addSystem(applySharedVoice) }
}

// MARK: stopObeliskChargeHum
/** Full charge / release: skip the hold and fade this obelisk's level out now. */
export function stopObeliskChargeHum(index: number, x: number, y: number, z: number, dt: number): void {
	mon(index).offT = CHARGE_HUM_HOLD_S
	updateObeliskChargeHum(index, x, y, z, false, dt)
}

// MARK: applySharedVoice
/** Drive the single camera-attached voice from the loudest obelisk level. */
function applySharedVoice(): void {
	let lvl = 0
	for (const m of mons) if (m && m.level > lvl) lvl = m.level
	const vol = Math.round(lvl * CHARGE_HUM_VOLUME * 100) / 100
	if (!voiceEnt) {
		if (vol <= 0) return
		unlockAudio()
		const e = engine.addEntity()
		Transform.create(e, { parent: engine.CameraEntity })
		AudioSource.create(e, { audioClipUrl: HUM_SRC, loop: true, playing: true, global: true, volume: vol, currentTime: 0 })
		voiceEnt = e
		writtenVol = vol
		return
	}
	if (vol <= 0) { removeVoice(); return }
	if (vol !== writtenVol) {
		const a = AudioSource.getMutableOrNull(voiceEnt)
		if (a) a.volume = vol
		writtenVol = vol
	}
}

function removeVoice(): void {
	if (voiceEnt) {
		if (AudioSource.has(voiceEnt)) AudioSource.stopSound(voiceEnt, true)
		engine.removeEntity(voiceEnt)
	}
	voiceEnt = null
	writtenVol = -1
}

// MARK: clearObeliskChargeHums
/** Drop every level and the voice at once (cycle reset / layout rebuild). */
export function clearObeliskChargeHums(): void {
	for (const m of mons) if (m) { m.level = 0; m.offT = CHARGE_HUM_HOLD_S }
	removeVoice()
}