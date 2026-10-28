/**
 * fireSlots.ts - which hidden-campfire slots actually hold a pit this
 * cycle (seed-placed hidden pit or player-built fire). Pure, so the
 * client and scripts/byofCapCheck share one definition.
 *
 * A slot's lit/unlit state never places it: the server sends a
 * hiddenCampfireState for EVERY slot (used or not) on join, and only a
 * seed spot or builtFirePlaced may mark a slot placed.
 */
/**
 * Built-fire recycling: the built fire extinguished the LONGEST
 * (smallest extinguishedAt > 0, unlit), or -1. Burning fires, the
 * hearth (not a slot) and non-built pits are never candidates.
 */
export function pickRecycleSlot(
	built: ReadonlyArray<boolean>,
	lit: ReadonlyArray<boolean>,
	extinguishedAt: ReadonlyArray<number>,
): number {
	let best = -1
	for (let i = 0; i < built.length; i++) {
		if (!built[i] || lit[i] || !(extinguishedAt[i] > 0)) continue
		if (best < 0 || extinguishedAt[i] < extinguishedAt[best]) best = i
	}
	return best
}

/**
 * Spent (out) fires: pure helpers shared by the server, the client and scripts/spentFireCheck.
 * Ash never blocks anything: it is excluded from build spacing and from the fire cap.
 */
/** Fires that count for build spacing: every placed slot that is NOT spent. */
export function spacingFires(
	placed: ReadonlyArray<boolean>,
	spent: ReadonlyArray<boolean>,
	xs: ReadonlyArray<number>,
	zs: ReadonlyArray<number>,
): { x: number; z: number }[] {
	const out: { x: number; z: number }[] = []
	for (let i = 0; i < placed.length; i++) if (placed[i] && !spent[i]) out.push({ x: xs[i], z: zs[i] })
	return out
}
/** Placed, non-spent fires (the fire cap counts these only). */
export function liveFireCount(placed: ReadonlyArray<boolean>, spent: ReadonlyArray<boolean>): number {
	let n = 0
	for (let i = 0; i < placed.length; i++) if (placed[i] && !spent[i]) n++
	return n
}
/** Spent slots whose ash is within radiusM of (x, z): cleared the moment a new fire is built there. */
export function spentSlotsNear(
	spent: ReadonlyArray<boolean>,
	xs: ReadonlyArray<number>,
	zs: ReadonlyArray<number>,
	x: number,
	z: number,
	radiusM: number,
): number[] {
	const out: number[] = []
	for (let i = 0; i < spent.length; i++) {
		if (spent[i] && (xs[i] - x) ** 2 + (zs[i] - z) ** 2 <= radiusM * radiusM) out.push(i)
	}
	return out
}
/** Spent slots whose age (s) reached limitS: due for removal. */
export function spentDue(spent: ReadonlyArray<boolean>, ageS: ReadonlyArray<number>, limitS: number): number[] {
	const out: number[] = []
	for (let i = 0; i < spent.length; i++) if (spent[i] && ageS[i] >= limitS) out.push(i)
	return out
}

export class FireSlotTable {
	readonly placed: boolean[]
	readonly x     : number[]
	readonly z     : number[]

	constructor(readonly size: number) {
		this.placed = new Array(size).fill(false)
		this.x      = new Array(size).fill(0)
		this.z      = new Array(size).fill(0)
	}

	place(i: number, x: number, z: number): void {
		if (i < 0 || i >= this.size) return
		this.placed[i] = true
		this.x[i] = x
		this.z[i] = z
	}

	clear(i: number): void {
		if (i < 0 || i >= this.size) return
		this.placed[i] = false
		this.x[i] = 0
		this.z[i] = 0
	}

	isPlaced(i: number): boolean {
		return i >= 0 && i < this.size && this.placed[i]
	}

	count(): number {
		let n = 0
		for (const p of this.placed) if (p) n++
		return n
	}

	positions(): { x: number; z: number }[] {
		const out: { x: number; z: number }[] = []
		for (let i = 0; i < this.size; i++) if (this.placed[i]) out.push({ x: this.x[i], z: this.z[i] })
		return out
	}
}