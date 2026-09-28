/**
 * loadTimeline.ts — timestamped log of the cold open and ember-fail rebuild.
 *
 * Polls the load gates once per frame and logs the first time each one
 * turns true, in ms since the scene script started. A progress line
 * (GLBs loading, snow nodes, total entities) prints once a second until
 * the splash drops. During an ember-fail rebuild the same gates are
 * logged again, relative to the moment the last fire went out.
 *
 * Every line starts with "loadTimeline:" so the preview logs can be
 * filtered for one run.
 */

import {
	GltfContainer,
	GltfContainerLoadingState,
	LoadingState,
	Transform,
	engine,
} from '@dcl/sdk/ecs'
import { isStateSyncronized } from '@dcl/sdk/network'

import { SeedHolder, seedHolder } from 'src/shared/components'

import { isRostered } from 'src/client/clientHandler'
import { getEmberFailPhaseName, isEmberFailing } from 'src/client/emberFail'
import { arePerimeterModelsReady, hasPerimeterSpawned } from 'src/client/perimeter'
import { isSnowHydrated } from 'src/client/snow/snowModel'
import { isSnowRebuilding, isSnowSettled, snowRenderStats } from 'src/client/snow/snowRenderer'
import { isColdOpenReleased } from 'src/client/ui/layers/layer.loadingSplash'


const scriptStartMs = Date.now()
const PROGRESS_INTERVAL_S = 1

type Gate = { name: string; test: () => boolean; firedAtMs: number | null }

const coldOpenGates: Gate[] = [
	{ name: 'rostered (server acked joinRoster)', test: isRostered,                                         firedAtMs: null },
	{ name: 'CRDT state synced',                  test: isStateSyncronized,                                 firedAtMs: null },
	{ name: 'seed known',                         test: () => (SeedHolder.getOrNull(seedHolder)?.seed ?? 0) !== 0, firedAtMs: null },
	{ name: 'snow first pass built',              test: () => !isSnowRebuilding(),                          firedAtMs: null },
	{ name: 'snow CRDT hydrated',                 test: isSnowHydrated,                                     firedAtMs: null },
	{ name: 'cliffs spawned',                     test: hasPerimeterSpawned,                                firedAtMs: null },
	{ name: 'cliff GLBs loaded',                  test: arePerimeterModelsReady,                            firedAtMs: null },
	{ name: 'snow settled (first full pass)',     test: isSnowSettled,                                      firedAtMs: null },
	{ name: 'splash released',                    test: isColdOpenReleased,                                 firedAtMs: null },
]

let installed        = false
let progressClock    = 0
let coldOpenDone     = false
let failStartMs      = 0
let lastFailPhase    = 'IDLE'
let failSawRebuild   = false
let failRebuildEnded = false
let failCliffsReady  = true


// MARK: sinceStart
function sinceStart(nowMs: number): string {
	return `${nowMs - scriptStartMs}ms`
}


// MARK: countGltfs
function countGltfs(): { total: number; loading: number; failed: number } {
	let total   = 0
	let loading = 0
	let failed  = 0
	for (const [entity] of engine.getEntitiesWith(GltfContainer)) {
		total++
		const st = GltfContainerLoadingState.getOrNull(entity)
		if (st === null || st.currentState === LoadingState.LOADING || st.currentState === LoadingState.UNKNOWN) {
			loading++
			continue
		}
		if (st.currentState === LoadingState.FINISHED_WITH_ERROR || st.currentState === LoadingState.NOT_FOUND) failed++
	}
	return { total, loading, failed }
}


// MARK: countEntities
function countEntities(): number {
	let n = 0
	for (const _ of engine.getEntitiesWith(Transform)) n++
	return n
}


// MARK: logProgress
function logProgress(
	label : string,
	nowMs : number,
): void {
	const g = countGltfs()
	const s = snowRenderStats()
	console.log(
		`loadTimeline: ${label} t=${sinceStart(nowMs)} ` +
		`gltf=${g.total} loading=${g.loading} failed=${g.failed} ` +
		`snowNodes=${s.nodes} pendingRoots=${s.pendingRoots} ground=${s.ground} ` +
		`entities=${countEntities()}`
	)
}


// MARK: tickColdOpen
function tickColdOpen(
	dt   : number,
	nowMs: number,
): void {
	for (const gate of coldOpenGates) {
		if (gate.firedAtMs !== null) continue
		if (!gate.test()) continue
		gate.firedAtMs = nowMs
		console.log(`loadTimeline: cold open: ${gate.name} at ${sinceStart(nowMs)}`)
	}

	progressClock += dt
	if (progressClock >= PROGRESS_INTERVAL_S) {
		progressClock = 0
		logProgress('cold open progress', nowMs)
	}

	if (!isColdOpenReleased()) return
	coldOpenDone = true
	logProgress('cold open DONE', nowMs)
	const parts = coldOpenGates.map((g) => `${g.name}=${g.firedAtMs === null ? 'never' : sinceStart(g.firedAtMs)}`)
	console.log(`loadTimeline: cold open summary: ${parts.join(' | ')}`)
}


// MARK: tickEmberFail
function tickEmberFail(nowMs: number): void {
	const phaseName = getEmberFailPhaseName()
	if (phaseName === lastFailPhase) {
		if (!isEmberFailing()) return
	} else {
		if (lastFailPhase === 'IDLE') {
			failStartMs      = nowMs
			failSawRebuild   = false
			failRebuildEnded = false
			failCliffsReady  = arePerimeterModelsReady()
			logProgress('ember fail START', nowMs)
		}
		const rel = nowMs - failStartMs
		console.log(`loadTimeline: ember fail: phase ${lastFailPhase} -> ${phaseName} at +${rel}ms`)
		if (phaseName === 'IDLE') logProgress(`ember fail DONE total=${rel}ms`, nowMs)
		lastFailPhase = phaseName
		if (phaseName === 'IDLE') return
	}

	const rel = nowMs - failStartMs
	if (!failSawRebuild && isSnowRebuilding()) {
		failSawRebuild = true
		logProgress(`ember fail: snow rebuild started at +${rel}ms`, nowMs)
	}
	if (failSawRebuild && !failRebuildEnded && !isSnowRebuilding()) {
		failRebuildEnded = true
		logProgress(`ember fail: snow rebuild finished at +${rel}ms`, nowMs)
	}
	const cliffsReady = hasPerimeterSpawned() && arePerimeterModelsReady()
	if (cliffsReady !== failCliffsReady) {
		failCliffsReady = cliffsReady
		logProgress(`ember fail: cliffs ${cliffsReady ? 'ready' : 'reloading'} at +${rel}ms`, nowMs)
	}
}


// MARK: setupLoadTimeline
/**
 * Register the timeline system. Call first thing in setupClient so the
 * gates are polled from the first frame.
 */
export function setupLoadTimeline(): void {
	if (installed) {
		console.log('loadTimeline: setupLoadTimeline: already installed, skipping')
		return
	}
	installed = true
	console.log(`loadTimeline: script start at ${scriptStartMs}`)

	engine.addSystem((dt: number) => {
		const nowMs = Date.now()
		if (!coldOpenDone) tickColdOpen(dt, nowMs)
		tickEmberFail(nowMs)
	})
}
