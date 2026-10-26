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
	linkKey,
	pickLinkPairs,
	routeFireLink,
} from 'src/shared/fireNetwork'
import { hearthIsLit } from 'src/shared/hearthFuel'
import { room } from 'src/shared/messages'
import { activeTerrain } from 'src/shared/terrain/terrainCache'

import { onCycleRoll } from 'src/server/cycle'
import { getMainFireFuel } from 'src/server/hearthFuel'
import { getHiddenFireNodes } from 'src/server/hiddenCampfire'
import { meltPathCell, releasePathCell } from 'src/server/snowState'
import { setLinkedEdges, setLinkedFireIds } from 'src/server/fireNetworkLinks'


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
}

const links = new Map<string, Link>()
/** Route cache by pair key (terrain is fixed for a cycle). null = no route. */
const routeCache = new Map<string, FireLinkRoute | null>()
let litSig = ''
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
	for (const l of links.values()) if (l.brokeMs === 0) ids.push(l.a.id, l.b.id)
	setLinkedFireIds(ids)
	const pairs: [number, number][] = []
	for (const l of links.values()) if (l.brokeMs === 0) pairs.push([l.a.id, l.b.id])
	setLinkedEdges(pairs)
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
	const sig = nodes.map((n) => n.id).join(',')
	const litIds = new Set(nodes.map((n) => n.id))
	if (sig !== litSig) {
		litSig = sig
		const want = new Set<string>()
		// Links already held stay while both fires are lit (hysteresis):
		// the RNG only decides NEW links, so lighting a third fire never
		// drops a working path (the old V-shape bug).
		const pairs = pickLinkPairs(nodes)
		const have = new Set(pairs.map(([p, q]) => linkKey(p.id, q.id)))
		for (const l of links.values()) {
			if (l.brokeMs !== 0 || !litIds.has(l.a.id) || !litIds.has(l.b.id)) continue
			if (!have.has(linkKey(l.a.id, l.b.id))) { pairs.push([l.a, l.b]); have.add(linkKey(l.a.id, l.b.id)) }
		}
		for (const [a, b] of pairs) {
			const k = linkKey(a.id, b.id)
			let r = routeCache.get(k)
			if (r === undefined) { r = routeFireLink(map, a, b); routeCache.set(k, r) }
			if (FIRE_NETWORK_DEBUG) console.log(`[Server] fireNetwork: pair ${k} ${r ? `route ${r.lengthM.toFixed(0)} m, ${r.cells.length} cells` : 'NO ROUTE'}`)
			if (!r) continue
			want.add(k)
			const cur = links.get(k)
			if (cur && cur.brokeMs === 0) continue
			// New link (or a retreating one relit): restart the melt.
			const L = r.lengthM
			const order = r.cells.map((_, i) => i).sort((i, j) => Math.min(r!.cells[i].t, L - r!.cells[i].t) - Math.min(r!.cells[j].t, L - r!.cells[j].t))
			const l: Link = { a, b, route: r, startMs: Date.now(), brokeMs: 0, deadA: false, deadB: false, meltOrder: order, melted: 0, released: new Set() }
			// A retreating link that relinks is replaced; the new melt re-protects its cells.
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
			const reach = (L / 2) * Math.min(1, (now - l.startMs) / (NETWORK_MELT_S * 1000))
			while (l.melted < l.meltOrder.length) {
				const c = cells[l.meltOrder[l.melted]]
				if (Math.min(c.t, L - c.t) > reach) break
				meltPathCell(c.key)
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
			if (fromDead <= u) { releasePathCell(c.key); l.released.add(i) }
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
		litSig = ''
	})
	console.log('[Server] fireNetwork: installed')
}
