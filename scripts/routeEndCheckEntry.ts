import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { routeFireLink } from 'src/shared/fireNetwork'
import { validateBuiltFireSpot } from 'src/shared/ruleset'
import { getTerrain } from 'src/shared/terrain/terrainCache'
import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
const say = console.log; console.log = () => {}
let n = 0, hook = 0, worst = 0, routes = 0, sharpRoutes = 0, sharpMaxDeg = 0
for (let s = 0; s < 4; s++) {
	const map = getTerrain(cycleMazeSeed(20000 + s * 7))
	const spots: { x: number; z: number }[] = []
	for (let x = CAMPFIRE_WORLD_X - 200; x < CAMPFIRE_WORLD_X + 200; x += 7) for (let z = CAMPFIRE_WORLD_Z - 200; z < CAMPFIRE_WORLD_Z + 200; z += 7)
		if (validateBuiltFireSpot(map, x, z, [], () => 0, 0) === 'ok') spots.push({ x, z })
	for (let i = 0; i < spots.length; i += 3) for (let j = i + 5; j < spots.length; j += 41) {
		const a = spots[i], b = spots[j]
		if (Math.hypot(a.x - b.x, a.z - b.z) > 60) continue
		const r = routeFireLink(map, { id: 1, ...a }, { id: 2, ...b })
		if (!r) continue
		const pts = r.runs.flatMap((q) => q.pts)
		// Hard turns: direction change > 40 deg at one vertex inside a run.
		routes++
		let sharp = false
		for (const q of r.runs) for (let k = 1; k < q.pts.length - 1; k++) {
			const p0 = q.pts[k - 1], p1 = q.pts[k], p2 = q.pts[k + 1]
			const a1 = Math.atan2(p1.z - p0.z, p1.x - p0.x), a2 = Math.atan2(p2.z - p1.z, p2.x - p1.x)
			let d = Math.abs(a2 - a1) * 180 / Math.PI; if (d > 180) d = 360 - d
			if (d > 40) { sharp = true; sharpMaxDeg = Math.max(sharpMaxDeg, d); }
		}
		if (sharp) sharpRoutes++
		for (const [end, list] of [[b, pts], [a, [...pts].reverse()]] as const) {
			let acc = 0, k = list.length - 1
			while (k > 0 && acc < 8) { acc += Math.hypot(list[k].x - list[k - 1].x, list[k].z - list[k - 1].z); k-- }
			const dx = end.x - list[k].x, dz = end.z - list[k].z, dl = Math.hypot(dx, dz) || 1
			let past = 0
			for (let j2 = k; j2 < list.length; j2++) past = Math.max(past, ((list[j2].x - end.x) * dx + (list[j2].z - end.z) * dz) / dl)
			n++; if (past > 1) hook++; worst = Math.max(worst, past)
		}
	}
}
say(`route ends=${n} overshoot>1m=${hook} worst=${worst.toFixed(1)} m | routes=${routes} with a hard turn (>40 deg)=${sharpRoutes} (${(100 * sharpRoutes / Math.max(1, routes)).toFixed(1)}%) sharpest=${sharpMaxDeg.toFixed(0)} deg`)