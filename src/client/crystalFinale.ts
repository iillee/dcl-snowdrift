/**
 * crystalFinale.ts - client side of the floating-crystals ENDING ("Level Thaws"), see src/shared/finale.ts.
 *
 * The server sends crystalFinaleState (start time as an age, negative until it begins; hydrated to late joiners). From
 * it every client derives the same ring of beams between the monuments' TOP tips and draws them one by one (one thin
 * emissive box per beam, scaled as it grows: 6 entities for the whole ring, they stay), shows the title, and - for
 * viewers who were there when it began - runs the high framing cinematic (monumentCinematic.startFinaleCinematic).
 * The snow under the beams is melted by the server (snowState.startCorridorFront) and arrives through the normal snow
 * sync, so late joiners see the thawed corridors without any client work.
 */

import { MeshRenderer, Transform, UiCanvasInformation, engine, type Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import { playBeamSfx } from 'src/client/audio'
import { onCycleSeedChange, getCurrentCycleSeed } from 'src/client/cycle'
import { startFinaleCinematic } from 'src/client/monumentCinematic'
import { BURST_SFX_VOLUME, canWatchCinematic, finaleAnchors, paintFinaleBeam } from 'src/client/stationMarkers'
import { beginThawSplash } from 'src/client/thawSplash'
import { cineAspect } from 'src/shared/crystalCineFrame'
import { cycleSeedsEqual } from 'src/shared/cycleMazeSeed'
import {
	FINALE_BEAM_XZ_M, FINALE_FOV_DEG, FINALE_TEXT_TOTAL_S, FINALE_TITLE, FinaleEdge, FinalePoint, FinaleTimes,
	finaleAvoidZone, finaleBeamProgress, finaleCameraAt, finaleCameraPose, finaleEdgeLengths, finaleEdges, finalePoints, finaleTimes,
} from 'src/shared/finale'
import { room } from 'src/shared/messages'
import { isFloatingCrystals } from 'src/shared/ruleset'
import { sceneHeightLimitM } from 'src/shared/settings'
import { activeGroundYAt, activeTerrain } from 'src/shared/terrain/terrainCache'

/** Viewers who see the ending begin (message age below this) get the cinematic; later joiners just get the state. */
const CINE_JOIN_GRACE_S = 1.5
/** Camera ceiling margin under the scene height limit (m), blend from the player camera into the shot (s), safety cap on the whole shot (s). */
const CEILING_MARGIN_M = 3
const CINE_BLEND_IN_S = 1.5
const CINE_CAP_S = 60
/** A beam started / the thaw began less than this ago still plays its sound (late joiners stay silent). */
const SFX_FRESH_S = 2

type FBeam = { e: Entity; a: Vector3; dir: Vector3; len: number; rot: Quaternion; shown: number; sfx: boolean }

let installed = false
let running = false
/** Client epoch (Date.now) of the finale start. */
let startEpochMs = 0
let first = 0
let seedSeen = 0
/** Was the ending still to begin (or just begun) when this client first heard of it: eligible for the cinematic. */
let armed = false
let cineStarted = false
let textShown = false
let thawSfx = false
let beams: FBeam[] = []
let edges: FinaleEdge[] = []
let ringPts: FinalePoint[] = []
let times: FinaleTimes | null = null


/** True from the moment the ending is scheduled until the cycle rolls (debug / tests). */
export function isFinaleRunning(): boolean {
	return running
}


function clearBeams(): void {
	for (const b of beams) engine.removeEntity(b.e)
	beams = []
	edges = []
	ringPts = []
	times = null
}

function resetFinale(): void {
	clearBeams()
	running = false
	armed = false
	cineStarted = false
	textShown = false
	thawSfx = false
}


/** Build the beam entities once every monument slot exists (no MeshRenderer yet: hidden until drawn). */
function buildBeams(): boolean {
	const anchors = finaleAnchors()
	const map = activeTerrain()
	if (!anchors || !map) return false
	const pts = finalePoints(map).slice(0, anchors.length)
	edges = finaleEdges(pts, finaleAvoidZone(map), first)
	ringPts = pts
	times = finaleTimes(finaleEdgeLengths(pts, edges))
	for (const [ia, ib] of edges) {
		const a = anchors[ia].tip, b = anchors[ib].tip
		const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z
		const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
		if (len < 0.5) continue
		const dir = Vector3.create(dx / len, dy / len, dz / len)
		const rot = Quaternion.fromToRotation(Vector3.Up(), dir)
		const e = engine.addEntity()
		Transform.create(e, { position: a, rotation: rot, scale: Vector3.create(FINALE_BEAM_XZ_M, 0.01, FINALE_BEAM_XZ_M) })
		paintFinaleBeam(e)
		beams.push({ e, a, dir, len, rot, shown: -1, sfx: false })
	}
	console.log(`crystalFinale: ${beams.length} beams ${edges.map(([a, b]) => `${a}>${b}`).join(' ')}`)
	return beams.length > 0
}

/** Draw beam b to progress f 0..1: a box from the start tip to f * length along the beam. */
function drawBeam(b: FBeam, f: number): void {
	if (f === b.shown) return
	b.shown = f
	if (f <= 0) return
	if (!MeshRenderer.has(b.e)) MeshRenderer.setBox(b.e)
	const l = b.len * f
	const tr = Transform.getMutable(b.e)
	tr.position = Vector3.create(b.a.x + b.dir.x * l * 0.5, b.a.y + b.dir.y * l * 0.5, b.a.z + b.dir.z * l * 0.5)
	tr.rotation = b.rot
	tr.scale = Vector3.create(FINALE_BEAM_XZ_M, l, FINALE_BEAM_XZ_M)
}


/**
 * The camera follows the traveller (beam head, then the thaw front) round the ring from inside it, then eases out to a
 * high pose over the whole network (best effort under the ceiling: the ring is wider than one frame).
 */
function startCinematic(ageS: number): void {
	const anchors = finaleAnchors()
	const tm = times
	if (!anchors || !tm) return
	const pts = []
	let cx = 0, cz = 0, gy = 0
	for (const a of anchors) {
		pts.push({ x: a.tip.x, y: a.tip.y, z: a.tip.z }, { x: a.ground.x, y: a.ground.y, z: a.ground.z })
		cx += a.tip.x; cz += a.tip.z; gy += a.ground.y
	}
	const n = anchors.length
	const look = { x: cx / n, y: gy / n, z: cz / n }
	const canvas = UiCanvasInformation.getOrNull(engine.RootEntity)
	const aspect = cineAspect(canvas?.width ?? 0, canvas?.height ?? 0)
	const maxH = sceneHeightLimitM() - CEILING_MARGIN_M
	const wide = finaleCameraPose(pts, look, aspect, maxH)
	const tipY = anchors[0].tip.y
	const rp = ringPts, ed = edges
	console.log(
		`crystalFinale: cinematic ring ${tm.total.toFixed(0)} m beams ${tm.beamsDoneS.toFixed(1)} s thaw ${tm.thawBeginS.toFixed(1)}-${tm.thawEndS.toFixed(1)} s ` +
		`end pose dist=${wide.dist.toFixed(0)} camH=${wide.cam.y.toFixed(0)} fits=${wide.fits} aspect=${aspect.toFixed(2)}`,
	)
	startFinaleCinematic({
		cam    : (t) => {
			const c = finaleCameraAt(rp, ed, tm, ageS + t, activeGroundYAt, tipY, maxH, wide)
			return { pos: Vector3.create(c.pos.x, c.pos.y, c.pos.z), look: Vector3.create(c.look.x, c.look.y, c.look.z) }
		},
		durS   : Math.max(2, tm.cineEndS - ageS),
		capS   : CINE_CAP_S,
		fovDeg : FINALE_FOV_DEG,
		blendInS: CINE_BLEND_IN_S,
		onEnd  : () => {},
	})
}


function finaleSystem(): void {
	if (!running) return
	const ageS = (Date.now() - startEpochMs) / 1000
	if (beams.length === 0) {
		if (ageS < -1) return // nothing to draw yet (buildBeams waits for the slots; cheap to retry each frame)
		if (!buildBeams()) return
	}
	if (!times) return
	if (ageS < 0) return
	for (let k = 0; k < beams.length; k++) {
		const f = finaleBeamProgress(times, k, ageS)
		if (f > 0 && !beams[k].sfx) {
			beams[k].sfx = true
			if (ageS - times.beamStartS[k] < SFX_FRESH_S) playBeamSfx(BURST_SFX_VOLUME, 0.05)
		}
		drawBeam(beams[k], f)
	}
	if (!thawSfx && ageS >= times.thawBeginS) {
		thawSfx = true
		if (ageS - times.thawBeginS < SFX_FRESH_S) playBeamSfx(BURST_SFX_VOLUME, 0.8)
	}
	if (armed && !cineStarted) {
		cineStarted = true
		if (canWatchCinematic()) startCinematic(ageS)
	}
	if (!textShown && ageS >= times.textAtS) {
		textShown = true
		if (ageS < times.textAtS + FINALE_TEXT_TOTAL_S) beginThawSplash(FINALE_TITLE)
	}
}


export function setupCrystalFinale(): void {
	if (installed) return
	installed = true
	if (!isFloatingCrystals()) return
	seedSeen = getCurrentCycleSeed()
	engine.addSystem(finaleSystem, undefined, 'crystalFinaleSystem')

	room.onMessage('crystalFinaleState', ({ seed, running: on, first: f, ageMs }) => {
		if (!cycleSeedsEqual(seed, getCurrentCycleSeed())) return
		seedSeen = seed
		if (on !== 1) { resetFinale(); return }
		const epoch = Date.now() - ageMs
		if (running && Math.abs(epoch - startEpochMs) < 750) return // echo of the one we run
		const wasRunning = running
		if (wasRunning) resetFinale()
		running = true
		startEpochMs = epoch
		first = f
		// Cinematic only for viewers who are here when it begins; a joiner later in (or after) it gets the state.
		armed = ageMs < CINE_JOIN_GRACE_S * 1000
		console.log(`crystalFinale: state running first=${f} age=${(ageMs / 1000).toFixed(1)} s armed=${armed}`)
	})

	onCycleSeedChange(({ newSeed }) => {
		if (cycleSeedsEqual(newSeed, seedSeen)) return
		seedSeen = newSeed
		resetFinale()
	})
	console.log('crystalFinale: installed')
}
