/**
 * skyboxDebug.ts \u2014 diagnostic sampler for the day/night cycle.
 *
 * Polls the runtime once per second and captures:
 *   - runtimeSeconds : `getWorldTime().seconds` \u2014 what the engine
 *                      says the skybox is actually rendering
 *   - writtenSeconds : the last fixedTime this client wrote via
 *                      `SkyboxTime` on RootEntity, or null if the
 *                      forced-cycle system is not installed
 *   - nowMs          : Date.now() at sample time, so cross-client
 *                      comparisons can align samples on wall-clock
 *   - locked         : whether SkyboxTime currently exists on
 *                      RootEntity (i.e. the player UI slider is
 *                      overridden per SDK docs)
 *
 * Logs each sample to console with a `skyboxDebug:` prefix so two
 * browsers can be compared line-by-line. Also exposes the latest
 * sample to the HUD overlay (layer.skyboxDebug.tsx).
 *
 * This module deliberately does NOT write SkyboxTime. It only reads.
 * That way the same overlay measures both the current unlocked
 * baseline (setupSkybox disabled) and any future forced cadence,
 * with no confusion about which value is "ours".
 */

import { engine, executeTask, SkyboxTime, TransitionMode } from '@dcl/sdk/ecs'
import { getWorldTime }                                     from '~system/Runtime'

import {
	getLastWrittenFixedTime,
	getLastWrittenMode,
	getSkyboxWriteCount,
} from 'src/client/skybox'


// MARK: Sample

export interface SkyboxSample {
	/** Wall-clock ms when the sample was taken. */
	nowMs           : number
	/** getWorldTime().seconds \u2014 what the engine reports. */
	runtimeSeconds  : number | null
	/** Last fixedTime this client wrote, or null if unlocked. */
	writtenSeconds  : number | null
	/** Whether SkyboxTime currently exists on RootEntity. */
	locked          : boolean
	/** Last transitionMode we wrote, or null if we have not written. */
	mode            : TransitionMode | null
	/** SkyboxTime writes/second averaged over the last sample interval. */
	writesPerSec    : number
	/** Sample index, monotonic since scene load. */
	tick            : number
}

const NO_SAMPLE: SkyboxSample = {
	nowMs         : 0,
	runtimeSeconds: null,
	writtenSeconds: null,
	locked        : false,
	mode          : null,
	writesPerSec  : 0,
	tick          : 0,
}

let latest         : SkyboxSample = NO_SAMPLE
let tick           = 0
let inFlight       = false
let lastWriteCount = 0


// MARK: getLatestSkyboxSample

/**
 * Most recent diagnostic sample. Returned by reference; do not mutate.
 * Returns a zero-filled sentinel until the first sample resolves.
 */
export function getLatestSkyboxSample(): SkyboxSample {
	return latest
}


// MARK: formatSeconds

/**
 * Format a 0..86400 skybox-seconds value as HH:MM:SS for the overlay.
 * Returns "--:--:--" for null.
 */
export function formatSeconds(sec: number | null): string {
	if (sec === null || !isFinite(sec)) return '--:--:--'
	const s = ((sec % 86400) + 86400) % 86400
	const h = Math.floor(s / 3600)
	const m = Math.floor((s % 3600) / 60)
	const ss = Math.floor(s % 60)
	const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
	return `${pad(h)}:${pad(m)}:${pad(ss)}`
}


// MARK: sampleOnce

/**
 * Take one sample. Runs an async getWorldTime call and updates latest
 * when it resolves. Guarded against overlapping in-flight calls so a
 * hitched frame can't stack multiple pending awaits.
 */
function sampleOnce(): void {
	if (inFlight) return
	inFlight = true

	const startNow  = Date.now()
	const written   = getLastWrittenFixedTime()
	const locked    = SkyboxTime.has(engine.RootEntity)
	const mode      = getLastWrittenMode()
	const wc        = getSkyboxWriteCount()
	const thisTick  = ++tick

	// Writes-per-second across the interval since the last sample.
	// Sampler runs at 1 Hz so intervalMs is ~1000 in steady state; fall
	// back to 1s if this is the first sample.
	const intervalMs = latest.nowMs === 0 ? 1000 : Math.max(1, startNow - latest.nowMs)
	const wps        = ((wc - lastWriteCount) * 1000) / intervalMs
	lastWriteCount   = wc

	executeTask(async () => {
		let runtimeSeconds: number | null = null
		try {
			const t = await getWorldTime({})
			runtimeSeconds = t.seconds
		} catch (err) {
			console.log(`skyboxDebug: sampleOnce: getWorldTime failed: ${err}`)
		}

		const sample: SkyboxSample = {
			nowMs         : startNow,
			runtimeSeconds: runtimeSeconds,
			writtenSeconds: written,
			locked        : locked,
			mode          : mode,
			writesPerSec  : wps,
			tick          : thisTick,
		}
		latest = sample
		inFlight = false

		const modeStr = mode === null                      ? 'null'
		              : mode === TransitionMode.TM_FORWARD ? 'FWD'
		              :                                      'BWD'

		// One-line CSV-ish log so two browsers can be diffed. Time is
		// wall-clock ms so samples align across peers on the same NTP.
		console.log(
			`skyboxDebug: sample ` +
			`tick=${thisTick} ` +
			`nowMs=${startNow} ` +
			`runtime=${runtimeSeconds === null ? 'null' : runtimeSeconds.toFixed(1)} ` +
			`written=${written === null ? 'null' : written.toFixed(1)} ` +
			`mode=${modeStr} ` +
			`wps=${wps.toFixed(2)} ` +
			`locked=${locked}`
		)
	})
}


// MARK: setupSkyboxDebug

/**
 * Install the 1 Hz sampler. Idempotent \u2014 safe to call once at
 * client bootstrap. Behind SHOW_SKYBOX_DEBUG in devFlags.
 */
let installed = false
export function setupSkyboxDebug(): void {
	if (installed) {
		console.log('skyboxDebug: setupSkyboxDebug: already installed, skipping')
		return
	}
	installed = true

	let acc = 0
	engine.addSystem((dt: number) => {
		acc += dt
		if (acc < 1) return
		acc = 0
		sampleOnce()
	})

	console.log('skyboxDebug: setupSkyboxDebug: installed, sampling at 1 Hz')
}
