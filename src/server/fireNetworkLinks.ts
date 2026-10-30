/**
 * fireNetworkLinks.ts — dependency-free "is this fire linked" registry.
 *
 * hiddenCampfire.ts / hearthFuel.ts read it for NETWORK_BURN_MUL;
 * fireNetwork.ts writes it. Keeps those modules from importing
 * fireNetwork.ts (which imports them) — no server import cycle.
 */

import { NETWORK_SHARE_HOPS, NETWORK_SHARE_KEEP, splitFuelChainFirst, splitFuelKeepShare } from 'src/shared/fireNetwork'
import { chainHopOf } from 'src/server/chargeLinks'
import { FUEL_MAX } from 'src/shared/hearthFuel'
import { room } from 'src/shared/messages'

const linked = new Set<number>()

/** Replace the set of fire ids (0 = hearth, i + 1 = hidden i) in held links. */
export function setLinkedFireIds(ids: Iterable<number>): void {
	linked.clear()
	for (const id of ids) linked.add(id)
}

export function isFireLinked(id: number): boolean {
	return linked.has(id)
}


// MARK: shared fuel

const edges: [number, number][] = []
/** Per-fire fuel accessors, registered by hearthFuel.ts (id 0) and hiddenCampfire.ts (i + 1). */
const fuelOf = new Map<number, { get: () => number; add: (n: number) => void }>()

export function setLinkedEdges(pairs: [number, number][]): void {
	edges.length = 0
	for (const p of pairs) edges.push(p)
}

/** Fire-fire edges whose trail is fully drawn (fireNetwork), for chain charging. */
let visEdges: [number, number][] = []
export function setVisibleEdges(p: [number, number][]): void { visEdges = p }
export function getVisibleEdges(): ReadonlyArray<readonly [number, number]> { return visEdges }

export function registerFireFuel(id: number, get: () => number, add: (n: number) => void): void {
	fuelOf.set(id, { get, add })
}

/** Lit fires within `hops` held-link hops of `id` (excludes id). */
function nearby(id: number, hops: number): number[] {
	const seen = new Set<number>([id])
	const depth = new Map<number, number>([[id, 0]])
	const q = [id]
	while (q.length) {
		const c = q.shift()!
		if (depth.get(c)! >= hops) continue
		for (const [a, b] of edges) {
			const o = a === c ? b : b === c ? a : -1
			if (o >= 0 && !seen.has(o) && (fuelOf.get(o)?.get() ?? 0) > 0) { seen.add(o); depth.set(o, depth.get(c)! + 1); q.push(o) }
		}
	}
	seen.delete(id)
	return [...seen]
}

/**
 * Shared feed. 'none' = not in a network (caller does the normal feed);
 * 'shared' = split applied + burst broadcast; 'full' = the network can't
 * take the whole piece (caller refuses, like the normal cap).
 */
export function tryShareFeed(id: number, add: number, from: string): 'none' | 'shared' | 'full' {
	if (!linked.has(id)) return 'none'
	const fed = fuelOf.get(id)
	if (!fed) return 'none'
	const ids = nearby(id, NETWORK_SHARE_HOPS).filter((i) => fuelOf.has(i))
	if (ids.length < 1) return 'none'
	// Fuel follows heat: a fed chain fire sends its shared part first to the
	// chain fires closer to the obelisk (lower hop), then the normal rule.
	const fedHop = id > 0 ? chainHopOf(id - 1) : 0
	const hops = ids.map((i) => { const h = i > 0 ? chainHopOf(i - 1) : 0; return fedHop > 0 && h > 0 && h < fedHop ? h : 0 })
	const r = hops.some((h) => h > 0)
		? splitFuelChainFirst(fed.get(), ids.map((i) => fuelOf.get(i)!.get()), hops, FUEL_MAX, add, NETWORK_SHARE_KEEP)
		: splitFuelKeepShare(fed.get(), ids.map((i) => fuelOf.get(i)!.get()), FUEL_MAX, add, NETWORK_SHARE_KEEP)
	if (!r) return 'full'
	if (r.fed > 0) fed.add(r.fed)
	const got: number[] = []
	ids.forEach((i, k) => { if (r.others[k] > 0.01) { fuelOf.get(i)!.add(r.others[k]); got.push(i) } })
	console.log(`[Server] fireNetwork: shared feed by ${from} at ${id}: +${add}s -> kept ${r.fed.toFixed(1)}, ${ids.map((i, k) => `${i}:+${r.others[k].toFixed(1)}`).join(' ')}`)
	if (got.length) room.send('fireNetworkShare', { from: id, ids: got })
	return 'shared'
}
