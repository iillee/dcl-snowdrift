/** nearObeliskSpawnCheckEntry.ts - the near obelisk sits right by spawn and any lazy fire near spawn links to it. Bundled by nearObeliskSpawnCheck.mjs. */
import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z, SPAWN_LOOK_COMPASS_DEG } from 'src/shared/campfire'
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import {
	BUILT_FIRE_MIN_SPACING_M, CHARGE_LINK_END_HALF_M, CRYSTAL_NEAR_OBELISK_MAX_M, CRYSTAL_NEAR_OBELISK_MIN_M, OBELISK_COUNT, OBELISK_LINK_RANGE_M, OBELISK_NODE_ID_BASE, validateBuiltFireSpot,
} from 'src/shared/ruleset'
import { routeFireLink } from 'src/shared/fireNetwork'
import { OASIS_DROP_M, OASIS_REACH_M, oasisClear, oasisLoweredAt, oasisNoteRelease, oasisRelease, walkableYAtWorld } from 'src/shared/terrain/oasis'

import { generateTerrain } from 'src/shared/terrain/terrainGen'
import { OBELISK_PIT_SIZE_M, STATION_CLEAR_M, cellCenterWorld, groundYAtWorld } from 'src/shared/terrain/terrainMap'

const args = (globalThis as unknown as { __SPAWN_ARGS: { profile: string; seeds: number } }).__SPAWN_ARGS
const g0 = globalThis as { __realLog?: typeof console.log }
g0.__realLog ??= console.log
const real = g0.__realLog
console.log = () => { /* quiet world gen */ }

const lookRad = (SPAWN_LOOK_COMPASS_DEG * Math.PI) / 180
const padX = CAMPFIRE_WORLD_X - Math.sin(lookRad) * 3
const padZ = CAMPFIRE_WORLD_Z - Math.cos(lookRad) * 3
const fails: string[] = []
const dists: number[] = []
const lookOff: number[] = []
let unrouted = 0, routed = 0
let ring18 = 0, ring18Link = 0, front = 0, frontLink = 0, all = 0, allLink = 0
for (let i = 0; i < args.seeds; i++) {
	const seed = cycleMazeSeed(1000 + i * 7919)
	const map = generateTerrain(seed)
	const st = map.stations[0]
	if (!st || !st.near) { fails.push(`seed ${seed}: no near obelisk at index 0`); continue }
	const c = cellCenterWorld(st.cx, st.cz)
	const d = Math.hypot(c.x - CAMPFIRE_WORLD_X, c.z - CAMPFIRE_WORLD_Z)
	if (d < CRYSTAL_NEAR_OBELISK_MIN_M) fails.push(`seed ${seed}: near obelisk ${d.toFixed(0)} m from the hearth (< ${CRYSTAL_NEAR_OBELISK_MIN_M})`)
	dists.push(d)
	if (d > CRYSTAL_NEAR_OBELISK_MAX_M) fails.push(`seed ${seed}: near obelisk ${d.toFixed(0)} m from the hearth (> ${CRYSTAL_NEAR_OBELISK_MAX_M})`)
	if (st.level !== map.levels[map.hearthCz * map.w + map.hearthCx]) fails.push(`seed ${seed}: near obelisk not on the hearth level`)
	if (map.stations.length < OBELISK_COUNT) fails.push(`seed ${seed}: only ${map.stations.length} obelisks`)
	// Clear of the spawn pad and the hearth: pit + rim clearance.
	if (Math.hypot(c.x - padX, c.z - padZ) < STATION_CLEAR_M + 4) fails.push(`seed ${seed}: near obelisk crowds the spawn pad`)
	if (d < STATION_CLEAR_M + 8) fails.push(`seed ${seed}: near obelisk crowds the hearth`)
	let off = Math.abs(Math.atan2(c.z - CAMPFIRE_WORLD_Z, c.x - CAMPFIRE_WORLD_X) - Math.atan2(Math.cos(lookRad), Math.sin(lookRad))) % (Math.PI * 2)
	if (off > Math.PI) off = Math.PI * 2 - off
	lookOff.push(off * 180 / Math.PI)
	// Oasis: the near obelisk's melt reaches the hearth and spawn pad (no plinth). The hearth is ~41 m out, normally outside the 28..36 m patch: it then stays at base height. A cell inside is lowered by exactly
	// one drop lower, so the re-seated hearth / spawn (activeGroundYAt) never leaves the player or the fire floating or underground.
	oasisClear(); oasisNoteRelease(c.x, c.z, -1e9); oasisRelease(map, c.x, c.z, Number.POSITIVE_INFINITY, 0)
	for (const [px, pz] of [[CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z], [padX, padZ]]) {
		const low = oasisLoweredAt(map, px, pz), dy = groundYAtWorld(map, px, pz) - walkableYAtWorld(map, px, pz)
		const far = Math.hypot(px - c.x, pz - c.z) > OASIS_REACH_M + 3
		if (far && (low || dy !== 0)) fails.push(`seed ${seed}: hearth/spawn ${px.toFixed(1)},${pz.toFixed(1)} outside the melt patch but lowered (dy ${dy})`)
		if (Math.abs(dy - (low ? OASIS_DROP_M : 0)) > 1e-9) fails.push(`seed ${seed}: hearth/spawn ${px.toFixed(1)},${pz.toFixed(1)} floor drop ${dy} does not match lowered=${low}`)
	}
	oasisClear()
	// Lazy first fire: every legal spot 18..30 m from the hearth, 5 degree steps.
	const bearing = Math.atan2(c.z - CAMPFIRE_WORLD_Z, c.x - CAMPFIRE_WORLD_X)
	for (const h of [BUILT_FIRE_MIN_SPACING_M + 0.5, 22, 26, 30]) {
		for (let a = 0; a < 72; a++) {
			const ang = (a / 72) * Math.PI * 2
			const x = CAMPFIRE_WORLD_X + Math.cos(ang) * h, z = CAMPFIRE_WORLD_Z + Math.sin(ang) * h
			if (validateBuiltFireSpot(map, x, z, [], () => 0, 0) !== 'ok') continue
			const link = Math.hypot(x - c.x, z - c.z) <= OBELISK_LINK_RANGE_M
			let rel = Math.abs(ang - bearing) % (Math.PI * 2)
			if (rel > Math.PI) rel = Math.PI * 2 - rel
			all++; if (link) allLink++
			if (link && a % 6 === 0) {
				// Same charge-link end the server routes to: the pit edge facing the fire (+ pad).
				const dd = Math.hypot(x - c.x, z - c.z), ux = (x - c.x) / dd, uz = (z - c.z) / dd
				const e = Math.min(CHARGE_LINK_END_HALF_M / Math.max(Math.abs(ux), Math.abs(uz)), Math.max(0, dd - 1))
				const r = routeFireLink(map, { id: 1, x, z }, { id: OBELISK_NODE_ID_BASE, x: c.x + ux * e, z: c.z + uz * e })
				if (r) routed++; else unrouted++
			}
			if (h < 19) { ring18++; if (link) ring18Link++ }
			if (rel <= Math.PI / 3) { front++; if (link) frontLink++ }
		}
	}
}
const q = (a: number[], p: number): string => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))].toFixed(0) : '-' }
const pct = (a: number, b: number): string => b ? (100 * a / b).toFixed(0) + '%' : '-'
real(`[${args.profile}] seeds ${args.seeds} | near obelisk <= ${CRYSTAL_NEAR_OBELISK_MAX_M} m, hearth level, clear of spawn pad + hearth`)
real(`  view off spawn heading deg min/med/max ${q(lookOff, 0)}/${q(lookOff, 0.5)}/${q(lookOff, 0.999)}`)
real(`  near obelisk distance from hearth (m): min ${Math.min(...dists).toFixed(1)} / max ${Math.max(...dists).toFixed(1)} (band ${CRYSTAL_NEAR_OBELISK_MIN_M}-${CRYSTAL_NEAR_OBELISK_MAX_M}); the hearth is not a fire node, so it never charges it`)
real(`  lazy first fire links (<= ${OBELISK_LINK_RANGE_M} m): at 18 m ring ${pct(ring18Link, ring18)} | facing +-60 deg cone 18-30 m ${pct(frontLink, front)} | anywhere 18-30 m ${pct(allLink, all)}`)
real(`  routed charge links from sampled in-range spots: ${routed} ok / ${unrouted} unrouted`)
if (unrouted) fails.push(`${unrouted} in-range fire spots have no route to the near obelisk`)
if (ring18 && ring18Link / ring18 < 0.3) fails.push(`18 m ring coverage ${pct(ring18Link, ring18)} < 30%`)
if (front && frontLink !== front) fails.push(`facing-cone coverage ${pct(frontLink, front)} < 100%`)
if (all && allLink / all < 0.25) fails.push(`overall coverage ${pct(allLink, all)} < 25%`)
if (fails.length) { real(`FAIL ${fails.length}:\n  ` + fails.slice(0, 20).join('\n  ')); process.exitCode = 1 } else real('  PASS')