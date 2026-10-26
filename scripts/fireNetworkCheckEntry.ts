/**
 * fireNetworkCheck.mjs entry - fire spacing + link stats for the fire network prototype.
 * Usage: node scripts/fireNetworkCheck.mjs [seedCount]
 */
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { pickHiddenCampfires } from 'src/shared/hiddenCampfire'
import { getTerrain } from 'src/shared/terrain/terrainCache'
import { FireNode, NETWORK_LINK_RANGE_M, pickLinkPairs, routeFireLink } from 'src/shared/fireNetwork'

const real = console.log
console.log = () => {}
const SEEDS = Number(process.argv[2] ?? 12)
const nn: number[] = []
const within: Record<number, number[]> = { 80: [], 100: [], 120: [], 140: [], 160: [], 200: [] }
let links = 0, routed = 0, cellsTot = 0, lenTot = 0, deg: number[] = [], comps: number[] = [], nodesN: number[] = []
for (let s = 1; s <= SEEDS; s++) {
	const seed = s * 7919
	const map = getTerrain(cycleMazeSeed(seed))
	const pits = pickHiddenCampfires(seed)
	const nodes: FireNode[] = [{ id: 0, x: CAMPFIRE_WORLD_X, z: CAMPFIRE_WORLD_Z }, ...pits.map((p, i) => ({ id: i + 1, x: p.x, z: p.z }))]
	nodesN.push(nodes.length)
	for (const a of nodes) {
		let best = Infinity
		const cnt: Record<number, number> = { 80: 0, 100: 0, 120: 0, 140: 0, 160: 0, 200: 0 }
		for (const b of nodes) {
			if (a === b) continue
			const d = Math.hypot(a.x - b.x, a.z - b.z)
			best = Math.min(best, d)
			for (const r of Object.keys(cnt)) if (d <= Number(r)) cnt[Number(r)]++
		}
		nn.push(best)
		for (const r of Object.keys(cnt)) within[Number(r)].push(cnt[Number(r)])
	}
	const pairs = pickLinkPairs(nodes)
	links += pairs.length
	const d = new Map<number, number>()
	const parent = new Map<number, number>(); nodes.forEach((n) => parent.set(n.id, n.id))
	const find = (x: number): number => parent.get(x) === x ? x : find(parent.get(x)!)
	for (const [a, b] of pairs) {
		const r = routeFireLink(map, a, b)
		if (!r) continue
		routed++; cellsTot += r.cells.length; lenTot += r.lengthM
		d.set(a.id, (d.get(a.id) ?? 0) + 1); d.set(b.id, (d.get(b.id) ?? 0) + 1)
		parent.set(find(a.id), find(b.id))
	}
	for (const n of nodes) deg.push(d.get(n.id) ?? 0)
	comps.push(new Set(nodes.map((n) => find(n.id))).size)
}
const q = (a: number[], p: number) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))] }
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
real(`seeds=${SEEDS} fires/seed avg=${avg(nodesN).toFixed(1)}`)
real(`nearest-neighbour m: min=${q(nn,0).toFixed(0)} p25=${q(nn,.25).toFixed(0)} median=${q(nn,.5).toFixed(0)} p75=${q(nn,.75).toFixed(0)} p90=${q(nn,.9).toFixed(0)} max=${q(nn,1).toFixed(0)}`)
for (const r of Object.keys(within)) real(`fires within ${r} m of a fire: avg=${avg(within[Number(r)]).toFixed(2)} isolated=${(within[Number(r)].filter((x) => x === 0).length / within[Number(r)].length * 100).toFixed(0)}%`)
real(`RNG@${NETWORK_LINK_RANGE_M}m (all fires lit): candidate links/seed=${(links/SEEDS).toFixed(1)} routed=${(routed/SEEDS).toFixed(1)} (${(routed/Math.max(1,links)*100).toFixed(0)}%) avg len=${(lenTot/Math.max(1,routed)).toFixed(0)} m cells/seed=${(cellsTot/SEEDS).toFixed(0)}`)
real(`degree: avg=${avg(deg).toFixed(2)} max=${q(deg,1)} unlinked=${(deg.filter((x)=>x===0).length/deg.length*100).toFixed(0)}%  components/seed avg=${avg(comps).toFixed(1)}`)
