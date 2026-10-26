/**
 * fireNetworkLinks.ts — dependency-free "is this fire linked" registry.
 *
 * hiddenCampfire.ts / hearthFuel.ts read it for NETWORK_BURN_MUL;
 * fireNetwork.ts writes it. Keeps those modules from importing
 * fireNetwork.ts (which imports them) — no server import cycle.
 */

const linked = new Set<number>()

/** Replace the set of fire ids (0 = hearth, i + 1 = hidden i) in held links. */
export function setLinkedFireIds(ids: Iterable<number>): void {
	linked.clear()
	for (const id of ids) linked.add(id)
}

export function isFireLinked(id: number): boolean {
	return linked.has(id)
}
