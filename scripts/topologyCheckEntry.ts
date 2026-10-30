/**
 * topologyCheck - fire network topology per seed: N lit fires at valid
 * build spots (14 m spacing, hearth included) + one obelisk charged by
 * its ring fires. Compares all in-range routable pairs, the legacy RNG
 * (without its hysteresis, so legacy in play was messier) and the pruned
 * network (pruneNetwork): links, total path length, components, 2-hop
 * share reach. Bundled by scripts/topologyCheck.mjs.
 *
 * Obelisk clusters: every charging (direct) fire also links to its nearest other charging fires of the same obelisk (>= 1,
 * ideally 2) when a route exists; cycles near obelisks are therefore allowed now, relays still have exactly one parent.
 *
 * Obelisk trees: every layout is pruned twice, before (flat RNG + old
 * fire-link rule) and after (default: forest under each obelisk). Asserts
 * after: no fire-fire link between two direct fires, exactly one parent per
 * relay (hop 2..3, one hop closer), every link near an obelisk is a bridge
 * (no cycles near obelisks), chain hops equal the best layering over all
 * routable candidates (so chain weights never drop), and the same-seed
 * crossing / link / cycle counts before vs after. Exit code 1 on failure.
 */
import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import {
	FireLinkRoute, FireNode, NETWORK_FIRE_LINK_RULE_ENABLED, NETWORK_LINK_RANGE_M, NETWORK_OBELISK_TREE_ENABLED, NETWORK_SHARE_HOPS, NETWORK_TREE_FIRE_HOPS, NetCand,
	countRouteCrossings, linkKey, pickLinkPairs, pruneNetwork, routeFireLink,
} from 'src/shared/fireNetwork'
import { CHARGE_CHAIN_MAX_HOPS, CHARGE_LINK_END_HALF_M, OBELISK_LINK_RANGE_M, OBELISK_NODE_ID_BASE, chainHops, chargeHopWeight, chargeRatePerS, validateBuiltFireSpot } from 'src/shared/ruleset'
import { OBELISK_PIT_SIZE_M } from 'src/shared/terrain/terrainMap'
import { WORLD_PROFILE } from 'src/shared/settings'
import { getTerrain } from 'src/shared/terrain/terrainCache'
import { cellCenterWorld } from 'src/shared/terrain/terrainMap'

const SEEDS = Number(process.argv[2] ?? 5)
const g0 = globalThis as { __realLog?: typeof console.log }
g0.__realLog ??= console.log
const say = g0.__realLog
console.log = () => {}

let chIn = 0, chRouted = 0, chKept = 0, chSlower = 0
const chTimes: number[] = []
let treeFail = 0
let clusterFires = 0, clusterOne = 0, clusterTwo = 0, clusterSolo = 0
const tot = { linksB: 0, linksA: 0, crossB: 0, crossA: 0, ddB: 0, ddA: 0, cycB: 0, cycA: 0, wB: 0, wA: 0, layouts: 0, crossBR: 0, crossAR: 0, wBR: 0, wAR: 0 }
let ends = 0, overshoot = 0, passThrough = 0, keptTotal = 0, ruleViol = 0, ruleSolo = 0
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

function stats(nodes: number[], edges: { a: number; b: number; L: number }[]) {
	const adj = new Map<number, number[]>(nodes.map((n) => [n, []]))
	for (const e of edges) { adj.get(e.a)?.push(e.b); adj.get(e.b)?.push(e.a) }
	const seen = new Set<number>(); let comps = 0
	for (const n of nodes) { if (seen.has(n)) continue; comps++; const q = [n]; seen.add(n); while (q.length) for (const o of adj.get(q.pop()!)!) if (!seen.has(o)) { seen.add(o); q.push(o) } }
	let reach = 0
	for (const n of nodes) {
		if (n >= OBELISK_NODE_ID_BASE) continue
		const d = new Map([[n, 0]]); const q = [n]
		while (q.length) { const c = q.shift()!; if (d.get(c)! >= NETWORK_SHARE_HOPS) continue; for (const o of adj.get(c)!) if (!d.has(o) && o < OBELISK_NODE_ID_BASE) { d.set(o, d.get(c)! + 1); q.push(o) } }
		reach += d.size - 1
	}
	const fires = nodes.filter((n) => n < OBELISK_NODE_ID_BASE).length
	return `links=${String(edges.length).padStart(3)} len=${String(Math.round(edges.reduce((s, e) => s + e.L, 0))).padStart(5)}m comps=${comps} 2hop=${(reach / Math.max(1, fires)).toFixed(1)}`
}

say(`[${WORLD_PROFILE}] topology=dense obeliskTrees=${NETWORK_OBELISK_TREE_ENABLED} seeds=${SEEDS}`)
if (NETWORK_TREE_FIRE_HOPS !== CHARGE_CHAIN_MAX_HOPS - 1) { treeFail++; say(`  FAIL NETWORK_TREE_FIRE_HOPS ${NETWORK_TREE_FIRE_HOPS} != CHARGE_CHAIN_MAX_HOPS - 1`) }
// [fires, ring fires near the obelisk, rest clustered around the obelisk (else around the hearth)]
for (const [N, RING, CLUSTER, REAL] of [[10, 3, false, true], [25, 3, false, false], [12, 5, true, true], [25, 6, true, false], [40, 8, true, false]] as const) for (let s = 0; s < SEEDS; s++) {
	const seed = 20000 + s * 7
	const map = getTerrain(cycleMazeSeed(seed))
	const R = rng(seed * 31 + N)
	const fires: FireNode[] = [{ id: 0, x: CAMPFIRE_WORLD_X, z: CAMPFIRE_WORLD_Z }]
	const placed: { x: number; z: number }[] = [{ x: CAMPFIRE_WORLD_X, z: CAMPFIRE_WORLD_Z }]
	// 3 ring fires around obelisk 0, rest within 160 m of the hearth.
	const st = map.stations[0]; const m = cellCenterWorld(st.cx, st.cz)
	for (let t = 0, ring = 0; t < 3000 && fires.length < N + 1; t++) {
		const inRing = ring < RING
		const r = inRing ? 6 + R() * (OBELISK_LINK_RANGE_M - 6) : CLUSTER ? 8 + R() * 150 : 10 + R() * 150, a = R() * Math.PI * 2
		const cx = inRing || CLUSTER ? m.x : CAMPFIRE_WORLD_X, cz = inRing || CLUSTER ? m.z : CAMPFIRE_WORLD_Z
		const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r
		if (validateBuiltFireSpot(map, x, z, placed, () => 0, 0) !== 'ok') { if (inRing && t > 600) ring = RING; continue }
		placed.push({ x, z }); fires.push({ id: fires.length, x, z }); if (inRing) ring++
	}
	const cache = new Map<string, FireLinkRoute | null>()
	const routeOf = (c: NetCand) => { let r = cache.get(c.key); if (r === undefined) { r = routeFireLink(map, c.a, c.b); cache.set(c.key, r) } return r }
	const cands: NetCand[] = []
	for (let i = 0; i < fires.length; i++) for (let j = i + 1; j < fires.length; j++) {
		const a = fires[i], b = fires[j]
		if (Math.hypot(a.x - b.x, a.z - b.z) <= NETWORK_LINK_RANGE_M) cands.push({ a, b, key: linkKey(a.id, b.id) })
	}
	const mon: FireNode = { id: OBELISK_NODE_ID_BASE, x: m.x, z: m.z }
	for (const f of fires) if (Math.hypot(f.x - m.x, f.z - m.z) <= OBELISK_LINK_RANGE_M) {
		const d = Math.hypot(f.x - m.x, f.z - m.z), ux = (f.x - m.x) / d, uz = (f.z - m.z) / d
		const e = Math.min(CHARGE_LINK_END_HALF_M / Math.max(Math.abs(ux), Math.abs(uz)), Math.max(0, d - 1))
		cands.push({ a: f, b: { id: mon.id, x: m.x + ((f.x - m.x) / d) * e, z: m.z + ((f.z - m.z) / d) * e }, key: linkKey(f.id, mon.id) })
	}
	const ids = [...fires.map((f) => f.id), ...(cands.some((c) => c.b.id === mon.id) ? [mon.id] : [])]
	const E = (list: NetCand[]) => list.map((c) => ({ c, r: routeOf(c) })).filter((x) => x.r).map((x) => ({ a: x.c.a.id, b: x.c.b.id, L: x.r!.lengthM }))
	const all = E(cands)
	const legacy = E([...pickLinkPairs(fires).map(([a, b]) => ({ a, b, key: linkKey(a.id, b.id) })), ...cands.filter((c) => c.b.id === mon.id)])
	const monOpt = { obelisks: [{ id: mon.id, x: m.x, z: m.z }] }
	const keptAfter = pruneNetwork(cands, routeOf, monOpt)
	const keptBefore = pruneNetwork(cands, routeOf, { tree: false, fireRule: true, ...monOpt })
	const pr = keptAfter.map((k) => ({ a: k.cand.a.id, b: k.cand.b.id, L: k.route.lengthM }))
	// Obelisk-tree assertions + before / after counts.
	{
		const isMonId = (id: number) => id >= OBELISK_NODE_ID_BASE
		const dist = (id: number) => { const f = fires.find((q) => q.id === id)!; return Math.hypot(f.x - m.x, f.z - m.z) }
		const direct = (list: typeof keptAfter) => new Set(list.filter((k) => isMonId(k.cand.b.id) || isMonId(k.cand.a.id)).map((k) => (isMonId(k.cand.b.id) ? k.cand.a.id : k.cand.b.id)))
		const edgesOf = (list: typeof keptAfter) => list.map((k) => [k.cand.a.id, k.cand.b.id] as const)
		const info = (list: typeof keptAfter) => {
			const seeds = direct(list)
			const hops = chainHops(seeds, edgesOf(list).filter(([a, b]) => !isMonId(a) && !isMonId(b)), (id) => id > 0)
			let w = 0
			for (const [id, h] of hops) w += h <= 1 ? chargeHopWeight(1, dist(id)) : chargeHopWeight(h, 0)
			const near = new Set<number>([mon.id, ...hops.keys()])
			// An edge is on a cycle iff it is not a bridge.
			const es = edgesOf(list)
			let cyc = 0
			for (let i = 0; i < es.length; i++) {
				if (!near.has(es[i][0]) && !near.has(es[i][1])) continue
				const adjm = new Map<number, number[]>()
				es.forEach(([a, b], j) => { if (j === i) return; (adjm.get(a) ?? adjm.set(a, []).get(a)!).push(b); (adjm.get(b) ?? adjm.set(b, []).get(b)!).push(a) })
				const seen = new Set([es[i][0]]); const q = [es[i][0]]
				while (q.length) for (const o of adjm.get(q.pop()!) ?? []) if (!seen.has(o)) { seen.add(o); q.push(o) }
				if (seen.has(es[i][1])) cyc++
			}
			const dd = es.filter(([a, b]) => !isMonId(a) && !isMonId(b) && seeds.has(a) && seeds.has(b)).length
			return { hops, w, cyc, dd, seeds }
		}
		const A = info(keptAfter), B = info(keptBefore)
		const cx = { b: countRouteCrossings(keptBefore), a: countRouteCrossings(keptAfter) }
		const fail = (msg: string) => { treeFail++; say(`    FAIL N=${N} seed ${seed}: ${msg}`) }
		if (NETWORK_OBELISK_TREE_ENABLED) {
			// Obelisk clusters (NETWORK_CLUSTER_LINKS_*): every direct fire links >= 1 other direct fire whenever a routable one exists, ideally 2.
			const ddOf = new Map<number, number>()
			for (const k of keptAfter) if (A.seeds.has(k.cand.a.id) && A.seeds.has(k.cand.b.id) && !isMonId(k.cand.a.id) && !isMonId(k.cand.b.id)) { ddOf.set(k.cand.a.id, (ddOf.get(k.cand.a.id) ?? 0) + 1); ddOf.set(k.cand.b.id, (ddOf.get(k.cand.b.id) ?? 0) + 1) }
			for (const id of A.seeds) {
				const n = ddOf.get(id) ?? 0
				clusterFires++; if (n >= 2) clusterTwo++; else if (n === 1) clusterOne++
				if (n === 0 && cands.some((c) => (c.a.id === id || c.b.id === id) && !isMonId(c.a.id) && !isMonId(c.b.id) && A.seeds.has(c.a.id) && A.seeds.has(c.b.id) && routeOf(c))) fail(`direct fire ${id} has no link to another direct fire although a routable one exists`)
				if (n === 0) clusterSolo++
			}
			// Cluster links only join direct fires: chain hops (and so charging) are exactly what they would be without them.
			{
				const noDD = keptAfter.filter((k) => !(A.seeds.has(k.cand.a.id) && A.seeds.has(k.cand.b.id) && !isMonId(k.cand.a.id) && !isMonId(k.cand.b.id)))
				const h2 = info(noDD).hops
				if (h2.size !== A.hops.size || [...A.hops].some(([id, h]) => h2.get(id) !== h)) fail('cluster links changed chain hops')
			}
			const fe = edgesOf(keptAfter).filter(([a, b]) => !isMonId(a) && !isMonId(b))
			for (const [id, h] of A.hops) {
				if (h < 2) continue
				const up = fe.filter(([a, b]) => (a === id ? b : b === id ? a : -1) >= 0 && (A.hops.get(a === id ? b : a) ?? 99) < h).length
				const side = fe.filter(([a, b]) => (a === id ? b : b === id ? a : -1) >= 0 && A.hops.get(a === id ? b : a) === h).length
				if (up !== 1) fail(`relay ${id} (hop ${h}) has ${up} parent links`)
				if (side) fail(`relay ${id} (hop ${h}) links ${side} same-hop fire(s)`)
			}
			// A relay's parent is closer to the obelisk (so no cycles) and is exactly one hop lower.
			for (const [id, h] of A.hops) {
				if (h < 2) continue
				const up = fe.filter(([a, b]) => (a === id || b === id) && (A.hops.get(a === id ? b : a) ?? 99) < h)
				for (const [a, b] of up) { const o = a === id ? b : a; if ((A.hops.get(o) ?? 99) !== h - 1) fail(`relay ${id}: parent ${o} is not one hop lower`) }
				if (h > 1 + NETWORK_TREE_FIRE_HOPS) fail(`relay ${id} past the chain (hop ${h})`)
			}
			if (A.w < B.w * 0.8) fail(`chain weight dropped ${B.w.toFixed(2)} -> ${A.w.toFixed(2)}`)
		}
		tot.linksB += keptBefore.length; tot.linksA += keptAfter.length
		tot.crossB += cx.b; tot.crossA += cx.a; tot.ddB += B.dd; tot.ddA += A.dd; tot.cycB += B.cyc; tot.cycA += A.cyc; tot.wB += B.w; tot.wA += A.w; tot.layouts++; if (REAL) { tot.crossBR += cx.b; tot.crossAR += cx.a; tot.wBR += B.w; tot.wAR += A.w }
		say(`  N=${String(N).padStart(2)} ring=${RING}${CLUSTER ? 'c' : ' '} seed ${seed}: before links=${String(keptBefore.length).padStart(3)} cross=${String(cx.b).padStart(2)} directPairs=${B.dd} cycleLinks=${String(B.cyc).padStart(2)} chainW=${B.w.toFixed(2)} | after links=${String(keptAfter.length).padStart(3)} cross=${String(cx.a).padStart(2)} directPairs=${A.dd} cycleLinks=${A.cyc} chainW=${A.w.toFixed(2)} (direct ${A.seeds.size}, relays h2/h3 ${[...A.hops.values()].filter((h) => h === 2).length}/${[...A.hops.values()].filter((h) => h === 3).length})`)
	}
	const monLinks = pr.filter((e) => e.b === mon.id).length
	// Charge membership = live (kept) obelisk link.
	const dOf = (id: number) => { const f = fires.find((q) => q.id === id)!; return Math.hypot(f.x - m.x, f.z - m.z) }
	const inRange = cands.filter((c) => c.b.id === mon.id)
	const routed = inRange.filter((c) => routeOf(c))
	const kept = pr.filter((e) => e.b === mon.id).map((e) => dOf(e.a))
	chIn += inRange.length; chRouted += routed.length; chKept += kept.length
	const rk = chargeRatePerS(kept), ra = chargeRatePerS(routed.map((c) => dOf(c.a.id)))
	if (rk > 0) chTimes.push(1 / rk)
	if (ra > 0 && rk < ra * 0.999) chSlower++
	// Rule: no fire with only obelisk links while a routable fire candidate exists.
	if (!NETWORK_OBELISK_TREE_ENABLED) for (const f of fires) {
		const mine = pr.filter((e) => e.a === f.id || e.b === f.id)
		if (!mine.some((e) => e.b === mon.id || e.a === mon.id)) continue
		if (mine.some((e) => e.a !== mon.id && e.b !== mon.id)) continue
		const alt = cands.some((c) => (c.a.id === f.id || c.b.id === f.id) && c.a.id !== mon.id && c.b.id !== mon.id && routeOf(c))
		if (alt) ruleViol++
		else ruleSolo++
	}
	// Pass-through: a kept route within 3 m of a lit node that is not one of its ends.
	{
		const nodesAll = [...fires, mon]
		for (const k of pruneNetwork(cands, routeOf)) {
			const pts = k.route.runs.flatMap((r) => r.pts)
			for (const n of nodesAll) {
				if (n.id === k.cand.a.id || n.id === k.cand.b.id) continue
				if (pts.some((p) => Math.hypot(p.x - n.x, p.z - n.z) < 3)) { passThrough++; break }
			}
			keptTotal++
		}
	}
	// End overshoot: a route point beyond the end node, i.e. farther along
	// the final approach than the fire / obelisk end, then doubling back.
	for (const c of cands) {
		const r = routeOf(c)
		if (!r) continue
		const pts = r.runs.flatMap((run) => run.pts)
		for (const [end, list] of [[c.b, pts], [c.a, [...pts].reverse()]] as const) {
			let acc = 0, k = list.length - 1
			while (k > 0 && acc < 8) { acc += Math.hypot(list[k].x - list[k - 1].x, list[k].z - list[k - 1].z); k-- }
			const dx = end.x - list[k].x, dz = end.z - list[k].z, dl = Math.hypot(dx, dz) || 1
			let past = 0
			for (let j = k; j < list.length; j++) past = Math.max(past, ((list[j].x - end.x) * dx + (list[j].z - end.z) * dz) / dl)
			ends++
			if (past > 1.0) { overshoot++; if (overshoot <= 3) say(`    overshoot ${past.toFixed(1)} m at node ${end.id} link ${c.key} last pts ${list.slice(-4).map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join(' ')} end ${end.x.toFixed(1)},${end.z.toFixed(1)}`) }
		}
	}
	say(`  N=${String(N).padStart(2)} seed ${seed}: all-in-range ${stats(ids, all)} | legacy ${stats(ids, legacy)} | pruned ${stats(ids, pr)} (obelisk links ${monLinks}/${cands.filter((c) => c.b.id === mon.id).length})`)
}
say(`  route ends checked=${ends} overshooting (>1.5 m past the end then back)=${overshoot}`)
ends = overshoot = 0
say(`  kept links passing within 3 m of a non-end fire: ${passThrough}/${keptTotal}`)
passThrough = keptTotal = 0
say(`  old fire-link rule (flat network only; ${NETWORK_OBELISK_TREE_ENABLED ? 'trees on, rule not applied' : NETWORK_FIRE_LINK_RULE_ENABLED ? 'on' : 'off'}): obelisk-only fires with a fire candidate = ${ruleViol} ${!NETWORK_OBELISK_TREE_ENABLED && NETWORK_FIRE_LINK_RULE_ENABLED ? (ruleViol === 0 ? 'PASS' : 'FAIL') : '(n/a)'}; true networks of one = ${ruleSolo}`)
ruleViol = ruleSolo = 0
say(`  OBELISK TREES over ${tot.layouts} layouts: links ${tot.linksB} -> ${tot.linksA} | crossing link pairs ${tot.crossB} -> ${tot.crossA} | direct-direct fire links ${tot.ddB} -> ${tot.ddA} | links on a cycle near an obelisk ${tot.cycB} -> ${tot.cycA} | summed chain weight ${tot.wB.toFixed(1)} -> ${tot.wA.toFixed(1)}`)
say(`  crossing link pairs, realistic layouts (N=10 with 3 ring fires, N=12 with 5 ring fires): ${tot.crossBR} -> ${tot.crossAR}, summed chain weight ${tot.wBR.toFixed(1)} -> ${tot.wAR.toFixed(1)}; stress layouts (25-40 fires within 150 m of one obelisk) only reported above`)
// Parents are chosen greedily (nearest closer fire, crossing-free if one is among the first few), so one stray crossing is tolerated.
// Cluster links are protected from the cross drop on purpose (at most ~2 per charging fire, crossing-free routes preferred); report only.
say(`  obelisk clusters: ${clusterFires} charging fires: ${clusterTwo} with 2+ links to other charging fires, ${clusterOne} with 1, ${clusterSolo} with none (only when no routable partner exists)`)
say(`  obelisk tree assertions: ${NETWORK_OBELISK_TREE_ENABLED ? (treeFail === 0 ? 'PASS' : 'FAIL') : '(trees off)'}`)
if (treeFail) process.exitCode = 1
Object.assign(tot, { linksB: 0, linksA: 0, crossB: 0, crossA: 0, ddB: 0, ddA: 0, cycB: 0, cycA: 0, wB: 0, wA: 0, layouts: 0, crossBR: 0, crossAR: 0, wBR: 0, wAR: 0 }); treeFail = 0
chTimes.sort((a, b) => a - b)
say(`  obelisk charge (range ${OBELISK_LINK_RANGE_M} m): candidates in range=${chIn} routable=${chRouted} kept-linked (=charging)=${chKept} | charge time with kept links min ${(chTimes[0] ?? NaN).toFixed(0)} s median ${(chTimes[chTimes.length >> 1] ?? NaN).toFixed(0)} s max ${(chTimes[chTimes.length - 1] ?? NaN).toFixed(0)} s | runs slowed by pruning ${chSlower}`)
chIn = chRouted = chKept = chSlower = 0; chTimes.length = 0
