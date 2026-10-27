/**
 * byofCapCheck.ts - regression check for the "FIRE LIMIT REACHED on first
 * log" bug. Replays the join hydrate (a lit=0 state for every slot) the
 * way src/client/hiddenCampfire.ts now handles it, then checks the cap
 * verdict at real buildable spots. Bundled by scripts/byofCapCheck.mjs.
 */
import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { FireSlotTable, pickRecycleSlot } from 'src/shared/fireSlots'
import { HIDDEN_CAMPFIRE_COUNT, pickHiddenCampfires } from 'src/shared/hiddenCampfire'
import { BUILT_FIRE_MAX, BUILT_FIRE_MIN_SPACING_M, RULESET, validateBuiltFireSpot } from 'src/shared/ruleset'
import { WORLD_PROFILE } from 'src/shared/settings'
import { getTerrain } from 'src/shared/terrain/terrainCache'

const g0 = globalThis as { __realLog?: typeof console.log }
g0.__realLog ??= console.log
const say = g0.__realLog
console.log = () => {}
let fail = 0
const expect = (ok: boolean, msg: string) => { if (!ok) fail++; say(`  ${ok ? 'PASS' : 'FAIL'} ${msg}`) }

say(`[${WORLD_PROFILE}] ruleset=${RULESET} slots=${HIDDEN_CAMPFIRE_COUNT} cap=${BUILT_FIRE_MAX}`)
const seed = 20007
const map  = getTerrain(cycleMazeSeed(seed))
const slots = new FireSlotTable(HIDDEN_CAMPFIRE_COUNT)
// Boot: seed spots (none in this ruleset).
pickHiddenCampfires(seed).forEach((p, i) => slots.place(i, p.x, p.z))
// Join hydrate: lit=0 for every slot. Old code spawned a pit per slot
// here (42 >= 40 => cap); the state path must not place anything.
const oldPhantomPits = HIDDEN_CAMPFIRE_COUNT
say(`  old logic: ${oldPhantomPits} phantom pits -> cap hit = ${oldPhantomPits >= BUILT_FIRE_MAX}`)
expect(slots.count() === 0, `after hydrate placed=${slots.count()} (want 0)`)

// Find buildable spots on a line out from the hearth.
const spots: { x: number; z: number }[] = []
for (let d = 16; d < 400 && spots.length < BUILT_FIRE_MAX + 2; d += BUILT_FIRE_MIN_SPACING_M + 1) {
	for (let a = 0; a < 16 && spots.length < BUILT_FIRE_MAX + 2; a++) {
		const x = CAMPFIRE_WORLD_X + Math.cos(a / 16 * 6.283) * d, z = CAMPFIRE_WORLD_Z + Math.sin(a / 16 * 6.283) * d
		if (validateBuiltFireSpot(map, x, z, [...slots.positions(), ...spots], () => 0, 0) === 'ok') spots.push({ x, z })
	}
}
expect(spots.length >= BUILT_FIRE_MAX + 1, `found ${spots.length} buildable spots`)
const v0 = validateBuiltFireSpot(map, spots[0].x, spots[0].z, slots.positions(), () => 0, slots.count())
expect(v0 === 'ok', `first log verdict=${v0} (want ok)`)
for (let i = 0; i < BUILT_FIRE_MAX; i++) slots.place(i, spots[i].x, spots[i].z)
const vN = validateBuiltFireSpot(map, spots[BUILT_FIRE_MAX].x, spots[BUILT_FIRE_MAX].z, slots.positions(), () => 0, slots.count())
expect(vN === 'cap', `after ${slots.count()} built verdict=${vN} (want cap)`)
const vDeep = validateBuiltFireSpot(map, spots[0].x + 100, spots[0].z, [], () => 3, 0)
say(`  deep snow verdict sample=${vDeep}`)
slots.clear(0)
const vFree = validateBuiltFireSpot(map, spots[BUILT_FIRE_MAX].x, spots[BUILT_FIRE_MAX].z, slots.positions(), () => 0, slots.count())
expect(vFree === 'ok', `after reset of one slot verdict=${vFree} (want ok)`)
// Recycling at the cap: oldest extinguished built fire, never a burning one.
{
	const n = 5
	const built = [true, true, true, true, false]
	expect(pickRecycleSlot(built, [true, true, true, true, false], [0, 0, 0, 0, 0]) === -1, 'all burning -> no recycle')
	expect(pickRecycleSlot(built, [false, true, false, true, false], [300, 0, 200, 0, 0]) === 2, 'oldest dead (200) recycled')
	expect(pickRecycleSlot(built, [true, true, false, true, false], [100, 0, 200, 0, 0]) === 2, 'relit fire (stale time) skipped')
	expect(pickRecycleSlot(built, [true, true, true, true, false], [0, 0, 0, 0, 50]) === -1, 'non-built slot never recycled')
	void n
	// Full cap with spot 0 dead: building ON the recycled fire's spacing ring is allowed.
	for (let i = 0; i < BUILT_FIRE_MAX; i++) slots.place(i, spots[i].x, spots[i].z)
	const rec = { x: spots[0].x, z: spots[0].z }
	const tx = spots[0].x, tz = spots[0].z // right on the dead fire
	const others = slots.positions().filter((p) => p.x !== rec.x || p.z !== rec.z)
	const vRec = validateBuiltFireSpot(map, tx, tz, others, () => 0, slots.count() - 1)
	const vNoRec = validateBuiltFireSpot(map, tx, tz, slots.positions(), () => 0, slots.count())
	say(`  recycle at cap: near recycled spot verdict=${vRec} (without recycle ${vNoRec})`)
	expect(vNoRec !== 'ok', 'at cap without a dead fire -> refused')
	expect(vRec === 'ok', `recycled fire must not block spacing (got ${vRec})`)
}
say(fail === 0 ? '  ALL PASS' : `  ${fail} FAILED`)