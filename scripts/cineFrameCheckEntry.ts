/**
 * cineFrameCheck - crystal release end shot per monument terrace: oblique 45-50 deg view, the whole melt circle inside
 * the frame, the tip HEADROOM below the top of the letterboxed frame. Bundled by scripts/cineFrameCheck.mjs.
 */
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { crystalFloatBottomY } from 'src/shared/crystalFloat'
import {
	CINE_CRYSTAL_BAR_FRAC, CINE_CRYSTAL_FOV_DEG, CINE_CRYSTAL_FRAME_GROUND_R_M,
	CINE_CRYSTAL_PITCH_MAX_DEG, CINE_CRYSTAL_PITCH_MIN_DEG, CINE_CRYSTAL_TIP_HEADROOM, crystalEndPose,
} from 'src/shared/crystalCineFrame'
import { WORLD_PROFILE, sceneHeightLimitM } from 'src/shared/settings'
import { getTerrain } from 'src/shared/terrain/terrainCache'
import { cellCenterWorld, groundYAtWorld } from 'src/shared/terrain/terrainMap'

const g0 = globalThis as { __realLog?: typeof console.log }
g0.__realLog ??= console.log
const say = g0.__realLog
console.log = () => {}
const SEEDS = Number(process.argv[2] ?? 4)
const OB_TOTAL = 14 + 2 * 4, LIM = sceneHeightLimitM()
let fail = 0
let hi: { g: number; s: string } | null = null, lo: { g: number; s: string } | null = null
let dMin = Infinity, dMax = 0
const aspectRange: Record<string, [number, number]> = {}
for (let s = 0; s < SEEDS; s++) {
	const map = getTerrain(cycleMazeSeed(1000 + s * 7919))
	const bottom = crystalFloatBottomY(map)
	for (const st of map.stations) {
		const c = cellCenterWorld(st.cx, st.cz)
		const g = groundYAtWorld(map, c.x, c.z)
		const tipTop = Math.min(bottom + OB_TOTAL, LIM - 24 - 0.3)
		const h = tipTop - g
		const R = CINE_CRYSTAL_FRAME_GROUND_R_M
		for (const aspect of [4 / 3, 16 / 9, 21 / 9]) {
		const p = crystalEndPose(h, R, LIM - 3 - g, aspect)
		// Independent check via view angles: aim = pitch below horizontal, angles measured from the aim axis.
		const pitch = p.pitchDeg * Math.PI / 180
		const tv = Math.tan((CINE_CRYSTAL_FOV_DEG / 2) * Math.PI / 180), vis = 1 - 2 * CINE_CRYSTAL_BAR_FRAC
		const look = (s2: number, y: number, lat: number) => {
			const hd = p.dist + s2, dy = y - p.camH
			const ang = Math.atan2(dy, hd) + pitch          // elevation of the point relative to the aim axis
			const rng = Math.hypot(hd, dy)
			const depth = rng * Math.cos(ang)
			return { v: Math.tan(ang) / tv / vis, x: lat / (depth * tv * aspect) }
		}
		let worst = 0, maxX = 0
		for (let k = 0; k < 64; k++) {
			const a = (k / 64) * Math.PI * 2
			const q = look(R * Math.cos(a), 0, R * Math.sin(a))
			worst = Math.max(worst, Math.abs(q.v)); maxX = Math.max(maxX, Math.abs(q.x))
		}
		const tip = look(0, h, 0)
		const headroom = (1 - tip.v) / 2
		const line = `asp=${aspect.toFixed(2)} ground=${g.toFixed(1)} tip=${h.toFixed(1)} dist=${p.dist} camH=${p.camH.toFixed(1)} lookH=${p.lookH.toFixed(1)} pitch=${p.pitchDeg}deg ringW=${(maxX * 100).toFixed(0)}% tipHeadroom=${(headroom * 100).toFixed(1)}%`
		if (p.dist >= 400 || p.pitchDeg < CINE_CRYSTAL_PITCH_MIN_DEG || p.pitchDeg > CINE_CRYSTAL_PITCH_MAX_DEG) { fail++; say('  FAIL no oblique pose ' + line) }
		if (worst > 1 || maxX > 1) { fail++; say('  FAIL circle out of frame ' + line) }
		if (Math.abs(headroom - CINE_CRYSTAL_TIP_HEADROOM) > 0.01) { fail++; say('  FAIL tip headroom ' + line) }
		if (aspect > 1.7 && aspect < 1.8) { dMin = Math.min(dMin, p.dist); dMax = Math.max(dMax, p.dist) }
		if (aspect > 1.7 && aspect < 1.8 && (!hi || g > hi.g)) hi = { g, s: line }
		if (aspect > 1.7 && aspect < 1.8 && (!lo || g < lo.g)) lo = { g, s: line }
		const k = aspect.toFixed(2); const r = aspectRange[k] ?? (aspectRange[k] = [Infinity, 0]); r[0] = Math.min(r[0], p.dist); r[1] = Math.max(r[1], p.dist)
		}
	}
}
say(`  [${WORLD_PROFILE}] highest terrace: ${hi?.s}`)
say(`  [${WORLD_PROFILE}] lowest terrace : ${lo?.s}`)
say(`  [${WORLD_PROFILE}] end distance range ${dMin}..${dMax} m, limit=${LIM.toFixed(1)}`)
for (const [a, r] of Object.entries(aspectRange)) say(`  [${WORLD_PROFILE}] aspect ${a}: distance ${r[0]}..${r[1]} m`)
say(fail === 0 ? '  ALL PASS' : `  ${fail} FAILED`)