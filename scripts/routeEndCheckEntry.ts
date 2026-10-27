import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { routeFireLink } from 'src/shared/fireNetwork'
import { validateBuiltFireSpot } from 'src/shared/ruleset'
import { getTerrain } from 'src/shared/terrain/terrainCache'
import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
const say = console.log; console.log = () => {}
let n = 0, hook = 0, worst = 0
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
say(`route ends=${n} overshoot>1m=${hook} worst=${worst.toFixed(1)} m`)