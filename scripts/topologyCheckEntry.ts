/**
 * topologyCheck - fire network topology per seed: N lit fires at valid
 * build spots (14 m spacing, hearth included) + one monument charged by
 * its ring fires. Compares all in-range routable pairs, the legacy RNG
 * (without its hysteresis, so legacy in play was messier) and the pruned
 * network (pruneNetwork): links, total path length, components, 2-hop
 * share reach. Bundled by scripts/topologyCheck.mjs.
 */
import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import {
	FireLinkRoute, FireNode, NETWORK_FIRE_LINK_RULE_ENABLED, NETWORK_LINK_RANGE_M, NETWORK_SHARE_HOPS, NETWORK_TOPOLOGY, NetCand,
	linkKey, pickLinkPairs, pruneNetwork, routeFireLink,
} from 'src/shared/fireNetwork'
import { CHARGE_LINK_EDGE_PAD_M, CHARGE_RING_M, MONUMENT_NODE_ID_BASE, chargeRatePerS, validateBuiltFireSpot } from 'src/shared/ruleset'
import { MONUMENT_PIT_SIZE_M } from 'src/shared/terrain/terrainMap'
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
let ends = 0, overshoot = 0, passThrough = 0, keptTotal = 0, ruleViol = 0, ruleSolo = 0
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

function stats(nodes: number[], edges: { a: number; b: number; L: number }[]) {
	const adj = new Map<number, number[]>(nodes.map((n) => [n, []]))
	for (const e of edges) { adj.get(e.a)?.push(e.b); adj.get(e.b)?.push(e.a) }
	const seen = new Set<number>(); let comps = 0
	for (const n of nodes) { if (seen.has(n)) continue; comps++; const q = [n]; seen.add(n); while (q.length) for (const o of adj.get(q.pop()!)!) if (!seen.has(o)) { seen.add(o); q.push(o) } }
	let reach = 0
	for (const n of nodes) {
		if (n >= MONUMENT_NODE_ID_BASE) continue
		const d = new Map([[n, 0]]); const q = [n]
		while (q.length) { const c = q.shift()!; if (d.get(c)! >= NETWORK_SHARE_HOPS) continue; for (const o of adj.get(c)!) if (!d.has(o) && o < MONUMENT_NODE_ID_BASE) { d.set(o, d.get(c)! + 1); q.push(o) } }
		reach += d.size - 1
	}
	const fires = nodes.filter((n) => n < MONUMENT_NODE_ID_BASE).length
	return `links=${String(edges.length).padStart(3)} len=${String(Math.round(edges.reduce((s, e) => s + e.L, 0))).padStart(5)}m comps=${comps} 2hop=${(reach / Math.max(1, fires)).toFixed(1)}`
}

say(`[${WORLD_PROFILE}] topology=${NETWORK_TOPOLOGY} seeds=${SEEDS}`)
for (const N of [10, 25]) for (let s = 0; s < SEEDS; s++) {
	const seed = 20000 + s * 7
	const map = getTerrain(cycleMazeSeed(seed))
	const R = rng(seed * 31 + N)
	const fires: FireNode[] = [{ id: 0, x: CAMPFIRE_WORLD_X, z: CAMPFIRE_WORLD_Z }]
	const placed: { x: number; z: number }[] = [{ x: CAMPFIRE_WORLD_X, z: CAMPFIRE_WORLD_Z }]
	// 3 ring fires around monument 0, rest within 160 m of the hearth.
	const st = map.stations[0]; const m = cellCenterWorld(st.cx, st.cz)
	for (let t = 0, ring = 0; t < 3000 && fires.length < N + 1; t++) {
		const inRing = ring < 3
		const r = inRing ? 6 + R() * (CHARGE_RING_M - 6) : 10 + R() * 150, a = R() * Math.PI * 2
		const cx = inRing ? m.x : CAMPFIRE_WORLD_X, cz = inRing ? m.z : CAMPFIRE_WORLD_Z
		const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r
		if (validateBuiltFireSpot(map, x, z, placed, () => 0, 0) !== 'ok') { if (inRing && t > 600) ring = 3; continue }
		placed.push({ x, z }); fires.push({ id: fires.length, x, z }); if (inRing) ring++
	}
	const cache = new Map<string, FireLinkRoute | null>()
	const routeOf = (c: NetCand) => { let r = cache.get(c.key); if (r === undefined) { r = routeFireLink(map, c.a, c.b); cache.set(c.key, r) } return r }
	const cands: NetCand[] = []
	for (let i = 0; i < fires.length; i++) for (let j = i + 1; j < fires.length; j++) {
		const a = fires[i], b = fires[j]
		if (Math.hypot(a.x - b.x, a.z - b.z) <= NETWORK_LINK_RANGE_M) cands.push({ a, b, key: linkKey(a.id, b.id) })
	}
	const mon: FireNode = { id: MONUMENT_NODE_ID_BASE, x: m.x, z: m.z }
	for (const f of fires) if (Math.hypot(f.x - m.x, f.z - m.z) <= CHARGE_RING_M) {
		const d = Math.hypot(f.x - m.x, f.z - m.z), ux = (f.x - m.x) / d, uz = (f.z - m.z) / d
		const e = Math.min((MONUMENT_PIT_SIZE_M / 2) / Math.max(Math.abs(ux), Math.abs(uz)) + CHARGE_LINK_EDGE_PAD_M, Math.max(0, d - 1))
		cands.push({ a: f, b: { id: mon.id, x: m.x + ((f.x - m.x) / d) * e, z: m.z + ((f.z - m.z) / d) * e }, key: linkKey(f.id, mon.id) })
	}
	const ids = [...fires.map((f) => f.id), ...(cands.some((c) => c.b.id === mon.id) ? [mon.id] : [])]
	const E = (list: NetCand[]) => list.map((c) => ({ c, r: routeOf(c) })).filter((x) => x.r).map((x) => ({ a: x.c.a.id, b: x.c.b.id, L: x.r!.lengthM }))
	const all = E(cands)
	const legacy = E([...pickLinkPairs(fires).map(([a, b]) => ({ a, b, key: linkKey(a.id, b.id) })), ...cands.filter((c) => c.b.id === mon.id)])
	const pr = pruneNetwork(cands, routeOf).map((k) => ({ a: k.cand.a.id, b: k.cand.b.id, L: k.route.lengthM }))
	const monLinks = pr.filter((e) => e.b === mon.id).length
	// Charge membership = live (kept) monument link.
	const dOf = (id: number) => { const f = fires.find((q) => q.id === id)!; return Math.hypot(f.x - m.x, f.z - m.z) }
	const inRange = cands.filter((c) => c.b.id === mon.id)
	const routed = inRange.filter((c) => routeOf(c))
	const kept = pr.filter((e) => e.b === mon.id).map((e) => dOf(e.a))
	chIn += inRange.length; chRouted += routed.length; chKept += kept.length
	const rk = chargeRatePerS(kept), ra = chargeRatePerS(routed.map((c) => dOf(c.a.id)))
	if (rk > 0) chTimes.push(1 / rk)
	if (ra > 0 && rk < ra * 0.999) chSlower++
	// Rule: no fire with only monument links while a routable fire candidate exists.
	for (const f of fires) {
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
	// the final approach than the fire / monument end, then doubling back.
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
	say(`  N=${String(N).padStart(2)} seed ${seed}: all-in-range ${stats(ids, all)} | legacy ${stats(ids, legacy)} | pruned ${stats(ids, pr)} (monument links ${monLinks}/${cands.filter((c) => c.b.id === mon.id).length})`)
}
say(`  route ends checked=${ends} overshooting (>1.5 m past the end then back)=${overshoot}`)
ends = overshoot = 0
say(`  kept links passing within 3 m of a non-end fire: ${passThrough}/${keptTotal}`)
passThrough = keptTotal = 0
say(`  fire-link rule (${NETWORK_FIRE_LINK_RULE_ENABLED ? 'on' : 'off'}): monument-only fires with a fire candidate = ${ruleViol} ${NETWORK_FIRE_LINK_RULE_ENABLED ? (ruleViol === 0 ? 'PASS' : 'FAIL') : '(rule off)'}; true networks of one = ${ruleSolo}`)
ruleViol = ruleSolo = 0
chTimes.sort((a, b) => a - b)
say(`  monument charge (range ${CHARGE_RING_M} m): candidates in range=${chIn} routable=${chRouted} kept-linked (=charging)=${chKept} | charge time with kept links min ${(chTimes[0] ?? NaN).toFixed(0)} s median ${(chTimes[chTimes.length >> 1] ?? NaN).toFixed(0)} s max ${(chTimes[chTimes.length - 1] ?? NaN).toFixed(0)} s | runs slowed by pruning ${chSlower}`)
chIn = chRouted = chKept = chSlower = 0; chTimes.length = 0
