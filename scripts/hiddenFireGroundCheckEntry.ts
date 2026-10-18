/**
 * hiddenFireGroundCheckEntry.ts - every hidden campfire must sit on the
 * walkable surface of the terrain that is actually DRAWN at its x/z.
 * Bundled by scripts/hiddenFireGroundCheck.mjs. Deterministic.
 *
 * The client seats pits with activeGroundYAt (the SeedHolder layout the
 * terrain renderer draws), not the Y baked in from the cycle seed's own
 * map. This checks, over N seeds:
 *   1. placement: spot.y == ground of the cycle seed's map (same layout);
 *   2. old rule, drawn layout != cycle layout (offline seed 1 fallback /
 *      dev reroll / foreign SeedHolder): how far the baked Y floats;
 *   3. new rule (activeGroundYAt on the drawn layout): must be 0 off.
 */
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { pickHiddenCampfires } from 'src/shared/hiddenCampfire'
import { WORLD_PROFILE } from 'src/shared/settings'
import { activeGroundYAt, getTerrain, setActiveTerrain } from 'src/shared/terrain/terrainCache'
import { groundYAtWorld } from 'src/shared/terrain/terrainMap'

const TOL   = 0.05
const SEEDS = Number((globalThis as { __HF_SEEDS?: number }).__HF_SEEDS ?? 40)
const g0 = globalThis as { __realLog?: typeof console.log }
g0.__realLog ??= console.log
const out = g0.__realLog
console.log = () => {}

let pits = 0, placeOff = 0, oldFloat = 0, oldMaxUp = 0, newOff = 0
let failed = false
const examples: string[] = []
for (let s = 0; s < SEEDS; s++) {
	const seed  = 20000 + s * 7
	const own   = cycleMazeSeed(seed)
	const map   = getTerrain(own)
	const spots = pickHiddenCampfires(seed)
	// Drawn layout for the mismatch case: the offline fallback seed 1.
	const drawn = 1
	for (const p of spots) {
		pits++
		// 1. placement on its own layout
		if (Math.abs(p.y - groundYAtWorld(map, p.x, p.z)) > TOL) {
			placeOff++
			if (examples.length < 6) examples.push(`placement seed=${seed} (${p.x.toFixed(1)},${p.z.toFixed(1)}) y=${p.y.toFixed(2)}`)
		}
		// new rule, same layout drawn
		setActiveTerrain(own)
		if (Math.abs(activeGroundYAt(p.x, p.z) - groundYAtWorld(map, p.x, p.z)) > TOL) newOff++
		// 2. old rule vs a different drawn layout
		setActiveTerrain(drawn)
		const g = activeGroundYAt(p.x, p.z)
		const up = p.y - g
		if (up > TOL) { oldFloat++; oldMaxUp = Math.max(oldMaxUp, up) }
		// 3. new rule on the drawn layout
		const seated = activeGroundYAt(p.x, p.z)
		if (Math.abs(seated - groundYAtWorld(getTerrain(drawn), p.x, p.z)) > TOL) newOff++
	}
}
if (placeOff > 0 || newOff > 0) failed = true
out(`[${WORLD_PROFILE}] seeds=${SEEDS} pits=${pits}`)
out(`  placement off own ground: ${placeOff}`)
out(`  OLD baked Y with a different drawn layout: ${oldFloat} floating, max ${oldMaxUp.toFixed(1)} m up`)
out(`  NEW grounded Y (activeGroundYAt) off drawn ground: ${newOff}`)
for (const e of examples) out('   e.g. ' + e)
out(failed ? '  FAIL' : '  PASS')
if (failed) (globalThis as { __HF_FAIL?: boolean }).__HF_FAIL = true
