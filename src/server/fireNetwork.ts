/**
 * fireNetwork.ts (server) — fire network prototype.
 *
 * Every NETWORK_TICK_S: gather lit campfires (hearth + hidden pits), pick
 * RNG pairs within range (src/shared/fireNetwork.ts), route each pair on
 * the terrain grid. New links melt + path-protect their snow cells outward
 * from both fires over NETWORK_MELT_S. A link whose fire went out (or that
 * the graph dropped) retreats its protection over NETWORK_REFREEZE_S from
 * the dead end; released cells keep their stage and regrow with weather.
 *
 * Broadcast: fireLinkState { a, b, ax, az, bx, bz, state, ageMs, deadA, deadB }
 * per change; joiners get every live / retreating link.
 */

import { engine } from '@dcl/sdk/ecs'

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import {
	FIRE_NETWORK_DEBUG,
	FireLinkRoute,
	FireNode,
	NETWORK_HEARTH_ID,
	NETWORK_MELT_S,
	NETWORK_REFREEZE_S,
	NETWORK_PATH_REFREEZE_ENABLED,
	NETWORK_TICK_S,
	NETWORK_LINK_RANGE_M,
	NETWORK_TOPOLOGY,
	NetCand,
	linkFullyVisibleS,
	linkKey,
	pickLinkPairs,
	pruneNetwork,
	routeFireLink,
} from 'src/shared/fireNetwork'
import { hearthIsLit } from 'src/shared/hearthFuel'
import { room } from 'src/shared/messages'
import { activeTerrain } from 'src/shared/terrain/terrainCache'

import { onCycleRoll } from 'src/server/cycle'
import { getMainFireFuel } from 'src/server/hearthFuel'
import { getHiddenFireNodes } from 'src/server/hiddenCampfire'
import { meltPathCell, releasePathCell } from 'src/server/snowState'
import { setLinkedEdges, setLinkedFireIds, setVisibleEdges } from 'src/server/fireNetworkLinks'
import { getChargePairs, setMonumentLinks } from 'src/server/chargeLinks'
import { isMonumentNodeId } from 'src/shared/ruleset'


interface Link {
	a: FireNode; b: FireNode
	route: FireLinkRoute
	/** ms since link formed (melting / held). */
	startMs: number
	/** Breaking: ms when it broke, and which end(s) died. */
	brokeMs: number
	deadA: boolean; deadB: boolean
	/** Cells already melted / released (index into route.cells sorted by melt order). */
	meltOrder: number[]   // indices sorted by min(t, L - t)
	melted: number
	released: Set<number>
	/** Cell indices this link has actually put a hold on (ref-counted in snowState). */
	held: Set<number>
}

const links = new Map<string, Link>()
/** Route cache by pair key (terrain is fixed for a cycle). null = no route. */
const routeCache = new Map<string, FireLinkRoute | null>()
let litSig = ''
/** Charge links: chosen monument end per pair key (null = none routes). */
const chargeEndCache = new Map<string, FireNode | null>()
/** Route cache key: ids + end positions (slots are reused by new fires elsewhere). */
function routeKey(a: FireNode, b: FireNode): string {
	const [p, q] = a.id < b.id ? [a, b] : [b, a]
	return `${p.id}:${p.x.toFixed(2)},${p.z.toFixed(2)}|${q.id}:${q.x.toFixed(2)},${q.z.toFixed(2)}`
}
function sameEnds(l: { a: FireNode; b: FireNode }, a: FireNode, b: FireNode): boolean {
	return routeKey(l.a, l.b) === routeKey(a, b)
}
let clock = 0


// MARK: litNodes
function litNodes(): FireNode[] {
	const out: FireNode[] = []
	if (hearthIsLit(getMainFireFuel())) out.push({ id: NETWORK_HEARTH_ID, x: CAMPFIRE_WORLD_X, z: CAMPFIRE_WORLD_Z })
	for (const n of getHiddenFireNodes()) if (n.lit) out.push({ id: n.index + 1, x: n.x, z: n.z })
	return out
}

function publishLinkedIds(): void {
	const ids: number[] = []
	// Charge links (fire -> monument) are visual + snow + warmth only:
	// never in shared fuel or the linked-fire burn multiplier.
	for (const l of links.values()) if (l.brokeMs === 0 && !isMonumentNodeId(l.b.id)) ids.push(l.a.id, l.b.id)
	setLinkedFireIds(ids)
	const pairs: [number, number][] = []
	for (const l of links.values()) if (l.brokeMs === 0 && !isMonumentNodeId(l.b.id)) pairs.push([l.a.id, l.b.id])
	setLinkedEdges(pairs)
	// Charging only counts links whose trail is fully drawn on clients
	// (connectedAt = startMs + linkFullyVisibleS): monument links + chain edges.
	const now = Date.now()
	const shown = (l: Link) => now - l.startMs >= linkFullyVisibleS(isMonumentNodeId(l.b.id)) * 1000
	const vis: [number, number][] = []
	for (const l of links.values()) if (l.brokeMs === 0 && !isMonumentNodeId(l.b.id) && shown(l)) vis.push([l.a.id, l.b.id])
	setVisibleEdges(vis)
	const mon = new Map<number, Set<number>>()
	for (const l of links.values()) {
		if (l.brokeMs !== 0 || !isMonumentNodeId(l.b.id) || !shown(l)) continue
		let s = mon.get(l.b.id)
		if (!s) { s = new Set(); mon.set(l.b.id, s) }
		s.add(l.a.id - 1)
	}
	setMonumentLinks(mon)
}


function payload(l: Link) {
	return {
		a: l.a.id, b: l.b.id, ax: l.a.x, az: l.a.z, bx: l.b.x, bz: l.b.z,
		state: l.brokeMs === 0 ? 1 : 0,
		ageMs: Math.min(2_000_000_000, Date.now() - (l.brokeMs === 0 ? l.startMs : l.brokeMs)),
		deadA: l.deadA ? 1 : 0, deadB: l.deadB ? 1 : 0,
	}
}
function broadcast(l: Link, to?: string): void {
	room.send('fireLinkState', payload(l), to ? { to: [to] } : undefined)
}

export function sendFireNetworkStateTo(userId: string): void {
	for (const l of links.values()) broadcast(l, userId)
}


// MARK: evaluate
function evaluate(): void {
	const map = activeTerrain()
	if (!map) return
	const nodes = litNodes()
	// Floating crystals: each charging fire also links to its monument
	// (end node on the pit edge facing that fire). Not part of the RNG
	// graph, so fire-to-fire links are unchanged.
	const charge = getChargePairs()
	const sig = nodes.map((n) => `${n.id}@${n.x.toFixed(1)},${n.z.toFixed(1)}`).join(',') + '|' + charge.map((p) => `${p.slot}>${p.mon}`).join(',')
	const litIds = new Set(nodes.map((n) => n.id))
	for (const p of charge) litIds.add(p.mon)
	if (sig !== litSig) {
		litSig = sig
		const want = new Set<string>()
		// Links already held stay while both fires are lit (hysteresis):
		// the RNG only decides NEW links, so lighting a third fire never
		// drops a working path (the old V-shape bug).
		// Charge pairs: first candidate monument end that routes (cached).
		const chargeNodes: [FireNode, FireNode][] = []
		for (const p of charge) {
			if (!litIds.has(p.slot + 1)) continue
			const k = linkKey(p.slot + 1, p.mon)
			const fire: FireNode = { id: p.slot + 1, x: p.fx, z: p.fz }
			const ek = `${k}@${p.fx.toFixed(2)},${p.fz.toFixed(2)}`
			let end = chargeEndCache.get(ek)
			if (end === undefined) {
				end = null
				for (const c of p.ends) {
					const node: FireNode = { id: p.mon, x: c.x, z: c.z }
					const r = routeFireLink(map, fire, node)
					if (r) { end = node; routeCache.set(routeKey(fire, node), r); break }
				}
				chargeEndCache.set(ek, end)
			}
			if (end) chargeNodes.push([fire, end])
		}
		let pairs: [FireNode, FireNode][]
		if (NETWORK_TOPOLOGY === 'legacy') {
			// Old: RNG on fires + hysteresis + every charging fire -> monument.
			pairs = pickLinkPairs(nodes)
			const have = new Set(pairs.map(([p, q]) => linkKey(p.id, q.id)))
			for (const cp of chargeNodes) { pairs.push(cp); have.add(linkKey(cp[0].id, cp[1].id)) }
			for (const l of links.values()) {
				if (l.brokeMs !== 0 || !litIds.has(l.a.id) || !litIds.has(l.b.id)) continue
				if (!have.has(linkKey(l.a.id, l.b.id))) { pairs.push([l.a, l.b]); have.add(linkKey(l.a.id, l.b.id)) }
			}
		} else {
			// Streamlined: prune all in-range fire pairs + charge pairs together
			// (monuments are nodes), reconnect, drop parallel duplicates.
			const cands: NetCand[] = []
			const r2 = NETWORK_LINK_RANGE_M * NETWORK_LINK_RANGE_M
			for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
				const a = nodes[i], b = nodes[j]
				if ((a.x - b.x) ** 2 + (a.z - b.z) ** 2 <= r2) cands.push({ a, b, key: linkKey(a.id, b.id) })
			}
			for (const [a, b] of chargeNodes) cands.push({ a, b, key: linkKey(a.id, b.id) })
			const routeOf = (c: NetCand) => {
				const rk = routeKey(c.a, c.b)
				let r = routeCache.get(rk)
				if (r === undefined) { r = routeFireLink(map, c.a, c.b); routeCache.set(rk, r) }
				return r
			}
			const kept = pruneNetwork(cands, routeOf)
			pairs = kept.map((k) => [k.cand.a, k.cand.b])
			console.log(`[Server] fireNetwork: topology ${NETWORK_TOPOLOGY}: ${nodes.length} fires + ${new Set(chargeNodes.map((c) => c[1].id)).size} monuments, ${cands.length} candidates -> ${pairs.length} links`)
		}		for (const [a, b] of pairs) {
			const k = linkKey(a.id, b.id)
			const rk = routeKey(a, b)
			let r = routeCache.get(rk)
			if (r === undefined) { r = routeFireLink(map, a, b); routeCache.set(rk, r) }
			if (FIRE_NETWORK_DEBUG) console.log(`[Server] fireNetwork: pair ${k} ${r ? `route ${r.lengthM.toFixed(0)} m, ${r.cells.length} cells` : 'NO ROUTE'}`)
			if (!r) continue
			want.add(k)
			const cur = links.get(k)
			// Same ids AND same end positions = the same link (keep it). A slot
			// reused by a new built fire elsewhere, or a monument end that moved,
			// is a NEW link (the old route would end at the old spot).
			if (cur && cur.brokeMs === 0 && sameEnds(cur, a, b)) continue
			// New link (or a retreating one relit): restart the melt.
			const L = r.lengthM
			// Charge links (fire -> monument): melt only from the fire end.
			const oneWay = isMonumentNodeId(b.id)
			const md = (t: number) => (oneWay ? t : Math.min(t, L - t))
			const order = r.cells.map((_, i) => i).sort((i, j) => md(r!.cells[i].t) - md(r!.cells[j].t))
			const l: Link = { a, b, route: r, startMs: Date.now(), brokeMs: 0, deadA: false, deadB: false, meltOrder: order, melted: 0, released: new Set(), held: new Set() }
			// A retreating link that relinks is replaced; the new melt re-protects its cells.
			// Drop the old link's remaining holds first (holds are ref-counted per cell).
			if (cur) for (const i of cur.held) if (!cur.released.has(i)) releasePathCell(cur.route.cells[i].key, cur.route.cells[i].cap)
			links.set(k, l)
			broadcast(l)
			console.log(`[Server] fireNetwork: LINK ${k} (${L.toFixed(0)} m, ${r.cells.length} cells)`)
		}
		for (const [k, l] of links) {
			if (l.brokeMs !== 0 || want.has(k)) continue
			l.brokeMs = Date.now()
			l.deadA = !litIds.has(l.a.id)
			l.deadB = !litIds.has(l.b.id)
			if (!l.deadA && !l.deadB) { l.deadA = true; l.deadB = true } // no longer routable: retreat from both ends
			broadcast(l)
			console.log(`[Server] fireNetwork: BREAK ${k} deadA=${l.deadA} deadB=${l.deadB}`)
		}
	}
}


// MARK: step
function step(): void {
	const now = Date.now()
	for (const [k, l] of links) {
		const cells = l.route.cells
		const L = Math.max(1, l.route.lengthM)
		if (l.brokeMs === 0) {
			// Melt outward from both fires; keep re-asserting held cells cheaply.
			// Charge links run one way (fire end -> monument) at the same speed.
			const oneWay = isMonumentNodeId(l.b.id)
			const reach = (oneWay ? L : L / 2) * Math.min(1, (now - l.startMs) / (NETWORK_MELT_S * (oneWay ? 2000 : 1000)))
			while (l.melted < l.meltOrder.length) {
				const c = cells[l.meltOrder[l.melted]]
				if ((oneWay ? c.t : Math.min(c.t, L - c.t)) > reach) break
				meltPathCell(c.key, c.cap)
				l.held.add(l.meltOrder[l.melted])
				l.melted++
			}
			continue
		}
		// Retreat from the dead end(s).
		const u = NETWORK_PATH_REFREEZE_ENABLED ? Math.min(1, (now - l.brokeMs) / (NETWORK_REFREEZE_S * 1000)) : 1
		for (let i = 0; i < cells.length; i++) {
			if (l.released.has(i)) continue
			const c = cells[i]
			const fromDead = l.deadA && l.deadB ? Math.min(c.t, L - c.t) / (L / 2) : l.deadA ? c.t / L : (L - c.t) / L
			if (fromDead <= u) { if (l.held.has(i)) releasePathCell(c.key, c.cap); l.released.add(i) }
		}
		if (l.released.size >= cells.length) links.delete(k)
	}
}


export function setupFireNetworkServer(): void {
	// Guarded: a prototype bug must never throw out of the server's system
	// loop (that would also stall snow flush / regrowth for everyone).
	let failed = false
	engine.addSystem((dt: number) => {
		if (failed) return
		try {
			clock += dt
			if (clock >= NETWORK_TICK_S) { clock = 0; evaluate(); publishLinkedIds() }
			step()
		} catch (err) {
			failed = true
			console.error('[Server] fireNetwork: DISABLED after error', err)
		}
	})
	onCycleRoll(() => {
		// Snow wipe clears path protection too (snowState.clearAllSnow).
		links.clear()
		routeCache.clear()
		chargeEndCache.clear()
		litSig = ''
	})
	console.log('[Server] fireNetwork: installed')
}
