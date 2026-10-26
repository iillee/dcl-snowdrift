/** fireNetworkVCheck: V-shape persistence + tile counts. node scripts/fireNetworkVCheck.mjs */
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { CAMPFIRE_WORLD_X as HX, CAMPFIRE_WORLD_Z as HZ } from 'src/shared/campfire'
import { pickHiddenCampfires } from 'src/shared/hiddenCampfire'
import { getTerrain } from 'src/shared/terrain/terrainCache'
import { FireNode, NETWORK_CUBE_SPACING_M, NETWORK_TILE_BAND_M, linkKey, pickLinkPairs, rasterizeRuns, routeFireLink } from 'src/shared/fireNetwork'

const real = console.log; console.log = () => {}
// Mirror of server evaluate(): RNG pairs + held links whose ends are lit.
function select(nodes: FireNode[], held: Set<string>): Set<string> {
	const out = new Set(pickLinkPairs(nodes).map(([a, b]) => linkKey(a.id, b.id)))
	const lit = new Set(nodes.map((n) => n.id))
	for (const k of held) { const [a, b] = k.split('-').map(Number); if (lit.has(a) && lit.has(b)) out.add(k) }
	return out
}
const H: FireNode = { id: 0, x: 400, z: 400 }
const A: FireNode = { id: 1, x: 460, z: 470 }
const B: FireNode = { id: 2, x: 340, z: 470 }
const C: FireNode = { id: 3, x: 420, z: 480 } // between A and B, closer to both than H-A
let held = select([H, A], new Set())
real(`step1 H+A: ${[...held]}`)
held = select([H, A, B], held); real(`step2 +B: ${[...held]}`)
held = select([H, A, B, C], held); real(`step3 +C: ${[...held]}  (plain RNG would be: ${pickLinkPairs([H, A, B, C]).map(([a, b]) => linkKey(a.id, b.id))})`)
const ok = ['0-1', '0-2'].every((k) => held.has(k))
real(`V check (H-A and H-B survive later lights): ${ok ? 'PASS' : 'FAIL'}`)

// Tile counts on real seeds, all fires lit.
let tiles = 0, links = 0, orbs = 0, orbMaxSeed = 0, orbMaxLink = 0
for (let s = 1; s <= 10; s++) {
	const seed = s * 7919
	const map = getTerrain(cycleMazeSeed(seed))
	const nodes: FireNode[] = [{ id: 0, x: HX, z: HZ }, ...pickHiddenCampfires(seed).map((p, i) => ({ id: i + 1, x: p.x, z: p.z }))]
	let seedOrbs = 0
	for (const [a, b] of pickLinkPairs(nodes)) {
		const r = routeFireLink(map, a, b); if (!r) continue
		links++; tiles += rasterizeRuns(map, r.runs, NETWORK_TILE_BAND_M).length
		let n = 0; for (const run of r.runs) { let L = 0; for (let k = 1; k < run.pts.length; k++) L += Math.hypot(run.pts[k].x - run.pts[k - 1].x, run.pts[k].z - run.pts[k - 1].z); n += Math.max(0, Math.floor(L / NETWORK_CUBE_SPACING_M + 0.5)) }
		orbs += n; seedOrbs += n; orbMaxLink = Math.max(orbMaxLink, n)
	}
	orbMaxSeed = Math.max(orbMaxSeed, seedOrbs)
}
real(`tiles: ${(tiles / Math.max(1, links)).toFixed(0)} per link avg, ${(tiles / 10).toFixed(0)} per seed with every fire lit (${(links / 10).toFixed(1)} links)`)
real(`orbs (~, before fire clearance): ${(orbs / Math.max(1, links)).toFixed(0)} per link avg, max ${orbMaxLink} per link; ${(orbs / 10).toFixed(0)} per seed avg, worst ${orbMaxSeed}, every fire lit`)
