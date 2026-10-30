/**
 * chargeLinks.ts - dependency-free registry of which fires are charging
 * an obelisk right now (floating-crystals ruleset). stations.ts writes
 * it; hiddenCampfire.ts reads it for CHARGE_FIRE_DRAIN_MUL. Keeps the
 * two modules from importing each other.
 *
 * Ids are hidden-slot indices (0..HIDDEN_CAMPFIRE_COUNT-1).
 */
const charging = new Set<number>()
/** Per slot: the player who last built or fed it (gold-name credit). */
const lastTouch = new Map<number, string>()

/** One charging fire -> obelisk link (fire-network shape). */
export interface ChargePair {
	/** Hidden slot index of the fire (network id = slot + 1). */
	slot: number
	/** Fire-network node id of the obelisk (OBELISK_NODE_ID_BASE + i). */
	mon : number
	fx: number; fz: number
	/**
	 * Candidate link ends, best first: the pit edge facing this fire,
	 * then the four pit-side midpoints by distance (fireNetwork takes the
	 * first that routes).
	 */
	ends: { x: number; z: number }[]
}
let pairs: ChargePair[] = []
/** fireNetwork.ts: obelisk node id -> hidden slots with a LIVE (routed, kept) link to it. */
let monLinks = new Map<number, Set<number>>()
export function setObeliskLinks(m: Map<number, Set<number>>): void { monLinks = m }
/** Slots linked to obelisk node `mon` right now (charge membership = linking). */
export function obeliskLinkedSlots(mon: number): ReadonlySet<number> { return monLinks.get(mon) ?? EMPTY }
const EMPTY: ReadonlySet<number> = new Set<number>()

/** stations.ts: the current fire -> obelisk charge links. */
export function setChargePairs(p: ChargePair[]): void {
	pairs = p
}

export function getChargePairs(): readonly ChargePair[] {
	return pairs
}

/** Obelisk node ids fire `slot` is charging. */
export function chargeTargetsOf(slot: number): number[] {
	const out: number[] = []
	for (const p of pairs) if (p.slot === slot) out.push(p.mon)
	return out
}

/** Chain charging: slot -> shortest hop to any unreleased obelisk (1 = direct). */
let chainHop = new Map<number, number>()
export function setChainHops(m: Map<number, number>): void { chainHop = m }
/** Shortest charge hop of hidden slot i (0 = not in a charging chain). */
export function chainHopOf(i: number): number { return chainHop.get(i) ?? 0 }

export function setChargingSlots(ids: Iterable<number>): void {
	charging.clear()
	for (const i of ids) charging.add(i)
}

export function isSlotCharging(i: number): boolean {
	return charging.has(i)
}

export function noteSlotTouched(i: number, userId: string): void {
	if (userId && userId !== 'unknown') lastTouch.set(i, userId)
}

export function clearSlotTouch(i: number): void {
	lastTouch.delete(i)
}

export function slotToucher(i: number): string {
	return lastTouch.get(i) ?? ''
}

export function clearSlotTouches(): void {
	lastTouch.clear()
	charging.clear()
	pairs = []
	chainHop = new Map()
}