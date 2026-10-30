/**
 * crystalFinale.ts - client side of the floating-crystals ENDING ("The world begins to thaw"), see src/shared/finale.ts.
 *
 * The server sends crystalFinaleState (start time as an age, negative until it begins; hydrated to late joiners). From it every
 * client derives the same ring of beams between the obelisks' TOP tips and draws ALL of them at once (one emissive box per beam,
 * scaled as it grows, same thickness / look as the vertical obelisk beam: n entities for the whole ring, they stay), then the
 * synchronized pulse (stationMarkers.startFinalePulse flash + the larger oasis the shared oasis registry opens), the title, and - for
 * viewers who were there when it began - the high framing cinematic (obeliskCinematic.startFinaleCinematic).
 * The snow in the enlarged area is melted by the server (snowState.startHeatZoneFront) and arrives through the normal snow sync; the
 * ground cap / earth / vegetation come from oasisSetFinalePulse (the time is derived from the finale start, so late joiners see the
 * finished state without any replay).
 */

import { MeshRenderer, Transform, UiCanvasInformation, engine, type Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import { playBeamSfx } from 'src/client/audio'
import { onCycleSeedChange, getCurrentCycleSeed } from 'src/client/cycle'
import { startFinaleCinematic } from 'src/client/obeliskCinematic'
import { BURST_SFX_VOLUME, canWatchCinematic, finaleAnchors, paintFinaleBeam, startFinalePulse } from 'src/client/stationMarkers'
import { beginThawSplash } from 'src/client/thawSplash'
import { cineAspect } from 'src/shared/crystalCineFrame'
import { cycleSeedsEqual } from 'src/shared/cycleMazeSeed'
import {
	FINALE_BEAM_XZ_M, FINALE_FOV_DEG, FINALE_PULSE_RADIUS_M, FINALE_PULSE_S, FINALE_TEXT_TOTAL_S, FINALE_TITLE, FinaleEdge, FinaleTimes,
	finaleAvoidZone, finaleBeamProgress, finaleCameraAt, finaleCameraPose, finaleEdges, finalePoints, finalePoseOpts, finaleTimes,
} from 'src/shared/finale'
import { room } from 'src/shared/messages'
import { isFloatingCrystals } from 'src/shared/ruleset'
import { sceneHeightLimitM } from 'src/shared/settings'
import { oasisSetFinalePulse } from 'src/shared/terrain/oasis'
import { activeTerrain } from 'src/shared/terrain/terrainCache'

/** Viewers who see the ending begin (message age below this) get the cinematic; later joiners just get the state. */
const CINE_JOIN_GRACE_S = 1.5
/** Camera ceiling margin under the scene height limit (m), blend from the player camera into the shot (s), safety cap on the whole shot (s). */
const CEILING_MARGIN_M = 3
const CINE_BLEND_IN_S = 1.5
const CINE_CAP_S = 60
/** The beams / the pulse began less than this ago: their sound / flash still plays (late joiners stay silent and see the finished state). */
const SFX_FRESH_S = 2

type FBeam = { e: Entity; a: Vector3; dir: Vector3; len: number; rot: Quaternion; shown: number }

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
let pulseStarted = false
let beamSfx = false
let beams: FBeam[] = []
let edges: FinaleEdge[] = []
let times: FinaleTimes | null = null


/** True from the moment the ending is scheduled until the cycle rolls (debug / tests). */
export function isFinaleRunning(): boolean {
	return running
}


function clearBeams(): void {
	for (const b of beams) engine.removeEntity(b.e)
	beams = []
	edges = []
	times = null
}

function resetFinale(): void {
	clearBeams()
	running = false
	armed = false
	cineStarted = false
	textShown = false
	pulseStarted = false
	beamSfx = false
	oasisSetFinalePulse(Number.POSITIVE_INFINITY)
}


/** Build the beam entities once every obelisk slot exists (no MeshRenderer yet: hidden until drawn). */
function buildBeams(): boolean {
	const anchors = finaleAnchors()
	const map = activeTerrain()
	if (!anchors || !map) return false
	const pts = finalePoints(map).slice(0, anchors.length)
	edges = finaleEdges(pts, finaleAvoidZone(map), first)
	times = finaleTimes()
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
		beams.push({ e, a, dir, len, rot, shown: -1 })
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
 * The camera holds one high pose over the whole ring (all obelisk tips + sockets): the ring is framed (best effort under the ceiling
 * for the 6-obelisk ring; the 3-obelisk triangle fits at a shallower pitch) while the beams connect, the pulse spreads and the title shows.
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
	const wide = finaleCameraPose(pts, look, aspect, maxH, finalePoseOpts())
	console.log(
		`crystalFinale: cinematic beams ${tm.beamStartS.toFixed(1)}-${tm.beamsDoneS.toFixed(1)} s pulse ${tm.pulseAtS.toFixed(1)}-${tm.pulseEndS.toFixed(1)} s ` +
		`pose dist=${wide.dist.toFixed(0)} camH=${wide.cam.y.toFixed(0)} fits=${wide.fits} aspect=${aspect.toFixed(2)}`,
	)
	startFinaleCinematic({
		cam    : (t) => {
			const c = finaleCameraAt(tm, ageS + t, wide)
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
	const f = finaleBeamProgress(times, ageS)
	if (f > 0 && !beamSfx) {
		beamSfx = true
		if (ageS - times.beamStartS < SFX_FRESH_S) playBeamSfx(BURST_SFX_VOLUME, 0.05)
	}
	for (const b of beams) drawBeam(b, f)
	if (!pulseStarted && ageS >= times.pulseAtS) {
		pulseStarted = true
		// The flash + sound only for viewers who are here when it fires; the ground / snow / vegetation need no replay (shared oasis clock).
		if (ageS - times.pulseAtS < SFX_FRESH_S) startFinalePulse(FINALE_PULSE_S - Math.max(0, ageS - times.pulseAtS), FINALE_PULSE_RADIUS_M)
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
		// The enlarged-oasis clock (ground cap, earth, vegetation): derived from the finale start, so every client and a late joiner agree.
		oasisSetFinalePulse(epoch + finaleTimes().pulseAtS * 1000)
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
