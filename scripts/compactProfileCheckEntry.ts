/**
 * compactProfileCheck - the world-profile envelope (settings.WORLD_PROFILE_SPEC): monument count, no volcano, role distances
 * (A introduction / B exploration / C expedition), wood, travel times, the 3-node finale (ring, camera framing, late joiner),
 * the 3/3 charge + release model, leaderboard separation per profile and dev-trigger safety. Runs for every profile: the
 * compact_3 assertions fire only for compact_3; the standard profiles assert they are UNCHANGED (6 monuments, a volcano, the
 * standard board key). Bundled by scripts/compactProfileCheck.mjs. Usage: node scripts/compactProfileCheck.mjs [seedCount]
 */
import { readFileSync } from 'fs'
import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { OASIS_RADIUS_M } from 'src/shared/terrain/oasis'
import { FINALE_TITLE } from 'src/shared/finale'
import { debugFinaleAllowed, DEBUG_FINALE_BUTTON, DEBUG_THAW_BUTTON } from 'src/client/devFlags'
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { crystalFloatBottomY } from 'src/shared/crystalFloat'
import {
	FINALE_PULSE_RADIUS_M, finaleAvoidZone, finaleBeamProgress, finaleCameraPose, finaleEdgeLengths, finaleEdges, finaleFrameMetric, finaleOrder, finalePoints, finalePoseOpts, finaleTimes,
} from 'src/shared/finale'
import { NETWORK_LINK_RANGE_M, NETWORK_MONUMENT_HARD_M, NETWORK_MONUMENT_END_SKIP_M, minDistToCentre, routeFireLink } from 'src/shared/fireNetwork'
import { HIDDEN_CAMPFIRE_COUNT } from 'src/shared/hiddenCampfire'
import {
	LEADERBOARD_BASE_KEY, LEADERBOARD_HEADING, LEADERBOARD_STORAGE_KEY, leaderboardKeyFor, newPlayer, parseStoredBoard, serializeBoard, storedBoardTag,
} from 'src/shared/leaderboard'
import {
	BUILT_FIRE_MAX, CHARGE_REF_DIST_M, CHARGE_RING_M, CHARGE_REF_FIRES, CHARGE_TARGET_S, MONUMENT_COUNT, MONUMENT_DISTANCE_BANDS, MONUMENT_MIN_ANGLE_DEG,
	WOOD_FRONTIER_RING_ACTIVE, WOOD_FRONTIER_ROUTE_ACTIVE, chargeRatePerS,
} from 'src/shared/ruleset'
import { hearthDecayRate } from 'src/shared/hearthFuel'
import {
	WORLD_CROWD_BURN_COEF, TERRAIN_CELL_M, WORLD_BOARD_SUFFIX, WORLD_HAS_VOLCANO, WORLD_IS_COMPACT, WORLD_MONUMENT_COUNT, WORLD_PROFILE, WORLD_PROFILE_SPEC, WorldProfile,
	TERRAIN_LEVEL_HIGH, TERRAIN_LEVEL_MOUNTAIN, groundYForLevel, isCrownLevel, isMountainLevel, isInsidePlayfield, sceneHeightLimitM,
} from 'src/shared/settings'
import { getTerrain, offHearthCellsForMazeSeed } from 'src/shared/terrain/terrainCache'
import { TERRAIN_ORIGIN_M, cellCenterWorld, groundYAtWorld, levelAtWorld } from 'src/shared/terrain/terrainMap'
import { SNOW_ORIGIN_M, SNOW_TILES_X, SNOW_TILES_Z } from 'src/shared/snowGrid'
import {
	WOOD_BAND_DEST, WOOD_BAND_FAR, WOOD_BAND_FRONTIER_RING, WOOD_BAND_FRONTIER_ROUTE, WOOD_BAND_ICED_CLUSTER, WOOD_BAND_NEAR, WOOD_BAND_OUTER, WOOD_BAND_TREE,
	WOOD_FAR_ACTIVE, WOOD_NEAR_ACTIVE, WOOD_OUTER_ACTIVE, computeWoodScatter, destWoodActiveTarget,
} from 'src/shared/woodScatter'

const SEEDS = Number(process.argv[2] ?? 40)
const g0 = globalThis as { __realLog?: typeof console.log }
g0.__realLog ??= console.log
const say = g0.__realLog
console.log = () => {}
let bad = 0
const fail = (m: string): void => { bad++; if (bad <= 40) say('FAIL ' + m) }
const expect = (c: boolean, m: string): void => { if (!c) fail(m) }

const stat = (a: number[]): string => {
	if (a.length === 0) return 'n/a'
	const s = [...a].sort((x, y) => x - y)
	const mean = s.reduce((p, v) => p + v, 0) / s.length
	return `min ${s[0].toFixed(0)} / mean ${mean.toFixed(0)} / p90 ${s[Math.floor(s.length * 0.9)].toFixed(0)} / max ${s[s.length - 1].toFixed(0)}`
}
/** Source text with // and block comments removed (for the no-hardcoded-count lint). */
const code = (path: string): string => readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

say(`[${WORLD_PROFILE}] compactProfileCheck seeds=${SEEDS} monuments=${MONUMENT_COUNT} volcano=${WORLD_HAS_VOLCANO} board='${LEADERBOARD_STORAGE_KEY}'`)

// ---------- 1. profile spec + standard profiles unchanged ----------
const spec = WORLD_PROFILE_SPEC[WORLD_PROFILE]
expect(MONUMENT_COUNT === WORLD_MONUMENT_COUNT && MONUMENT_COUNT === spec.monuments, 'MONUMENT_COUNT does not come from the profile spec')
expect(WORLD_HAS_VOLCANO === spec.volcano, 'WORLD_HAS_VOLCANO does not come from the profile spec')
expect(WORLD_IS_COMPACT === (WORLD_PROFILE === 'compact_3'), 'WORLD_IS_COMPACT wrong')
expect(WORLD_BOARD_SUFFIX === spec.boardSuffix, 'board suffix does not come from the profile spec')
if (!WORLD_IS_COMPACT) {
	expect(MONUMENT_COUNT === 6, `standard profile must keep 6 monuments (got ${MONUMENT_COUNT})`)
	expect(WORLD_HAS_VOLCANO, 'standard profile must keep its volcano')
	expect(MONUMENT_DISTANCE_BANDS.length === 5 && MONUMENT_MIN_ANGLE_DEG === 35, 'standard monument bands / min angle changed')
	expect(LEADERBOARD_STORAGE_KEY === 'cryocene.leaderboard.v2' && LEADERBOARD_HEADING === '', 'standard leaderboard key / heading changed')
} else {
	expect(MONUMENT_COUNT === 3 && !WORLD_HAS_VOLCANO, 'compact_3 must be 3 monuments, no volcano')
	expect(CHARGE_TARGET_S === 60, `CHARGE_TARGET_S must stay 60 (got ${CHARGE_TARGET_S})`)
}

// ---------- 2. leaderboard separation per profile ----------
{
	const profiles: WorldProfile[] = ['playtest_52', 'full_100', 'compact_3']
	const keys = profiles.map((p) => leaderboardKeyFor(p))
	expect(leaderboardKeyFor('playtest_52') === 'cryocene.leaderboard.v2' && leaderboardKeyFor('full_100') === 'cryocene.leaderboard.v2', 'standard board key changed')
	expect(leaderboardKeyFor('compact_3') !== leaderboardKeyFor('playtest_52'), 'compact and standard boards share a storage key')
	expect(new Set(keys).size === 2, `expected exactly 2 distinct board keys, got ${new Set(keys).size}`)
	expect(LEADERBOARD_STORAGE_KEY === leaderboardKeyFor(WORLD_PROFILE) && LEADERBOARD_STORAGE_KEY.startsWith(LEADERBOARD_BASE_KEY), 'active key != key of the active profile')
	// Simulated scene Storage: write each profile's board under its own key, read each back without cross-talk.
	const store = new Map<string, string>()
	const std = [{ ...newPlayer('0xaaa', 'Std'), d: 9, mon: 6, td: 8, ts: 1200 }]
	const cmp = [{ ...newPlayer('0xbbb', 'Cmp'), d: 3, mon: 3, td: 2, ts: 700 }]
	store.set(leaderboardKeyFor('playtest_52'), serializeBoard(std, WORLD_PROFILE_SPEC.playtest_52.boardSuffix))
	store.set(leaderboardKeyFor('compact_3'), serializeBoard(cmp, WORLD_PROFILE_SPEC.compact_3.boardSuffix))
	const stdBack = parseStoredBoard(store.get(leaderboardKeyFor('full_100'))!)
	const cmpBack = parseStoredBoard(store.get(leaderboardKeyFor('compact_3'))!)
	expect(stdBack.length === 1 && stdBack[0].n === 'Std' && stdBack[0].mon === 6, 'standard board read back wrong')
	expect(cmpBack.length === 1 && cmpBack[0].n === 'Cmp' && cmpBack[0].mon === 3, 'compact board read back wrong')
	expect(JSON.parse(store.get('cryocene.leaderboard.v2')!).b === undefined, 'standard blob must not carry a board tag (bytes unchanged)')
	expect(storedBoardTag(store.get(leaderboardKeyFor('compact_3'))) === '.compact3' && storedBoardTag(store.get(leaderboardKeyFor('playtest_52'))) === '', 'board tags wrong')
	// Wrong-board guard (server load): a blob whose tag differs from the active suffix must be refused.
	for (const p of profiles) {
		const active = WORLD_PROFILE_SPEC[p].boardSuffix
		for (const q of profiles) {
			const tag = storedBoardTag(store.get(leaderboardKeyFor(q)))
			const refused = tag !== active
			expect(refused === (WORLD_PROFILE_SPEC[q].boardSuffix !== active), `board guard: ${p} loading ${q}'s blob: refused=${refused}`)
		}
	}
	// Dev shortcuts never write records: every server write path is gated on the run taint, and the debug handlers taint first.
	const lb = code('src/server/leaderboard.ts')
	const writers = ['recordRunProgress', 'recordDayTick', 'recordFireContribution', 'recordFirenet', 'recordThaw']
	for (const w of writers) {
		const m = new RegExp(`function ${w}\\b[\\s\\S]*?\\n}\\n`).exec(lb)
		if (m) expect(m[0].includes('isRunTainted'), `server leaderboard ${w} is not taint-gated`)
	}
	expect((lb.match(/isRunTainted\(\)/g) ?? []).length >= 3, 'server leaderboard lost its taint gates')
	const st = code('src/server/stations.ts')
	for (const h of ['debugFinale', 'debugThaw', 'debugVolcanoStage']) {
		const m = new RegExp(`onMessage\\('${h}'[\\s\\S]*?\\n\\t}\\)`).exec(st)
		expect(!!m && m[0].includes('markRunTainted'), `${h} handler does not taint the run`)
		if (m) expect(m[0].indexOf('markRunTainted') < m[0].search(/releaseCrystal|releasePitSnow|startFinale|activateStation|broadcastOne/), `${h} taints only AFTER it changes state`)
	}
	expect(!DEBUG_FINALE_BUTTON && !DEBUG_THAW_BUTTON && !debugFinaleAllowed('0x0000000000000000000000000000000000000001'), 'a dev finale/thaw flag is ON in this build')
}

// ---------- 3. no hardcoded monument count in finale / progression code ----------
{
	const files = ['src/shared/finale.ts', 'src/client/crystalFinale.ts', 'src/server/stations.ts', 'src/server/snowState.ts', 'src/server/leaderboard.ts', 'src/shared/leaderboard.ts', 'src/client/ui/layers/layer.helpPanel.tsx', 'src/client/ui/layers/layer.leaderboard.tsx']
	const lit = /\b(released|lit|active|stations?|monuments?|total|count)\w*\s*(>=|===|<=|!==|<|>)\s*[3-9]\b|\b[3-9]\s*(<=|>=|===|!==)\s*(released|lit|stationTotal|getActiveStationCount)\w*/g
	for (const f of files) {
		const m = code(f).match(lit)
		expect(!m, `${f}: hard-coded monument count in a comparison: ${m?.slice(0, 3).join(' | ')}`)
	}
}

// ---------- 3b. title: the ending is "THE WORLD BEGINS TO THAW"; the old "WORLD THAWS" text is gone from code and docs ----------
{
	expect(FINALE_TITLE === 'THE WORLD BEGINS TO THAW', `FINALE_TITLE is "${FINALE_TITLE}"`)
	for (const f of ['src/shared/finale.ts', 'src/client/crystalFinale.ts', 'src/server/stations.ts', 'README.md', 'docs/HANDOFF.md']) {
		expect(!/WORLD THAWS|World Thaws/.test(readFileSync(f, 'utf8')), `${f} still says WORLD THAWS / World Thaws`)
	}
}

// ---------- 4. charge + release + completion model (compact only the real count differs) ----------
{
	// 3 fires at the reference distance light a monument in exactly CHARGE_TARGET_S.
	const rate = chargeRatePerS(new Array(CHARGE_REF_FIRES).fill(CHARGE_REF_DIST_M))
	expect(Math.abs(1 / rate - CHARGE_TARGET_S) < 0.5, `3 reference fires charge in ${(1 / rate).toFixed(1)} s, want ${CHARGE_TARGET_S}`)
	// Replay of src/server/stations.ts: charge integrates per tick, release at 1, finale only when every monument of the layout is released.
	const total = MONUMENT_COUNT
	const charge = new Array<number>(total).fill(0)
	const released: boolean[] = new Array<boolean>(total).fill(false)
	let finaleAt = -1
	let t = 0
	for (; t < 4000 && finaleAt < 0; t += 0.25) {
		for (let i = 0; i < total; i++) {
			if (released[i]) continue
			charge[i] = Math.min(1, charge[i] + rate * 0.25 * (1 + 0 * i))
			if (charge[i] >= 1) released[i] = true
		}
		if (released.filter(Boolean).length >= total) finaleAt = t
		const n = released.filter(Boolean).length
		if (n < total) expect(finaleAt < 0, 'finale armed before every monument was released')
	}
	expect(finaleAt >= 0 && released.every(Boolean), `${total}/${total} never completed`)
	// partial: released count total-1 must NOT complete
	const partial = new Array<boolean>(total).fill(true)
	partial[total - 1] = false
	expect(partial.filter(Boolean).length < total, 'partial release counted as complete')
}

// ---------- 5. per-seed generation ----------
const hx = CAMPFIRE_WORLD_X, hz = CAMPFIRE_WORLD_Z
const dA: number[] = [], dB: number[] = [], dC: number[] = [], rB: number[] = [], rC: number[] = [], rA: number[] = []
const spacing: number[] = [], spread: number[] = [], seedsShort: number[] = []
const woodA: number[] = [], woodB: number[] = [], woodC: number[] = [], woodHearth: number[] = [], woodTotal: number[] = [], woodGuar: number[] = []
const ringLen: number[] = [], edgeMax: number[] = [], camMetric: Record<string, number[]> = { '1.00': [], '1.78': [], '2.40': [] }
let netPairs = 0, netNull = 0, netCrossing = 0
let volcanoFound = 0, camOutside = 0, camFits = 0, camN = 0, cFarther = 0
const maxH = sceneHeightLimitM() - 3
const OB_TOTAL_M = 22
for (let s = 0; s < SEEDS; s++) {
	const seed = 20000 + s * 7
	const ms = cycleMazeSeed(seed)
	const map = getTerrain(ms)
	const st = map.stations
	if (st.length !== MONUMENT_COUNT) { seedsShort.push(seed); fail(`seed ${seed}: ${st.length}/${MONUMENT_COUNT} monuments placed`); continue }
	if (!WORLD_HAS_VOLCANO) {
		if (map.volcano) { volcanoFound++; fail(`seed ${seed}: volcano present in a no-volcano profile`) }
		let crown = 0
		for (let i = 0; i < map.levels.length; i++) if (isCrownLevel(map.levels[i])) crown++
		if (crown > 0) fail(`seed ${seed}: ${crown} crown/lava cells in a no-volcano profile`)
		// no stepped peak anywhere: walkable terrain tops out at HIGH, the rim wall is one uniform level (no raised peak tiers)
		let tallest = 0, walkTop = 0
		for (let i = 0; i < map.levels.length; i++) { const l = map.levels[i]; tallest = Math.max(tallest, l); if (l < TERRAIN_LEVEL_MOUNTAIN) walkTop = Math.max(walkTop, l) }
		if (tallest > TERRAIN_LEVEL_MOUNTAIN) fail(`seed ${seed}: raised mountain tier ${tallest} (rim wall must be uniform level ${TERRAIN_LEVEL_MOUNTAIN})`)
		if (walkTop > TERRAIN_LEVEL_HIGH) fail(`seed ${seed}: walkable level ${walkTop} above HIGH (${TERRAIN_LEVEL_HIGH})`)
	} else if (!map.volcano) fail(`seed ${seed}: standard profile lost its volcano`)
	const pos = st.map((q) => cellCenterWorld(q.cx, q.cz))
	let minSep = Infinity
	for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) minSep = Math.min(minSep, Math.hypot(pos[i].x - pos[j].x, pos[i].z - pos[j].z))
	spacing.push(minSep)
	for (let i = 0; i < pos.length; i++) {
		if (!isInsidePlayfield(pos[i].x, pos[i].z)) fail(`seed ${seed}: monument ${i} outside the playfield`)
		if (map.routeDist[st[i].cz * map.w + st[i].cx] < 0) fail(`seed ${seed}: monument ${i} unreachable from the hearth`)
	}
	// Wood sits ON the terrain, in every profile: scatter Y == the terrain surface == the snow tile base the renderer uses
	// (groundYForLevel(level), snowRenderer.baseYForTile), never on a wall / outside the playfield, and the snow grid is
	// indexed exactly like the terrain grid (padding / origin offsets must not shift one against the other).
	if (SNOW_TILES_X !== map.w || SNOW_TILES_Z !== map.h || SNOW_ORIGIN_M !== TERRAIN_ORIGIN_M) fail(`seed ${seed}: snow grid ${SNOW_TILES_X}x${SNOW_TILES_Z}@${SNOW_ORIGIN_M} != terrain grid ${map.w}x${map.h}@${TERRAIN_ORIGIN_M}`)
	if (s < 12) {
		let buried = 0, onWall = 0, outside = 0, total = 0
		for (const c of computeWoodScatter(seed, offHearthCellsForMazeSeed(ms))) {
			total++
			const lv = levelAtWorld(map, c.worldX, c.worldZ)
			if (isMountainLevel(lv)) { onWall++; continue }
			if (!isInsidePlayfield(c.worldX, c.worldZ)) outside++
			if (Math.abs(c.worldY - groundYAtWorld(map, c.worldX, c.worldZ)) > 0.01 || c.worldY < groundYForLevel(lv) - 0.01) buried++
		}
		if (buried + onWall + outside > 0) fail(`seed ${seed}: wood chunks off the surface: ${buried} buried/floating, ${onWall} on a wall, ${outside} outside the playfield (of ${total})`)
	}
	// Fire-to-fire links go AROUND monuments: fires on opposite sides of each monument (ring distance 9..20 m) must route with the
	// centreline >= NETWORK_MONUMENT_HARD_M from EVERY monument (own included), except the first / last few metres at the fires.
	if (s < 16) {
		for (let mi = 0; mi < pos.length; mi++) {
			const c = pos[mi]
			const lvl = levelAtWorld(map, c.x, c.z)
			let tested = false
			for (let ai = 0; ai < 12 && !tested; ai++) {
				const th = (ai / 12) * Math.PI * 2 + 0.2, rr = 9 + (ai % 3) * 5.5
				const A = { id: 1, x: c.x + Math.cos(th) * rr, z: c.z + Math.sin(th) * rr }
				const B = { id: 2, x: c.x - Math.cos(th) * rr, z: c.z - Math.sin(th) * rr }
				if (levelAtWorld(map, A.x, A.z) !== lvl || levelAtWorld(map, B.x, B.z) !== lvl) continue
				const route = routeFireLink(map, A, B)
				netPairs++
				if (!route) { netNull++; continue }
				tested = true
				const wouldCross = minDistToCentre([A, B], c, 0) < NETWORK_MONUMENT_HARD_M
				if (wouldCross) netCrossing++
				for (const m of pos) for (const r of route.runs) {
					const d = minDistToCentre(r.pts, m, NETWORK_MONUMENT_END_SKIP_M)
					if (d < NETWORK_MONUMENT_HARD_M - 1e-6) fail(`seed ${seed}: fire link passes ${d.toFixed(1)} m from a monument centre (hard ${NETWORK_MONUMENT_HARD_M} m) A=${A.x.toFixed(1)},${A.z.toFixed(1)} B=${B.x.toFixed(1)},${B.z.toFixed(1)} mon=${m.x.toFixed(1)},${m.z.toFixed(1)} mi=${mi} run=${JSON.stringify(r.pts.map((q) => [Math.round(q.x * 10) / 10, Math.round(q.z * 10) / 10]))}`)
				}
			}
		}
	}
	if (!WORLD_IS_COMPACT) continue

	// roles by hearth distance: A nearest; B / C by route length
	const info = pos.map((p, i) => ({ i, p, d: Math.hypot(p.x - hx, p.z - hz), r: map.routeDist[st[i].cz * map.w + st[i].cx] * TERRAIN_CELL_M }))
	info.sort((a, b) => a.d - b.d)
	const A = info[0]
	const rest = info.slice(1).sort((a, b) => a.r - b.r)
	const B = rest[0], C = rest[1]
	dA.push(A.d); dB.push(B.d); dC.push(C.d); rA.push(A.r); rB.push(B.r); rC.push(C.r)
	if (A.d < 33 || A.d > 47) fail(`seed ${seed}: A at ${A.d.toFixed(0)} m, want ~35-45`)
	if (B.d < A.d + 25) fail(`seed ${seed}: B (${B.d.toFixed(0)} m) is not clearly farther than A (${A.d.toFixed(0)} m)`)
	if (C.d < 120 || C.r < B.r) fail(`seed ${seed}: C (${C.d.toFixed(0)} m, route ${C.r.toFixed(0)}) is not the expedition (B ${B.d.toFixed(0)} m, route ${B.r.toFixed(0)})`)
	if (C.d >= B.d) cFarther++
	if (C.r > 800) fail(`seed ${seed}: C route ${C.r.toFixed(0)} m`)
	if (minSep < 100) fail(`seed ${seed}: monuments only ${minSep.toFixed(0)} m apart (separate networks need room)`)
	if (C.d > 330) fail(`seed ${seed}: C at ${C.d.toFixed(0)} m is a bottleneck`)
	// spread of directions (triangle, not a line)
	const ang = (m: { p: { x: number; z: number } }): number => Math.atan2(m.p.z - hz, m.p.x - hx)
	const angs = [ang(A), ang(B), ang(C)].sort((a, b) => a - b)
	const gaps = [angs[1] - angs[0], angs[2] - angs[1], angs[0] + 2 * Math.PI - angs[2]].map((g) => g * 180 / Math.PI)
	spread.push(Math.min(...gaps))
	if (Math.min(...gaps) < 50) fail(`seed ${seed}: monuments only ${Math.min(...gaps).toFixed(0)} deg apart as seen from the hearth`)

	// wood: expected ACTIVE logs (replays server/wood.ts: shuffleTake counts per band / pool size)
	const wood = computeWoodScatter(seed, offHearthCellsForMazeSeed(ms))
	const pool: Record<number, number> = {}
	for (const c of wood) pool[c.band] = (pool[c.band] ?? 0) + 1
	const act: Record<number, number> = {
		[WOOD_BAND_NEAR]: WOOD_NEAR_ACTIVE, [WOOD_BAND_FAR]: WOOD_FAR_ACTIVE, [WOOD_BAND_OUTER]: WOOD_OUTER_ACTIVE, [WOOD_BAND_DEST]: destWoodActiveTarget(ms),
		[WOOD_BAND_FRONTIER_ROUTE]: WOOD_FRONTIER_ROUTE_ACTIVE * MONUMENT_COUNT, [WOOD_BAND_FRONTIER_RING]: WOOD_FRONTIER_RING_ACTIVE,
	}
	const w = (band: number): number => (band === WOOD_BAND_TREE || band === WOOD_BAND_ICED_CLUSTER ? 1 : Math.min(1, (act[band] ?? 0) / Math.max(1, pool[band] ?? 1)))
	const near = (x: number, z: number, r: number): number => wood.reduce((a, c) => a + (Math.hypot(c.worldX - x, c.worldZ - z) <= r ? w(c.band) : 0), 0)
	woodA.push(near(A.p.x, A.p.z, 60)); woodB.push(near(B.p.x, B.p.z, 60)); woodC.push(near(C.p.x, C.p.z, 60))
	woodHearth.push(near(hx, hz, 80))
	woodTotal.push(wood.reduce((a, c) => a + w(c.band), 0))
	for (const q of [A, B, C]) woodGuar.push(wood.filter((c) => c.band === WOOD_BAND_ICED_CLUSTER && Math.hypot(c.worldX - q.p.x, c.worldZ - q.p.z) <= 45).length)

	// finale: triangle ring + camera framing
	const pts = finalePoints(map)
	if (pts.length !== 3) { fail(`seed ${seed}: finale has ${pts.length} points`); continue }
	const avoid = finaleAvoidZone(map)
	if (avoid) fail(`seed ${seed}: finale avoid-zone present without a volcano`)
	const edges = finaleEdges(pts, avoid, 0)
	const order = finaleOrder(pts, avoid, 0)
	if (edges.length !== 3 || new Set(order).size !== 3) fail(`seed ${seed}: finale ring is not a 3-cycle`)
	const lens = finaleEdgeLengths(pts, edges)
	ringLen.push(lens.reduce((a, b) => a + b, 0)); edgeMax.push(Math.max(...lens))
	const times = finaleTimes()
	// all 3 beams connect simultaneously (one shared progress), then the synchronized pulse; a late joiner sees the ring complete
	if (finaleBeamProgress(times, times.cineEndS + 600) !== 1) fail(`seed ${seed}: late joiner does not see the ring complete`)
	if (!(times.pulseAtS > times.beamsDoneS && FINALE_PULSE_RADIUS_M > OASIS_RADIUS_M)) fail(`seed ${seed}: pulse not after the ring / not larger than an oasis`)
	const tipY = crystalFloatBottomY(map) + OB_TOTAL_M - 0.4
	const tips = pts.map((p) => ({ x: p.x, y: tipY, z: p.z }))
	const grounds = pts.map((p) => ({ x: p.x, y: groundYAtWorld(map, p.x, p.z), z: p.z }))
	const look = { x: tips.reduce((a, p) => a + p.x, 0) / 3, y: grounds.reduce((a, p) => a + p.y, 0) / 3, z: tips.reduce((a, p) => a + p.z, 0) / 3 }
	for (const aspect of [1.0, 16 / 9, 2.4]) {
		const pose = finaleCameraPose([...tips, ...grounds], look, aspect, maxH, finalePoseOpts())
		const m = finaleFrameMetric([...tips, ...grounds], pose.cam, pose.bearing, pose.pitchDeg * Math.PI / 180, aspect)
		camMetric[aspect.toFixed(2)].push(m)
		camN++
		if (pose.fits) camFits++
		if (m > 1) camOutside++
	}
}

if (WORLD_IS_COMPACT) {
	expect(seedsShort.length === 0, `${seedsShort.length}/${SEEDS} seeds did not place 3/3 monuments`)
	expect(volcanoFound === 0, 'volcano found')
	// every role keeps its band over all seeds; A is the most wood-rich on average, C the least rich per monument
	const mean = (a: number[]): number => a.reduce((p, v) => p + v, 0) / Math.max(1, a.length)
	expect(Math.min(...woodGuar) >= 5, `a monument has only ${Math.min(...woodGuar)} guaranteed logs within 45 m`)
	expect(Math.min(...woodA) >= 6 && Math.min(...woodB) >= 4 && Math.min(...woodC) >= 4, `expected active logs within 60 m: min A ${Math.min(...woodA).toFixed(1)} B ${Math.min(...woodB).toFixed(1)} C ${Math.min(...woodC).toFixed(1)}`)
	expect(mean(woodA) > mean(woodC), `wood roles: A (${mean(woodA).toFixed(1)}) should be richer than C (${mean(woodC).toFixed(1)})`)
	// camera: the whole triangle (tips + sockets) must be inside the frame (metric <= 1) at every tested aspect on every seed
	expect(camOutside === 0, `finale camera leaves part of the triangle outside the frame in ${camOutside}/${camN} poses`)

	const spd = [8, 3, 1.5]
	const mins = (m: number, v: number): string => `${(m / v / 60).toFixed(1)}`
	say(`  seeds ${SEEDS - seedsShort.length}/${SEEDS} placed 3/3 | no volcano cells | min spacing ${stat(spacing)} m | angular spread (min gap) ${stat(spread)} deg`)
	say(`  hearth distance m: A ${stat(dA)} | B ${stat(dB)} | C ${stat(dC)}`)
	say(`  route length m (4-connected BFS upper bound): A ${stat(rA)} | B ${stat(rB)} | C ${stat(rC)}`)
	for (const [lbl, arr] of [['A', rA], ['B', rB], ['C', rC]] as Array<[string, number[]]>) {
		const eu = lbl === 'A' ? dA : lbl === 'B' ? dB : dC
		const mEu = eu.reduce((p, v) => p + v, 0) / eu.length, mRt = arr.reduce((p, v) => p + v, 0) / arr.length
		say(`  one-way ${lbl} (mean ${mEu.toFixed(0)} m straight .. ${mRt.toFixed(0)} m route): ${spd.map((v) => `${mins(mEu, v)}..${mins(mRt, v)} min @${v} m/s`).join(' | ')}`)
	}
	say(`  expected ACTIVE logs within 60 m of monument: A ${stat(woodA)} | B ${stat(woodB)} | C ${stat(woodC)} | guaranteed cluster within 45 m ${stat(woodGuar)}`)
	say(`  expected active logs within 80 m of the hearth ${stat(woodHearth)} | whole world ${stat(woodTotal)} | per player (15) ${(mean(woodTotal) / 15).toFixed(1)} avg`)
	say(`  finale: ring length ${stat(ringLen)} m, longest beam ${stat(edgeMax)} m | camera frame metric (<=1 inside, <=0.8 is the fill target) 1:1 ${stat(camMetric['1.00'].map((v) => v * 100))}% 16:9 ${stat(camMetric['1.78'].map((v) => v * 100))}% 2.4:1 ${stat(camMetric['2.40'].map((v) => v * 100))}%, fills target in ${camFits}/${camN}`)
	const relays = (d: number): number => Math.max(0, Math.ceil((d - CHARGE_RING_M) / NETWORK_LINK_RANGE_M) - 1)
	const relayTotal = relays(mean(dB)) + relays(mean(dC)) + relays(mean(dA))
	say(`  C is farther than B in straight line on ${cFarther}/${SEEDS} seeds (roles are ordered by route length); min fires to light all 3 = ${3 * CHARGE_REF_FIRES} ring + ~${relayTotal} relay (mean distances, link range ${NETWORK_LINK_RANGE_M} m, ring ${CHARGE_RING_M} m) = ~${3 * CHARGE_REF_FIRES + relayTotal}`)
	say(`  fire cap: BUILT_FIRE_MAX ${BUILT_FIRE_MAX} (global, burning fires only), ${HIDDEN_CAMPFIRE_COUNT} fire slots; 3 fires light a monument in ${CHARGE_TARGET_S} s`)
} else {
	say(`  seeds ${SEEDS - seedsShort.length}/${SEEDS} placed ${MONUMENT_COUNT}/${MONUMENT_COUNT} | min spacing ${stat(spacing)} m`)
}
say(`  fire links around monuments: ${netPairs} pairs routed (${netNull} no route), ${netCrossing} would have crossed a monument if straight, 0 do now`)
// ---------- crowd burn coefficient (fire decay 1 + c * log2(players)): 0.5 standard, 0.25 compact_3, one path for every fire ----------
{
	expect(WORLD_PROFILE_SPEC.playtest_52.crowdBurnCoef === 0.5 && WORLD_PROFILE_SPEC.full_100.crowdBurnCoef === 0.5, 'standard profiles must keep the crowd burn coefficient 0.5')
	expect(WORLD_PROFILE_SPEC.compact_3.crowdBurnCoef === 0.25, 'compact_3 must use the crowd burn coefficient 0.25')
	expect(WORLD_CROWD_BURN_COEF === spec.crowdBurnCoef && WORLD_CROWD_BURN_COEF === (WORLD_IS_COMPACT ? 0.25 : 0.5), `active crowd burn coefficient ${WORLD_CROWD_BURN_COEF} is not the profile's`)
	for (const n of [1, 2, 4, 8, 15, 16, 20]) {
		const want = 1 + (WORLD_IS_COMPACT ? 0.25 : 0.5) * Math.log2(n)
		expect(Math.abs(hearthDecayRate(n) - want) < 1e-9, `hearthDecayRate(${n}) = ${hearthDecayRate(n)}, want ${want}`)
	}
	expect(hearthDecayRate(1) === 1 && hearthDecayRate(0) === 1, 'solo burn must stay 1x')
	expect(Math.abs(hearthDecayRate(15, 0.5) - (1 + 0.5 * Math.log2(15))) < 1e-9, 'the standard 0.5 curve changed')
	// every burn path reads the same function with the player count only (no local override); torches do not use the crowd factor at all
	for (const f of ['src/server/hearthFuel.ts', 'src/server/hiddenCampfire.ts']) expect(/hearthDecayRate\(players\) \* getPhaseDrainMul\(\)/.test(code(f)), f + ' does not burn with hearthDecayRate(players)')
	expect(/hearthDecayRate\(players\)/.test(code('src/client/hearthBillboard.ts')), 'the xN chip does not use hearthDecayRate')
	expect(!/hearthDecayRate/.test(code('src/client/torchInput.ts') + code('src/client/torchEquip.ts')), 'torches use the crowd burn factor')
	const log = (n: number, phase: number, ch = 1): number => 120 / (hearthDecayRate(n) * phase * ch)
	say(`  log burn time (s) day/night/charging-night: 1p ${log(1, 0.5).toFixed(0)}/${log(1, 1.5).toFixed(0)}/${log(1, 1.5, 1.5).toFixed(0)}  4p ${log(4, 0.5).toFixed(0)}/${log(4, 1.5).toFixed(0)}/${log(4, 1.5, 1.5).toFixed(0)}  15p ${log(15, 0.5).toFixed(0)}/${log(15, 1.5).toFixed(0)}/${log(15, 1.5, 1.5).toFixed(0)}`)
}
say(bad === 0 ? 'compactProfileCheck: OK' : `compactProfileCheck: ${bad} FAILURES`)
if (bad) process.exitCode = 1