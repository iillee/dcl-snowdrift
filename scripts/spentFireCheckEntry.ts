/**
 * spentFireCheck.ts - spent (out) fires: never relightable, removed after SPENT_FIRE_REMOVE_S,
 * ash never limits building (spacing / cap / ghost), freed slot rebuildable, fire network and
 * world flame only see burning fires, hearth + obelisks exempt. Pure helpers + source
 * assertions (the server / client modules need the DCL runtime). scripts/spentFireCheck.mjs.
 */
import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { FireSlotTable, liveFireCount, spacingFires, spentDue, spentSlotsNear } from 'src/shared/fireSlots'
import {
	BUILT_FIRE_MAX,
	BUILT_FIRE_MIN_SPACING_M,
	SPENT_FIRE_CLEAR_M,
	SPENT_FIRE_REMOVE_S,
	validateBuiltFireSpot,
} from 'src/shared/ruleset'
import { getTerrain } from 'src/shared/terrain/terrainCache'

const say = console.log.bind(console)
let fail = 0
const expect = (ok: boolean, msg: string) => { if (!ok) fail++; say(`  ${ok ? 'PASS' : 'FAIL'} ${msg}`) }
const SRC = (globalThis as { __SRC?: Record<string, string> }).__SRC ?? {}
const has = (file: string, re: RegExp) => re.test(SRC[file] ?? '')

say(`spentFire: remove after ${SPENT_FIRE_REMOVE_S}s, clear radius ${SPENT_FIRE_CLEAR_M} m, spacing ${BUILT_FIRE_MIN_SPACING_M} m`)

// --- Timeout: a spent fire is removed once its age reaches SPENT_FIRE_REMOVE_S, not before.
{
	const spent = [true, false, true]
	const age = [0, 0, 0]
	let removedAt = -1
	for (let t = 1; t <= SPENT_FIRE_REMOVE_S + 5; t++) {
		for (let i = 0; i < spent.length; i++) if (spent[i]) age[i] += 1
		const due = spentDue(spent, age, SPENT_FIRE_REMOVE_S)
		if (due.length && removedAt < 0) removedAt = t
		for (const i of due) { spent[i] = false; age[i] = 0 }
	}
	expect(removedAt === SPENT_FIRE_REMOVE_S, `ash removed at t=${removedAt}s (want ${SPENT_FIRE_REMOVE_S})`)
	expect(!spent[0] && !spent[2], 'every spent slot removed; a burning slot (1) never aged out')
	const burning = spentDue([false], [9999], SPENT_FIRE_REMOVE_S)
	expect(burning.length === 0, 'a burning fire is never due')
}

// --- Ash never blocks building: spacing, cap, ghost.
const seed = 20007
const map = getTerrain(cycleMazeSeed(seed))
let S: { x: number; z: number } | null = null
for (let d = 16; d < 400 && !S; d += 5) {
	for (let a = 0; a < 16 && !S; a++) {
		const x = CAMPFIRE_WORLD_X + Math.cos(a / 16 * 6.283) * d, z = CAMPFIRE_WORLD_Z + Math.sin(a / 16 * 6.283) * d
		if (validateBuiltFireSpot(map, x, z, [], () => 0, 0) === 'ok') S = { x, z }
	}
}
expect(S !== null, 'found a buildable spot')
if (S) {
	const t = new FireSlotTable(8)
	t.place(0, S.x, S.z)
	const spent = new Array(8).fill(false)
	const all = t.positions()
	expect(validateBuiltFireSpot(map, S.x, S.z, all, () => 0, 1) !== 'ok', 'burning fire blocks building on its own spot (spacing)')
	spent[0] = true
	const live = spacingFires(t.placed, spent, t.x, t.z)
	expect(live.length === 0, 'spent fire is excluded from the spacing list')
	const vOn = validateBuiltFireSpot(map, S.x, S.z, live, () => 0, liveFireCount(t.placed, spent))
	expect(vOn === 'ok', `building ON the ash spot is allowed (verdict ${vOn})`)
	const vNear = validateBuiltFireSpot(map, S.x + 4, S.z, live, () => 0, 0)
	expect(vNear !== 'too-close' && vNear !== 'spacing', `building 4 m from ash is not refused for spacing (verdict ${vNear})`)
	expect(spentSlotsNear(spent, t.x, t.z, S.x + 1, S.z, SPENT_FIRE_CLEAR_M).join() === '0', 'a new fire overlapping ash clears that ash')
	expect(spentSlotsNear(spent, t.x, t.z, S.x + SPENT_FIRE_CLEAR_M + 3, S.z, SPENT_FIRE_CLEAR_M).length === 0, 'ash farther than the clear radius stays')
	const burningOnly = [false, ...new Array(7).fill(false)]
	expect(spentSlotsNear(burningOnly, t.x, t.z, S.x, S.z, SPENT_FIRE_CLEAR_M).length === 0, 'a burning fire is never cleared by a build')
	// Removed: slot freed, spot buildable, positions empty.
	t.clear(0); spent[0] = false
	expect(t.count() === 0 && t.positions().length === 0, 'removed fire frees its slot')
	expect(validateBuiltFireSpot(map, S.x, S.z, t.positions(), () => 0, liveFireCount(t.placed, spent)) === 'ok', 'freed spot can be built on again')
}
{
	const placed = new Array(42).fill(false).map((_, i) => i < BUILT_FIRE_MAX)
	const spent = new Array(42).fill(false).map((_, i) => i < 3)
	expect(liveFireCount(placed, spent) === BUILT_FIRE_MAX - 3, 'ash does not count toward the fire cap')
	const spot = S ?? { x: CAMPFIRE_WORLD_X + 30, z: CAMPFIRE_WORLD_Z }
	expect(validateBuiltFireSpot(map, spot.x, spot.z, [], () => 0, BUILT_FIRE_MAX) === 'cap', 'sanity: a full cap of BURNING fires still refuses')
}

// --- Wiring (source assertions): relight path, network, world flame, hearth exempt, UI.
const SH = 'src/server/hiddenCampfire.ts', CH = 'src/client/hiddenCampfire.ts'
expect(has(SH, /spent\[index\] \|\| gone\[index\] \|\| built\[index\]/), 'server ignite handler refuses spent / removed / built fires (no relight)')
expect(has(SH, /broadcastRecycle\(\)\s*\n\s*markSpent\(index\)/), 'snuffFire (fuel exhausted) marks the fire spent')
expect(has(SH, /spentDue\(spent, spentAge, SPENT_FIRE_REMOVE_S\)[^\n]*removeFire/), 'server removes spent fires after SPENT_FIRE_REMOVE_S')
expect(has(SH, /!lit\[target\] \|\| fuel\[target\] <= 0/), 'feeding a fire that is out is refused (no logs on ash)')
expect(has(SH, /room\.send\('fireRemoved'/) && has(SH, /else if \(gone\[i\]\)/) && has(SH, /if \(spent\[i\]\) broadcastSpent\(i, userId\)/), 'removal broadcast + late-join hydration (ash shown, removed absent)')
expect(has(SH, /forgetFireContributors\(index \+ 1\)/) && has(SH, /clearSlotTouch\(index\)/), 'leaderboard credit + slot touch cleared on removal')
expect(has(SH, /lit: lit\[i\] && fuel\[i\] > 0/) && has('src/server/fireNetwork.ts', /for \(const n of getHiddenFireNodes\(\)\) if \(n\.lit\)/), 'fire network nodes = burning fires only (links to ash / removed fires drop)')
expect(has('src/server/worldFlame.ts', /isAnyHiddenFireLit\(\)/) && has(SH, /if \(lit\[i\] && fuel\[i\] > 0\) return true/), 'world-flame rule counts burning fires only (unchanged)')
expect(has(SH, /spacingFires\(/) && has(SH, /spentSlotsNear\(/) && has(SH, /if \(count >= BUILT_CAP\) return 'cap'/), 'server build: ash excluded from spacing + cap, ash under a new fire cleared')
expect(has(CH, /if \(spentLocal\[i\]\) continue/), 'client never offers an ignite on ash (torch relight prompt)')
expect(has('src/client/buildFire.ts', /getLiveFirePositions\(\)/) && !has('src/client/buildFire.ts', /getPlacedFirePositions\(\)/), 'client build ghost ignores ash')
expect(has(CH, /fireRemoved/) && has(CH, /sinking\.push\(/), 'client removes pit + ash entities (sink) on fireRemoved')
expect(!has('src/server/hearthFuel.ts', /markSpent|removeFire|spentAge|spent\[/) && !has('src/server/hearthFuel.ts', /from 'src\/server\/hiddenCampfire'/), 'main hearth keeps its own behaviour (exempt)')
expect(!has('src/server/stations.ts', /markSpent|removeFire|spentAge/), 'obelisks / eternal heat untouched')

say(fail === 0 ? '  ALL PASS' : `  ${fail} FAILED`)
if (fail) process.exit(1)